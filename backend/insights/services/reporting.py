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

# Canonical money precision used by the reporting serializer (cents).
# Not a materiality / significance threshold — representation only.
_MONEY_QUANTUM = Decimal("0.01")


def _decimal(value) -> Decimal:
    if value is None:
        return Decimal("0")
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def _finite_decimal(value) -> Decimal | None:
    """Return a finite Decimal, or None when the value is missing/non-finite."""
    if value is None:
        return None
    try:
        d = value if isinstance(value, Decimal) else Decimal(str(value))
    except Exception:
        return None
    if not d.is_finite():
        return None
    return d


def _money(value) -> str:
    """Serialize a money amount. Non-finite inputs become explicit null via callers of _money_or_none."""
    d = _finite_decimal(value)
    if d is None:
        # Known empty aggregates use Decimal("0"); refuse NaN/Infinity emission.
        raise ValueError(f"non-finite money value: {value!r}")
    return str(d.quantize(_MONEY_QUANTUM))


def _money_or_none(value) -> str | None:
    d = _finite_decimal(value)
    if d is None:
        return None
    return str(d.quantize(_MONEY_QUANTUM))


def _percent_or_none(value: Decimal | None) -> str | None:
    if value is None or not value.is_finite():
        return None
    return str(value.quantize(Decimal("0.1")))


def _show_category_comparison(*, delta: Decimal) -> bool:
    """
    Whether a category MoM comparison should be shown.

    True when the delta is non-zero at canonical money precision (same quantum as
    serialized ``delta``). No dollar-amount or category-share materiality suppression:
    any real cent-level change is visible to the client via ``show_comparison``.
    """
    return delta.quantize(_MONEY_QUANTUM) != 0


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
        pct: Decimal | None = None
        if prev != 0:
            pct = delta / abs(prev) * Decimal("100")
        out[key] = {
            "current": _money(cur),
            "previous": _money(prev),
            "delta": _money(delta),
            "percent_change": _percent_or_none(pct),
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

    expense_abs_total = sum(
        (abs(item["total"]) for item in current.values() if item["total"] < 0),
        Decimal("0"),
    )

    breakdown = []
    for cat_id, item in current.items():
        total = item["total"]
        prev = previous.get(cat_id, Decimal("0"))
        delta = total - prev
        row: dict[str, Any] = {
            "category_id": item["category_id"],
            "category_name": item["category_name"],
            "total": _money(total),
        }
        # Expense share of month expense subtotal — backend-owned analytical field.
        if total < 0 and expense_abs_total > 0:
            share = abs(total) / expense_abs_total * Decimal("100")
            row["expense_share_percent"] = _percent_or_none(share)
        else:
            row["expense_share_percent"] = None
        if include_previous:
            row["previous_total"] = _money(prev)
            row["delta"] = _money(delta)
            pct: Decimal | None = None
            if prev != 0:
                pct = delta / abs(prev) * Decimal("100")
            row["percent_change"] = _percent_or_none(pct)
            row["show_comparison"] = _show_category_comparison(delta=delta)
        breakdown.append(row)

    # Categories that only appeared last month are omitted from current breakdown
    # (they did not spend/earn in the selected month).
    # Prefer expense magnitude (most negative first), then name — backend ordering.
    breakdown.sort(
        key=lambda r: (
            0 if Decimal(r["total"]) < 0 else 1,
            Decimal(r["total"]) if Decimal(r["total"]) < 0 else Decimal("0"),
            r["category_name"],
        )
    )
    return {"month": ctx.period.month, "breakdown": breakdown}
