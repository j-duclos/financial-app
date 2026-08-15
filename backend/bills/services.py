"""
Monthly bill checklist: projected rule occurrences, manual bills, and payment status.
"""
from __future__ import annotations

import calendar
from calendar import monthrange
from collections import defaultdict
from dataclasses import dataclass, field
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
from timeline.services.ledger import _materialize_rule_occurrence
from timeline.services.rule_schedule import generate_rule_occurrence_dates, resolve_rule_params, signed_amount_from_params
from transactions.models import Transaction, TransactionMatch
from transactions.services.matching import AMOUNT_TOLERANCE, ledger_visible_transactions

from .bill_insights import (
    count_late_occurrences,
    DISPLAY_DUE_SOON,
    DISPLAY_LATE,
    DISPLAY_LIKELY_FORGOTTEN,
    DISPLAY_SKIPPED,
    average_paid_amount,
    bill_amount_history,
    bulk_average_paid_amounts,
    build_checklist_warnings,
    build_occurrence_warnings,
    compute_display_status,
    detect_autopay,
    detect_likely_forgotten,
    payment_confidence,
    _match_score_for_txn,
    _prior_month,
)
from .recurring_payment_status import (
    compute_recurring_payment_counts,
    recurring_missed_message,
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


def _signed_rule_amount(rule: RecurringRule, *, as_of_date: date | None = None) -> Decimal:
    if as_of_date is not None:
        return signed_amount_from_params(resolve_rule_params(rule, as_of_date))
    amt = _decimal(rule.amount)
    if rule.direction == RecurringRule.Direction.INCOME:
        return amt
    return -amt


def _transaction_is_paid(txn: Transaction, *, matched_ids: Optional[set[int]] = None) -> bool:
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
    if matched_ids is not None:
        return txn.pk in matched_ids
    if TransactionMatch.objects.filter(planned_transaction_id=txn.pk).exists():
        return True
    if TransactionMatch.objects.filter(imported_transaction_id=txn.pk).exists():
        return True
    return False


def _status_from_transaction(
    txn: Transaction,
    *,
    due_date: date,
    today: date,
    skipped: bool,
    matched_ids: Optional[set[int]] = None,
) -> str:
    if skipped:
        return BillOccurrence.Status.PROJECTED
    if txn.reconciled or txn.status == Transaction.Status.RECONCILED:
        return BillOccurrence.Status.RECONCILED
    if _transaction_is_paid(txn, matched_ids=matched_ids):
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


def find_matching_transaction_from_pool(
    *,
    account_id: int,
    expected_amount: Decimal,
    due_date: date,
    rule: Optional[RecurringRule] = None,
    category_id: Optional[int] = None,
    month_start: date,
    month_end: date,
    txns_by_account: dict[int, list[Transaction]],
    visible_ids: set[int],
    matched_ids: set[int],
) -> Optional[Transaction]:
    """In-memory equivalent of find_matching_transaction()."""
    account_txns = txns_by_account.get(account_id, [])
    if rule:
        exact_matches = [
            txn for txn in account_txns if txn.rule_id == rule.id and txn.date == due_date
        ]
        if exact_matches:
            exact_matches.sort(key=lambda t: t.id, reverse=True)
            return exact_matches[0]
        month_rule = [
            txn
            for txn in account_txns
            if txn.rule_id == rule.id
            and month_start <= txn.date <= month_end
            and txn.id in visible_ids
        ]
        month_rule.sort(key=lambda t: (t.date, t.id))
        for txn in month_rule:
            if abs(txn.amount - expected_amount) <= AMOUNT_TOLERANCE and _transaction_is_paid(
                txn, matched_ids=matched_ids
            ):
                return txn

    low = due_date - timedelta(days=BILL_MATCH_DATE_WINDOW_DAYS)
    high = due_date + timedelta(days=BILL_MATCH_DATE_WINDOW_DAYS)
    window_start = max(low, month_start)
    window_end = min(high, month_end)
    window = [
        txn
        for txn in account_txns
        if txn.id in visible_ids
        and txn.amount is not None
        and txn.amount < 0
        and window_start <= txn.date <= window_end
    ]
    window.sort(key=lambda t: (-t.date.toordinal(), -t.id))
    best: Optional[Transaction] = None
    best_score = -1
    for txn in window:
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


def _persisted_occurrence_transaction(occ: BillOccurrence) -> Optional[Transaction]:
    """Return a user-linked or previously matched transaction stored on the occurrence."""
    if not occ.transaction_id:
        return None
    try:
        return occ.transaction
    except Transaction.DoesNotExist:
        return None


def _sync_occurrence_from_transaction(
    occurrence: BillOccurrence,
    txn: Optional[Transaction],
    *,
    today: date,
    matched_ids: Optional[set[int]] = None,
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
        txn,
        due_date=occurrence.due_date,
        today=today,
        skipped=occurrence.skipped,
        matched_ids=matched_ids,
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
    *,
    rules: Optional[Iterable[RecurringRule]] = None,
    skipped: Optional[set[tuple[int, date]]] = None,
) -> list[dict[str, Any]]:
    if rules is None:
        rules = list(
            RecurringRule.objects.filter(household__in=households, active=True)
            .select_related("account", "category", "transfer_to_account")
            .prefetch_related("schedules")
        )
    if skipped is None:
        skipped = set(
            RecurringRuleSkip.objects.filter(
                rule__household__in=households,
                date__gte=month_start,
                date__lte=month_end,
            ).values_list("rule_id", "date")
        )
    out: list[dict[str, Any]] = []
    for rule in rules:
        if not getattr(rule, "active", True):
            continue
        if not rule_counts_as_bill(rule):
            continue
        for due_date in generate_rule_occurrence_dates(rule, month_start, month_end):
            if (rule.id, due_date) in skipped:
                continue
            cat = rule.category
            account = rule.account
            amount = _signed_rule_amount(rule, as_of_date=due_date)
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


@dataclass
class RecurringChecklistContext:
    """Bulk-loaded data for one monthly checklist request. Serialization should not query."""

    accounts_by_id: dict[int, Account] = field(default_factory=dict)
    rules_by_id: dict[int, RecurringRule] = field(default_factory=dict)
    txns_by_account: dict[int, list[Transaction]] = field(default_factory=dict)
    visible_ids: set[int] = field(default_factory=set)
    matched_ids: set[int] = field(default_factory=set)
    average_paid_by_rule_id: dict[int, Decimal] = field(default_factory=dict)
    outflows_by_rule_id: dict[int, list[Transaction]] = field(default_factory=dict)
    paid_year_months_by_rule_id: dict[int, set[tuple[int, int]]] = field(default_factory=dict)
    latest_current_month_occ_by_rule_id: dict[int, BillOccurrence] = field(default_factory=dict)


OCCURRENCE_UPDATE_FIELDS = [
    "month",
    "name",
    "account",
    "category",
    "expected_amount",
    "status",
    "transaction",
    "paid_at",
    "reconciled_at",
    "updated_at",
]


def _occurrence_field_tuple(occ: BillOccurrence) -> tuple:
    return (
        occ.month,
        occ.name,
        occ.account_id,
        occ.category_id,
        occ.expected_amount,
        occ.status,
        occ.transaction_id,
        occ.paid_at,
        occ.reconciled_at,
    )


def _load_month_occurrences(
    household_ids: list[int],
    start: date,
    end: date,
) -> list[BillOccurrence]:
    return list(
        BillOccurrence.objects.filter(
            household_id__in=household_ids,
            due_date__gte=start,
            due_date__lte=end,
        )
        .select_related(
            "rule",
            "account",
            "category",
            "transaction",
            "transaction__account",
            "transaction__category",
        )
        .order_by("id")
    )


def _occurrence_lookup_maps(
    occurrences: list[BillOccurrence],
) -> tuple[dict[tuple[int, date], BillOccurrence], dict[tuple, BillOccurrence]]:
    by_rule_date: dict[tuple[int, date], BillOccurrence] = {}
    by_manual: dict[tuple, BillOccurrence] = {}
    for occ in occurrences:
        if occ.rule_id:
            by_rule_date.setdefault((occ.rule_id, occ.due_date), occ)
        else:
            by_manual.setdefault(
                (occ.household_id, occ.due_date, occ.name, occ.account_id),
                occ,
            )
    return by_rule_date, by_manual


def _lookup_occurrence(
    cand: dict[str, Any],
    by_rule_date: dict[tuple[int, date], BillOccurrence],
    by_manual: dict[tuple, BillOccurrence],
) -> Optional[BillOccurrence]:
    rule = cand.get("rule")
    if rule:
        return by_rule_date.get((rule.id, cand["due_date"]))
    return by_manual.get(
        (cand["household_id"], cand["due_date"], cand["name"], cand["account"].id)
    )


def _new_occurrence_from_candidate(cand: dict[str, Any], month_key: str) -> BillOccurrence:
    return BillOccurrence(
        household_id=cand["household_id"],
        rule=cand.get("rule"),
        due_date=cand["due_date"],
        month=month_key,
        name=cand["name"],
        account=cand["account"],
        category=cand.get("category"),
        expected_amount=abs(_decimal(cand["expected_amount"])),
        status=BillOccurrence.Status.PROJECTED,
    )


def _history_window(today: date, as_of: date, month_end: date) -> tuple[date, date]:
    y_asof, m_asof = _prior_month(as_of.year, as_of.month, 6)
    y_real, m_real = _prior_month(today.year, today.month, 6)
    start = min(date(y_asof, m_asof, 1), date(y_real, m_real, 1))
    end = max(month_end, today)
    return start, end


def _load_checklist_transactions(
    account_ids: list[int],
    start: date,
    end: date,
) -> tuple[list[Transaction], set[int], set[int]]:
    if not account_ids:
        return [], set(), set()
    base = Transaction.objects.filter(
        account_id__in=account_ids,
        date__gte=start,
        date__lte=end,
    )
    txns = list(base.select_related("account", "category", "rule"))
    visible_ids = set(ledger_visible_transactions(base).values_list("pk", flat=True))
    txn_ids = [t.pk for t in txns]
    matched_ids: set[int] = set()
    if txn_ids:
        for planned_id, imported_id in TransactionMatch.objects.filter(
            Q(planned_transaction_id__in=txn_ids) | Q(imported_transaction_id__in=txn_ids)
        ).values_list("planned_transaction_id", "imported_transaction_id"):
            if planned_id:
                matched_ids.add(planned_id)
            if imported_id:
                matched_ids.add(imported_id)
    return txns, visible_ids, matched_ids


def _manual_bill_candidates_from_txns(
    txns: list[Transaction],
    visible_ids: set[int],
    month_start: date,
    month_end: date,
    month_key: str,
    rule_ids_with_occurrences: set[tuple[int, date]],
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for txn in txns:
        if txn.id not in visible_ids:
            continue
        if txn.amount is None or txn.amount >= 0:
            continue
        if not (month_start <= txn.date <= month_end):
            continue
        if not (
            txn.source == Transaction.Source.ONE_TIME
            or (txn.source == Transaction.Source.ACTUAL and txn.rule_id is None)
            or txn.is_bill
        ):
            continue
        if txn.rule_id and (txn.rule_id, txn.date) in rule_ids_with_occurrences:
            continue
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
    household_ids = [h.id for h in households]

    all_rules = list(
        RecurringRule.objects.filter(household_id__in=household_ids)
        .select_related("account", "category", "transfer_to_account")
        .prefetch_related("schedules")
    )
    skipped = set(
        RecurringRuleSkip.objects.filter(
            rule__household_id__in=household_ids,
            date__gte=month_start,
            date__lte=month_end,
        ).values_list("rule_id", "date")
    )
    rule_candidates = _rule_occurrence_candidates(
        households,
        month_start,
        month_end,
        month_key,
        rules=all_rules,
        skipped=skipped,
    )
    rule_keys = {(c["rule"].id, c["due_date"]) for c in rule_candidates if c.get("rule")}

    account_ids = list(
        Account.objects.filter(household_id__in=household_ids).values_list("id", flat=True)
    )
    history_start, history_end = _history_window(date.today(), today, month_end)
    txns, visible_ids, matched_ids = _load_checklist_transactions(
        account_ids, history_start, history_end
    )
    manual_candidates = _manual_bill_candidates_from_txns(
        txns, visible_ids, month_start, month_end, month_key, rule_keys
    )
    all_candidates = rule_candidates + manual_candidates
    if account_id:
        all_candidates = [c for c in all_candidates if c["account"].id == account_id]
    if category_id:
        all_candidates = [
            c for c in all_candidates if c.get("category") and c["category"].id == category_id
        ]

    today_real = date.today()
    today_month_start = date(today_real.year, today_real.month, 1)
    today_month_end = date(
        today_real.year, today_real.month, monthrange(today_real.year, today_real.month)[1]
    )
    occ_start = min(month_start, today_month_start)
    occ_end = max(month_end, today_month_end)
    existing = _load_month_occurrences(household_ids, occ_start, occ_end)
    by_rule_date, by_manual = _occurrence_lookup_maps(existing)

    missing = [
        cand for cand in all_candidates if _lookup_occurrence(cand, by_rule_date, by_manual) is None
    ]
    # GET-time materialization remains: checklist rows need occurrence IDs for
    # detail/skip/link, and there is no scheduled job that creates the next month.
    # Missing rows are bulk-created once per request instead of get_or_create() per item.
    if missing:
        BillOccurrence.objects.bulk_create(
            [_new_occurrence_from_candidate(cand, month_key) for cand in missing],
            ignore_conflicts=True,
        )
        existing = _load_month_occurrences(household_ids, occ_start, occ_end)
        by_rule_date, by_manual = _occurrence_lookup_maps(existing)

    txns_by_account: dict[int, list[Transaction]] = defaultdict(list)
    outflows_by_rule_id: dict[int, list[Transaction]] = defaultdict(list)
    paid_year_months_by_rule_id: dict[int, set[tuple[int, int]]] = defaultdict(set)
    for txn in txns:
        txns_by_account[txn.account_id].append(txn)
        if txn.rule_id and txn.amount is not None and txn.amount < 0 and txn.id in visible_ids:
            outflows_by_rule_id[txn.rule_id].append(txn)
            paid_year_months_by_rule_id[txn.rule_id].add((txn.date.year, txn.date.month))

    today_month_key = f"{today_real.year:04d}-{today_real.month:02d}"
    latest_current_month_occ_by_rule_id: dict[int, BillOccurrence] = {}
    for occ in existing:
        if not occ.rule_id or occ.month != today_month_key:
            continue
        prev = latest_current_month_occ_by_rule_id.get(occ.rule_id)
        if prev is None or occ.due_date > prev.due_date:
            latest_current_month_occ_by_rule_id[occ.rule_id] = occ

    ctx = RecurringChecklistContext(
        accounts_by_id={a.id: a for a in (c["account"] for c in all_candidates if c.get("account"))},
        rules_by_id={r.id: r for r in all_rules},
        txns_by_account=dict(txns_by_account),
        visible_ids=visible_ids,
        matched_ids=matched_ids,
        average_paid_by_rule_id=bulk_average_paid_amounts(
            dict(outflows_by_rule_id), today=today_real
        ),
        outflows_by_rule_id=dict(outflows_by_rule_id),
        paid_year_months_by_rule_id=dict(paid_year_months_by_rule_id),
        latest_current_month_occ_by_rule_id=latest_current_month_occ_by_rule_id,
    )

    items: list[dict[str, Any]] = []
    to_update_by_id: dict[int, BillOccurrence] = {}
    now = timezone.now()
    for cand in all_candidates:
        occ = _lookup_occurrence(cand, by_rule_date, by_manual)
        if occ is None:
            continue
        before = _occurrence_field_tuple(occ)
        occ.month = month_key
        occ.name = cand["name"]
        occ.account = cand["account"]
        occ.category = cand.get("category")
        occ.expected_amount = abs(_decimal(cand["expected_amount"]))

        rule = cand.get("rule")
        txn = cand.get("transaction") or _persisted_occurrence_transaction(occ)
        if txn is None:
            txn = find_matching_transaction_from_pool(
                account_id=cand["account"].id,
                expected_amount=cand["expected_amount"],
                due_date=cand["due_date"],
                rule=rule,
                category_id=cand["category"].id if cand.get("category") else None,
                month_start=month_start,
                month_end=month_end,
                txns_by_account=ctx.txns_by_account,
                visible_ids=ctx.visible_ids,
                matched_ids=ctx.matched_ids,
            )
        _sync_occurrence_from_transaction(occ, txn, today=today, matched_ids=ctx.matched_ids)
        if _occurrence_field_tuple(occ) != before:
            occ.updated_at = now
            to_update_by_id[occ.pk] = occ

        item = _serialize_checklist_item(occ, cand, txn, today=today, ctx=ctx)
        if status_filter:
            sf = status_filter
            if sf == "missed":
                sf = DISPLAY_LATE
            if item["status"] != sf:
                continue
        items.append(item)

    if to_update_by_id:
        BillOccurrence.objects.bulk_update(list(to_update_by_id.values()), OCCURRENCE_UPDATE_FIELDS)

    items.sort(key=lambda x: (x["due_date"], x["name"]))

    total_projected = Decimal("0")
    total_paid = Decimal("0")
    forgotten_count = 0
    for it in items:
        amt = _decimal(it["amount"])
        st = it["status"]
        if st in ("paid", "reconciled"):
            total_paid += amt
        elif st in ("projected", DISPLAY_DUE_SOON, DISPLAY_LIKELY_FORGOTTEN):
            total_projected += amt
        if st == DISPLAY_LIKELY_FORGOTTEN:
            forgotten_count += 1

    late_occurrence_count = count_late_occurrences(items)
    late_count, due_soon_count = compute_recurring_payment_counts(all_rules, items, today=today)

    total_bills = sum(_decimal(it["amount"]) for it in items if it["status"] != DISPLAY_SKIPPED)
    total_remaining = total_bills - total_paid
    warnings = build_checklist_warnings(
        items, today=today, missed_bill_count=late_count
    )

    return {
        "month": month_key,
        "total_projected": str(total_projected),
        "total_paid": str(total_paid),
        "total_remaining": str(max(Decimal("0"), total_remaining)),
        "missed_count": late_count,
        "late_count": late_count,
        "late_occurrence_count": late_occurrence_count,
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
    ctx: Optional[RecurringChecklistContext] = None,
) -> dict[str, Any]:
    has_payment = txn is not None
    base_status = occ.status
    paid_year_months = None
    if ctx is not None and occ.rule_id:
        paid_year_months = ctx.paid_year_months_by_rule_id.get(occ.rule_id, set())
    likely_forgotten = detect_likely_forgotten(
        rule_id=occ.rule_id,
        due_date=occ.due_date,
        today=today,
        has_payment=has_payment,
        base_status=base_status,
        paid_year_months=paid_year_months,
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

    rule = cand.get("rule")
    if rule is None and occ.rule_id:
        if ctx is not None:
            rule = ctx.rules_by_id.get(occ.rule_id)
        else:
            rule = occ.rule
    if ctx is not None and occ.rule_id:
        avg_amt = ctx.average_paid_by_rule_id.get(occ.rule_id)
        autopay = detect_autopay(
            rule,
            household_id=occ.household_id,
            rule_id=occ.rule_id,
            occurrence=occ,
            visible_outflows=ctx.outflows_by_rule_id.get(occ.rule_id, []),
            latest_current_month_occurrence=ctx.latest_current_month_occ_by_rule_id.get(occ.rule_id),
        )
    else:
        avg_amt = average_paid_amount(occ.rule_id) if occ.rule_id else None
        autopay = detect_autopay(
            rule,
            household_id=occ.household_id,
            rule_id=occ.rule_id,
            occurrence=occ,
        )

    account = occ.account
    category = occ.category
    item = {
        "id": occ.id,
        "name": occ.name,
        "account": {
            "id": occ.account_id,
            "name": account.effective_display_name if account else "",
        },
        "due_date": occ.due_date.isoformat(),
        "amount": str(occ.expected_amount),
        "average_amount": str(avg_amt) if avg_amt else None,
        "category": (
            {"id": occ.category_id, "name": category.name}
            if occ.category_id and category
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
    missed_message = recurring_missed_message(late, due_soon)
    if missed_message is None:
        if forgotten == 1:
            missed_message = "1 bill may be forgotten"
        elif forgotten > 1:
            missed_message = f"{forgotten} bills may be forgotten"
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
        "checklist_url": f"/recurring?month={data['month']}",
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


def _payment_history_row(txn: Transaction) -> dict[str, Any]:
    return {
        "id": txn.id,
        "date": txn.date.isoformat(),
        "amount": str(abs(_decimal(txn.amount))),
        "payee": txn.payee,
        "status": txn.status,
        "source": txn.source,
        "reconciled": txn.reconciled,
    }


def _ledger_payment_matches_rule(
    txn: Transaction,
    *,
    rule: RecurringRule,
    category_id: Optional[int],
    expected_amounts: list[Decimal],
) -> bool:
    txn_amt = abs(_decimal(txn.amount))
    if not any(abs(txn_amt - amt) <= AMOUNT_TOLERANCE for amt in expected_amounts):
        return False
    if category_id and txn.category_id == category_id:
        return True
    rule_name = (rule.name or "").lower()
    payee = (txn.payee or "").lower()
    if rule_name and (rule_name in payee or payee in rule_name):
        return True
    return False


def build_rule_payment_history(
    *,
    rule: RecurringRule,
    occurrence: BillOccurrence,
    today: date,
    limit: int = 24,
) -> list[dict[str, Any]]:
    """
    Past cleared/reconciled payments plus upcoming planned rows, ascending by date.

    Includes ledger charges matched to the rule even when rule_id was never set
    (e.g. Plaid imports linked via bill occurrences).
    """
    seen_ids: set[int] = set()
    dated_rows: list[tuple[date, dict[str, Any]]] = []
    expected_amounts = list(
        dict.fromkeys(
            abs(_decimal(v))
            for v in (occurrence.expected_amount, rule.amount)
            if v is not None
        )
    )

    def add_txn(txn: Transaction) -> None:
        if txn.id in seen_ids:
            return
        seen_ids.add(txn.id)
        dated_rows.append((txn.date, _payment_history_row(txn)))

    actual_past = ledger_visible_transactions(
        Transaction.objects.filter(
            rule_id=rule.id,
            account_id=occurrence.account_id,
            date__lte=today,
            amount__lt=0,
        ).exclude(status=Transaction.Status.PLANNED)
    ).order_by("date")
    for txn in actual_past:
        if _transaction_is_paid(txn) or txn.reconciled:
            add_txn(txn)

    past_occs = (
        BillOccurrence.objects.filter(rule_id=rule.id, due_date__lte=today)
        .select_related("transaction", "category")
        .order_by("-due_date")[:limit]
    )
    for occ in past_occs:
        txn = occ.transaction
        if not txn:
            oy, om = occ.due_date.year, occ.due_date.month
            occ_start = date(oy, om, 1)
            occ_end = date(oy, om, monthrange(oy, om)[1])
            txn = find_matching_transaction(
                household_id=occ.household_id,
                account_id=occ.account_id,
                expected_amount=-abs(_decimal(occ.expected_amount)),
                due_date=occ.due_date,
                rule=rule,
                category_id=occ.category_id,
                month_start=occ_start,
                month_end=occ_end,
            )
        if not txn:
            continue
        if _transaction_is_paid(txn) or occ.status in (
            BillOccurrence.Status.PAID,
            BillOccurrence.Status.RECONCILED,
        ):
            add_txn(txn)

    past_unlinked = ledger_visible_transactions(
        Transaction.objects.filter(
            account_id=occurrence.account_id,
            date__gte=today - timedelta(days=730),
            date__lte=today,
            amount__lt=0,
            rule_id__isnull=True,
        )
    ).order_by("-date")
    past_actual_count = sum(1 for d, _ in dated_rows if d <= today)
    for txn in past_unlinked:
        if past_actual_count >= limit:
            break
        if not _transaction_is_paid(txn):
            continue
        if _ledger_payment_matches_rule(
            txn,
            rule=rule,
            category_id=occurrence.category_id,
            expected_amounts=expected_amounts,
        ):
            add_txn(txn)
            past_actual_count += 1

    future_planned = ledger_visible_transactions(
        Transaction.objects.filter(
            rule_id=rule.id,
            account_id=occurrence.account_id,
            date__gt=today,
            amount__lt=0,
        ).filter(
            Q(status=Transaction.Status.PLANNED) | Q(cleared=False, reconciled=False)
        )
    ).order_by("date")
    for txn in future_planned:
        add_txn(txn)

    dated_rows.sort(key=lambda row: row[0])
    return [row for _, row in dated_rows[:limit]]


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
    if occurrence.rule_id and occurrence.rule:
        history = build_rule_payment_history(
            rule=occurrence.rule,
            occurrence=occurrence,
            today=today,
        )
        amount_trend = bill_amount_history(occurrence.rule_id)
    else:
        amount_trend = []
        if txn and txn.date <= today and (_transaction_is_paid(txn) or txn.reconciled):
            history = [_payment_history_row(txn)]

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
    if (
        occurrence.rule_id
        and txn.rule_id == occurrence.rule_id
        and txn.status == Transaction.Status.PLANNED
    ):
        raise ValueError(
            "That row is a forecast, not a bank charge. "
            "Choose the transaction from your account feed."
        )
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
