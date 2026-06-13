"""
Bulk preload + in-memory lookup for rule occurrence materialization.

Eliminates per-occurrence Transaction.objects.filter(...).first() queries during
build_timeline() materialization.
"""
from __future__ import annotations

from contextvars import ContextVar
from datetime import date
from typing import Optional

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
        self.active_bucket_rule_ids: set[int] = set()
        self.existing_loaded: int = 0

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


def build_rule_occurrence_store(
    *,
    rule_ids: list[int],
    account_ids: list[int],
    start_date: date,
    end_date: date,
    active_bucket_rule_ids: set[int] | None = None,
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
    return store


def activate_rule_occurrence_store(store: RuleOccurrenceStore) -> None:
    _rule_occurrence_store.set(store)


def deactivate_rule_occurrence_store() -> None:
    _rule_occurrence_store.set(None)


def get_rule_occurrence_store() -> Optional[RuleOccurrenceStore]:
    return _rule_occurrence_store.get()
