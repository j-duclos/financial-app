"""Canonical signed balances for accounts (ledger as of a date)."""
from __future__ import annotations

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


def credit_owed_balance(account: Account, as_of: date | None = None) -> Decimal:
    """Positive amount owed on a credit card from the ledger (zero if not in debt)."""
    return ledger_owed_balance(account, as_of)


def compute_net_worth(accounts: list[Account], as_of: date | None = None) -> Decimal:
    """Sum signed ledger balances for net worth (assets minus debts)."""
    return sum((signed_ledger_balance(acc, as_of) for acc in accounts), Decimal("0"))
