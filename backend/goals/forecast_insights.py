"""
Goal forecast insights: pace, projections, contribution suggestions, funding sources, scenarios.
"""
from __future__ import annotations

import calendar
from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from django.db.models import Sum

from goals.models import GoalBucket, GoalContribution, RuleAllocation
from goals.services import (
    _add_months,
    _decimal,
    _quantize_money,
    _serialize_decimal,
    calculate_projected_completion,
)
from timeline.models import RecurringRule, Scenario, ScenarioRuleOverride

PACE_AHEAD = "ahead"
PACE_ON_TRACK = "on_track"
PACE_BEHIND = "behind"
PACE_STALLED = "stalled"
PACE_COMPLETED = "completed"

FREQ_LABELS = {
    RecurringRule.Frequency.WEEKLY: "week",
    RecurringRule.Frequency.BIWEEKLY: "paycheck",
    RecurringRule.Frequency.MONTHLY_DAY: "month",
    RecurringRule.Frequency.MONTHLY_NTH_WEEKDAY: "month",
    RecurringRule.Frequency.YEARLY: "year",
}


def _rule_amount_to_monthly(amount: Decimal, frequency: str) -> Decimal:
    if frequency == RecurringRule.Frequency.WEEKLY:
        return amount * Decimal("52") / Decimal("12")
    if frequency == RecurringRule.Frequency.BIWEEKLY:
        return amount * Decimal("26") / Decimal("12")
    if frequency in (
        RecurringRule.Frequency.MONTHLY_DAY,
        RecurringRule.Frequency.MONTHLY_NTH_WEEKDAY,
    ):
        return amount
    if frequency == RecurringRule.Frequency.YEARLY:
        return amount / Decimal("12")
    return amount


def _monthly_to_period_amount(monthly: Decimal, frequency: str) -> Decimal:
    """Convert a monthly required amount onto the actual paycheck/rule schedule."""
    if frequency == RecurringRule.Frequency.WEEKLY:
        return _quantize_money(monthly * Decimal("12") / Decimal("52"))
    if frequency == RecurringRule.Frequency.BIWEEKLY:
        return _quantize_money(monthly * Decimal("12") / Decimal("26"))
    if frequency in (
        RecurringRule.Frequency.MONTHLY_DAY,
        RecurringRule.Frequency.MONTHLY_NTH_WEEKDAY,
    ):
        return _quantize_money(monthly)
    if frequency == RecurringRule.Frequency.YEARLY:
        return _quantize_money(monthly * Decimal("12"))
    return _quantize_money(monthly)


def suggested_per_paycheck_amount(
    monthly_required: Decimal | None,
    linked_rules: list[dict[str, Any]],
) -> dict[str, str | None]:
    """Per-paycheck needed from monthly_required and the actual funding schedule.

    Hidden when frequency cannot be determined uniquely (no hardcoded biweekly fallback).
    """
    empty = {
        "suggested_per_paycheck": None,
        "paycheck_frequency": None,
        "paycheck_frequency_label": None,
    }
    if not monthly_required or monthly_required <= 0:
        return empty
    freqs = [rule.get("frequency") for rule in linked_rules if rule.get("frequency")]
    if not freqs:
        return empty
    unique = set(freqs)
    if len(unique) != 1:
        return empty
    freq = freqs[0]
    return {
        "suggested_per_paycheck": _serialize_decimal(_monthly_to_period_amount(monthly_required, freq)),
        "paycheck_frequency": freq,
        "paycheck_frequency_label": FREQ_LABELS.get(freq, "period"),
    }


def _months_between(start: date, end: date) -> int:
    if end <= start:
        return 1
    return max(
        1,
        (end.year - start.year) * 12
        + (end.month - start.month)
        + (1 if end.day > start.day else 0),
    )


def _monthly_from_contributions(
    bucket: GoalBucket,
    months: int,
    *,
    today: date,
    contribution_stats=None,
    context=None,
) -> Decimal:
    if contribution_stats is None and context is not None:
        contribution_stats = context.contribution_stats_by_bucket_id.get(bucket.id)
    if contribution_stats is not None:
        from goals.bucket_services import monthly_from_contribution_stats

        return monthly_from_contribution_stats(contribution_stats, months)
    since = today - timedelta(days=months * 31)
    total = (
        GoalContribution.objects.filter(bucket=bucket, date__gte=since).aggregate(s=Sum("amount"))[
            "s"
        ]
        or Decimal("0")
    )
    if total <= 0:
        return Decimal("0")
    return _quantize_money(_decimal(total) / Decimal(max(1, months)))


def _rule_allocation_amount(
    alloc: RuleAllocation,
    *,
    scenario: Scenario | None = None,
    scenario_overrides: dict | None = None,
) -> Decimal:
    rule = alloc.rule
    if not rule or not rule.active:
        return Decimal("0")
    if alloc.fixed_amount and alloc.fixed_amount > 0:
        portion = _decimal(alloc.fixed_amount)
    elif alloc.percent and alloc.percent > 0:
        base = abs(_decimal(rule.amount))
        if scenario:
            override = None
            if scenario_overrides is not None:
                override = scenario_overrides.get(rule.id)
            else:
                override = ScenarioRuleOverride.objects.filter(scenario=scenario, rule=rule).first()
            if override and override.override_amount is not None:
                base = abs(_decimal(override.override_amount))
            elif override and override.override_active is False:
                return Decimal("0")
        portion = base * _decimal(alloc.percent) / Decimal("100")
    else:
        return Decimal("0")
    return portion


def monthly_from_rules(
    bucket: GoalBucket,
    *,
    scenario: Scenario | None = None,
    context=None,
) -> Decimal:
    if context is not None:
        funding = context.funding_stats_by_bucket_id.get(bucket.id)
        if funding is not None:
            monthly = funding.rule_monthly_scenario if scenario else funding.rule_monthly
            return _quantize_money(monthly) if monthly > 0 else Decimal("0")
    rule_monthly = Decimal("0")
    from goals.bucket_services import iter_active_rule_allocations

    allocations = (
        context.active_allocations_by_bucket_id.get(bucket.id) if context is not None else None
    )
    overrides = context.scenario_overrides_by_rule_id if context is not None else None
    for alloc in iter_active_rule_allocations(bucket, allocations):
        portion = _rule_allocation_amount(
            alloc, scenario=scenario, scenario_overrides=overrides
        )
        if portion <= 0:
            continue
        rule = alloc.rule
        rule_monthly += _rule_amount_to_monthly(portion, rule.frequency)
    return _quantize_money(rule_monthly) if rule_monthly > 0 else Decimal("0")


def contribution_pace_monthly(
    bucket: GoalBucket,
    *,
    today: date | None = None,
    scenario: Scenario | None = None,
    contribution_stats=None,
    context=None,
) -> Decimal:
    """Best estimate of monthly funding: rules, target, or recent contribution history."""
    today = today or date.today()
    if context is not None:
        funding = context.funding_stats_by_bucket_id.get(bucket.id)
        if funding is not None:
            return funding.contribution_pace_monthly
    from_rules = monthly_from_rules(bucket, scenario=scenario, context=context)
    if from_rules > 0:
        return from_rules
    if bucket.monthly_target > 0:
        return _decimal(bucket.monthly_target)
    pace_3 = _monthly_from_contributions(
        bucket, 3, today=today, contribution_stats=contribution_stats, context=context
    )
    pace_6 = _monthly_from_contributions(
        bucket, 6, today=today, contribution_stats=contribution_stats, context=context
    )
    return max(pace_3, pace_6)


def has_funding_activity(
    bucket: GoalBucket,
    *,
    today: date | None = None,
    contribution_stats=None,
    context=None,
) -> bool:
    today = today or date.today()
    if bucket.monthly_target > 0:
        return True
    from goals.bucket_services import iter_active_rule_allocations

    allocations = (
        context.active_allocations_by_bucket_id.get(bucket.id) if context is not None else None
    )
    if any(True for _ in iter_active_rule_allocations(bucket, allocations)):
        return True
    if contribution_stats is None and context is not None:
        contribution_stats = context.contribution_stats_by_bucket_id.get(bucket.id)
    if contribution_stats is not None:
        return contribution_stats.recent_90d_count > 0
    since = today - timedelta(days=90)
    return GoalContribution.objects.filter(bucket=bucket, date__gte=since).exists()


def build_funding_info(bucket: GoalBucket, *, context=None) -> dict[str, Any]:
    linked_rules: list[dict[str, Any]] = []
    automatic_parts: list[str] = []
    from goals.bucket_services import iter_active_rule_allocations

    allocations = (
        context.active_allocations_by_bucket_id.get(bucket.id) if context is not None else None
    )
    for alloc in iter_active_rule_allocations(bucket, allocations):
        rule = alloc.rule
        if not rule or not rule.active:
            continue
        if alloc.fixed_amount and alloc.fixed_amount > 0:
            amt = _decimal(alloc.fixed_amount)
        elif alloc.percent and alloc.percent > 0:
            amt = abs(_decimal(rule.amount)) * _decimal(alloc.percent) / Decimal("100")
        else:
            continue
        freq = FREQ_LABELS.get(rule.frequency, "period")
        label = f"${_quantize_money(amt)}/{freq}"
        automatic_parts.append(label)
        linked_rules.append(
            {
                "rule_id": rule.id,
                "rule_name": rule.name,
                "amount": _serialize_decimal(amt),
                "frequency": rule.frequency,
                "frequency_label": freq,
                "label": label,
            }
        )

    funding_account_id = bucket.linked_account_id
    funding_account_name = (
        bucket.linked_account.effective_display_name if bucket.linked_account else None
    )
    automatic_transfer_label = None
    auto_transfer_rule_id = None
    if bucket.auto_fund_enabled:
        transfer_rule = None
        if context is not None:
            transfer_rule = context.auto_fund_rule_by_bucket_id.get(bucket.id)
        else:
            from goals.auto_fund import find_auto_fund_transfer_rule

            transfer_rule = find_auto_fund_transfer_rule(bucket)
        if transfer_rule and transfer_rule.active:
            auto_transfer_rule_id = transfer_rule.id
            freq = FREQ_LABELS.get(transfer_rule.frequency, "period")
            xfer_label = (
                f"Auto-transfer ${_quantize_money(_decimal(transfer_rule.amount))}/{freq} "
                f"to {funding_account_name or 'linked account'}"
            )
            automatic_parts.append(xfer_label)

    if automatic_parts:
        automatic_transfer_label = "Paycheck funding: " + "; ".join(automatic_parts)
    elif bucket.auto_fund_enabled and bucket.monthly_target > 0:
        automatic_transfer_label = f"Planned: ${_quantize_money(_decimal(bucket.monthly_target))}/mo"

    return {
        "funding_account_id": funding_account_id,
        "funding_account_name": funding_account_name,
        "linked_rules": linked_rules,
        "automatic_transfer_label": automatic_transfer_label,
        "auto_fund_transfer_rule_id": auto_transfer_rule_id,
        "has_automatic_funding": bool(linked_rules) or auto_transfer_rule_id is not None,
    }


def suggested_contributions(
    remaining: Decimal,
    target_date: date | None,
    *,
    today: date | None = None,
) -> dict[str, str | None]:
    today = today or date.today()
    if remaining <= 0 or not target_date or target_date <= today:
        return {
            "suggested_monthly": None,
            "suggested_biweekly": None,
            "suggested_weekly": None,
        }
    months = _months_between(today, target_date)
    monthly = _quantize_money(remaining / Decimal(months))
    biweekly = _quantize_money(monthly * Decimal("12") / Decimal("26"))
    weekly = _quantize_money(monthly * Decimal("12") / Decimal("52"))
    return {
        "suggested_monthly": _serialize_decimal(monthly),
        "suggested_biweekly": _serialize_decimal(biweekly),
        "suggested_weekly": _serialize_decimal(weekly),
    }


def compute_pace_status(
    bucket: GoalBucket,
    *,
    progress_percent: Decimal,
    on_track_status: str,
    monthly_pace: Decimal,
    projected: date | None,
    today: date | None = None,
    contribution_stats=None,
    context=None,
) -> str:
    today = today or date.today()
    if bucket.status == GoalBucket.Status.COMPLETED or progress_percent >= Decimal("100"):
        return PACE_COMPLETED
    if monthly_pace <= 0 and not has_funding_activity(
        bucket, today=today, contribution_stats=contribution_stats, context=context
    ):
        return PACE_STALLED
    if not bucket.target_date:
        return PACE_ON_TRACK if monthly_pace > 0 else PACE_STALLED
    if on_track_status == "ahead":
        return PACE_AHEAD
    if on_track_status == "behind":
        return PACE_BEHIND
    if projected and bucket.target_date and projected > bucket.target_date:
        return PACE_BEHIND
    return PACE_ON_TRACK


def projection_headline(
    pace_status: str,
    projected: date | None,
    target_date: date | None,
    *,
    today: date | None = None,
) -> str:
    today = today or date.today()
    if pace_status == PACE_COMPLETED:
        return "Goal completed"
    if pace_status == PACE_STALLED:
        return "No funding activity yet"
    if projected is None:
        if target_date and target_date > today:
            return "Target date likely unattainable at current contribution pace."
        return "Add contributions to see a completion estimate."

    month_year = projected.strftime("%b %Y")
    if pace_status in (PACE_AHEAD, PACE_ON_TRACK) and target_date and projected <= target_date:
        return f"On track for {month_year}"
    return f"At current pace: {month_year}"


def pace_warnings(
    pace_status: str,
    monthly_pace: Decimal,
    monthly_required: Decimal | None,
    *,
    target_date: date | None,
    today: date | None = None,
) -> list[str]:
    today = today or date.today()
    warnings: list[str] = []
    if pace_status == PACE_STALLED and target_date and target_date > today:
        warnings.append("No funding activity yet — set up transfers or contribute to stay on schedule.")
    if monthly_required and monthly_pace > 0 and monthly_required > monthly_pace:
        warnings.append("Current pace is too slow to reach your target date.")
    if pace_status == PACE_BEHIND and target_date and monthly_pace <= 0:
        warnings.append("Target date likely unattainable at current contribution pace.")
    return warnings


def contribution_recommendation_text(
    suggestions: dict[str, str | None],
    forecast_gap: Decimal | None,
    *,
    pace_status: str,
) -> str | None:
    monthly = suggestions.get("suggested_monthly")
    biweekly = suggestions.get("suggested_biweekly")
    if forecast_gap and forecast_gap > 0:
        return f"Add ${_quantize_money(forecast_gap)}/month to stay on pace"
    if monthly and pace_status in (PACE_BEHIND, PACE_ON_TRACK, PACE_AHEAD):
        parts = [f"Add ${monthly}/month to stay on pace"]
        if biweekly:
            parts.append(f"${biweekly}/paycheck needed to reach target")
        return " · ".join(parts)
    if monthly:
        return f"Add ${monthly}/month to stay on pace"
    return None


def build_forecast_growth(
    bucket: GoalBucket,
    *,
    current: Decimal,
    target: Decimal,
    monthly_pace: Decimal,
    today: date | None = None,
    months: int = 12,
    max_months: int = 60,
) -> list[dict[str, str]]:
    """Monthly projected balance points for charting.

    Horizon covers projected completion (same months_needed formula as
    calculate_projected_completion) and the target date when in range.
    """
    today = today or date.today()
    start = today.replace(day=1)
    horizon = months
    if monthly_pace > 0 and current < target:
        remaining = target - current
        months_needed = max(1, int((remaining + monthly_pace - Decimal("0.01")) / monthly_pace))
        horizon = max(horizon, min(months_needed, max_months))
    if bucket.target_date:
        target_start = bucket.target_date.replace(day=1)
        months_to_target = (target_start.year - start.year) * 12 + (target_start.month - start.month)
        if 0 <= months_to_target <= max_months:
            horizon = max(horizon, months_to_target)
    horizon = min(horizon, max_months)

    points: list[dict[str, str]] = []
    balance = current
    for i in range(horizon + 1):
        d = _add_months(start, i)
        if i > 0 and monthly_pace > 0:
            balance = min(target, balance + monthly_pace)
        points.append(
            {
                "month": d.strftime("%Y-%m"),
                "label": d.strftime("%b %Y"),
                "amount": _serialize_decimal(_quantize_money(balance)) or "0",
            }
        )
        reached_target = balance >= target
        past_target_date = not bucket.target_date or d >= bucket.target_date.replace(day=1)
        if reached_target and past_target_date and i >= min(months, horizon):
            break
    return points


def build_forecast_scenarios(
    bucket: GoalBucket,
    *,
    remaining: Decimal,
    base_monthly: Decimal,
    today: date | None = None,
) -> list[dict[str, Any]]:
    today = today or date.today()

    class _Proxy:
        target_date = bucket.target_date
        monthly_contribution = bucket.monthly_target
        contribution_rule = None

    proxy = _Proxy()
    scenarios = [
        ("current_pace", "Current pace", base_monthly),
        ("increased_pace", "20% higher contributions", base_monthly * Decimal("1.2") if base_monthly > 0 else Decimal("0")),
        ("missed_contributions", "Miss next 2 months", base_monthly),
    ]
    out: list[dict[str, Any]] = []
    for key, label, monthly in scenarios:
        effective_monthly = monthly
        extra_months = 0
        if key == "missed_contributions" and monthly > 0:
            extra_months = 2
        projected = calculate_projected_completion(
            proxy,
            remaining_amount=remaining,
            monthly_contribution=effective_monthly,
            today=today,
        )
        if projected and extra_months:
            projected = _add_months(projected, extra_months)
        out.append(
            {
                "id": key,
                "label": label,
                "monthly_pace": _serialize_decimal(_quantize_money(effective_monthly))
                if effective_monthly > 0
                else None,
                "projected_completion_date": projected.isoformat() if projected else None,
                "headline": projection_headline(
                    PACE_ON_TRACK if projected else PACE_STALLED,
                    projected,
                    bucket.target_date,
                    today=today,
                ),
            }
        )
    return out


def enrich_goal_forecast(
    bucket: GoalBucket,
    progress: dict[str, Any],
    *,
    today: date | None = None,
    scenario: Scenario | None = None,
    contribution_stats=None,
    context=None,
) -> dict[str, Any]:
    """Attach predictive fields to bucket progress dict."""
    today = today or date.today()
    remaining = _decimal(progress["remaining_amount"])
    progress_pct = _decimal(progress["progress_percent"])
    monthly_pace = contribution_pace_monthly(
        bucket,
        today=today,
        scenario=scenario,
        contribution_stats=contribution_stats,
        context=context,
    )

    from goals.bucket_services import _bucket_as_goal_proxy

    # Recompute projection with pace-aware monthly rate
    projected = None
    if bucket.forecast_enabled and monthly_pace > 0:
        projected = calculate_projected_completion(
            _bucket_as_goal_proxy(bucket),
            remaining_amount=remaining,
            monthly_contribution=monthly_pace,
            today=today,
        )
    elif remaining <= 0:
        projected = today

    on_track = progress.get("on_track_status", "no_target_date")
    if bucket.target_date and projected:
        if projected <= bucket.target_date:
            if (bucket.target_date - projected).days > 31:
                on_track = "ahead"
            else:
                on_track = "on_track"
        else:
            on_track = "behind"
    elif bucket.target_date and projected is None:
        on_track = "behind"

    pace_status = compute_pace_status(
        bucket,
        progress_percent=progress_pct,
        on_track_status=on_track,
        monthly_pace=monthly_pace,
        projected=projected,
        today=today,
        contribution_stats=contribution_stats,
        context=context,
    )

    monthly_required = _decimal(progress.get("monthly_required") or 0) or None
    if monthly_required is None and bucket.target_date and bucket.target_date > today and remaining > 0:
        months = _months_between(today, bucket.target_date)
        monthly_required = _quantize_money(remaining / Decimal(months))

    forecast_gap = None
    forecast_surplus = None
    if monthly_required and monthly_required > 0:
        gap = monthly_required - monthly_pace
        if gap > Decimal("0"):
            forecast_gap = gap
        else:
            forecast_gap = Decimal("0")
            forecast_surplus = -gap if gap < Decimal("0") else Decimal("0")

    suggestions = suggested_contributions(remaining, bucket.target_date, today=today)
    funding = build_funding_info(bucket, context=context)
    per_paycheck = suggested_per_paycheck_amount(monthly_required, funding["linked_rules"])
    warnings = pace_warnings(
        pace_status,
        monthly_pace,
        monthly_required,
        target_date=bucket.target_date,
        today=today,
    )
    headline = projection_headline(pace_status, projected, bucket.target_date, today=today)
    recommendation = contribution_recommendation_text(
        suggestions,
        forecast_gap,
        pace_status=pace_status,
    )

    current = _decimal(progress["current_amount"])
    target = _decimal(progress["target_amount"])

    pace_3 = _monthly_from_contributions(
        bucket, 3, today=today, contribution_stats=contribution_stats, context=context
    )
    pace_6 = _monthly_from_contributions(
        bucket, 6, today=today, contribution_stats=contribution_stats, context=context
    )
    return {
        **progress,
        "projected_completion_date": projected.isoformat() if projected else None,
        "on_track_status": on_track,
        "pace_status": pace_status,
        "projection_headline": headline,
        "contribution_pace_monthly": _serialize_decimal(monthly_pace) if monthly_pace > 0 else None,
        "pace_avg_3mo": _serialize_decimal(pace_3) if pace_3 > 0 else None,
        "pace_avg_6mo": _serialize_decimal(pace_6) if pace_6 > 0 else None,
        "monthly_required": _serialize_decimal(monthly_required) if monthly_required else progress.get("monthly_required"),
        "current_contribution_rate": _serialize_decimal(monthly_pace) if monthly_pace > 0 else None,
        "forecast_gap": _serialize_decimal(forecast_gap) if forecast_gap is not None else None,
        "forecast_surplus": _serialize_decimal(forecast_surplus) if forecast_surplus is not None else None,
        "suggested_monthly": suggestions["suggested_monthly"],
        "suggested_biweekly": suggestions["suggested_biweekly"],
        "suggested_weekly": suggestions["suggested_weekly"],
        "suggested_per_paycheck": per_paycheck["suggested_per_paycheck"],
        "paycheck_frequency": per_paycheck["paycheck_frequency"],
        "paycheck_frequency_label": per_paycheck["paycheck_frequency_label"],
        "suggested_contribution_amount": suggestions["suggested_monthly"],
        "contribution_recommendation": recommendation,
        "pace_warnings": warnings,
        "funding_account_id": funding["funding_account_id"],
        "funding_account_name": funding["funding_account_name"],
        "linked_rules": funding["linked_rules"],
        "automatic_transfer_label": funding["automatic_transfer_label"],
        "has_automatic_funding": funding["has_automatic_funding"],
        "funding_source_label": funding["funding_account_name"]
        or ("No automatic funding configured" if not funding["has_automatic_funding"] else None),
        "forecast_growth": build_forecast_growth(
            bucket, current=current, target=target, monthly_pace=monthly_pace, today=today
        ),
        "forecast_scenarios": build_forecast_scenarios(
            bucket, remaining=remaining, base_monthly=monthly_pace, today=today
        ),
    }


def build_goal_detail(
    bucket: GoalBucket,
    *,
    user,
    scenario_id: int | None = None,
    today: date | None = None,
) -> dict[str, Any]:
    from goals.bucket_services import (
        bucket_to_api_dict,
        build_goal_calculation_context,
        calculate_bucket_progress,
        enrich_bucket,
    )

    today = today or date.today()
    scenario = None
    if scenario_id:
        from core.utils import get_households_for_user

        households = get_households_for_user(user)
        scenario = Scenario.objects.filter(household__in=households, pk=scenario_id).first()

    context = build_goal_calculation_context(
        [bucket], today=today, as_of=today, user=user, scenario=scenario
    )
    base_progress = calculate_bucket_progress(bucket, today=today, user=user, context=context)
    enriched = enrich_bucket(
        bucket, base_progress, today=today, context=context, scenario=scenario
    )
    forecast = enriched

    if scenario:
        scenario_pace = contribution_pace_monthly(
            bucket, today=today, scenario=scenario, context=context
        )
        remaining = _decimal(forecast["remaining_amount"])
        if scenario_pace > 0 and bucket.forecast_enabled:

            class _Proxy:
                target_date = bucket.target_date
                monthly_contribution = bucket.monthly_target
                contribution_rule = None

            scenario_projected = calculate_projected_completion(
                _Proxy(),
                remaining_amount=remaining,
                monthly_contribution=scenario_pace,
                today=today,
            )
            forecast["scenario_projection"] = {
                "scenario_id": scenario.id,
                "scenario_name": scenario.name,
                "projected_completion_date": scenario_projected.isoformat()
                if scenario_projected
                else None,
                "projection_headline": projection_headline(
                    compute_pace_status(
                        bucket,
                        progress_percent=_decimal(forecast["progress_percent"]),
                        on_track_status=forecast["on_track_status"],
                        monthly_pace=scenario_pace,
                        projected=scenario_projected,
                        today=today,
                    ),
                    scenario_projected,
                    bucket.target_date,
                    today=today,
                ),
                "contribution_pace_monthly": _serialize_decimal(scenario_pace),
            }

    contributions = (
        GoalContribution.objects.filter(bucket=bucket)
        .select_related("account", "transaction")
        .order_by("-date", "-id")[:100]
    )
    history = [
        {
            "id": c.id,
            "amount": _serialize_decimal(_decimal(c.amount)),
            "date": c.date.isoformat(),
            "source": c.source,
            "account_id": c.account_id,
            "account_name": c.account.effective_display_name if c.account else None,
            "notes": c.notes,
        }
        for c in contributions
    ]

    return {
        "goal": bucket_to_api_dict(bucket, forecast),
        "contribution_history": history,
        "linked_rules": forecast.get("linked_rules", []),
        "forecast_growth": forecast.get("forecast_growth", []),
        "forecast_scenarios": forecast.get("forecast_scenarios", []),
        "scenario_projection": forecast.get("scenario_projection"),
    }
