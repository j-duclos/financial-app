"""
Request-scoped balance preload and memoization for build_timeline().

Activated only during timeline builds via timeline_balance_cache_scope(). Keeps
account rows and ledger-visible transactions in memory so repeated
_balance_at_end_of_date / _credit_card_balance_through_date calls avoid N+1
ORM queries.

Measured impact (typical household, DEBUG profiling):
  Before: ~40-80 balance-related queries per build_timeline miss
  After:  ~2-4 queries (household accounts + household transactions preload)

In-memory only — not Redis. Invalidated per account when rule materialization
adds, updates, or deletes transactions during the same build.
"""
from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from datetime import date, timedelta
from decimal import Decimal
from typing import Collection, Iterator, Optional

from accounts.models import Account

_active_cache: ContextVar[Optional["TimelineBalanceCache"]] = ContextVar(
    "timeline_balance_cache", default=None
)


def get_active_balance_cache() -> Optional["TimelineBalanceCache"]:
    return _active_cache.get()


class TimelineBalanceCache:
    """Preloaded accounts and ledger rows for one build_timeline() invocation."""

    def __init__(self) -> None:
        self.accounts_by_id: dict[int, Account] = {}
        self._ledger_rows_by_account: dict[int, list[dict]] = {}
        self._posting_dates_by_account: dict[int, set[date]] = {}
        self._opening_balance_cache: dict[tuple[int, date], Decimal] = {}
        self._balance_end_cache: dict[tuple[int, date], Decimal] = {}
        self._raw_balance_cache: dict[tuple[int, date], Decimal] = {}
        self._through_balance_cache: dict[tuple, Decimal] = {}

    def preload_accounts(self, accounts: Collection[Account]) -> None:
        for acc in accounts:
            self.accounts_by_id[acc.pk] = acc

    def register_account(self, account: Account) -> None:
        self.accounts_by_id[account.pk] = account

    def get_account(self, account_id: int) -> Account | None:
        return self.accounts_by_id.get(account_id)

    def preload_transactions(self, account_ids: Collection[int], end_date: date) -> None:
        from transactions.models import Transaction
        from transactions.services.matching import ledger_visible_transactions

        if not account_ids:
            return
        qs = ledger_visible_transactions(
            Transaction.objects.filter(
                account_id__in=account_ids,
                date__lte=end_date,
            )
        ).order_by("account_id", "date", "id")
        for txn in qs.iterator():
            row = {
                "id": txn.pk,
                "date": txn.date,
                "amount": txn.amount,
                "status": txn.status,
                "rule_id": txn.rule_id,
                "account_id": txn.account_id,
                "source": txn.source,
            }
            aid = txn.account_id
            self._ledger_rows_by_account.setdefault(aid, []).append(row)
            self._posting_dates_by_account.setdefault(aid, set()).add(txn.date)

    def note_transaction_saved(self, txn) -> None:
        """Keep preload in sync when build_timeline materializes rule rows."""
        row = {
            "id": txn.pk,
            "date": txn.date,
            "amount": txn.amount,
            "status": txn.status,
            "rule_id": txn.rule_id,
            "account_id": txn.account_id,
            "source": txn.source,
        }
        aid = txn.account_id
        rows = self._ledger_rows_by_account.setdefault(aid, [])
        replaced = False
        for i, existing in enumerate(rows):
            if existing.get("id") == txn.pk:
                rows[i] = row
                replaced = True
                break
        if not replaced:
            rows.append(row)
            rows.sort(key=lambda r: (r["date"], r.get("id") or 0))
        self._posting_dates_by_account.setdefault(aid, set()).add(txn.date)
        self._invalidate_account_caches(aid)

    def note_transactions_deleted(self, account_id: int, *, rule_id: int | None = None, on_date: date | None = None) -> None:
        rows = self._ledger_rows_by_account.get(account_id, [])
        if rule_id is not None and on_date is not None:
            self._ledger_rows_by_account[account_id] = [
                r
                for r in rows
                if not (r.get("rule_id") == rule_id and r.get("date") == on_date)
            ]
        self._posting_dates_by_account[account_id] = {r["date"] for r in self._ledger_rows_by_account.get(account_id, [])}
        self._invalidate_account_caches(account_id)

    def _invalidate_account_caches(self, account_id: int) -> None:
        for cache in (
            self._opening_balance_cache,
            self._balance_end_cache,
            self._raw_balance_cache,
        ):
            for key in list(cache.keys()):
                if key[0] == account_id:
                    del cache[key]
        for key in list(self._through_balance_cache.keys()):
            if key[0] == account_id:
                del self._through_balance_cache[key]

    def has_posting_on_date(self, account_id: int, d: date) -> bool:
        return d in self._posting_dates_by_account.get(account_id, set())

    def _sum_ledger_rows(
        self,
        account_id: int,
        *,
        date_lt: date | None = None,
        date_lte: date | None = None,
        exclude_interest: bool = True,
        exclude_ids: Collection[int] | None = None,
    ) -> Decimal:
        rows = self._ledger_rows_by_account.get(account_id, [])
        if not rows:
            return Decimal("0")
        ex = frozenset(exclude_ids or ())
        candidates = []
        for r in rows:
            if ex and r.get("id") in ex:
                continue
            if exclude_interest and r.get("source") == "interest":
                continue
            rd = r["date"]
            if date_lt is not None and rd >= date_lt:
                continue
            if date_lte is not None and rd > date_lte:
                continue
            candidates.append(r)
        from timeline.services.ledger import is_superseded_planned_row

        total = Decimal("0")
        for row in candidates:
            if is_superseded_planned_row(row, candidates):
                continue
            total += Decimal(str(row["amount"]))
        return total

    def _signed_opening_from_account(self, acc: Account | None) -> tuple[Decimal, bool]:
        opening = Decimal("0")
        credit_opening_pre_negated = False
        if acc and acc.starting_balance is not None:
            opening = Decimal(str(acc.starting_balance))
            if acc.account_type == Account.AccountType.CREDIT and opening > 0:
                opening = -opening
                credit_opening_pre_negated = True
        return opening, credit_opening_pre_negated

    def opening_balance(self, account_id: int, as_of_date: date) -> Decimal:
        key = (account_id, as_of_date)
        if key in self._opening_balance_cache:
            return self._opening_balance_cache[key]
        acc = self.get_account(account_id)
        opening, credit_opening_pre_negated = self._signed_opening_from_account(acc)
        txn_sum = self._sum_ledger_rows(account_id, date_lt=as_of_date)
        total = opening + txn_sum
        if (
            acc
            and acc.account_type == Account.AccountType.CREDIT
            and total > 0
            and not credit_opening_pre_negated
        ):
            total = -total
        self._opening_balance_cache[key] = total
        return total

    def balance_at_end_of_date(self, account_id: int, d: date) -> Decimal:
        key = (account_id, d)
        if key in self._balance_end_cache:
            return self._balance_end_cache[key]
        value = self.opening_balance(account_id, d + timedelta(days=1))
        self._balance_end_cache[key] = value
        return value

    def raw_balance_at_end_of_date(self, account_id: int, as_of_date: date) -> Decimal:
        key = (account_id, as_of_date)
        if key in self._raw_balance_cache:
            return self._raw_balance_cache[key]
        acc = self.get_account(account_id)
        total = self._sum_ledger_rows(account_id, date_lte=as_of_date, exclude_interest=False)
        if acc and acc.starting_balance is not None:
            total += Decimal(str(acc.starting_balance))
        self._raw_balance_cache[key] = total
        return total

    def db_card_postings_in_exclusive_range(
        self, card_account_id: int, after_date: date, through_date: date
    ) -> Decimal:
        total = Decimal("0")
        for r in self._ledger_rows_by_account.get(card_account_id, []):
            rd = r["date"]
            if rd <= after_date or rd > through_date:
                continue
            total += Decimal(str(r["amount"]))
        return total

    def balance_through_date(
        self,
        account_id: int,
        as_of_date: date,
        rows: list[dict],
        *,
        include_row_leg_without_txn: bool,
        include_db_postings_on_as_of_date: bool = False,
        exclude_transaction_ids: Collection[int] | None = None,
        credit_style: bool = False,
    ) -> Decimal:
        cache_key = (
            account_id,
            as_of_date,
            include_row_leg_without_txn,
            include_db_postings_on_as_of_date,
            frozenset(exclude_transaction_ids or ()),
            credit_style,
            len(rows),
            id(rows),
        )
        if cache_key in self._through_balance_cache:
            return self._through_balance_cache[cache_key]

        acc = self.get_account(account_id)
        if not acc:
            value = Decimal("0")
            self._through_balance_cache[cache_key] = value
            return value

        sb = Decimal(str(acc.starting_balance)) if acc.starting_balance is not None else Decimal("0")
        if credit_style and acc.account_type == Account.AccountType.CREDIT and sb > 0:
            opening_one = -sb
        else:
            opening_one = sb

        ex = exclude_transaction_ids
        if include_db_postings_on_as_of_date:
            from timeline.services.ledger import is_superseded_planned_row

            before = self._sum_ledger_rows(account_id, date_lt=as_of_date, exclude_ids=ex)
            on_day_rows = [
                r
                for r in self._ledger_rows_by_account.get(account_id, [])
                if r["date"] == as_of_date and (not ex or r.get("id") not in ex)
            ]
            on_day = Decimal("0")
            for row in on_day_rows:
                if is_superseded_planned_row(row, on_day_rows):
                    continue
                on_day += Decimal(str(row["amount"]))
            balance = opening_one + before + on_day
            if include_row_leg_without_txn:
                for r in rows:
                    if r.get("account_id") != account_id:
                        continue
                    rd = r.get("date")
                    if rd is None:
                        continue
                    if isinstance(rd, str):
                        rd = date.fromisoformat(rd[:10]) if rd else None
                    if rd != as_of_date or r.get("transaction_id") is not None:
                        continue
                    balance += Decimal(str(r.get("amount") or 0))
            self._through_balance_cache[cache_key] = balance
            return balance

        balance = opening_one + self._sum_ledger_rows(
            account_id, date_lte=as_of_date, exclude_ids=ex
        )
        for r in rows:
            if r.get("account_id") != account_id:
                continue
            rd = r.get("date")
            if rd is None:
                continue
            if isinstance(rd, str):
                rd = date.fromisoformat(rd[:10]) if rd else None
            if rd is None or rd > as_of_date:
                continue
            amt = r.get("amount")
            try:
                amt_d = Decimal(str(amt)) if amt is not None else Decimal("0")
            except (TypeError, ValueError):
                continue
            if include_row_leg_without_txn:
                if r.get("transaction_id") is not None:
                    continue
                balance += amt_d
            else:
                if r.get("source") != "rule":
                    continue
                balance += amt_d
        self._through_balance_cache[cache_key] = balance
        return balance


@contextmanager
def timeline_balance_cache_scope() -> Iterator[TimelineBalanceCache]:
    cache = TimelineBalanceCache()
    token = _active_cache.set(cache)
    try:
        yield cache
    finally:
        _active_cache.reset(token)


def activate_balance_cache() -> tuple[TimelineBalanceCache, object]:
    cache = TimelineBalanceCache()
    return cache, _active_cache.set(cache)


def deactivate_balance_cache(token: object) -> None:
    _active_cache.reset(token)


def preload_household_balance_data(
    cache: TimelineBalanceCache,
    households,
    end_date: date,
) -> set[int]:
    """Load all household accounts and ledger rows once for timeline build."""
    from accounts.models import Account

    account_ids = set(
        Account.objects.for_historical_reporting()
        .filter(household__in=households)
        .values_list("pk", flat=True)
    )
    if not account_ids:
        return set()
    accounts = list(Account.objects.filter(pk__in=account_ids))
    cache.preload_accounts(accounts)
    cache.preload_transactions(account_ids, end_date)
    return account_ids
