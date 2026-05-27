"""
Goal bucket allocations, forecasting, and safe-to-spend reserves.

Buckets reserve money on linked accounts via GoalContribution rows pointing at real
transactions. allocated_amount is denormalized from contributions for fast reads.
"""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from django.db.models import Sum
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


def _active_buckets_on_linked_account(account_id: int) -> int:
    return GoalBucket.objects.filter(
        linked_account_id=account_id,
        status__in=(GoalBucket.Status.ACTIVE, GoalBucket.Status.PAUSED),
    ).count()


def _effective_bucket_current(bucket: GoalBucket, *, today: date | None = None) -> Decimal:
    """
    Savings progress: when this is the only bucket on a linked account, use the
    account ledger balance (same as legacy goals). With multiple buckets on one
    account, only explicit GoalContribution amounts count.
    """
    today = today or date.today()
    sync_bucket_allocated_amount(bucket)
    contrib = _decimal(bucket.allocated_amount)

    if bucket.is_debt_bucket():
        return contrib

    if bucket.linked_account_id and bucket.linked_account:
        if _active_buckets_on_linked_account(bucket.linked_account_id) == 1:
            return _linked_savings_balance(bucket.linked_account, today)
        return contrib

    return contrib


def sync_bucket_allocated_amount(bucket: GoalBucket) -> Decimal:
    total = (
        GoalContribution.objects.filter(bucket=bucket).aggregate(s=Sum("amount"))["s"]
        or Decimal("0")
    )
    total = _quantize_money(_decimal(total))
    if bucket.allocated_amount != total:
        bucket.allocated_amount = total
        bucket.save(update_fields=["allocated_amount", "updated_at"])
    return total


def bucket_reserve_for_account(
    account_id: int,
    *,
    today: date | None = None,
) -> Decimal:
    """Sum of explicit bucket allocations on this account (reduces safe-to-spend)."""
    qs = GoalBucket.objects.filter(
        linked_account_id=account_id,
        status__in=(GoalBucket.Status.ACTIVE, GoalBucket.Status.PAUSED),
        include_in_safe_to_spend=True,
    )
    total = Decimal("0")
    for bucket in qs:
        sync_bucket_allocated_amount(bucket)
        total += _decimal(bucket.allocated_amount)
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
                "allocated_amount": _serialize_decimal(b.allocated_amount),
                "target_amount": _serialize_decimal(b.target_amount),
                "include_in_safe_to_spend": b.include_in_safe_to_spend,
            }
            for b in buckets
        ],
    }


def _monthly_from_contributions(bucket: GoalBucket, months: int = 6) -> Decimal:
    since = date.today() - timedelta(days=months * 31)
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


def _effective_monthly_for_bucket(bucket: GoalBucket) -> Decimal:
    rule_monthly = Decimal("0")
    for alloc in bucket.rule_allocations.filter(active=True).select_related("rule"):
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
    return _monthly_from_contributions(bucket)


def calculate_bucket_progress(bucket: GoalBucket, *, today: date | None = None) -> dict[str, Any]:
    today = today or date.today()
    sync_bucket_allocated_amount(bucket)
    target = _decimal(bucket.target_amount)
    if target <= 0:
        target = Decimal("0.01")

    if bucket.is_debt_bucket() and bucket.linked_account_id:
        owed = ledger_owed_balance(bucket.linked_account, today)
        current = _effective_bucket_current(bucket, today=today)
        remaining = max(Decimal("0"), owed)
        progress = min(Decimal("100"), current / target * Decimal("100")) if target > 0 else Decimal("0")
    else:
        current = _effective_bucket_current(bucket, today=today)
        remaining = max(Decimal("0"), target - current)
        progress = min(Decimal("100"), current / target * Decimal("100"))

    monthly = _effective_monthly_for_bucket(bucket)
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


def enrich_bucket(bucket: GoalBucket, progress: dict[str, Any], *, today: date | None = None) -> dict[str, Any]:
    today = today or date.today()
    progress_pct = Decimal(progress["progress_percent"])
    remaining = _decimal(progress["remaining_amount"])
    monthly = _effective_monthly_for_bucket(bucket)
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

    return enrich_goal_forecast(bucket, base, today=today)


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


def calculate_aggregate_bucket_summary(buckets: list[GoalBucket], *, today: date | None = None) -> dict[str, Any]:
    today = today or date.today()
    active = [b for b in buckets if b.status in (GoalBucket.Status.ACTIVE, GoalBucket.Status.PAUSED)]
    total_saved = Decimal("0")
    total_target = Decimal("0")
    monthly_needed_total = Decimal("0")
    on_track_count = 0
    latest_completion: date | None = None
    warnings: list[dict[str, Any]] = []

    for bucket in active:
        progress = enrich_bucket(bucket, calculate_bucket_progress(bucket, today=today), today=today)
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
                    "bucket_id": bucket.id,
                    "name": bucket.name,
                    "message": f"{bucket.name} goal behind by {gap}/mo",
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


def build_goals_report(
    households,
    *,
    months: int = 12,
    today: date | None = None,
) -> dict[str, Any]:
    """Aggregate bucket progress, contribution history, and funding for reports."""
    today = today or date.today()
    since = today.replace(day=1)
    for _ in range(max(0, months - 1)):
        if since.month == 1:
            since = since.replace(year=since.year - 1, month=12)
        else:
            since = since.replace(month=since.month - 1)

    buckets = list(
        GoalBucket.objects.filter(household__in=households)
        .exclude(status=GoalBucket.Status.ARCHIVED)
        .select_related("linked_account")
        .order_by("priority", "-created_at")
    )
    bucket_rows = []
    for bucket in buckets:
        progress = enrich_bucket(bucket, calculate_bucket_progress(bucket, today=today), today=today)
        bucket_rows.append(bucket_to_api_dict(bucket, progress))

    contributions = (
        GoalContribution.objects.filter(bucket__household__in=households, date__gte=since)
        .select_related("bucket", "account")
        .order_by("-date", "-id")
    )
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
        for c in contributions[:500]
    ]

    monthly_totals: dict[str, Decimal] = {}
    for c in contributions:
        key = c.date.strftime("%Y-%m")
        monthly_totals[key] = monthly_totals.get(key, Decimal("0")) + _decimal(c.amount)

    monthly_funding = [
        {"month": k, "total": _serialize_decimal(_quantize_money(v))}
        for k, v in sorted(monthly_totals.items())
    ]

    return {
        "buckets": bucket_rows,
        "contribution_history": history,
        "monthly_funding": monthly_funding,
        "summary": calculate_aggregate_bucket_summary(
            [b for b in buckets if b.status in (GoalBucket.Status.ACTIVE, GoalBucket.Status.PAUSED)],
            today=today,
        ),
    }


def dashboard_buckets_for_user(user, *, limit: int | None = None, today: date | None = None) -> list[dict[str, Any]]:
    from core.utils import get_households_for_user

    today = today or date.today()
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
    buckets = sorted(qs, key=lambda b: (PRIORITY_ORDER.get(b.priority, 9), -b.created_at.timestamp()))
    if limit is not None:
        buckets = buckets[:limit]
    return [
        bucket_to_api_dict(b, enrich_bucket(b, calculate_bucket_progress(b, today=today), today=today))
        for b in buckets
    ]


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
    contrib = GoalContribution.objects.create(
        bucket=bucket,
        transaction=transaction,
        account_id=account_id,
        amount=amount,
        date=contrib_date,
        source=source,
    )
    sync_bucket_allocated_amount(bucket)
    remaining = _decimal(bucket.target_amount) - _decimal(bucket.allocated_amount)
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
