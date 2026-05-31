"""
Spending target calculations — calendar period vs target.

Counts only known money movement:
  spent = posted transactions in the period through today
  scheduled_remaining = future scheduled rows in the period not already satisfied
  remaining = target - spent - scheduled_remaining
  status uses spent + scheduled_remaining vs target

No pace-based or daily-average projection.
"""
from __future__ import annotations

from calendar import monthrange
from collections import Counter
from datetime import date, timedelta
from decimal import Decimal
from statistics import StatisticsError, mode
from typing import Any

from django.db.models import Q, Sum
from django.db.models.functions import Coalesce

from categories.models import Category
from core.utils import get_households_for_user
from insights.services.dashboard_upcoming import CREDIT_CARD_PAYMENT_CATEGORY
from timeline.models import RecurringRule, RecurringRuleSkip
from timeline.services.rule_schedule import generate_rule_occurrence_dates, resolve_rule_params
from transactions.models import Transaction
from transactions.services.matching import ledger_visible_transactions

from ..models import SpendingTarget

STATUS_WITHIN = "within_target"
STATUS_APPROACHING = "approaching_target"
STATUS_ABOVE = "above_target"
STATUS_RISKY = "risky"  # legacy; no longer assigned

SCHEDULED_ONLY = "scheduled_only"
APPROACHING_THRESHOLD_PERCENT = Decimal("80")


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
    include_category_names: frozenset[str] | None = None,
):
    excluded = _excluded_category_names()
    if include_category_names:
        excluded = excluded - include_category_names
    qs = Transaction.objects.filter(
        account__household_id__in=household_ids,
        amount__lt=0,
    ).select_related("category", "account")
    if account_id is not None:
        qs = qs.filter(account_id=account_id)
    return qs.exclude(transfer_group_id__isnull=False).exclude(
        Q(category__name__in=excluded) | Q(category__isnull=True, payee__icontains="transfer")
    )


def _visible_expense_qs(base_qs):
    """Ledger-visible expense rows (excludes matched-import duplicates)."""
    return ledger_visible_transactions(base_qs)


def _category_ids_for_target(target: SpendingTarget) -> list[int]:
    name = target.category.name if target.category_id else ""
    if not name:
        return [target.category_id] if target.category_id else []
    return list(
        Category.objects.filter(
            household_id=target.household_id,
            category_type=Category.CategoryType.EXPENSE,
            name__iexact=name,
            is_archived=False,
        ).values_list("id", flat=True)
    )


def _category_ids_for_category(category: Category) -> list[int]:
    return list(
        Category.objects.filter(
            household_id=category.household_id,
            category_type=Category.CategoryType.EXPENSE,
            name__iexact=category.name,
            is_archived=False,
        ).values_list("id", flat=True)
    )


def _posted_status_q() -> Q:
    """Rows that count as spent/posted (not future scheduled-only)."""
    return Q(status__in=(Transaction.Status.CLEARED, Transaction.Status.RECONCILED)) | Q(
        status=Transaction.Status.PLANNED
    )


def _posted_rule_months(
    household_id: int,
    category_ids: list[int],
    start: date,
    end: date,
    *,
    today: date,
    account_id: int | None = None,
) -> set[tuple[int, int, int]]:
    """(rule_id, year, month) pairs with a posted payment in the period through today."""
    if not category_ids:
        return set()
    through = min(end, today)
    qs = _visible_expense_qs(
        Transaction.objects.filter(
            account__household_id=household_id,
            rule_id__isnull=False,
            category_id__in=category_ids,
            amount__lt=0,
            date__gte=start,
            date__lte=through,
        )
    ).filter(_posted_status_q())
    if account_id is not None:
        qs = qs.filter(account_id=account_id)
    return {(rule_id, d.year, d.month) for rule_id, d in qs.values_list("rule_id", "date")}


def _sum_spent(
    base_qs,
    category_ids: list[int],
    start: date,
    end: date,
    *,
    today: date,
) -> Decimal:
    """Posted/manual/imported expenses in the period through today."""
    if not category_ids:
        return Decimal("0")
    through = min(end, today)
    spent = (
        _visible_expense_qs(
            base_qs.filter(
                category_id__in=category_ids,
                date__gte=start,
                date__lte=through,
            )
        )
        .filter(_posted_status_q())
        .aggregate(total=Coalesce(Sum("amount"), Decimal("0")))["total"]
        or Decimal("0")
    )
    return abs(spent)


def _sum_scheduled_planned(
    base_qs,
    category_ids: list[int],
    start: date,
    end: date,
    *,
    today: date,
    posted_rule_months: set[tuple[int, int, int]],
) -> Decimal:
    """Future PLANNED rows in the period that are not already satisfied."""
    if not category_ids or today >= end:
        return Decimal("0")

    rows = _visible_expense_qs(
        base_qs.filter(
            category_id__in=category_ids,
            date__gte=start,
            date__lte=end,
            date__gt=today,
            status=Transaction.Status.PLANNED,
        )
    ).values_list("amount", "rule_id", "date")

    total = Decimal("0")
    for amount, rule_id, txn_date in rows:
        if rule_id and (rule_id, txn_date.year, txn_date.month) in posted_rule_months:
            continue
        total += abs(_decimal(amount))
    return total


def _sum_rule_projections_in_period(
    target: SpendingTarget,
    category_ids: list[int],
    start: date,
    end: date,
    *,
    today: date,
    posted_rule_months: set[tuple[int, int, int]],
) -> Decimal:
    """Future recurring rule amounts not already represented by a transaction row."""
    if not category_ids or today >= end:
        return Decimal("0")

    proj_start = max(start, today + timedelta(days=1))
    if proj_start > end:
        return Decimal("0")

    rules_qs = RecurringRule.objects.filter(
        household_id=target.household_id,
        active=True,
        direction=RecurringRule.Direction.EXPENSE,
        category_id__in=category_ids,
    )
    if target.account_id is not None:
        rules_qs = rules_qs.filter(account_id=target.account_id)

    skipped = set(
        RecurringRuleSkip.objects.filter(
            rule__household_id=target.household_id,
            date__gte=proj_start,
            date__lte=end,
        ).values_list("rule_id", "date")
    )

    txn_qs = Transaction.objects.filter(
        account__household_id=target.household_id,
        rule_id__isnull=False,
        date__gte=start,
        date__lte=end,
        category_id__in=category_ids,
    )
    if target.account_id is not None:
        txn_qs = txn_qs.filter(account_id=target.account_id)
    existing_rule_dates = set(txn_qs.values_list("rule_id", "date"))

    total = Decimal("0")
    for rule in rules_qs:
        for occ_date in generate_rule_occurrence_dates(rule, proj_start, end):
            key = (rule.id, occ_date)
            if key in skipped or key in existing_rule_dates:
                continue
            if (rule.id, occ_date.year, occ_date.month) in posted_rule_months:
                continue
            total += abs(resolve_rule_params(rule, occ_date).amount)

    return total


def _target_status(
    *,
    committed_amount: Decimal,
    target_amount: Decimal,
) -> str:
    if target_amount <= 0:
        return STATUS_WITHIN
    if committed_amount > target_amount:
        return STATUS_ABOVE
    pct = (committed_amount / target_amount * Decimal("100")) if target_amount else Decimal("0")
    if pct >= APPROACHING_THRESHOLD_PERCENT:
        return STATUS_APPROACHING
    return STATUS_WITHIN


def _recommendation_for_target(
    category_name: str,
    *,
    status: str,
    over_target: Decimal,
) -> str | None:
    if status not in (STATUS_ABOVE, STATUS_APPROACHING):
        return None
    if over_target > 0:
        amt = over_target.quantize(Decimal("0.01"))
        return f"{category_name} is ${amt} over limit."
    if status == STATUS_APPROACHING:
        return f"{category_name} is approaching its spending limit."
    return None


def suggest_target_type(category: Category) -> dict[str, str]:
    category_ids = _category_ids_for_category(category)
    household_id = category.household_id

    has_rules = RecurringRule.objects.filter(
        household_id=household_id,
        active=True,
        direction=RecurringRule.Direction.EXPENSE,
        category_id__in=category_ids,
    ).exists()
    if has_rules:
        return {
            "target_type": SpendingTarget.TargetType.FIXED,
            "reason": "Category has active recurring rules.",
        }

    lookback_start = date.today() - timedelta(days=180)
    txns = list(
        Transaction.objects.filter(
            account__household_id=household_id,
            category_id__in=category_ids,
            amount__lt=0,
            date__gte=lookback_start,
            status__in=(Transaction.Status.CLEARED, Transaction.Status.RECONCILED),
        )
        .exclude(transfer_group_id__isnull=False)
        .values_list("date", flat=True)
    )

    if len(txns) < 3:
        return {
            "target_type": SpendingTarget.TargetType.VARIABLE,
            "reason": "Not enough history; defaulting to variable spending.",
        }

    months = Counter((d.year, d.month) for d in txns)
    avg_per_month = len(txns) / max(1, len(months))

    if avg_per_month <= 2.5:
        days = [d.day for d in txns]
        try:
            common_day = mode(days)
            close = sum(1 for d in days if abs(d - common_day) <= 2)
            if close / len(days) >= 0.7:
                return {
                    "target_type": SpendingTarget.TargetType.FIXED,
                    "reason": "Transactions usually occur on the same day each month.",
                }
        except StatisticsError:
            pass

    if avg_per_month >= 4:
        return {
            "target_type": SpendingTarget.TargetType.VARIABLE,
            "reason": "Frequent irregular transactions.",
        }

    return {
        "target_type": SpendingTarget.TargetType.VARIABLE,
        "reason": "Default to variable for discretionary spending.",
    }


def calculate_target_metrics(
    target: SpendingTarget,
    *,
    anchor: date | None = None,
    today: date | None = None,
    include_scheduled: bool = True,
    transfer_rule_ids: set[int] | None = None,
) -> dict[str, Any]:
    _ = transfer_rule_ids
    today = today or date.today()
    anchor = anchor or today
    period_start, period_end = period_bounds(target.period, anchor)
    target_amount = _decimal(target.target_amount)
    target_type = target.target_type or SpendingTarget.TargetType.VARIABLE
    household_id = target.household_id
    category_name = target.category.name if target.category_id else ""
    include_names = (
        frozenset({category_name}) if category_name in _excluded_category_names() else None
    )
    category_ids = _category_ids_for_target(target)
    base_qs = _base_expense_qs(
        [household_id],
        account_id=target.account_id,
        include_category_names=include_names,
    )

    posted_rule_months = _posted_rule_months(
        household_id,
        category_ids,
        period_start,
        period_end,
        today=today,
        account_id=target.account_id,
    )

    spent_so_far = _sum_spent(
        base_qs, category_ids, period_start, period_end, today=today
    )

    scheduled_planned = Decimal("0")
    rule_scheduled = Decimal("0")

    if include_scheduled:
        scheduled_planned = _sum_scheduled_planned(
            base_qs,
            category_ids,
            period_start,
            period_end,
            today=today,
            posted_rule_months=posted_rule_months,
        )
        rule_scheduled = _sum_rule_projections_in_period(
            target,
            category_ids,
            period_start,
            period_end,
            today=today,
            posted_rule_months=posted_rule_months,
        )

    scheduled_remaining = scheduled_planned + rule_scheduled
    committed_amount = spent_so_far + scheduled_remaining
    remaining = target_amount - spent_so_far - scheduled_remaining
    over_target = (
        committed_amount - target_amount if committed_amount > target_amount else Decimal("0")
    )
    percent_used = (
        (committed_amount / target_amount * Decimal("100")).quantize(Decimal("0.1"))
        if target_amount > 0
        else Decimal("0")
    )
    status = _target_status(
        committed_amount=committed_amount,
        target_amount=target_amount,
    )
    cat_name = target.name or (target.category.name if target.category else "Category")
    recommendation = _recommendation_for_target(
        cat_name,
        status=status,
        over_target=over_target,
    )

    spent_str = str(spent_so_far.quantize(Decimal("0.01")))
    scheduled_str = str(scheduled_remaining.quantize(Decimal("0.01")))
    committed_str = str(committed_amount.quantize(Decimal("0.01")))

    status_note = None
    if over_target > 0:
        amt = over_target.quantize(Decimal("0.01"))
        status_note = f"Known spending exceeds limit by ${amt}."

    return {
        "target_id": target.id,
        "category_id": target.category_id,
        "category_name": target.category.name if target.category else cat_name,
        "name": target.name or target.category.name,
        "period": target.period,
        "target_type": target_type,
        "forecast_method": SCHEDULED_ONLY,
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
        "target_amount": str(target_amount.quantize(Decimal("0.01"))),
        "spent_so_far": spent_str,
        "scheduled_in_period": scheduled_str,
        "forecast_amount": committed_str,
        "period_total": committed_str,
        "remaining_to_target": str(remaining.quantize(Decimal("0.01"))),
        "percent_used": str(percent_used),
        "status": status,
        "recommendation": recommendation,
        "forecast_summary": status_note,
        "forecast_impact": status_note,
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
    include_scheduled: bool = True,
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
        calculate_target_metrics(
            t, anchor=anchor, today=today, include_scheduled=include_scheduled
        )
        for t in targets
    ]

    monthly_targets = Decimal("0")
    spent = Decimal("0")
    scheduled = Decimal("0")
    for row in rows:
        if row["period"] == SpendingTarget.Period.MONTHLY:
            monthly_targets += _decimal(row["target_amount"])
        spent += _decimal(row["spent_so_far"])
        scheduled += _decimal(row["scheduled_in_period"])

    return {
        "anchor_date": anchor.isoformat(),
        "total_monthly_targets": str(monthly_targets.quantize(Decimal("0.01"))),
        "spent_so_far_total": str(spent.quantize(Decimal("0.01"))),
        "scheduled_in_period_total": str(scheduled.quantize(Decimal("0.01"))),
        "above_target_count": len([r for r in rows if r["status"] in (STATUS_ABOVE, STATUS_RISKY)]),
        "approaching_target_count": len([r for r in rows if r["status"] == STATUS_APPROACHING]),
        "targets": rows,
    }


def recommendations_from_spending_targets(
    user,
    *,
    anchor: date | None = None,
    limit: int = 3,
) -> list[dict[str, Any]]:
    summary = spending_targets_summary(user, anchor=anchor)
    recs: list[dict[str, Any]] = []
    for row in summary["targets"]:
        if row["status"] not in (STATUS_ABOVE, STATUS_RISKY, STATUS_APPROACHING):
            continue
        total = _decimal(row["spent_so_far"]) + _decimal(row["scheduled_in_period"])
        target_amt = _decimal(row["target_amount"])
        over = total - target_amt
        if over <= 0 and row["status"] == STATUS_APPROACHING:
            pass
        cat = row["category_name"]
        if over > 0:
            why = f"{cat} known spending exceeds limit by ${over.quantize(Decimal('0.01'))}."
        else:
            why = f"{cat} is approaching its spending limit."
        action = row.get("recommendation") or f"Review {cat} spending."
        severity = "warning"
        recs.append(
            {
                "id": f"spending-target-{row['target_id']}",
                "severity": severity,
                "title": cat,
                "why": why,
                "recommended_action": action,
                "impact_label": "Over limit" if over > 0 else None,
                "impact_value": str(over.quantize(Decimal("0.01"))) if over > 0 else None,
                "primary_action_label": "View spending limits",
                "primary_action_url": "/spending-goals",
                "primary_action_type": "navigate",
                "secondary_action_label": None,
                "secondary_action_url": None,
                "secondary_action_type": None,
            }
        )
    recs.sort(key=lambda r: (0 if r["severity"] == "critical" else 1, r["title"]))
    return recs[:limit]
