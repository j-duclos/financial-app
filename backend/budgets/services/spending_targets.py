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
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal
from statistics import StatisticsError, mode
from typing import Any

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


_POSTED_STATUSES = frozenset(
    {
        Transaction.Status.CLEARED,
        Transaction.Status.RECONCILED,
        Transaction.Status.PLANNED,
    }
)


@dataclass
class SpendingTargetCalculationContext:
    """Bulk-loaded support data so per-target metrics need no SQL."""

    today: date
    include_scheduled: bool
    category_ids_by_target_id: dict[int, list[int]] = field(default_factory=dict)
    transactions: list[Transaction] = field(default_factory=list)
    visible_ids: set[int] = field(default_factory=set)
    rules: list[RecurringRule] = field(default_factory=list)
    skipped: set[tuple[int, date]] = field(default_factory=set)


def _category_ids_for_category(category: Category) -> list[int]:
    return list(
        Category.objects.filter(
            household_id=category.household_id,
            category_type=Category.CategoryType.EXPENSE,
            name__iexact=category.name,
            is_archived=False,
        ).values_list("id", flat=True)
    )


def _load_category_ids_by_household_name(household_ids: list[int]) -> dict[tuple[int, str], list[int]]:
    ids_by_key: dict[tuple[int, str], list[int]] = defaultdict(list)
    if not household_ids:
        return ids_by_key
    for cat_id, household_id, name in Category.objects.filter(
        household_id__in=household_ids,
        category_type=Category.CategoryType.EXPENSE,
        is_archived=False,
    ).values_list("id", "household_id", "name"):
        ids_by_key[(household_id, (name or "").lower())].append(cat_id)
    return ids_by_key


def _category_ids_for_target_from_map(
    target: SpendingTarget,
    ids_by_key: dict[tuple[int, str], list[int]],
) -> list[int]:
    name = target.category.name if target.category_id else ""
    if not name:
        return [target.category_id] if target.category_id else []
    return list(ids_by_key.get((target.household_id, name.lower()), []))


def _txn_is_base_expense(txn: Transaction, *, include_category_names: frozenset[str] | None) -> bool:
    if txn.amount is None or txn.amount >= 0:
        return False
    if txn.transfer_group_id is not None:
        return False
    excluded = _excluded_category_names()
    if include_category_names:
        excluded = excluded - include_category_names
    cat_name = txn.category.name if txn.category_id and txn.category else None
    if cat_name in excluded:
        return False
    if txn.category_id is None and "transfer" in (txn.payee or "").lower():
        return False
    return True


def _posted_rule_months_from_context(
    ctx: SpendingTargetCalculationContext,
    *,
    category_ids: list[int],
    start: date,
    end: date,
    account_id: int | None,
) -> set[tuple[int, int, int]]:
    if not category_ids:
        return set()
    through = min(end, ctx.today)
    cat_set = set(category_ids)
    out: set[tuple[int, int, int]] = set()
    for txn in ctx.transactions:
        if not txn.rule_id or txn.id not in ctx.visible_ids:
            continue
        if txn.category_id not in cat_set:
            continue
        if account_id is not None and txn.account_id != account_id:
            continue
        if txn.amount is None or txn.amount >= 0:
            continue
        if not (start <= txn.date <= through):
            continue
        if txn.status not in _POSTED_STATUSES:
            continue
        out.add((txn.rule_id, txn.date.year, txn.date.month))
    return out


def _sum_spent_from_context(
    ctx: SpendingTargetCalculationContext,
    *,
    category_ids: list[int],
    start: date,
    end: date,
    account_id: int | None,
    include_category_names: frozenset[str] | None,
) -> Decimal:
    if not category_ids:
        return Decimal("0")
    through = min(end, ctx.today)
    cat_set = set(category_ids)
    total = Decimal("0")
    for txn in ctx.transactions:
        if txn.id not in ctx.visible_ids:
            continue
        if txn.category_id not in cat_set:
            continue
        if account_id is not None and txn.account_id != account_id:
            continue
        if not (start <= txn.date <= through):
            continue
        if txn.status not in _POSTED_STATUSES:
            continue
        if not _txn_is_base_expense(txn, include_category_names=include_category_names):
            continue
        total += abs(_decimal(txn.amount))
    return total


def _sum_scheduled_planned_from_context(
    ctx: SpendingTargetCalculationContext,
    *,
    category_ids: list[int],
    start: date,
    end: date,
    account_id: int | None,
    include_category_names: frozenset[str] | None,
    posted_rule_months: set[tuple[int, int, int]],
) -> Decimal:
    if not category_ids or ctx.today >= end:
        return Decimal("0")
    cat_set = set(category_ids)
    total = Decimal("0")
    for txn in ctx.transactions:
        if txn.id not in ctx.visible_ids:
            continue
        if txn.category_id not in cat_set:
            continue
        if account_id is not None and txn.account_id != account_id:
            continue
        if txn.status != Transaction.Status.PLANNED:
            continue
        if not (start <= txn.date <= end and txn.date > ctx.today):
            continue
        if not _txn_is_base_expense(txn, include_category_names=include_category_names):
            continue
        if txn.rule_id and (txn.rule_id, txn.date.year, txn.date.month) in posted_rule_months:
            continue
        total += abs(_decimal(txn.amount))
    return total


def _existing_rule_dates_from_context(
    ctx: SpendingTargetCalculationContext,
    *,
    category_ids: list[int],
    start: date,
    end: date,
    account_id: int | None,
) -> set[tuple[int, date]]:
    cat_set = set(category_ids)
    out: set[tuple[int, date]] = set()
    for txn in ctx.transactions:
        if not txn.rule_id:
            continue
        if txn.category_id not in cat_set:
            continue
        if account_id is not None and txn.account_id != account_id:
            continue
        if not (start <= txn.date <= end):
            continue
        out.add((txn.rule_id, txn.date))
    return out


def _sum_rule_projections_from_context(
    ctx: SpendingTargetCalculationContext,
    target: SpendingTarget,
    *,
    category_ids: list[int],
    start: date,
    end: date,
    posted_rule_months: set[tuple[int, int, int]],
) -> Decimal:
    if not category_ids or ctx.today >= end:
        return Decimal("0")
    proj_start = max(start, ctx.today + timedelta(days=1))
    if proj_start > end:
        return Decimal("0")
    cat_set = set(category_ids)
    existing = _existing_rule_dates_from_context(
        ctx,
        category_ids=category_ids,
        start=start,
        end=end,
        account_id=target.account_id,
    )
    total = Decimal("0")
    for rule in ctx.rules:
        if rule.household_id != target.household_id:
            continue
        if not rule.active or rule.direction != RecurringRule.Direction.EXPENSE:
            continue
        if rule.category_id not in cat_set:
            continue
        if target.account_id is not None and rule.account_id != target.account_id:
            continue
        for occ_date in generate_rule_occurrence_dates(rule, proj_start, end):
            key = (rule.id, occ_date)
            if key in ctx.skipped or key in existing:
                continue
            if (rule.id, occ_date.year, occ_date.month) in posted_rule_months:
                continue
            total += abs(resolve_rule_params(rule, occ_date).amount)
    return total


def build_spending_target_context(
    targets: list[SpendingTarget],
    *,
    today: date,
    anchor: date | None = None,
    include_scheduled: bool = True,
) -> SpendingTargetCalculationContext:
    ctx = SpendingTargetCalculationContext(today=today, include_scheduled=include_scheduled)
    if not targets:
        return ctx

    anchor = anchor or today
    household_ids = list({t.household_id for t in targets})
    ids_by_key = _load_category_ids_by_household_name(household_ids)
    for target in targets:
        ctx.category_ids_by_target_id[target.id] = _category_ids_for_target_from_map(target, ids_by_key)

    window_start = None
    window_end = None
    for target in targets:
        start, end = period_bounds(target.period, anchor)
        window_start = start if window_start is None else min(window_start, start)
        window_end = end if window_end is None else max(window_end, end)
    if window_start is None or window_end is None:
        return ctx

    txn_qs = Transaction.objects.filter(
        account__household_id__in=household_ids,
        date__gte=window_start,
        date__lte=window_end,
    )
    ctx.transactions = list(txn_qs.select_related("category", "account"))
    ctx.visible_ids = set(ledger_visible_transactions(txn_qs).values_list("pk", flat=True))

    all_category_ids = {cid for ids in ctx.category_ids_by_target_id.values() for cid in ids}
    rules_qs = RecurringRule.objects.filter(
        household_id__in=household_ids,
        active=True,
        direction=RecurringRule.Direction.EXPENSE,
    )
    if all_category_ids:
        rules_qs = rules_qs.filter(category_id__in=all_category_ids)
    ctx.rules = list(rules_qs.select_related("account", "category").prefetch_related("schedules"))

    if include_scheduled:
        ctx.skipped = set(
            RecurringRuleSkip.objects.filter(
                rule__household_id__in=household_ids,
                date__gte=window_start,
                date__lte=window_end,
            ).values_list("rule_id", "date")
        )
    return ctx


def _target_status(
    *,
    committed_amount: Decimal,
    target_amount: Decimal,
    warning_threshold_percent: Decimal | None = None,
) -> str:
    if target_amount <= 0:
        return STATUS_WITHIN
    if committed_amount > target_amount:
        return STATUS_ABOVE
    threshold = (
        warning_threshold_percent
        if warning_threshold_percent is not None
        else APPROACHING_THRESHOLD_PERCENT
    )
    pct = (committed_amount / target_amount * Decimal("100")) if target_amount else Decimal("0")
    if pct >= threshold:
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
    context: SpendingTargetCalculationContext | None = None,
) -> dict[str, Any]:
    _ = transfer_rule_ids
    today = today or date.today()
    anchor = anchor or today
    if context is None:
        context = build_spending_target_context(
            [target], today=today, anchor=anchor, include_scheduled=include_scheduled
        )
    period_start, period_end = period_bounds(target.period, anchor)
    target_amount = _decimal(target.target_amount)
    target_type = target.target_type or SpendingTarget.TargetType.VARIABLE
    category_name = target.category.name if target.category_id else ""
    include_names = (
        frozenset({category_name}) if category_name in _excluded_category_names() else None
    )
    category_ids = context.category_ids_by_target_id.get(target.id) or []

    posted_rule_months = _posted_rule_months_from_context(
        context,
        category_ids=category_ids,
        start=period_start,
        end=period_end,
        account_id=target.account_id,
    )
    spent_so_far = _sum_spent_from_context(
        context,
        category_ids=category_ids,
        start=period_start,
        end=period_end,
        account_id=target.account_id,
        include_category_names=include_names,
    )

    scheduled_planned = Decimal("0")
    rule_scheduled = Decimal("0")
    if include_scheduled:
        scheduled_planned = _sum_scheduled_planned_from_context(
            context,
            category_ids=category_ids,
            start=period_start,
            end=period_end,
            account_id=target.account_id,
            include_category_names=include_names,
            posted_rule_months=posted_rule_months,
        )
        rule_scheduled = _sum_rule_projections_from_context(
            context,
            target,
            category_ids=category_ids,
            start=period_start,
            end=period_end,
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
        warning_threshold_percent=_decimal(target.warning_threshold_percent),
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
    households=None,
    household_ids: list[int] | None = None,
) -> dict[str, Any]:
    today = date.today()
    anchor = anchor or today
    if household_id is not None:
        if households is None:
            households = get_households_for_user(user)
        targets = SpendingTarget.objects.filter(
            household_id=household_id, household__in=households, active=True
        )
    elif household_ids is not None:
        targets = SpendingTarget.objects.filter(household_id__in=household_ids, active=True)
    else:
        if households is None:
            households = get_households_for_user(user)
        targets = SpendingTarget.objects.filter(household__in=households, active=True)
    targets = targets.select_related("category", "account", "household")
    target_list = list(targets)
    context = build_spending_target_context(
        target_list, today=today, anchor=anchor, include_scheduled=include_scheduled
    )

    rows = [
        calculate_target_metrics(
            t,
            anchor=anchor,
            today=today,
            include_scheduled=include_scheduled,
            context=context,
        )
        for t in target_list
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
    summary: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    if summary is None:
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
                "primary_action_label": "View budget",
                "primary_action_url": "/spending-goals",
                "primary_action_type": "navigate",
                "secondary_action_label": None,
                "secondary_action_url": None,
                "secondary_action_type": None,
            }
        )
    recs.sort(key=lambda r: (0 if r["severity"] == "critical" else 1, r["title"]))
    return recs[:limit]
