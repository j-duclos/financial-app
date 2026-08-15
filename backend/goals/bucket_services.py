"""
Goal bucket allocations, forecasting, and safe-to-spend reserves.

Buckets reserve money on linked accounts via GoalContribution rows pointing at real
transactions. allocated_amount is denormalized from contributions for fast reads.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal
from typing import Any, Iterable
from django.db.models import Count, Q, Sum
from django.db.models.functions import Coalesce, TruncMonth
from django.utils import timezone

from accounts.services.credit_card import ledger_owed_balance
from goals.models import GoalBucket, GoalContribution, RuleAllocation
from timeline.models import RecurringRule
from timeline.services.ledger import _balance_at_end_of_date

from goals.services import (
    _linked_savings_balance,
    HEALTH_AHEAD,
    HEALTH_BEHIND,
    HEALTH_COMPLETED,
    HEALTH_NO_SCHEDULE,
    HEALTH_ON_TRACK,
    HEALTH_WATCH,
    _decimal,
    _on_track_status,
    _quantize_money,
    _recommended_monthly,
    _serialize_decimal,
    calculate_projected_completion,
)

PRIORITY_ORDER = {
    GoalBucket.Priority.HIGH: 0,
    GoalBucket.Priority.MEDIUM: 1,
    GoalBucket.Priority.LOW: 2,
}

GOAL_TYPE_TO_BUCKET = {
    "emergency_fund": GoalBucket.BucketType.EMERGENCY,
    "savings": GoalBucket.BucketType.CUSTOM,
    "house_down_payment": GoalBucket.BucketType.HOUSE,
    "college": GoalBucket.BucketType.EDUCATION,
    "vacation": GoalBucket.BucketType.VACATION,
    "taxes": GoalBucket.BucketType.PURCHASE,
    "car": GoalBucket.BucketType.PURCHASE,
    "purchase": GoalBucket.BucketType.PURCHASE,
    "debt_payoff": GoalBucket.BucketType.DEBT_PAYOFF,
    "custom": GoalBucket.BucketType.CUSTOM,
}

NUMERIC_PRIORITY_TO_BUCKET = {1: GoalBucket.Priority.HIGH, 2: GoalBucket.Priority.MEDIUM, 3: GoalBucket.Priority.MEDIUM}


@dataclass(frozen=True)
class BucketContributionStats:
    total: Decimal
    last_3_months: Decimal
    last_6_months: Decimal
    recent_90d_count: int


def _empty_contribution_stats() -> BucketContributionStats:
    return BucketContributionStats(
        total=Decimal("0"),
        last_3_months=Decimal("0"),
        last_6_months=Decimal("0"),
        recent_90d_count=0,
    )


def bulk_bucket_contribution_stats(
    bucket_ids: Iterable[int],
    *,
    today: date | None = None,
) -> dict[int, BucketContributionStats]:
    """Grouped contribution totals and recent windows for many buckets (one query)."""
    today = today or date.today()
    ids = [int(pk) for pk in bucket_ids]
    if not ids:
        return {}
    three_month_cutoff = today - timedelta(days=3 * 31)
    six_month_cutoff = today - timedelta(days=6 * 31)
    ninety_cutoff = today - timedelta(days=90)
    rows = (
        GoalContribution.objects.filter(bucket_id__in=ids)
        .values("bucket_id")
        .annotate(
            total=Coalesce(Sum("amount"), Decimal("0")),
            last_3_months=Coalesce(
                Sum("amount", filter=Q(date__gte=three_month_cutoff)),
                Decimal("0"),
            ),
            last_6_months=Coalesce(
                Sum("amount", filter=Q(date__gte=six_month_cutoff)),
                Decimal("0"),
            ),
            recent_90d_count=Count("id", filter=Q(date__gte=ninety_cutoff)),
        )
    )
    stats = {
        row["bucket_id"]: BucketContributionStats(
            total=_quantize_money(_decimal(row["total"])),
            last_3_months=_decimal(row["last_3_months"]),
            last_6_months=_decimal(row["last_6_months"]),
            recent_90d_count=int(row["recent_90d_count"] or 0),
        )
        for row in rows
    }
    for bucket_id in ids:
        stats.setdefault(bucket_id, _empty_contribution_stats())
    return stats


def monthly_from_contribution_stats(stats: BucketContributionStats, months: int) -> Decimal:
    total = stats.last_3_months if months <= 3 else stats.last_6_months
    if total <= 0:
        return Decimal("0")
    return _quantize_money(_decimal(total) / Decimal(max(1, months)))


@dataclass
class GoalFundingStats:
    """Authoritative monthly funding sources for one goal (computed once)."""

    rule_monthly: Decimal
    rule_monthly_scenario: Decimal
    explicit_monthly_target: Decimal
    contribution_pace_3mo: Decimal
    contribution_pace_6mo: Decimal

    @property
    def effective_monthly_for_bucket(self) -> Decimal:
        if self.rule_monthly > 0:
            return _quantize_money(self.rule_monthly)
        if self.explicit_monthly_target > 0:
            return self.explicit_monthly_target
        return self.contribution_pace_6mo

    @property
    def contribution_pace_monthly(self) -> Decimal:
        if self.rule_monthly_scenario > 0:
            return _quantize_money(self.rule_monthly_scenario)
        if self.explicit_monthly_target > 0:
            return self.explicit_monthly_target
        return max(self.contribution_pace_3mo, self.contribution_pace_6mo)


@dataclass
class GoalCalculationContext:
    """Bulk-loaded support data so per-goal metrics need no SQL."""

    today: date
    as_of: date
    contribution_stats_by_bucket_id: dict[int, BucketContributionStats] = field(default_factory=dict)
    active_allocations_by_bucket_id: dict[int, list] = field(default_factory=dict)
    funding_stats_by_bucket_id: dict[int, GoalFundingStats] = field(default_factory=dict)
    linked_balance_by_account_id: dict[int, Decimal] = field(default_factory=dict)
    debt_owed_by_account_id: dict[int, Decimal] = field(default_factory=dict)
    auto_fund_rule_by_bucket_id: dict = field(default_factory=dict)
    scenario_overrides_by_rule_id: dict = field(default_factory=dict)
    scenario: Any = None


def _rule_portion_for_alloc(alloc, *, override=None) -> Decimal:
    rule = alloc.rule
    if not rule or not rule.active:
        return Decimal("0")
    if override is not None and getattr(override, "override_active", True) is False:
        return Decimal("0")
    if alloc.fixed_amount and alloc.fixed_amount > 0:
        return _decimal(alloc.fixed_amount)
    if alloc.percent and alloc.percent > 0:
        base = abs(_decimal(rule.amount))
        if override is not None and getattr(override, "override_amount", None) is not None:
            base = abs(_decimal(override.override_amount))
        return base * _decimal(alloc.percent) / Decimal("100")
    return Decimal("0")


def _funding_stats_for_bucket(
    bucket: GoalBucket,
    *,
    contribution_stats: BucketContributionStats,
    allocations: list,
    scenario=None,
    scenario_overrides: dict | None = None,
) -> GoalFundingStats:
    rule_monthly = Decimal("0")
    rule_monthly_scenario = Decimal("0")
    for alloc in allocations:
        if not getattr(alloc, "active", True):
            continue
        portion = _rule_portion_for_alloc(alloc)
        if portion > 0:
            rule_monthly += _rule_amount_to_monthly(portion, alloc.rule.frequency)
        override = None
        if scenario is not None:
            override = (scenario_overrides or {}).get(alloc.rule_id)
        portion_s = _rule_portion_for_alloc(alloc, override=override) if scenario is not None else portion
        if portion_s > 0:
            rule_monthly_scenario += _rule_amount_to_monthly(portion_s, alloc.rule.frequency)
    return GoalFundingStats(
        rule_monthly=rule_monthly,
        rule_monthly_scenario=rule_monthly_scenario if scenario is not None else rule_monthly,
        explicit_monthly_target=_decimal(bucket.monthly_target),
        contribution_pace_3mo=monthly_from_contribution_stats(contribution_stats, 3),
        contribution_pace_6mo=monthly_from_contribution_stats(contribution_stats, 6),
    )


def build_goal_calculation_context(
    buckets: list[GoalBucket],
    *,
    today: date,
    as_of: date | None = None,
    user=None,
    scenario=None,
    contribution_stats: dict[int, BucketContributionStats] | None = None,
    signed_balances: dict[int, Decimal] | None = None,
) -> GoalCalculationContext:
    as_of = as_of or today
    ctx = GoalCalculationContext(today=today, as_of=as_of, scenario=scenario)
    if not buckets:
        return ctx

    bucket_ids = [b.id for b in buckets if b.id]
    ctx.contribution_stats_by_bucket_id = contribution_stats or bulk_bucket_contribution_stats(
        bucket_ids, today=today
    )

    allocs = list(
        RuleAllocation.objects.filter(bucket_id__in=bucket_ids, active=True).select_related("rule")
    )
    by_bucket: dict[int, list] = defaultdict(list)
    for alloc in allocs:
        by_bucket[alloc.bucket_id].append(alloc)
    ctx.active_allocations_by_bucket_id = {bid: by_bucket.get(bid, []) for bid in bucket_ids}

    if scenario is not None:
        from timeline.models import ScenarioRuleOverride

        ctx.scenario_overrides_by_rule_id = {
            o.rule_id: o
            for o in ScenarioRuleOverride.objects.filter(scenario=scenario)
        }

    savings_accounts = []
    debt_accounts = []
    seen_savings: set[int] = set()
    seen_debt: set[int] = set()
    for bucket in buckets:
        acc = bucket.linked_account if bucket.linked_account_id else None
        if acc is None:
            continue
        if bucket.is_debt_bucket():
            if acc.pk not in seen_debt:
                debt_accounts.append(acc)
                seen_debt.add(acc.pk)
        elif acc.pk not in seen_savings:
            savings_accounts.append(acc)
            seen_savings.add(acc.pk)

    from goals.services import bulk_linked_savings_balances

    ctx.linked_balance_by_account_id = bulk_linked_savings_balances(
        savings_accounts, as_of, user=user
    )

    if signed_balances is not None:
        from accounts.services.balances import credit_owed_from_signed_balance

        ctx.debt_owed_by_account_id = {
            acc.pk: credit_owed_from_signed_balance(signed_balances.get(acc.pk, Decimal("0")))
            for acc in debt_accounts
        }
    elif debt_accounts:
        from accounts.services.balances import (
            bulk_signed_ledger_balances,
            credit_owed_from_signed_balance,
        )

        signed = bulk_signed_ledger_balances(debt_accounts, as_of)
        ctx.debt_owed_by_account_id = {
            acc.pk: credit_owed_from_signed_balance(signed.get(acc.pk, Decimal("0")))
            for acc in debt_accounts
        }

    from goals.auto_fund import bulk_auto_fund_transfer_rules

    ctx.auto_fund_rule_by_bucket_id = bulk_auto_fund_transfer_rules(buckets)

    for bucket in buckets:
        ctx.funding_stats_by_bucket_id[bucket.id] = _funding_stats_for_bucket(
            bucket,
            contribution_stats=ctx.contribution_stats_by_bucket_id.get(
                bucket.id, _empty_contribution_stats()
            ),
            allocations=ctx.active_allocations_by_bucket_id.get(bucket.id, []),
            scenario=scenario,
            scenario_overrides=ctx.scenario_overrides_by_rule_id,
        )
    return ctx


def iter_active_rule_allocations(bucket: GoalBucket, allocations: list | None = None):
    """Use bulk-loaded or prefetched rule_allocations when present; otherwise query once."""
    if allocations is not None:
        for alloc in allocations:
            if alloc.active:
                yield alloc
        return
    cache = getattr(bucket, "_prefetched_objects_cache", None)
    if cache is not None and "rule_allocations" in cache:
        allocs = list(bucket.rule_allocations.all())
        for alloc in allocs:
            if alloc.active:
                yield alloc
        return
    yield from bucket.rule_allocations.filter(active=True).select_related("rule")


def _allocated_amount_for_bucket(
    bucket: GoalBucket,
    *,
    contribution_stats: BucketContributionStats | None = None,
    persist: bool = False,
) -> Decimal:
    if contribution_stats is not None:
        total = contribution_stats.total
    else:
        total = (
            GoalContribution.objects.filter(bucket=bucket).aggregate(s=Sum("amount"))["s"]
            or Decimal("0")
        )
        total = _quantize_money(_decimal(total))
    if persist and bucket.allocated_amount != total:
        bucket.allocated_amount = total
        bucket.save(update_fields=["allocated_amount", "updated_at"])
    return total


def _effective_bucket_current(
    bucket: GoalBucket,
    *,
    as_of: date | None = None,
    user=None,
    contribution_stats: BucketContributionStats | None = None,
    persist_allocated: bool = False,
    context: GoalCalculationContext | None = None,
) -> Decimal:
    """
    Savings progress = linked account balance on ``as_of`` (default today).
    Debt buckets use explicit paydown contributions.
    """
    as_of = as_of or date.today()
    if contribution_stats is None and context is not None:
        contribution_stats = context.contribution_stats_by_bucket_id.get(bucket.id)
    allocated = _allocated_amount_for_bucket(
        bucket, contribution_stats=contribution_stats, persist=persist_allocated
    )

    if bucket.is_debt_bucket():
        return allocated

    if bucket.linked_account_id and bucket.linked_account:
        if context is not None and bucket.linked_account_id in context.linked_balance_by_account_id:
            return context.linked_balance_by_account_id[bucket.linked_account_id]
        return _linked_savings_balance(bucket.linked_account, as_of, user=user)

    return allocated


def sync_bucket_allocated_amount(bucket: GoalBucket) -> Decimal:
    return _allocated_amount_for_bucket(bucket, persist=True)


def bucket_reserves_by_account(
    user,
    account_ids: Iterable[int],
    *,
    today: date | None = None,
) -> dict[int, Decimal]:
    """
    Bulk load safe-to-spend goal reserves per linked account.

    One query for all buckets; avoids per-account bucket_reserve_for_account() calls
    during dashboard forecast batching.
    """
    today = today or date.today()
    id_set = {int(aid) for aid in account_ids}
    if not id_set:
        return {}

    buckets = list(
        GoalBucket.objects.filter(
            linked_account_id__in=id_set,
            status__in=(GoalBucket.Status.ACTIVE, GoalBucket.Status.PAUSED),
            include_in_safe_to_spend=True,
        ).select_related("linked_account")
    )
    stats = bulk_bucket_contribution_stats([b.id for b in buckets], today=today)

    totals: dict[int, Decimal] = defaultdict(lambda: Decimal("0"))
    for bucket in buckets:
        aid = bucket.linked_account_id
        if aid is None:
            continue
        totals[aid] += _effective_bucket_current(
            bucket,
            as_of=today,
            user=user,
            contribution_stats=stats.get(bucket.id),
            persist_allocated=False,
        )

    return {aid: _quantize_money(totals.get(aid, Decimal("0"))) for aid in id_set}


def bucket_reserve_for_account(
    account_id: int,
    *,
    today: date | None = None,
    user=None,
) -> Decimal:
    """Sum of explicit bucket allocations on this account (reduces safe-to-spend)."""
    if user is not None:
        return bucket_reserves_by_account(user, [account_id], today=today).get(
            account_id, Decimal("0")
        )
    qs = GoalBucket.objects.filter(
        linked_account_id=account_id,
        status__in=(GoalBucket.Status.ACTIVE, GoalBucket.Status.PAUSED),
        include_in_safe_to_spend=True,
    )
    total = Decimal("0")
    for bucket in qs:
        total += _effective_bucket_current(bucket, as_of=today)
    return _quantize_money(total)


def account_bucket_summary(account_id: int, *, today: date | None = None) -> dict[str, Any]:
    today = today or date.today()
    balance = _balance_at_end_of_date(account_id, today)
    allocated = bucket_reserve_for_account(account_id, today=today)
    available = max(Decimal("0"), balance - allocated)
    buckets = GoalBucket.objects.filter(
        linked_account_id=account_id,
        status__in=(GoalBucket.Status.ACTIVE, GoalBucket.Status.PAUSED),
    ).order_by("priority", "-created_at")
    return {
        "account_id": account_id,
        "balance": _serialize_decimal(balance),
        "allocated_total": _serialize_decimal(allocated),
        "available_unallocated": _serialize_decimal(available),
        "bucket_count": buckets.count(),
        "buckets": [
            {
                "id": b.id,
                "name": b.name,
                "allocated_amount": _serialize_decimal(
                    _effective_bucket_current(b, as_of=today)
                ),
                "target_amount": _serialize_decimal(b.target_amount),
                "include_in_safe_to_spend": b.include_in_safe_to_spend,
            }
            for b in buckets
        ],
    }


def _monthly_from_contributions(
    bucket: GoalBucket,
    months: int = 6,
    *,
    today: date | None = None,
    contribution_stats: BucketContributionStats | None = None,
) -> Decimal:
    today = today or date.today()
    if contribution_stats is not None:
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


def _effective_monthly_for_bucket(
    bucket: GoalBucket,
    *,
    contribution_stats: BucketContributionStats | None = None,
    today: date | None = None,
    context: GoalCalculationContext | None = None,
) -> Decimal:
    if context is not None:
        funding = context.funding_stats_by_bucket_id.get(bucket.id)
        if funding is not None:
            return funding.effective_monthly_for_bucket
    rule_monthly = Decimal("0")
    allocations = (
        context.active_allocations_by_bucket_id.get(bucket.id) if context is not None else None
    )
    for alloc in iter_active_rule_allocations(bucket, allocations):
        rule = alloc.rule
        if not rule or not rule.active:
            continue
        if alloc.fixed_amount and alloc.fixed_amount > 0:
            portion = _decimal(alloc.fixed_amount)
        elif alloc.percent and alloc.percent > 0:
            portion = abs(_decimal(rule.amount)) * _decimal(alloc.percent) / Decimal("100")
        else:
            continue
        rule_monthly += _rule_amount_to_monthly(portion, rule.frequency)
    if rule_monthly > 0:
        return _quantize_money(rule_monthly)
    if bucket.monthly_target > 0:
        return _decimal(bucket.monthly_target)
    if contribution_stats is None and context is not None:
        contribution_stats = context.contribution_stats_by_bucket_id.get(bucket.id)
    return _monthly_from_contributions(
        bucket, contribution_stats=contribution_stats, today=today
    )


def calculate_bucket_progress(
    bucket: GoalBucket,
    *,
    today: date | None = None,
    as_of: date | None = None,
    user=None,
    contribution_stats: BucketContributionStats | None = None,
    owed_balance: Decimal | None = None,
    persist_allocated: bool = False,
    context: GoalCalculationContext | None = None,
) -> dict[str, Any]:
    today = today or date.today()
    progress_as_of = as_of or today
    if context is None:
        context = build_goal_calculation_context(
            [bucket], today=today, as_of=progress_as_of, user=user
        )
    if contribution_stats is None:
        contribution_stats = context.contribution_stats_by_bucket_id.get(bucket.id)
    target = _decimal(bucket.target_amount)
    if target <= 0:
        target = Decimal("0.01")

    current = _effective_bucket_current(
        bucket,
        as_of=progress_as_of,
        user=user,
        contribution_stats=contribution_stats,
        persist_allocated=persist_allocated,
        context=context,
    )
    if bucket.is_debt_bucket() and bucket.linked_account_id:
        if owed_balance is None:
            owed = context.debt_owed_by_account_id.get(bucket.linked_account_id)
            if owed is None:
                owed = ledger_owed_balance(bucket.linked_account, today)
        else:
            owed = owed_balance
        remaining = max(Decimal("0"), owed)
        progress = min(Decimal("100"), current / target * Decimal("100")) if target > 0 else Decimal("0")
    else:
        remaining = max(Decimal("0"), target - current)
        progress = min(Decimal("100"), current / target * Decimal("100"))

    monthly = _effective_monthly_for_bucket(
        bucket, contribution_stats=contribution_stats, today=today, context=context
    )
    projected = None
    if bucket.forecast_enabled:
        projected = calculate_projected_completion(
            _bucket_as_goal_proxy(bucket),
            remaining_amount=remaining,
            monthly_contribution=monthly,
            today=today,
        )
    recommended = _recommended_monthly(_bucket_as_goal_proxy(bucket), remaining, today)
    on_track = _on_track_status(_bucket_as_goal_proxy(bucket), projected, today)

    return {
        "current_amount": _serialize_decimal(_quantize_money(current)),
        "target_amount": _serialize_decimal(_quantize_money(target)),
        "remaining_amount": _serialize_decimal(_quantize_money(remaining)),
        "progress_percent": str(progress.quantize(Decimal("0.01"))),
        "projected_completion_date": projected.isoformat() if projected else None,
        "on_track_status": on_track,
        "recommended_monthly_contribution": _serialize_decimal(recommended) if recommended else None,
        "is_debt_goal": bucket.is_debt_bucket(),
        "allocated_amount": _serialize_decimal(_quantize_money(current)),
    }


def _bucket_as_goal_proxy(bucket: GoalBucket):
    """Minimal proxy so existing projection helpers can run."""

    class _Proxy:
        target_date = bucket.target_date
        monthly_contribution = bucket.monthly_target
        contribution_rule = None

    return _Proxy()


def _expected_progress_percent_bucket(bucket: GoalBucket, today: date) -> Decimal | None:
    if not bucket.target_date:
        return None
    start = bucket.start_date or (bucket.created_at.date() if bucket.created_at else today)
    if bucket.target_date <= start:
        return Decimal("100")
    total_days = (bucket.target_date - start).days
    if total_days <= 0:
        return Decimal("100")
    if today >= bucket.target_date:
        return Decimal("100")
    elapsed = max(0, (today - start).days)
    return min(Decimal("100"), Decimal(elapsed) / Decimal(total_days) * Decimal("100"))


def calculate_bucket_health(bucket: GoalBucket, progress_percent: Decimal, *, today: date | None = None) -> str:
    today = today or date.today()
    if bucket.status == GoalBucket.Status.COMPLETED or progress_percent >= Decimal("100"):
        return HEALTH_COMPLETED
    if not bucket.forecast_enabled or not bucket.target_date:
        return HEALTH_NO_SCHEDULE
    expected = _expected_progress_percent_bucket(bucket, today)
    if expected is None:
        return HEALTH_NO_SCHEDULE
    delta = progress_percent - expected
    if delta >= Decimal("5"):
        return HEALTH_AHEAD
    if delta >= Decimal("-5"):
        return HEALTH_ON_TRACK
    if delta >= Decimal("-15"):
        return HEALTH_WATCH
    return HEALTH_BEHIND


def enrich_bucket(
    bucket: GoalBucket,
    progress: dict[str, Any],
    *,
    today: date | None = None,
    contribution_stats: BucketContributionStats | None = None,
    context: GoalCalculationContext | None = None,
    scenario=None,
) -> dict[str, Any]:
    today = today or date.today()
    if context is None:
        context = build_goal_calculation_context(
            [bucket], today=today, as_of=today, scenario=scenario
        )
    if contribution_stats is None:
        contribution_stats = context.contribution_stats_by_bucket_id.get(bucket.id)
    progress_pct = Decimal(progress["progress_percent"])
    remaining = _decimal(progress["remaining_amount"])
    monthly = _effective_monthly_for_bucket(
        bucket, contribution_stats=contribution_stats, today=today, context=context
    )
    monthly_required = _recommended_monthly(_bucket_as_goal_proxy(bucket), remaining, today)
    if monthly_required is None and bucket.monthly_target > 0:
        monthly_required = _decimal(bucket.monthly_target)
    forecast_gap = None
    if monthly_required and monthly_required > 0:
        gap = monthly_required - monthly
        forecast_gap = gap if gap > Decimal("0") else Decimal("0")

    funding_name = bucket.linked_account.effective_display_name if bucket.linked_account else None
    health = calculate_bucket_health(bucket, progress_pct, today=today)

    milestones = []
    target = _decimal(progress["target_amount"])
    for pct in (25, 50, 75, 100):
        achieved = progress_pct >= Decimal(pct)
        if pct == 100:
            label = "Completion"
        elif pct == 50:
            label = "Halfway"
        elif pct == 25:
            label = f"First ${_quantize_money(target * Decimal('0.25'))}"
        else:
            label = f"{pct}%"
        milestones.append(
            {
                "percent": pct,
                "label": label,
                "threshold_amount": _serialize_decimal(_quantize_money(target * Decimal(pct) / 100)),
                "achieved": achieved,
            }
        )

    base = {
        **progress,
        "goal_health": health,
        "monthly_required": _serialize_decimal(monthly_required) if monthly_required else None,
        "current_contribution_rate": _serialize_decimal(monthly) if monthly > 0 else None,
        "forecast_gap": _serialize_decimal(forecast_gap) if forecast_gap is not None else None,
        "funding_account": funding_name,
        "milestones": milestones,
        "forecast_status": _forecast_status_label(
            health, progress.get("projected_completion_date")
        ),
    }
    from goals.forecast_insights import enrich_goal_forecast

    return enrich_goal_forecast(
        bucket,
        base,
        today=today,
        contribution_stats=contribution_stats,
        scenario=scenario if scenario is not None else context.scenario,
        context=context,
    )


def _forecast_status_label(health: str, projected: str | None) -> str:
    if health == HEALTH_COMPLETED:
        return "completed"
    if projected is None and health == HEALTH_NO_SCHEDULE:
        return "never"
    if health == HEALTH_AHEAD:
        return "ahead"
    if health == HEALTH_BEHIND:
        return "behind"
    return "on_track"


def bucket_to_api_dict(bucket: GoalBucket, enriched: dict[str, Any]) -> dict[str, Any]:
    linked_name = enriched.get("funding_account")
    return {
        "id": bucket.id,
        "household": bucket.household_id,
        "name": bucket.name,
        "description": bucket.description,
        "goal_type": bucket.type,
        "type": bucket.type,
        "target_amount": enriched["target_amount"],
        "current_amount": enriched["current_amount"],
        "allocated_amount": enriched["allocated_amount"],
        "starting_debt_amount": None,
        "target_date": bucket.target_date.isoformat() if bucket.target_date else None,
        "start_date": bucket.start_date.isoformat() if bucket.start_date else None,
        "linked_account": bucket.linked_account_id,
        "linked_credit_account": bucket.linked_account_id if bucket.is_debt_bucket() else None,
        "linked_account_name": linked_name,
        "linked_credit_account_name": linked_name if bucket.is_debt_bucket() else None,
        "monthly_contribution": _serialize_decimal(bucket.monthly_target),
        "monthly_target": _serialize_decimal(bucket.monthly_target),
        "priority": bucket.priority,
        "status": bucket.status,
        "notes": bucket.notes,
        "auto_fund_enabled": bucket.auto_fund_enabled,
        "forecast_enabled": bucket.forecast_enabled,
        "include_in_safe_to_spend": bucket.include_in_safe_to_spend,
        "created_at": bucket.created_at.isoformat() if bucket.created_at else None,
        "updated_at": bucket.updated_at.isoformat() if bucket.updated_at else None,
        "completed_at": bucket.completed_at.isoformat() if bucket.completed_at else None,
        **{k: enriched[k] for k in enriched if k not in ("allocated_amount",)},
    }


def calculate_goal_bucket_results(
    buckets: list[GoalBucket],
    *,
    user=None,
    today: date | None = None,
    as_of: date | None = None,
    scenario=None,
    context: GoalCalculationContext | None = None,
    contribution_stats: dict[int, BucketContributionStats] | None = None,
    signed_balances: dict[int, Decimal] | None = None,
) -> list[dict[str, Any]]:
    """Calculate every goal once from a shared context (no per-goal SQL after load)."""
    today = today or date.today()
    progress_as_of = as_of or today
    if context is None:
        context = build_goal_calculation_context(
            buckets,
            today=today,
            as_of=progress_as_of,
            user=user,
            scenario=scenario,
            contribution_stats=contribution_stats,
            signed_balances=signed_balances,
        )
    rows = []
    for bucket in buckets:
        stats = context.contribution_stats_by_bucket_id.get(bucket.id)
        owed = None
        if bucket.linked_account_id:
            owed = context.debt_owed_by_account_id.get(bucket.linked_account_id)
        progress = calculate_bucket_progress(
            bucket,
            today=today,
            as_of=progress_as_of,
            user=user,
            contribution_stats=stats,
            owed_balance=owed,
            context=context,
        )
        enriched = enrich_bucket(
            bucket,
            progress,
            today=today,
            contribution_stats=stats,
            context=context,
            scenario=scenario,
        )
        rows.append(bucket_to_api_dict(bucket, enriched))
    return rows


def calculate_aggregate_bucket_summary_from_results(
    results: list[dict[str, Any]],
) -> dict[str, Any]:
    """Pure Python summary from already-calculated goal rows."""
    active_statuses = {GoalBucket.Status.ACTIVE, GoalBucket.Status.PAUSED}
    active = [row for row in results if row.get("status") in active_statuses]
    total_saved = Decimal("0")
    total_target = Decimal("0")
    monthly_needed_total = Decimal("0")
    on_track_count = 0
    latest_completion: date | None = None
    warnings: list[dict[str, Any]] = []

    for progress in active:
        total_saved += _decimal(progress["current_amount"])
        total_target += _decimal(progress["target_amount"])
        monthly_req = progress.get("monthly_required")
        if monthly_req:
            monthly_needed_total += _decimal(monthly_req)
        if progress.get("goal_health") in (HEALTH_AHEAD, HEALTH_ON_TRACK, HEALTH_COMPLETED):
            on_track_count += 1
        gap = progress.get("forecast_gap")
        if gap and float(gap) > 0 and progress.get("goal_health") == HEALTH_BEHIND:
            warnings.append(
                {
                    "bucket_id": progress.get("id"),
                    "name": progress.get("name"),
                    "message": f"{progress.get('name')} goal behind by {gap}/mo",
                    "gap": gap,
                }
            )
        projected = progress.get("projected_completion_date")
        if projected:
            proj_date = date.fromisoformat(projected)
            if latest_completion is None or proj_date > latest_completion:
                latest_completion = proj_date

    return {
        "total_saved": _serialize_decimal(_quantize_money(total_saved)),
        "total_target": _serialize_decimal(_quantize_money(total_target)),
        "monthly_needed_total": _serialize_decimal(_quantize_money(monthly_needed_total)),
        "goals_on_track": on_track_count,
        "goals_active_count": len(active),
        "projected_completion": latest_completion.isoformat() if latest_completion else None,
        "warnings": warnings,
    }


def calculate_aggregate_bucket_summary(
    buckets: list[GoalBucket],
    *,
    today: date | None = None,
    as_of: date | None = None,
    user=None,
    contribution_stats: dict[int, BucketContributionStats] | None = None,
    owed_balances: dict[int, Decimal] | None = None,
    context: GoalCalculationContext | None = None,
    precomputed_results: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    if precomputed_results is not None:
        return calculate_aggregate_bucket_summary_from_results(precomputed_results)
    today = today or date.today()
    progress_as_of = as_of or today
    active = [b for b in buckets if b.status in (GoalBucket.Status.ACTIVE, GoalBucket.Status.PAUSED)]
    results = calculate_goal_bucket_results(
        active,
        user=user,
        today=today,
        as_of=progress_as_of,
        context=context,
        contribution_stats=contribution_stats,
        signed_balances=owed_balances,
    )
    return calculate_aggregate_bucket_summary_from_results(results)


def build_goals_report(
    households,
    *,
    months: int = 12,
    month: str | None = None,
    user=None,
    today: date | None = None,
    include_history: bool = False,
) -> dict[str, Any]:
    """Aggregate bucket progress and month-scoped funding for reports."""
    from insights.services.report_dates import month_key, report_period

    today = today or date.today()
    if month:
        period = report_period(month, history_months=months)
        progress_as_of = period.end
        history_start = period.history_start
        history_end = period.history_end
        report_month = period.month
    else:
        period = report_period(today.strftime("%Y-%m"), history_months=months)
        progress_as_of = today
        history_start = period.history_start
        history_end = period.history_end
        report_month = period.month

    buckets = list(
        GoalBucket.objects.filter(household__in=households)
        .exclude(status=GoalBucket.Status.ARCHIVED)
        .select_related("linked_account")
        .prefetch_related("rule_allocations__rule")
        .order_by("priority", "-created_at")
    )
    context = build_goal_calculation_context(
        buckets, today=today, as_of=progress_as_of, user=user
    )
    bucket_rows = calculate_goal_bucket_results(
        buckets,
        user=user,
        today=today,
        as_of=progress_as_of,
        context=context,
    )
    bucket_ids = [b.id for b in buckets]
    monthly_funding: list[dict[str, Any]] = []
    projected_monthly_funding: list[dict[str, Any]] = []
    history: list[dict[str, Any]] = []

    if bucket_ids:
        grouped = (
            GoalContribution.objects.filter(
                bucket_id__in=bucket_ids,
                date__gte=history_start,
            )
            .annotate(month=TruncMonth("date"))
            .values("month")
            .annotate(
                total=Coalesce(Sum("amount"), Decimal("0")),
                contributed=Coalesce(Sum("amount", filter=Q(amount__gt=0)), Decimal("0")),
                released=Coalesce(Sum("amount", filter=Q(amount__lt=0)), Decimal("0")),
            )
            .order_by("month")
        )
        history_end_key = month_key(history_end)
        for row in grouped:
            total = _decimal(row["total"])
            contributed = _decimal(row["contributed"])
            released = abs(_decimal(row["released"]))
            key = month_key(row["month"])
            payload = {
                "month": key,
                "total": _serialize_decimal(_quantize_money(total)),
                "contributed": _serialize_decimal(_quantize_money(contributed)),
                "released": _serialize_decimal(_quantize_money(released)),
                "kind": "actual" if key <= history_end_key else "projected",
            }
            if payload["kind"] == "actual":
                monthly_funding.append(payload)
            else:
                projected_monthly_funding.append(payload)

        if include_history:
            history = [
                {
                    "id": c.id,
                    "bucket_id": c.bucket_id,
                    "bucket_name": c.bucket.name,
                    "account_id": c.account_id,
                    "amount": _serialize_decimal(c.amount),
                    "date": c.date.isoformat(),
                    "source": c.source,
                }
                for c in GoalContribution.objects.filter(
                    bucket_id__in=bucket_ids,
                    date__gte=history_start,
                    date__lte=history_end,
                )
                .select_related("bucket", "account")
                .order_by("-date", "-id")[:500]
            ]

    return {
        "buckets": bucket_rows,
        "contribution_history": history,
        "monthly_funding": monthly_funding,
        "projected_monthly_funding": projected_monthly_funding,
        "summary": calculate_aggregate_bucket_summary_from_results(bucket_rows),
        "report_month": report_month,
        "progress_as_of": progress_as_of.isoformat(),
        "history_start": history_start.isoformat(),
        "history_end": history_end.isoformat(),
    }


def dashboard_buckets_for_user(
    user,
    *,
    limit: int | None = None,
    today: date | None = None,
    households=None,
    contribution_stats: dict[int, BucketContributionStats] | None = None,
    buckets: list[GoalBucket] | None = None,
) -> list[dict[str, Any]]:
    from core.utils import get_households_for_user

    today = today or date.today()
    if buckets is None:
        if households is None:
            households = get_households_for_user(user)
        qs = (
            GoalBucket.objects.filter(
                household__in=households,
                status__in=(GoalBucket.Status.ACTIVE, GoalBucket.Status.PAUSED),
            )
            .select_related("linked_account")
            .prefetch_related("rule_allocations__rule")
            .order_by("priority", "-created_at")
        )
        buckets = list(qs)
    buckets = sorted(
        buckets, key=lambda b: (PRIORITY_ORDER.get(b.priority, 9), -b.created_at.timestamp())
    )
    if limit is not None:
        buckets = buckets[:limit]
    return calculate_goal_bucket_results(
        buckets,
        user=user,
        today=today,
        contribution_stats=contribution_stats,
    )


def record_contribution(
    bucket: GoalBucket,
    *,
    transaction,
    account_id: int,
    amount: Decimal,
    contrib_date: date,
    source: str,
) -> GoalContribution:
    amount = _quantize_money(_decimal(amount))
    contrib, _created = GoalContribution.objects.update_or_create(
        transaction_id=transaction.pk,
        defaults={
            "bucket": bucket,
            "account_id": account_id,
            "amount": amount,
            "date": contrib_date,
            "source": source,
        },
    )
    sync_bucket_allocated_amount(bucket)
    remaining = _decimal(bucket.target_amount) - _effective_bucket_current(bucket, as_of=contrib_date)
    if remaining <= 0 and bucket.status == GoalBucket.Status.ACTIVE:
        bucket.status = GoalBucket.Status.COMPLETED
        bucket.completed_at = timezone.now()
        bucket.save(update_fields=["status", "completed_at", "updated_at"])
    return contrib


def process_rule_allocations_for_transaction(rule: RecurringRule, txn) -> list[GoalContribution]:
    """When a rule materializes an inflow, create bucket contributions per RuleAllocation."""
    if txn.amount <= 0:
        return []
    created: list[GoalContribution] = []
    inflow = abs(_decimal(txn.amount))
    for alloc in RuleAllocation.objects.filter(rule=rule, active=True).select_related("bucket"):
        bucket = alloc.bucket
        if bucket.status not in (GoalBucket.Status.ACTIVE, GoalBucket.Status.PAUSED):
            continue
        if alloc.fixed_amount and alloc.fixed_amount > 0:
            portion = min(inflow, _decimal(alloc.fixed_amount))
        elif alloc.percent and alloc.percent > 0:
            portion = _quantize_money(inflow * _decimal(alloc.percent) / Decimal("100"))
        else:
            continue
        if portion <= 0:
            continue
        account_id = bucket.linked_account_id or txn.account_id
        created.append(
            record_contribution(
                bucket,
                transaction=txn,
                account_id=account_id,
                amount=portion,
                contrib_date=txn.date,
                source=GoalContribution.Source.RULE,
            )
        )
    return created
