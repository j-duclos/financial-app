"""Canonical signed balances for accounts (ledger as of a date)."""
from __future__ import annotations

from collections.abc import Collection
from datetime import date
from decimal import Decimal

from accounts.models import Account
from accounts.services.credit_card import ledger_owed_balance
from timeline.services.ledger import _balance_at_end_of_date


def signed_ledger_balance(account: Account, as_of: date | None = None) -> Decimal:
    """
    Signed balance through end of ``as_of`` (default today).

    Matches account list ``?balance=true`` and reconciliation ``app_current_balance``:
    ledger-visible transactions with ``date <= as_of``, plus starting balance.
    Credit debt is negative; assets are positive.
    """
    as_of = as_of or date.today()
    return _balance_at_end_of_date(account.pk, as_of)


def credit_owed_from_signed_balance(balance: Decimal) -> Decimal:
    """Positive amount owed from a signed ledger balance (zero if not in debt)."""
    if balance >= 0:
        return Decimal("0")
    return abs(balance)


def credit_owed_balance(account: Account, as_of: date | None = None) -> Decimal:
    """Positive amount owed on a credit card from the ledger (zero if not in debt)."""
    return ledger_owed_balance(account, as_of)


def bulk_signed_ledger_balances(
    accounts: Collection[Account],
    as_of_date: date | None = None,
) -> dict[int, Decimal]:
    """
    Signed ledger balances for many accounts with one transaction preload.

    Uses the same rules as ``signed_ledger_balance`` (opening balance, credit sign
    normalization, ledger-visible rows, superseded planned exclusion).
    """
    from timeline.services.balance_cache import TimelineBalanceCache

    as_of_date = as_of_date or date.today()
    account_list = list(accounts)
    if not account_list:
        return {}

    cache = TimelineBalanceCache()
    account_ids = [acc.pk for acc in account_list]
    cache.preload_accounts(account_list)
    cache.preload_transactions(account_ids, as_of_date)

    return {
        acc.pk: cache.balance_at_end_of_date(acc.pk, as_of_date)
        for acc in account_list
    }


def compute_net_worth(
    accounts: list[Account],
    as_of: date | None = None,
    *,
    balance_by_account: dict[int, Decimal] | None = None,
) -> Decimal:
    """Sum signed ledger balances for net worth (assets minus debts)."""
    if balance_by_account is not None:
        return sum(
            (balance_by_account.get(acc.pk, Decimal("0")) for acc in accounts),
            Decimal("0"),
        )
    return sum((signed_ledger_balance(acc, as_of) for acc in accounts), Decimal("0"))
