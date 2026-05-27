"""
Bill intelligence: display status, autopay hints, payment confidence, warnings, history.
"""
from __future__ import annotations

from calendar import monthrange
from datetime import date, timedelta
from decimal import Decimal
from statistics import median
from typing import Any, Optional

from timeline.models import RecurringRule
from transactions.models import Transaction
from transactions.services.matching import ledger_visible_transactions

from .models import BillOccurrence

DUE_SOON_DAYS_DEFAULT = 5
AMOUNT_INCREASE_WARN_PCT = Decimal("15")
FORGOTTEN_LOOKBACK_MONTHS = 3
AUTOPAY_MIN_PLAID_MONTHS = 3

DISPLAY_PROJECTED = "projected"
DISPLAY_DUE_SOON = "due_soon"
DISPLAY_PAID = "paid"
DISPLAY_RECONCILED = "reconciled"
DISPLAY_LATE = "late"
DISPLAY_LIKELY_FORGOTTEN = "likely_forgotten"
DISPLAY_SKIPPED = "skipped"


def _decimal(value: Decimal | str | float) -> Decimal:
    return Decimal(str(value)).quantize(Decimal("0.01"))


def _prior_month(year: int, month: int, delta: int) -> tuple[int, int]:
    m = month - delta
    y = year
    while m < 1:
        m += 12
        y -= 1
    return y, m


def _rule_paid_in_month(rule_id: int, year: int, month: int) -> bool:
    start = date(year, month, 1)
    end = date(year, month, monthrange(year, month)[1])
    return ledger_visible_transactions(
        Transaction.objects.filter(
            rule_id=rule_id,
            date__gte=start,
            date__lte=end,
            amount__lt=0,
        )
    ).exists()


def detect_likely_forgotten(
    *,
    rule_id: Optional[int],
    due_date: date,
    today: date,
    has_payment: bool,
    base_status: str,
) -> bool:
    if has_payment or not rule_id or base_status in (
        BillOccurrence.Status.PAID,
        BillOccurrence.Status.RECONCILED,
    ):
        return False
    y, m = due_date.year, due_date.month
    paid_months = 0
    for i in range(1, FORGOTTEN_LOOKBACK_MONTHS + 1):
        py, pm = _prior_month(y, m, i)
        if _rule_paid_in_month(rule_id, py, pm):
            paid_months += 1
    if paid_months < 2:
        return False
    # Pattern existed but this month has no payment yet
    if today > due_date:
        return base_status == BillOccurrence.Status.MISSED
    # Before due date: flag if we're within 3 days of due and still no payment
    days_until = (due_date - today).days
    return days_until <= 3 and today.day >= max(1, due_date.day - 2)


def compute_display_status(
    occ: BillOccurrence,
    *,
    today: date,
    has_payment: bool,
    likely_forgotten: bool,
    due_soon_days: int = DUE_SOON_DAYS_DEFAULT,
) -> str:
    if occ.skipped:
        return DISPLAY_SKIPPED
    if occ.status == BillOccurrence.Status.RECONCILED:
        return DISPLAY_RECONCILED
    if occ.status == BillOccurrence.Status.PAID:
        return DISPLAY_PAID
    if likely_forgotten and not has_payment:
        return DISPLAY_LIKELY_FORGOTTEN
    if occ.due_date < today and not has_payment:
        return DISPLAY_LATE
    if occ.status == BillOccurrence.Status.MISSED:
        return DISPLAY_LATE
    days_until = (occ.due_date - today).days
    if not has_payment and 0 <= days_until <= due_soon_days:
        return DISPLAY_DUE_SOON
    return DISPLAY_PROJECTED


def payment_confidence(
    *,
    txn: Optional[Transaction],
    match_score: int,
    manual_mark: bool,
) -> tuple[str, int]:
    """Return (high|medium|low, score 0-100)."""
    if manual_mark and txn:
        return "high", 95
    if txn is None:
        return "low", 0
    if txn.reconciled or txn.status == Transaction.Status.RECONCILED:
        return "high", 98
    if txn.source == Transaction.Source.PLAID:
        if match_score >= 70:
            return "high", min(95, match_score + 20)
        return "medium", match_score + 10
    if txn.rule_id and match_score >= 60:
        return "high", min(92, match_score + 15)
    if match_score >= 50:
        return "medium", match_score
    return "low", max(10, match_score)


def _match_score_for_txn(
    txn: Transaction,
    *,
    expected_amount: Decimal,
    due_date: date,
    category_id: Optional[int],
    rule_id: Optional[int],
) -> int:
    score = 40
    if abs(abs(txn.amount) - abs(expected_amount)) <= Decimal("0.01"):
        score += 20
    dd = abs((txn.date - due_date).days)
    if dd == 0:
        score += 25
    elif dd <= 5:
        score += 15
    if category_id and txn.category_id == category_id:
        score += 15
    if rule_id and txn.rule_id == rule_id:
        score += 20
    return score


def detect_autopay(
    rule: Optional[RecurringRule],
    *,
    household_id: int,
    rule_id: Optional[int],
    occurrence: Optional[BillOccurrence] = None,
) -> dict[str, Any]:
    if occurrence and occurrence.autopay_override:
        mode = occurrence.autopay_override
        return {
            "autopay_mode": mode,
            "autopay_confidence": "high",
            "autopay_label": "Automatically paid" if mode == "autopay" else "Paid manually",
            "autopay_risk": False,
        }

    if not rule or not rule_id:
        return {
            "autopay_mode": "unknown",
            "autopay_confidence": "low",
            "autopay_label": None,
            "autopay_risk": False,
        }

    today = date.today()
    plaid_streak = 0
    total = 0
    for i in range(1, 5):
        y, m = _prior_month(today.year, today.month, i)
        start = date(y, m, 1)
        end = date(y, m, monthrange(y, m)[1])
        txns = ledger_visible_transactions(
            Transaction.objects.filter(
                rule_id=rule_id,
                date__gte=start,
                date__lte=end,
                amount__lt=0,
            )
        )
        for txn in txns[:1]:
            total += 1
            if txn.source == Transaction.Source.PLAID:
                plaid_streak += 1

    if plaid_streak >= AUTOPAY_MIN_PLAID_MONTHS:
        return {
            "autopay_mode": "autopay",
            "autopay_confidence": "medium",
            "autopay_label": "Likely on autopay",
            "autopay_risk": False,
        }

    risk = False
    if total >= 2 and plaid_streak >= 2:
        occ = (
            BillOccurrence.objects.filter(rule_id=rule_id, month=f"{today.year:04d}-{today.month:02d}")
            .order_by("-due_date")
            .first()
        )
        if occ and occ.due_date <= today + timedelta(days=2) and not occ.transaction_id:
            risk = True

    return {
        "autopay_mode": "unknown",
        "autopay_confidence": "low",
        "autopay_label": "Autopay failed risk" if risk else None,
        "autopay_risk": risk,
    }


def bill_amount_history(rule_id: int, months: int = 6) -> list[dict[str, Any]]:
    today = date.today()
    points: list[dict[str, Any]] = []
    for i in range(months - 1, -1, -1):
        y, m = _prior_month(today.year, today.month, i)
        start = date(y, m, 1)
        end = date(y, m, monthrange(y, m)[1])
        txns = ledger_visible_transactions(
            Transaction.objects.filter(
                rule_id=rule_id,
                date__gte=start,
                date__lte=end,
                amount__lt=0,
            )
        ).order_by("date")
        amt = None
        if txns.exists():
            amt = _decimal(abs(txns.first().amount))
        points.append(
            {
                "month": f"{y:04d}-{m:02d}",
                "label": start.strftime("%b %Y"),
                "amount": str(amt) if amt is not None else None,
            }
        )
    return points


def build_occurrence_warnings(
    item: dict[str, Any],
    *,
    today: date,
    average_amount: Optional[Decimal] = None,
) -> list[dict[str, str]]:
    warnings: list[dict[str, str]] = []
    status = item.get("status")
    name = item.get("name", "Bill")
    days = item.get("days_until_due", 0)

    if status == DISPLAY_LATE:
        warnings.append(
            {"id": f"late-{item['id']}", "severity": "critical", "message": f"{name} is late"}
        )
    elif status == DISPLAY_LIKELY_FORGOTTEN:
        warnings.append(
            {
                "id": f"forgot-{item['id']}",
                "severity": "warning",
                "message": f"{name} may have been forgotten",
            }
        )
    elif status == DISPLAY_DUE_SOON and days <= 2:
        warnings.append(
            {
                "id": f"due-{item['id']}",
                "severity": "warning",
                "message": f"{name} due in {days} day{'s' if days != 1 else ''}",
            }
        )

    if item.get("autopay_risk"):
        warnings.append(
            {
                "id": f"autopay-{item['id']}",
                "severity": "warning",
                "message": f"{name}: autopay may have failed",
            }
        )

    amt = _decimal(item["amount"]) if item.get("amount") else None
    if average_amount and amt and average_amount > 0:
        pct = (amt - average_amount) / average_amount * Decimal("100")
        if pct >= AMOUNT_INCREASE_WARN_PCT:
            warnings.append(
                {
                    "id": f"increase-{item['id']}",
                    "severity": "info",
                    "message": f"{name} amount up {pct.quantize(Decimal('0.1'))}% vs average",
                }
            )

    return warnings


def build_checklist_warnings(items: list[dict[str, Any]], *, today: date) -> list[dict[str, str]]:
    seen: set[str] = set()
    out: list[dict[str, str]] = []
    for item in items:
        for w in item.get("warnings") or []:
            wid = w.get("id")
            if wid and wid in seen:
                continue
            if wid:
                seen.add(wid)
            out.append(w)
    late_count = sum(1 for i in items if i.get("status") == DISPLAY_LATE)
    if late_count >= 2:
        out.insert(
            0,
            {
                "id": "multiple-late",
                "severity": "critical",
                "message": f"{late_count} bills overdue this month",
            },
        )
    return out[:12]


def average_paid_amount(rule_id: int, months: int = 6) -> Optional[Decimal]:
    today = date.today()
    amounts: list[Decimal] = []
    for i in range(1, months + 1):
        y, m = _prior_month(today.year, today.month, i)
        start = date(y, m, 1)
        end = date(y, m, monthrange(y, m)[1])
        txn = (
            ledger_visible_transactions(
                Transaction.objects.filter(
                    rule_id=rule_id,
                    date__gte=start,
                    date__lte=end,
                    amount__lt=0,
                )
            )
            .order_by("date")
            .first()
        )
        if txn:
            amounts.append(_decimal(abs(txn.amount)))
    if not amounts:
        return None
    return _quantize_median(amounts)


def _quantize_median(values: list[Decimal]) -> Decimal:
    return _decimal(median([float(v) for v in values]))
