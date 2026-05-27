"""
Daily lowest projected balance markers for Timeline and Dashboard.

Visual-only — uses balance_after from timeline rows; does not change forecasts.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from accounts.models import Account
from accounts.services.available_to_spend import _decimal, account_supports_available_to_spend

from insights.services.day_heat import HEAT_DANGEROUS, HEAT_TIGHT


@dataclass(frozen=True)
class _AccountDayLow:
    account_id: int
    account_name: str
    balance: Decimal
    minimum_buffer: Decimal
    transaction_id: str | int | None
    after_description: str | None
    txn_index: int


def _cash_accounts_only(
    accounts_by_id: dict[int, Account],
    scope_account_id: int | None,
) -> set[int]:
    ids: set[int] = set()
    for aid, acc in accounts_by_id.items():
        if scope_account_id is not None and aid != scope_account_id:
            continue
        if acc.is_credit_card():
            continue
        if not account_supports_available_to_spend(acc):
            continue
        ids.add(aid)
    return ids


def scan_transaction_lows(
    transactions: list[dict[str, Any]],
    accounts_by_id: dict[int, Account],
    *,
    scope_account_id: int | None = None,
) -> list[_AccountDayLow]:
    """Per-account lowest balance_after reached during the day (cash accounts only)."""
    allowed = _cash_accounts_only(accounts_by_id, scope_account_id)
    by_account: dict[int, _AccountDayLow] = {}

    for idx, txn in enumerate(transactions):
        aid = txn.get("account_id")
        if aid is None:
            continue
        try:
            aid_int = int(aid)
        except (TypeError, ValueError):
            continue
        if aid_int not in allowed:
            continue
        bal_raw = txn.get("balance_after")
        if bal_raw is None:
            continue
        account = accounts_by_id.get(aid_int)
        if not account:
            continue
        bal = _decimal(bal_raw)
        name = (txn.get("account_name") or account.effective_display_name).strip()
        buffer = _decimal(account.minimum_buffer or 0)
        current = by_account.get(aid_int)
        if current is None or bal < current.balance:
            by_account[aid_int] = _AccountDayLow(
                account_id=aid_int,
                account_name=name,
                balance=bal,
                minimum_buffer=buffer,
                transaction_id=txn.get("id"),
                after_description=(txn.get("description") or "").strip() or None,
                txn_index=idx,
            )
    return list(by_account.values())


def _amount_needed_to_zero(balance: Decimal) -> Decimal:
    if balance < Decimal("0"):
        return (-balance).quantize(Decimal("0.01"))
    return Decimal("0")


def _amount_needed_to_buffer(balance: Decimal, minimum_buffer: Decimal) -> Decimal:
    if minimum_buffer > 0 and balance < minimum_buffer:
        return (minimum_buffer - balance).quantize(Decimal("0.01"))
    return Decimal("0")


def should_show_lowest_marker(
    *,
    heat_level: str | None,
    balance: Decimal | None,
    minimum_buffer: Decimal,
) -> bool:
    if heat_level in (HEAT_TIGHT, HEAT_DANGEROUS):
        return True
    if balance is None:
        return False
    if balance < Decimal("0"):
        return True
    if minimum_buffer > 0 and balance < minimum_buffer:
        return True
    return False


def calculate_day_lowest_marker(
    transactions: list[dict[str, Any]],
    accounts_by_id: dict[int, Account],
    *,
    date_iso: str,
    heat_level: str | None = None,
    scope_account_id: int | None = None,
) -> dict[str, Any]:
    """
  Worst cash-account low for the day plus amounts to restore zero/buffer.
    """
    lows = scan_transaction_lows(
        transactions, accounts_by_id, scope_account_id=scope_account_id
    )
    if not lows:
        return _empty_marker(date_iso)

    worst = min(lows, key=lambda row: row.balance)
    balance = worst.balance
    buffer = worst.minimum_buffer
    show = should_show_lowest_marker(
        heat_level=heat_level, balance=balance, minimum_buffer=buffer
    )
    to_zero = _amount_needed_to_zero(balance)
    to_buffer = _amount_needed_to_buffer(balance, buffer)
    below_buffer = to_buffer if to_buffer > 0 else Decimal("0")

    return {
        "lowest_projected_balance_date": date_iso,
        "lowest_projected_balance": str(balance.quantize(Decimal("0.01"))),
        "lowest_projected_balance_account_id": worst.account_id,
        "lowest_projected_balance_account_name": worst.account_name,
        "lowest_projected_balance_transaction_id": worst.transaction_id,
        "lowest_projected_balance_after_description": worst.after_description,
        "lowest_projected_balance_txn_index": worst.txn_index,
        "amount_needed_to_zero": str(to_zero),
        "amount_needed_to_buffer": str(to_buffer),
        "below_buffer_amount": (
            str(below_buffer.quantize(Decimal("0.01"))) if below_buffer > 0 else None
        ),
        "show_lowest_balance_marker": show,
    }


def _empty_marker(date_iso: str) -> dict[str, Any]:
    return {
        "lowest_projected_balance_date": date_iso,
        "lowest_projected_balance": None,
        "lowest_projected_balance_account_id": None,
        "lowest_projected_balance_account_name": None,
        "lowest_projected_balance_transaction_id": None,
        "lowest_projected_balance_after_description": None,
        "lowest_projected_balance_txn_index": None,
        "amount_needed_to_zero": "0.00",
        "amount_needed_to_buffer": "0.00",
        "below_buffer_amount": None,
        "show_lowest_balance_marker": False,
    }


def account_balance_rows_from_transactions(
    transactions: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Per-account lowest balance_after (for heat), compatible with day_heat helpers."""
    by_account: dict[str, Decimal] = {}
    for txn in transactions:
        bal_raw = txn.get("balance_after")
        if bal_raw is None:
            continue
        name = (txn.get("account_name") or "Account").strip()
        bal = _decimal(bal_raw)
        if name not in by_account or bal < by_account[name]:
            by_account[name] = bal
    return [
        {
            "account_name": name,
            "balance": str(bal.quantize(Decimal("0.01"))),
        }
        for name, bal in sorted(by_account.items(), key=lambda x: x[1])
    ]
