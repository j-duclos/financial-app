"""
Spending target calculations — forecast-aware guidance, not envelope budgeting.
"""
from __future__ import annotations

from calendar import monthrange
from datetime import date, timedelta
from decimal import Decimal
from typing import Any, Optional

from django.db.models import Q, Sum
from django.db.models.functions import Coalesce

from accounts.models import Account
from categories.models import Category
from core.utils import get_households_for_user
from insights.services.dashboard_upcoming import CREDIT_CARD_PAYMENT_CATEGORY
from transactions.models import Transaction

from ..models import SpendingTarget

STATUS_WITHIN = "within_target"
STATUS_APPROACHING = "approaching_target"
STATUS_ABOVE = "above_target"
STATUS_RISKY = "risky"


def _decimal(value) -> Decimal:
    if value is None:
        return Decimal("0")
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def period_bounds(period: str, anchor: date) -> tuple[date, date]:
    if period == SpendingTarget.Period.WEEKLY:
        start = anchor - timedelta(days=anchor.weekday())
        return start, start + timedelta(days=6)
    if period == SpendingTarget.Period.MONTHLY:
        start = anchor.replace(day=1)
        last = monthrange(anchor.year, anchor.month)[1]
        return start, anchor.replace(day=last)
    if period == SpendingTarget.Period.QUARTERLY:
        q_start_month = ((anchor.month - 1) // 3) * 3 + 1
        start = date(anchor.year, q_start_month, 1)
        end_month = q_start_month + 2
        last = monthrange(anchor.year, end_month)[1]
        return start, date(anchor.year, end_month, last)
    if period == SpendingTarget.Period.YEARLY:
        return date(anchor.year, 1, 1), date(anchor.year, 12, 31)
    raise ValueError(f"Unknown period: {period}")


def _excluded_category_names() -> frozenset[str]:
    return frozenset({CREDIT_CARD_PAYMENT_CATEGORY, "Bank Transfer", "Transfer"})


def _base_expense_qs(
    household_ids,
    *,
    account_id: int | None = None,
):
    qs = Transaction.objects.filter(
        account__household_id__in=household_ids,
        amount__lt=0,
    ).select_related("category", "account")
    if account_id is not None:
        qs = qs.filter(account_id=account_id)
    return qs.exclude(transfer_group_id__isnull=False).exclude(
        Q(category__name__in=_excluded_category_names()) | Q(category__isnull=True, payee__icontains="transfer")
    )


def _sum_category_spend(
    qs,
    category_id: int,
    start: date,
    end: date,
    *,
    today: date,
    include_future_planned: bool,
) -> tuple[Decimal, Decimal]:
    """Return (spent_so_far, future_planned) as positive amounts."""
    in_period = qs.filter(category_id=category_id, date__gte=start, date__lte=end)
    actual = in_period.filter(date__lte=today).exclude(
        status=Transaction.Status.PLANNED,
    ).aggregate(total=Coalesce(Sum("amount"), Decimal("0")))["total"] or Decimal("0")
    spent = abs(actual)

    future_planned = Decimal("0")
    if include_future_planned and today < end:
        planned = in_period.filter(
            date__gt=today,
            status=Transaction.Status.PLANNED,
        ).aggregate(total=Coalesce(Sum("amount"), Decimal("0")))["total"] or Decimal("0")
        future_planned = abs(planned)
    return spent, future_planned


def _linear_pace_projection(
    spent_so_far: Decimal,
    *,
    period_start: date,
    period_end: date,
    today: date,
) -> Decimal:
    if today >= period_end:
        return spent_so_far
    elapsed = (today - period_start).days + 1
    total_days = (period_end - period_start).days + 1
    if elapsed <= 0 or total_days <= 0:
        return spent_so_far
    daily = spent_so_far / Decimal(elapsed)
    return (daily * Decimal(total_days)).quantize(Decimal("0.01"))


def _target_status(
    target: SpendingTarget,
    *,
    spent_so_far: Decimal,
    projected: Decimal,
    target_amount: Decimal,
) -> str:
    if target_amount <= 0:
        return STATUS_WITHIN
    pct = (spent_so_far / target_amount * Decimal("100")) if target_amount else Decimal("0")
    projected_pct = (projected / target_amount * Decimal("100")) if target_amount else Decimal("0")
    over = projected - target_amount
    if over > 0 and (projected_pct >= Decimal("110") or target.hard_limit):
        return STATUS_RISKY
    if projected > target_amount:
        return STATUS_ABOVE
    threshold = _decimal(target.warning_threshold_percent)
    if pct >= threshold or projected_pct >= threshold:
        return STATUS_APPROACHING
    return STATUS_WITHIN


def _recommendation_for_target(
    category_name: str,
    *,
    status: str,
    projected_over_under: Decimal,
    period_label: str,
) -> str | None:
    if status not in (STATUS_ABOVE, STATUS_RISKY, STATUS_APPROACHING):
        return None
    if projected_over_under <= 0:
        return f"On pace for {category_name} this {period_label}."
    amt = projected_over_under.quantize(Decimal("0.01"))
    if status == STATUS_RISKY:
        return f"Reduce {category_name} spending by ${amt} this {period_label} to lower cashflow risk."
    return f"Reduce {category_name} spending by ${amt} to stay within target."


def calculate_target_metrics(
    target: SpendingTarget,
    *,
    anchor: date | None = None,
    today: date | None = None,
    include_forecast: bool = True,
    transfer_rule_ids: set[int] | None = None,
) -> dict[str, Any]:
    today = today or date.today()
    anchor = anchor or today
    period_start, period_end = period_bounds(target.period, anchor)
    target_amount = _decimal(target.target_amount)
    household_id = target.household_id

    spent_so_far, future_planned = _sum_category_spend(
        _base_expense_qs([household_id], account_id=target.account_id),
        target.category_id,
        period_start,
        period_end,
        today=today,
        include_future_planned=include_forecast,
    )

    projected = spent_so_far + future_planned
    if include_forecast and future_planned == 0:
        pace = _linear_pace_projection(
            spent_so_far,
            period_start=period_start,
            period_end=period_end,
            today=today,
        )
        if pace > projected:
            projected = pace

    remaining = target_amount - spent_so_far
    projected_over_under = projected - target_amount
    percent_used = (
        (spent_so_far / target_amount * Decimal("100")).quantize(Decimal("0.1"))
        if target_amount > 0
        else Decimal("0")
    )
    status = _target_status(
        target,
        spent_so_far=spent_so_far,
        projected=projected,
        target_amount=target_amount,
    )
    cat_name = target.name or (target.category.name if target.category else "Category")
    period_label = target.period
    recommendation = _recommendation_for_target(
        cat_name,
        status=status,
        projected_over_under=projected_over_under if projected_over_under > 0 else Decimal("0"),
        period_label=period_label,
    )

    return {
        "target_id": target.id,
        "category_id": target.category_id,
        "category_name": target.category.name if target.category else cat_name,
        "name": target.name or target.category.name,
        "period": target.period,
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
        "target_amount": str(target_amount.quantize(Decimal("0.01"))),
        "spent_so_far": str(spent_so_far.quantize(Decimal("0.01"))),
        "remaining_to_target": str(remaining.quantize(Decimal("0.01"))),
        "percent_used": str(percent_used),
        "projected_period_spend": str(projected.quantize(Decimal("0.01"))),
        "projected_over_under": str(projected_over_under.quantize(Decimal("0.01"))),
        "status": status,
        "recommendation": recommendation,
        "forecast_impact": (
            f"Projected ${abs(projected_over_under).quantize(Decimal('0.01'))} above target by period end."
            if projected_over_under > 0
            else None
        ),
        "account_id": target.account_id,
        "warning_threshold_percent": str(target.warning_threshold_percent),
        "hard_limit": target.hard_limit,
        "active": target.active,
    }


def spending_targets_summary(
    user,
    *,
    anchor: date | None = None,
    household_id: int | None = None,
    include_forecast: bool = True,
) -> dict[str, Any]:
    today = date.today()
    anchor = anchor or today
    households = get_households_for_user(user)
    if household_id is not None:
        targets = SpendingTarget.objects.filter(
            household_id=household_id, household__in=households, active=True
        )
    else:
        targets = SpendingTarget.objects.filter(household__in=households, active=True)
    targets = targets.select_related("category", "account", "household")

    rows = [
        calculate_target_metrics(t, anchor=anchor, today=today, include_forecast=include_forecast)
        for t in targets
    ]

    monthly_targets = Decimal("0")
    spent = Decimal("0")
    projected = Decimal("0")
    for row in rows:
        if row["period"] == SpendingTarget.Period.MONTHLY:
            monthly_targets += _decimal(row["target_amount"])
        spent += _decimal(row["spent_so_far"])
        projected += _decimal(row["projected_period_spend"])

    above = [r for r in rows if r["status"] in (STATUS_ABOVE, STATUS_RISKY)]
    approaching = [r for r in rows if r["status"] == STATUS_APPROACHING]

    return {
        "anchor_date": anchor.isoformat(),
        "total_monthly_targets": str(monthly_targets.quantize(Decimal("0.01"))),
        "spent_so_far_total": str(spent.quantize(Decimal("0.01"))),
        "projected_total": str(projected.quantize(Decimal("0.01"))),
        "above_target_count": len(above),
        "approaching_target_count": len(approaching),
        "targets": rows,
    }


def recommendations_from_spending_targets(
    user,
    *,
    anchor: date | None = None,
    limit: int = 3,
) -> list[dict[str, Any]]:
    summary = spending_targets_summary(user, anchor=anchor, include_forecast=True)
    recs: list[dict[str, Any]] = []
    for row in summary["targets"]:
        if row["status"] not in (STATUS_ABOVE, STATUS_RISKY, STATUS_APPROACHING):
            continue
        over = _decimal(row["projected_over_under"])
        if over <= 0 and row["status"] == STATUS_APPROACHING:
            continue
        cat = row["category_name"]
        why = row.get("forecast_impact") or f"{cat} is approaching its spending target."
        if over > 0:
            why = f"{cat} is projected ${over.quantize(Decimal('0.01'))} above target this {row['period']}."
        action = row.get("recommendation") or f"Review {cat} spending."
        severity = "critical" if row["status"] == STATUS_RISKY else "warning"
        recs.append(
            {
                "id": f"spending-target-{row['target_id']}",
                "severity": severity,
                "title": cat,
                "why": why,
                "recommended_action": action,
                "impact_label": "Projected over",
                "impact_value": str(over.quantize(Decimal("0.01"))) if over > 0 else None,
                "primary_action_label": "View targets",
                "primary_action_url": "/spending-targets",
                "primary_action_type": "navigate",
                "secondary_action_label": None,
                "secondary_action_url": None,
                "secondary_action_type": None,
            }
        )
    recs.sort(key=lambda r: (0 if r["severity"] == "critical" else 1, r["title"]))
    return recs[:limit]
