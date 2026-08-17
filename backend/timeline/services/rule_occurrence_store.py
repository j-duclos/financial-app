"""
Bulk preload + in-memory lookup for rule occurrence materialization.

Eliminates per-occurrence Transaction.objects.filter(...).first() queries during
build_timeline() materialization.
"""
from __future__ import annotations

from contextvars import ContextVar
from datetime import date, timedelta
from decimal import Decimal
from typing import Callable, Optional

from transactions.models import Transaction

_rule_occurrence_store: ContextVar["RuleOccurrenceStore | None"] = ContextVar(
    "rule_occurrence_store",
    default=None,
)


def make_rule_occurrence_key(
    rule_id: int,
    account_id: int,
    occurrence_date: date,
) -> tuple[int, int, date]:
    """Stable key for rule + account + date (matches materialization uniqueness)."""
    return (int(rule_id), int(account_id), occurrence_date)


def make_rule_date_key(rule_id: int, occurrence_date: date) -> tuple[int, date]:
    return (int(rule_id), occurrence_date)


class RuleOccurrenceStore:
    """In-memory index of existing and newly materialized rule occurrence transactions."""

    def __init__(self) -> None:
        self._by_key: dict[tuple[int, int, date], Transaction] = {}
        self._by_rule_date: dict[tuple[int, date], list[Transaction]] = {}
        self._matched_by_rule_account: dict[tuple[int, int], list[Transaction]] = {}
        self.active_bucket_rule_ids: set[int] = set()
        self.existing_loaded: int = 0
        self.matched_loaded: bool = False

    def __len__(self) -> int:
        return len(self._by_key)

    def get(self, rule_id: int, account_id: int, occurrence_date: date) -> Optional[Transaction]:
        return self._by_key.get(make_rule_occurrence_key(rule_id, account_id, occurrence_date))

    def get_other_account_leg(
        self,
        rule_id: int,
        occurrence_date: date,
        exclude_account_id: int,
    ) -> Optional[Transaction]:
        for txn in self._by_rule_date.get(make_rule_date_key(rule_id, occurrence_date), []):
            if txn.account_id != exclude_account_id:
                return txn
        return None

    def get_leg_pks(
        self,
        rule_id: int,
        occurrence_date: date,
        account_id: int,
    ) -> tuple[int, ...]:
        return tuple(
            txn.pk
            for txn in self._by_rule_date.get(make_rule_date_key(rule_id, occurrence_date), [])
            if txn.account_id == account_id and txn.pk is not None
        )

    def put(self, txn: Transaction) -> None:
        if txn.rule_id is None:
            return
        key = make_rule_occurrence_key(txn.rule_id, txn.account_id, txn.date)
        if key not in self._by_key:
            self._by_key[key] = txn
        rd_key = make_rule_date_key(txn.rule_id, txn.date)
        legs = self._by_rule_date.setdefault(rd_key, [])
        if not any(t.pk == txn.pk for t in legs if txn.pk is not None):
            legs.append(txn)

    def index_transaction(self, txn: Transaction) -> None:
        """Register a preloaded transaction (first per key wins, all legs indexed by rule/date)."""
        if txn.rule_id is None:
            return
        key = make_rule_occurrence_key(txn.rule_id, txn.account_id, txn.date)
        self._by_key.setdefault(key, txn)
        rd_key = make_rule_date_key(txn.rule_id, txn.date)
        legs = self._by_rule_date.setdefault(rd_key, [])
        if not any(t.pk == txn.pk for t in legs):
            legs.append(txn)

    def index_matched(self, txn: Transaction) -> None:
        if txn.rule_id is None:
            return
        key = (int(txn.rule_id), int(txn.account_id))
        rows = self._matched_by_rule_account.setdefault(key, [])
        rows.append(txn)

    def find_matched_cover(
        self,
        *,
        rule_id: int,
        account_id: int,
        on_date: date,
        amount: Decimal | None,
        window_days: int,
        amounts_equal: Callable[[Decimal | None, Decimal | None], bool],
    ) -> Optional[Transaction]:
        """Same semantics as matching._matched_rule_occurrence_covers, from the bulk index."""
        low = on_date - timedelta(days=window_days)
        high = on_date + timedelta(days=window_days)
        rows = self._matched_by_rule_account.get((int(rule_id), int(account_id)), [])
        for txn in rows:
            if txn.date < low or txn.date > high:
                continue
            if amount is None or txn.amount is None or amounts_equal(txn.amount, amount):
                return txn
        return None


def build_rule_occurrence_store(
    *,
    rule_ids: list[int],
    account_ids: list[int],
    start_date: date,
    end_date: date,
    active_bucket_rule_ids: set[int] | None = None,
    match_window_days: int = 0,
) -> RuleOccurrenceStore:
    """Bulk-load existing RULE-sourced transactions for the materialization window."""
    store = RuleOccurrenceStore()
    if active_bucket_rule_ids is not None:
        store.active_bucket_rule_ids = set(active_bucket_rule_ids)
    if not rule_ids:
        return store

    qs = (
        Transaction.objects.filter(
            rule_id__in=rule_ids,
            account_id__in=account_ids,
            date__gte=start_date,
            date__lte=end_date,
            source=Transaction.Source.RULE,
        )
        .select_related("account", "category")
        .order_by("date", "id")
    )
    for txn in qs:
        store.index_transaction(txn)
    store.existing_loaded = len(store)

    if match_window_days > 0:
        matched_qs = (
            Transaction.objects.filter(
                rule_id__in=rule_ids,
                account_id__in=account_ids,
                date__gte=start_date - timedelta(days=match_window_days),
                date__lte=end_date + timedelta(days=match_window_days),
                import_match_status=Transaction.ImportMatchStatus.MATCHED,
                scenario__isnull=True,
            )
            .select_related("account", "category")
            .order_by("-date", "-id")
        )
        for txn in matched_qs:
            store.index_matched(txn)
        store.matched_loaded = True
    return store


def activate_rule_occurrence_store(store: RuleOccurrenceStore) -> None:
    _rule_occurrence_store.set(store)


def deactivate_rule_occurrence_store() -> None:
    _rule_occurrence_store.set(None)


def get_rule_occurrence_store() -> Optional[RuleOccurrenceStore]:
    return _rule_occurrence_store.get()
