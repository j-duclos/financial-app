"""
Monthly bill checklist: projected rule occurrences, manual bills, and payment status.
"""
from __future__ import annotations

import calendar
from calendar import monthrange
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any, Iterable, Optional

from django.db import transaction as db_transaction
from django.db.models import Q
from django.utils import timezone

from accounts.models import Account
from categories.models import Category
from core.models import Household
from core.utils import get_households_for_user
from timeline.models import RecurringRule, RecurringRuleSkip
from timeline.services.ledger import generate_rule_occurrences, _materialize_rule_occurrence
from transactions.models import Transaction, TransactionMatch
from transactions.services.matching import AMOUNT_TOLERANCE, ledger_visible_transactions

from .bill_insights import (
    DISPLAY_DUE_SOON,
    DISPLAY_LATE,
    DISPLAY_LIKELY_FORGOTTEN,
    DISPLAY_SKIPPED,
    average_paid_amount,
    bill_amount_history,
    build_checklist_warnings,
    build_occurrence_warnings,
    compute_display_status,
    detect_autopay,
    detect_likely_forgotten,
    payment_confidence,
    _match_score_for_txn,
)
from .models import BillOccurrence

BILL_MATCH_DATE_WINDOW_DAYS = 5
DUE_SOON_DAYS = 5

CARD_LOAN_PAYMENT_CATEGORIES = frozenset(
    {"Credit Card Payment", "Student Loan", "Personal Loan", "Mortgage"}
)
TRANSFER_CATEGORY_NAMES = frozenset({"Bank Transfer", "Transfer"})
SUBSCRIPTION_CATEGORY_NAMES = frozenset({"Streaming", "Software / Apps", "Memberships"})
LOAN_KEYWORDS = ("loan", "mortgage", "debt", "heloc")


def _decimal(value: Decimal | str | float | int) -> Decimal:
    return Decimal(str(value)).quantize(Decimal("0.01"))


def _month_bounds(year: int, month: int) -> tuple[date, date, str]:
    start = date(year, month, 1)
    last_day = calendar.monthrange(year, month)[1]
    end = date(year, month, last_day)
    return start, end, f"{year:04d}-{month:02d}"


def _category_suggests_loan(category_name: Optional[str]) -> bool:
    if not category_name:
        return False
    n = category_name.lower()
    return any(k in n for k in LOAN_KEYWORDS)


def rule_counts_as_bill(rule: RecurringRule) -> bool:
    """Whether a recurring rule belongs on the monthly bill checklist."""
    if getattr(rule, "is_bill", False):
        return True
    if rule.direction == RecurringRule.Direction.INCOME:
        return False
    cat_name = (rule.category.name if rule.category_id and rule.category else "") or ""
    has_transfer_dest = bool(rule.transfer_to_account_id)
    name_lower = (rule.name or "").lower()
    if cat_name in CARD_LOAN_PAYMENT_CATEGORIES or _category_suggests_loan(cat_name):
        return True
    if rule.direction == RecurringRule.Direction.TRANSFER or has_transfer_dest:
        if cat_name in TRANSFER_CATEGORY_NAMES and cat_name not in CARD_LOAN_PAYMENT_CATEGORIES:
            return False
        if "move to" in name_lower and cat_name not in CARD_LOAN_PAYMENT_CATEGORIES:
            return False
        return cat_name in CARD_LOAN_PAYMENT_CATEGORIES or has_transfer_dest
    if rule.direction == RecurringRule.Direction.EXPENSE:
        return True
    return False


def transaction_counts_as_bill(txn: Transaction) -> bool:
    if getattr(txn, "is_bill", False):
        return True
    if txn.amount is not None and txn.amount >= 0:
        return False
    if txn.rule_id and txn.rule:
        return rule_counts_as_bill(txn.rule)
    cat_name = (txn.category.name if txn.category_id and txn.category else "") or ""
    if cat_name in CARD_LOAN_PAYMENT_CATEGORIES or _category_suggests_loan(cat_name):
        return True
    if txn.transaction_type in (
        Transaction.TransactionType.CREDIT_CARD_PAYMENT,
    ):
        return True
    if txn.source in (Transaction.Source.ONE_TIME, Transaction.Source.ACTUAL, Transaction.Source.PLAID):
        if txn.category and txn.category.category_type == Category.CategoryType.EXPENSE:
            return True
    return False


def _signed_rule_amount(rule: RecurringRule) -> Decimal:
    amt = _decimal(rule.amount)
    if rule.direction == RecurringRule.Direction.INCOME:
        return amt
    return -amt


def _transaction_is_paid(txn: Transaction) -> bool:
    if txn.reconciled:
        return True
    if txn.status == Transaction.Status.RECONCILED:
        return True
    if txn.cleared:
        return True
    if txn.status == Transaction.Status.CLEARED:
        return True
    if txn.source == Transaction.Source.PLAID:
        if txn.import_match_status in (
            Transaction.ImportMatchStatus.MATCHED,
            Transaction.ImportMatchStatus.NONE,
        ):
            return True
    if TransactionMatch.objects.filter(planned_transaction_id=txn.pk).exists():
        return True
    if TransactionMatch.objects.filter(imported_transaction_id=txn.pk).exists():
        return True
    return False


def _status_from_transaction(txn: Transaction, *, due_date: date, today: date, skipped: bool) -> str:
    if skipped:
        return BillOccurrence.Status.PROJECTED
    if txn.reconciled or txn.status == Transaction.Status.RECONCILED:
        return BillOccurrence.Status.RECONCILED
    if _transaction_is_paid(txn):
        return BillOccurrence.Status.PAID
    if due_date < today:
        return BillOccurrence.Status.MISSED
    return BillOccurrence.Status.PROJECTED


def find_matching_transaction(
    *,
    household_id: int,
    account_id: int,
    expected_amount: Decimal,
    due_date: date,
    rule: Optional[RecurringRule] = None,
    category_id: Optional[int] = None,
    month_start: date,
    month_end: date,
) -> Optional[Transaction]:
    """Find a ledger transaction that pays this bill occurrence."""
    if rule:
        exact = (
            Transaction.objects.filter(rule=rule, date=due_date, account_id=account_id)
            .select_related("category", "account")
            .first()
        )
        if exact:
            return exact
        month_rule = (
            ledger_visible_transactions(
                Transaction.objects.filter(
                    rule=rule,
                    account_id=account_id,
                    date__gte=month_start,
                    date__lte=month_end,
                )
            )
            .select_related("category", "account")
            .order_by("date")
        )
        for txn in month_rule:
            if abs(txn.amount - expected_amount) <= AMOUNT_TOLERANCE and _transaction_is_paid(txn):
                return txn

    low = due_date - timedelta(days=BILL_MATCH_DATE_WINDOW_DAYS)
    high = due_date + timedelta(days=BILL_MATCH_DATE_WINDOW_DAYS)
    candidates = ledger_visible_transactions(
        Transaction.objects.filter(
            account__household_id=household_id,
            account_id=account_id,
            date__gte=max(low, month_start),
            date__lte=min(high, month_end),
            amount__lt=0,
        )
    ).select_related("category", "account")

    best: Optional[Transaction] = None
    best_score = -1
    for txn in candidates:
        if abs(abs(txn.amount) - abs(expected_amount)) > AMOUNT_TOLERANCE:
            continue
        score = 40
        if category_id and txn.category_id == category_id:
            score += 30
        elif rule and txn.rule_id == rule.id:
            score += 25
        dd = abs((txn.date - due_date).days)
        if dd == 0:
            score += 20
        elif dd <= BILL_MATCH_DATE_WINDOW_DAYS:
            score += 10
        else:
            continue
        if score > best_score:
            best_score = score
            best = txn
    return best


def _sync_occurrence_from_transaction(
    occurrence: BillOccurrence,
    txn: Optional[Transaction],
    *,
    today: date,
) -> BillOccurrence:
    if occurrence.skipped:
        occurrence.status = BillOccurrence.Status.PROJECTED
        return occurrence
    if txn is None:
        if occurrence.due_date < today:
            occurrence.status = BillOccurrence.Status.MISSED
        else:
            occurrence.status = BillOccurrence.Status.PROJECTED
        occurrence.transaction = None
        return occurrence
    occurrence.transaction = txn
    occurrence.status = _status_from_transaction(
        txn, due_date=occurrence.due_date, today=today, skipped=occurrence.skipped
    )
    if occurrence.status == BillOccurrence.Status.PAID and not occurrence.paid_at:
        occurrence.paid_at = timezone.now()
    if occurrence.status == BillOccurrence.Status.RECONCILED and not occurrence.reconciled_at:
        occurrence.reconciled_at = timezone.now()
    return occurrence


def _rule_occurrence_candidates(
    households: Iterable[Household],
    month_start: date,
    month_end: date,
    month_key: str,
) -> list[dict[str, Any]]:
    rules = (
        RecurringRule.objects.filter(household__in=households, active=True)
        .select_related("account", "category", "transfer_to_account")
    )
    skipped = set(
        RecurringRuleSkip.objects.filter(
            rule__household__in=households,
            date__gte=month_start,
            date__lte=month_end,
        ).values_list("rule_id", "date")
    )
    out: list[dict[str, Any]] = []
    for rule in rules:
        if not rule_counts_as_bill(rule):
            continue
        for due_date in generate_rule_occurrences(rule, month_start, month_end):
            if (rule.id, due_date) in skipped:
                continue
            cat = rule.category
            account = rule.account
            amount = _signed_rule_amount(rule)
            if rule.transfer_to_account_id and rule.category:
                cat_name = (rule.category.name or "").strip()
                if cat_name in ("Credit Card Payment", "Bank Transfer"):
                    account = rule.account
            out.append(
                {
                    "household_id": rule.household_id,
                    "rule": rule,
                    "due_date": due_date,
                    "name": rule.name,
                    "account": account,
                    "category": cat,
                    "expected_amount": amount,
                    "month": month_key,
                    "source_type": "rule",
                }
            )
    return out


def _manual_bill_candidates(
    households: Iterable[Household],
    month_start: date,
    month_end: date,
    month_key: str,
    rule_ids_with_occurrences: set[int],
) -> list[dict[str, Any]]:
    """ONE_TIME / ACTUAL expense bills without a rule occurrence in this month."""
    qs = ledger_visible_transactions(
        Transaction.objects.filter(
            account__household__in=households,
            date__gte=month_start,
            date__lte=month_end,
            amount__lt=0,
        )
    ).filter(
        Q(source=Transaction.Source.ONE_TIME)
        | Q(source=Transaction.Source.ACTUAL, rule__isnull=True)
        | Q(is_bill=True)
    ).select_related("account", "category", "rule")

    out: list[dict[str, Any]] = []
    seen_rule_dates: set[tuple[int, date]] = set()
    for txn in qs:
        if txn.rule_id and (txn.rule_id, txn.date) in rule_ids_with_occurrences:
            continue
        if txn.rule_id:
            seen_rule_dates.add((txn.rule_id, txn.date))
        if not transaction_counts_as_bill(txn):
            continue
        if txn.rule_id and txn.rule and rule_counts_as_bill(txn.rule):
            if (txn.rule_id, txn.date) in rule_ids_with_occurrences:
                continue
        out.append(
            {
                "household_id": txn.account.household_id,
                "rule": txn.rule,
                "due_date": txn.date,
                "name": txn.payee or "Bill",
                "account": txn.account,
                "category": txn.category,
                "expected_amount": txn.amount,
                "month": month_key,
                "source_type": "imported" if txn.source == Transaction.Source.PLAID else "manual",
                "transaction": txn,
            }
        )
    return out


def get_monthly_bill_checklist(
    user,
    *,
    month: int,
    year: int,
    household_id: Optional[int] = None,
    account_id: Optional[int] = None,
    status_filter: Optional[str] = None,
    category_id: Optional[int] = None,
    as_of_date: Optional[date] = None,
) -> dict[str, Any]:
    today = as_of_date or date.today()
    month_start, month_end, month_key = _month_bounds(year, month)
    households = list(get_households_for_user(user))
    if household_id:
        households = [h for h in households if h.id == household_id]
    if not households:
        return _empty_checklist(month_key)

    rule_candidates = _rule_occurrence_candidates(households, month_start, month_end, month_key)
    rule_keys = {(c["rule"].id, c["due_date"]) for c in rule_candidates if c.get("rule")}
    manual_candidates = _manual_bill_candidates(
        households, month_start, month_end, month_key, rule_keys
    )
    all_candidates = rule_candidates + manual_candidates

    items: list[dict[str, Any]] = []
    for cand in all_candidates:
        if account_id and cand["account"].id != account_id:
            continue
        if category_id and (not cand.get("category") or cand["category"].id != category_id):
            continue

        rule = cand.get("rule")
        lookup = {
            "household_id": cand["household_id"],
            "due_date": cand["due_date"],
        }
        if rule:
            lookup["rule"] = rule
        else:
            lookup["rule"] = None
            lookup["name"] = cand["name"]
            lookup["account"] = cand["account"]
        occ, _created = BillOccurrence.objects.get_or_create(
            **lookup,
            defaults={
                "month": month_key,
                "name": cand["name"],
                "account": cand["account"],
                "category": cand.get("category"),
                "expected_amount": abs(_decimal(cand["expected_amount"])),
                "status": BillOccurrence.Status.PROJECTED,
            },
        )
        if not _created:
            occ.month = month_key
            occ.name = cand["name"]
            occ.account = cand["account"]
            occ.category = cand.get("category")
            occ.expected_amount = abs(_decimal(cand["expected_amount"]))

        txn = cand.get("transaction") or find_matching_transaction(
            household_id=cand["household_id"],
            account_id=cand["account"].id,
            expected_amount=cand["expected_amount"],
            due_date=cand["due_date"],
            rule=rule,
            category_id=cand["category"].id if cand.get("category") else None,
            month_start=month_start,
            month_end=month_end,
        )
        _sync_occurrence_from_transaction(occ, txn, today=today)
        occ.save()

        if occ.skipped:
            display_status = "skipped"
        else:
            display_status = occ.status

        item = _serialize_checklist_item(occ, cand, txn, today=today)
        if status_filter:
            sf = status_filter
            if sf == "missed":
                sf = DISPLAY_LATE
            if item["status"] != sf:
                continue
        items.append(item)

    items.sort(key=lambda x: (x["due_date"], x["name"]))

    total_projected = Decimal("0")
    total_paid = Decimal("0")
    late_count = 0
    due_soon_count = 0
    forgotten_count = 0
    for it in items:
        amt = _decimal(it["amount"])
        st = it["status"]
        if st in ("paid", "reconciled"):
            total_paid += amt
        elif st in ("projected", DISPLAY_DUE_SOON, DISPLAY_LIKELY_FORGOTTEN):
            total_projected += amt
        if st == DISPLAY_LATE:
            late_count += 1
        if st == DISPLAY_DUE_SOON:
            due_soon_count += 1
        if st == DISPLAY_LIKELY_FORGOTTEN:
            forgotten_count += 1

    total_bills = sum(_decimal(it["amount"]) for it in items if it["status"] != DISPLAY_SKIPPED)
    total_remaining = total_bills - total_paid
    warnings = build_checklist_warnings(items, today=today)

    return {
        "month": month_key,
        "total_projected": str(total_projected),
        "total_paid": str(total_paid),
        "total_remaining": str(max(Decimal("0"), total_remaining)),
        "missed_count": late_count,
        "late_count": late_count,
        "due_soon_count": due_soon_count,
        "forgotten_count": forgotten_count,
        "overdue_count": late_count,
        "total_count": len([i for i in items if i["status"] != DISPLAY_SKIPPED]),
        "paid_count": len([i for i in items if i["status"] in ("paid", "reconciled")]),
        "remaining_count": len(
            [
                i
                for i in items
                if i["status"]
                not in ("paid", "reconciled", DISPLAY_SKIPPED)
            ]
        ),
        "warnings": warnings,
        "items": items,
    }


def _empty_checklist(month_key: str) -> dict[str, Any]:
    return {
        "month": month_key,
        "total_projected": "0.00",
        "total_paid": "0.00",
        "total_remaining": "0.00",
        "missed_count": 0,
        "late_count": 0,
        "due_soon_count": 0,
        "forgotten_count": 0,
        "overdue_count": 0,
        "total_count": 0,
        "paid_count": 0,
        "remaining_count": 0,
        "warnings": [],
        "items": [],
    }


def _serialize_checklist_item(
    occ: BillOccurrence,
    cand: dict[str, Any],
    txn: Optional[Transaction],
    *,
    today: date,
) -> dict[str, Any]:
    has_payment = txn is not None
    base_status = occ.status
    likely_forgotten = detect_likely_forgotten(
        rule_id=occ.rule_id,
        due_date=occ.due_date,
        today=today,
        has_payment=has_payment,
        base_status=base_status,
    )
    status = compute_display_status(
        occ,
        today=today,
        has_payment=has_payment,
        likely_forgotten=likely_forgotten,
        due_soon_days=DUE_SOON_DAYS,
    )
    days_until = (occ.due_date - today).days
    is_overdue = status == DISPLAY_LATE
    source_type = cand.get("source_type", "rule" if occ.rule_id else "manual")

    score = 0
    if txn:
        score = _match_score_for_txn(
            txn,
            expected_amount=-abs(_decimal(occ.expected_amount)),
            due_date=occ.due_date,
            category_id=occ.category_id,
            rule_id=occ.rule_id,
        )
    conf_label, conf_score = payment_confidence(
        txn=txn,
        match_score=score,
        manual_mark=bool(occ.paid_at and not txn),
    )

    rule = cand.get("rule") or (occ.rule if occ.rule_id else None)
    avg_amt = average_paid_amount(occ.rule_id) if occ.rule_id else None
    autopay = detect_autopay(
        rule,
        household_id=occ.household_id,
        rule_id=occ.rule_id,
        occurrence=occ,
    )

    item = {
        "id": occ.id,
        "name": occ.name,
        "account": {
            "id": occ.account_id,
            "name": occ.account.effective_display_name,
        },
        "due_date": occ.due_date.isoformat(),
        "amount": str(occ.expected_amount),
        "average_amount": str(avg_amt) if avg_amt else None,
        "category": (
            {"id": occ.category_id, "name": occ.category.name}
            if occ.category_id and occ.category
            else None
        ),
        "source_type": source_type,
        "transaction_id": txn.id if txn else None,
        "rule_id": occ.rule_id,
        "status": status,
        "base_status": base_status if not occ.skipped else "skipped",
        "paid_date": txn.date.isoformat() if txn and status in ("paid", "reconciled") else None,
        "matched_transaction_id": txn.id if txn else None,
        "is_overdue": is_overdue,
        "days_until_due": days_until,
        "skipped": occ.skipped,
        "notes": occ.notes or "",
        "payment_confidence": conf_label,
        "payment_confidence_score": conf_score,
        "likely_forgotten": likely_forgotten,
        **autopay,
    }
    if occ.warning_snoozed_until and occ.warning_snoozed_until >= today:
        item["warnings"] = []
    else:
        item["warnings"] = build_occurrence_warnings(item, today=today, average_amount=avg_amt)
    return item


def build_dashboard_bill_summary(user, *, as_of_date: Optional[date] = None) -> dict[str, Any]:
    today = as_of_date or date.today()
    data = get_monthly_bill_checklist(
        user, month=today.month, year=today.year, as_of_date=today
    )
    total = data.get("total_count") or 0
    paid = data.get("paid_count") or 0
    late = data.get("late_count") or data.get("missed_count") or 0
    forgotten = data.get("forgotten_count") or 0
    due_soon = data.get("due_soon_count") or 0
    remaining = data.get("remaining_count") or max(0, total - paid)
    month_label = today.strftime("%B")
    label = f"{paid} of {total} bills paid this month" if total else f"{month_label}: no bills scheduled"
    missed_message = None
    if late == 1:
        missed_message = "1 bill overdue"
    elif late > 1:
        missed_message = f"{late} bills overdue"
    elif forgotten == 1:
        missed_message = "1 bill may be forgotten"
    elif forgotten > 1:
        missed_message = f"{forgotten} bills may be forgotten"
    elif due_soon > 0:
        missed_message = f"{due_soon} bill{'s' if due_soon != 1 else ''} due soon"
    return {
        "month": data["month"],
        "paid_count": paid,
        "total_count": total,
        "missed_count": late,
        "late_count": late,
        "forgotten_count": forgotten,
        "due_soon_count": due_soon,
        "remaining_count": remaining,
        "total_remaining": data.get("total_remaining", "0.00"),
        "label": label,
        "missed_message": missed_message,
        "checklist_url": f"/bills?month={data['month']}",
        "warnings": data.get("warnings", [])[:5],
    }


def get_bills_overview(
    user,
    *,
    center_month: Optional[int] = None,
    center_year: Optional[int] = None,
    months_before: int = 0,
    months_after: int = 1,
    as_of_date: Optional[date] = None,
) -> dict[str, Any]:
    """Multi-month bill command center: summaries + full checklist for center month."""
    today = as_of_date or date.today()
    cy = center_year or today.year
    cm = center_month or today.month
    month_sections: list[dict[str, Any]] = []
    for delta in range(-months_before, months_after + 1):
        m = cm + delta
        y = cy
        while m < 1:
            m += 12
            y -= 1
        while m > 12:
            m -= 12
            y += 1
        section = get_monthly_bill_checklist(user, month=m, year=y, as_of_date=today)
        section["is_projection_month"] = (y, m) > (today.year, today.month)
        month_sections.append(section)

    center = month_sections[months_before] if month_sections else _empty_checklist(f"{cy:04d}-{cm:02d}")
    return {
        "center_month": center["month"],
        "months": month_sections,
        "checklist": center,
        "warnings": center.get("warnings", []),
    }


def get_occurrence_detail(occurrence: BillOccurrence, *, today: Optional[date] = None) -> dict[str, Any]:
    today = today or date.today()
    month_y, month_m = map(int, occurrence.month.split("-"))
    month_start = date(month_y, month_m, 1)
    month_end = date(month_y, month_m, monthrange(month_y, month_m)[1])

    txn = occurrence.transaction
    if not txn and occurrence.rule_id:
        txn = find_matching_transaction(
            household_id=occurrence.household_id,
            account_id=occurrence.account_id,
            expected_amount=-abs(_decimal(occurrence.expected_amount)),
            due_date=occurrence.due_date,
            rule=occurrence.rule,
            category_id=occurrence.category_id,
            month_start=month_start,
            month_end=month_end,
        )

    cand = {
        "source_type": "rule" if occurrence.rule_id else "manual",
        "rule": occurrence.rule,
    }
    item = _serialize_checklist_item(occurrence, cand, txn, today=today)

    history: list[dict[str, Any]] = []
    if occurrence.rule_id:
        txns = ledger_visible_transactions(
            Transaction.objects.filter(rule_id=occurrence.rule_id, amount__lt=0)
        ).order_by("-date")[:24]
        for t in txns:
            history.append(
                {
                    "id": t.id,
                    "date": t.date.isoformat(),
                    "amount": str(abs(_decimal(t.amount))),
                    "payee": t.payee,
                    "status": t.status,
                    "source": t.source,
                    "reconciled": t.reconciled,
                }
            )
        amount_trend = bill_amount_history(occurrence.rule_id)
    else:
        amount_trend = []

    linked = []
    if txn:
        linked.append(
            {
                "id": txn.id,
                "date": txn.date.isoformat(),
                "amount": str(txn.amount),
                "payee": txn.payee,
            }
        )

    return {
        "occurrence": item,
        "payment_history": history,
        "amount_trend": amount_trend,
        "linked_transactions": linked,
        "rule": (
            {
                "id": occurrence.rule_id,
                "name": occurrence.rule.name,
                "frequency": occurrence.rule.frequency,
                "amount": str(occurrence.rule.amount),
            }
            if occurrence.rule_id and occurrence.rule
            else None
        ),
    }


@db_transaction.atomic
def mark_bill_paid(occurrence: BillOccurrence, *, user) -> BillOccurrence:
    today = date.today()
    if occurrence.transaction_id:
        txn = occurrence.transaction
        txn.cleared = True
        if txn.status == Transaction.Status.PLANNED:
            txn.status = Transaction.Status.CLEARED
        txn.save(update_fields=["cleared", "status", "updated_at"])
    elif occurrence.rule_id:
        rule = occurrence.rule
        amt = -abs(_decimal(occurrence.expected_amount))
        txn = _materialize_rule_occurrence(
            rule,
            occurrence.due_date,
            occurrence.account_id,
            amt,
            occurrence.name,
            occurrence.category_id,
        )
        txn.cleared = True
        txn.status = Transaction.Status.CLEARED
        txn.save(update_fields=["cleared", "status", "updated_at"])
        occurrence.transaction = txn
    else:
        txn = Transaction.objects.create(
            account_id=occurrence.account_id,
            date=occurrence.due_date,
            payee=occurrence.name,
            amount=-abs(_decimal(occurrence.expected_amount)),
            category_id=occurrence.category_id,
            status=Transaction.Status.CLEARED,
            source=Transaction.Source.ONE_TIME,
            cleared=True,
            is_bill=True,
        )
        occurrence.transaction = txn
    occurrence.paid_at = timezone.now()
    occurrence.status = BillOccurrence.Status.PAID
    occurrence.save()
    return occurrence


@db_transaction.atomic
def mark_bill_missed(occurrence: BillOccurrence) -> BillOccurrence:
    if not occurrence.skipped:
        occurrence.status = BillOccurrence.Status.MISSED
        occurrence.save(update_fields=["status", "updated_at"])
    return occurrence


@db_transaction.atomic
def link_bill_transaction(occurrence: BillOccurrence, transaction_id: int) -> BillOccurrence:
    txn = Transaction.objects.select_related("account").get(pk=transaction_id)
    if txn.account.household_id != occurrence.household_id:
        raise ValueError("Transaction must belong to the same household.")
    occurrence.transaction = txn
    _sync_occurrence_from_transaction(occurrence, txn, today=date.today())
    occurrence.save()
    return occurrence


@db_transaction.atomic
def skip_bill_occurrence(occurrence: BillOccurrence) -> BillOccurrence:
    occurrence.skipped = True
    occurrence.skipped_at = timezone.now()
    occurrence.status = BillOccurrence.Status.PROJECTED
    occurrence.save(update_fields=["skipped", "skipped_at", "status", "updated_at"])
    return occurrence
