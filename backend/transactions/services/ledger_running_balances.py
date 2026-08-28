"""Canonical per-transaction running balances for account ledger list responses."""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Collection

from accounts.models import Account


def running_balances_for_account_transactions(
    account: Account,
    transaction_ids: Collection[int],
    *,
    as_of: date | None = None,
) -> dict[int, str]:
    """
    Return signed running balance **after** each participating transaction (balance_after).

    Computed fresh from the canonical historical ledger walk — not cached per transaction.
    """
    from transactions.services.historical_ledger import (
        debug_log_historical_ledger,
        running_balances_after_historical_walk,
    )

    as_of = as_of or date.today()
    debug_log_historical_ledger(account, as_of=as_of)
    return running_balances_after_historical_walk(
        account, transaction_ids, as_of=as_of
    )


def posted_ledger_running_after_walk(
    account: Account,
    *,
    as_of: date | None = None,
) -> Decimal:
    """
    Canonical posted-before-pending balance — same ending state as the last Recent row.

    Matches ``ledger_today_balance_before_pending``.
    """
    from transactions.services.historical_ledger import posted_balance_before_pending_from_steps

    as_of = as_of or date.today()
    return posted_balance_before_pending_from_steps(account, as_of=as_of)
