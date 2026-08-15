"""Historical income/expense reporting aggregates."""
from __future__ import annotations

from collections import defaultdict
from decimal import Decimal
from typing import Any

from django.db.models import Q, QuerySet, Sum
from django.db.models.functions import Coalesce, TruncMonth

from insights.services.dashboard_upcoming import BANK_TRANSFER_CATEGORY_NAMES
from insights.services.report_context import ReportContext
from insights.services.report_dates import month_key
from transactions.models import Transaction


def _decimal(value) -> Decimal:
    if value is None:
        return Decimal("0")
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def _money(value) -> str:
    return str(_decimal(value).quantize(Decimal("0.01")))


def exclude_internal_transfers(qs: QuerySet) -> QuerySet:
    """Drop paired transfer legs and bank-transfer categories from P&L-style totals."""
    return qs.exclude(transfer_group_id__isnull=False).exclude(
        category__name__in=BANK_TRANSFER_CATEGORY_NAMES
    )


def _visible_transactions(ctx: ReportContext, *, start, end) -> QuerySet:
    return exclude_internal_transfers(
        Transaction.objects.filter(
            account_id__in=ctx.account_ids,
            date__gte=start,
            date__lte=end,
        )
    )


def _empty_month_totals() -> dict[str, Decimal]:
    return {
        "total_income": Decimal("0"),
        "total_expenses": Decimal("0"),
        "net": Decimal("0"),
    }


def monthly_totals_by_month(
    ctx: ReportContext,
    *,
    start=None,
    end=None,
) -> dict[str, dict[str, Decimal]]:
    """One grouped query: income/expense/net for the given window (defaults to history)."""
    start = start or ctx.period.history_start
    end = end or ctx.period.end
    rows = (
        _visible_transactions(ctx, start=start, end=end)
        .annotate(month=TruncMonth("date"))
        .values("month")
        .annotate(
            total_income=Coalesce(Sum("amount", filter=Q(amount__gt=0)), Decimal("0")),
            total_expenses=Coalesce(Sum("amount", filter=Q(amount__lt=0)), Decimal("0")),
        )
        .order_by("month")
    )
    by_month: dict[str, dict[str, Decimal]] = {}
    for row in rows:
        key = month_key(row["month"])
        income = _decimal(row["total_income"])
        expenses = _decimal(row["total_expenses"])
        by_month[key] = {
            "total_income": income,
            "total_expenses": expenses,
            "net": income + expenses,
        }
    return by_month


def serialize_month_totals(totals: dict[str, Decimal], *, month: str) -> dict[str, Any]:
    return {
        "month": month,
        "total_income": _money(totals["total_income"]),
        "total_expenses": _money(totals["total_expenses"]),
        "net": _money(totals["net"]),
    }


def comparison_payload(current: dict[str, Decimal], previous: dict[str, Decimal]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key in ("total_income", "total_expenses", "net"):
        cur = current[key]
        prev = previous[key]
        delta = cur - prev
        pct = None
        if prev != 0:
            pct = (delta / abs(prev) * Decimal("100")).quantize(Decimal("0.1"))
        out[key] = {
            "current": _money(cur),
            "previous": _money(prev),
            "delta": _money(delta),
            "percent_change": str(pct) if pct is not None else None,
        }
    return out


def build_monthly_summary(ctx: ReportContext) -> dict[str, Any]:
    by_month = monthly_totals_by_month(
        ctx, start=ctx.period.previous_start, end=ctx.period.end
    )
    current = by_month.get(ctx.period.month, _empty_month_totals())
    previous = by_month.get(month_key(ctx.period.previous_start), _empty_month_totals())
    payload = serialize_month_totals(current, month=ctx.period.month)
    payload["previous_month"] = month_key(ctx.period.previous_start)
    payload["comparison"] = comparison_payload(current, previous)
    return payload


def build_monthly_trend(ctx: ReportContext) -> list[dict[str, Any]]:
    from insights.services.report_dates import add_months, month_start

    by_month = monthly_totals_by_month(ctx)
    cursor = month_start(ctx.period.history_start.year, ctx.period.history_start.month)
    end = ctx.period.start
    out: list[dict[str, Any]] = []
    while cursor <= end:
        key = month_key(cursor)
        totals = by_month.get(key, _empty_month_totals())
        out.append(serialize_month_totals(totals, month=key))
        cursor = add_months(cursor, 1)
    return out


def build_category_breakdown(
    ctx: ReportContext,
    *,
    include_previous: bool = True,
) -> dict[str, Any]:
    """Grouped category totals for the selected month (optional previous-month deltas)."""
    start = ctx.period.previous_start if include_previous else ctx.period.start
    rows = (
        _visible_transactions(ctx, start=start, end=ctx.period.end)
        .annotate(month=TruncMonth("date"))
        .values("category_id", "category__name", "month")
        .annotate(total=Coalesce(Sum("amount"), Decimal("0")))
        .order_by("category__name")
    )
    current: dict[int | None, dict[str, Any]] = {}
    previous: dict[int | None, Decimal] = defaultdict(lambda: Decimal("0"))
    current_key = ctx.period.month
    previous_key = month_key(ctx.period.previous_start)
    for row in rows:
        cat_id = row["category_id"]
        name = row["category__name"] or "Uncategorized"
        total = _decimal(row["total"])
        key = month_key(row["month"])
        if key == current_key:
            current[cat_id] = {
                "category_id": cat_id,
                "category_name": name,
                "total": total,
            }
        elif include_previous and key == previous_key:
            previous[cat_id] += total

    breakdown = []
    for cat_id, item in current.items():
        total = item["total"]
        prev = previous.get(cat_id, Decimal("0"))
        delta = total - prev
        row = {
            "category_id": item["category_id"],
            "category_name": item["category_name"],
            "total": _money(total),
        }
        if include_previous:
            row["previous_total"] = _money(prev)
            row["delta"] = _money(delta)
        breakdown.append(row)

    # Categories that only appeared last month are omitted from current breakdown
    # (they did not spend/earn in the selected month).
    breakdown.sort(key=lambda r: r["category_name"])
    return {"month": ctx.period.month, "breakdown": breakdown}
