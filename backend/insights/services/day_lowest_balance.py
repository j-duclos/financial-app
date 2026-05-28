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

from insights.services.day_heat import HEAT_DANGEROUS, HEAT_TIGHT, AccountDayBalance


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
    return _marker_payload(
        date_iso=date_iso,
        account_id=worst.account_id,
        account_name=worst.account_name,
        balance=worst.balance,
        minimum_buffer=worst.minimum_buffer,
        heat_level=heat_level,
        transaction_id=worst.transaction_id,
        after_description=worst.after_description,
        txn_index=worst.txn_index,
    )


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


def _marker_payload(
    *,
    date_iso: str,
    account_id: int | None,
    account_name: str,
    balance: Decimal,
    minimum_buffer: Decimal,
    heat_level: str | None,
    transaction_id: str | int | None = None,
    after_description: str | None = None,
    txn_index: int | None = None,
) -> dict[str, Any]:
    show = should_show_lowest_marker(
        heat_level=heat_level, balance=balance, minimum_buffer=minimum_buffer
    )
    to_zero = _amount_needed_to_zero(balance)
    to_buffer = _amount_needed_to_buffer(balance, minimum_buffer)
    below_buffer = to_buffer if to_buffer > 0 else Decimal("0")
    return {
        "lowest_projected_balance_date": date_iso,
        "lowest_projected_balance": str(balance.quantize(Decimal("0.01"))),
        "lowest_projected_balance_account_id": account_id,
        "lowest_projected_balance_account_name": account_name,
        "lowest_projected_balance_transaction_id": transaction_id,
        "lowest_projected_balance_after_description": after_description,
        "lowest_projected_balance_txn_index": txn_index,
        "amount_needed_to_zero": str(to_zero),
        "amount_needed_to_buffer": str(to_buffer),
        "below_buffer_amount": (
            str(below_buffer.quantize(Decimal("0.01"))) if below_buffer > 0 else None
        ),
        "show_lowest_balance_marker": show,
    }


def calculate_day_lowest_marker_from_snapshots(
    snapshots: list[AccountDayBalance],
    accounts_by_id: dict[int, Account],
    *,
    date_iso: str,
    heat_level: str | None = None,
    scope_account_id: int | None = None,
) -> dict[str, Any]:
    """Lowest marker from end-of-day account balances when the day has no txn lows."""
    if not snapshots:
        return _empty_marker(date_iso)

    scoped = snapshots
    if scope_account_id is not None:
        name = accounts_by_id.get(scope_account_id)
        if name is not None:
            label = name.effective_display_name
            scoped = [row for row in snapshots if row.account_name == label]
            if not scoped:
                scoped = snapshots

    worst = min(scoped, key=lambda row: row.balance)
    account_id: int | None = None
    for aid, acc in accounts_by_id.items():
        if scope_account_id is not None and aid != scope_account_id:
            continue
        if acc.effective_display_name == worst.account_name:
            account_id = aid
            break

    return _marker_payload(
        date_iso=date_iso,
        account_id=account_id,
        account_name=worst.account_name,
        balance=worst.balance,
        minimum_buffer=worst.minimum_buffer,
        heat_level=heat_level,
    )


_CARRIED_MARKER_KEYS = (
    "lowest_projected_balance",
    "lowest_projected_balance_account_id",
    "lowest_projected_balance_account_name",
    "lowest_projected_balance_transaction_id",
    "lowest_projected_balance_after_description",
    "amount_needed_to_zero",
    "amount_needed_to_buffer",
    "below_buffer_amount",
)


def _parse_decimal(val: Any) -> Decimal | None:
    if val is None:
        return None
    try:
        return _decimal(val)
    except Exception:
        return None


def _marker_has_detail(day: dict[str, Any]) -> bool:
    return bool(
        day.get("show_lowest_balance_marker")
        and day.get("lowest_projected_balance") is not None
    )


def _extract_carried_marker(day: dict[str, Any]) -> dict[str, Any]:
    return {key: day.get(key) for key in _CARRIED_MARKER_KEYS if day.get(key) is not None}


def _apply_carried_marker(day: dict[str, Any], carried: dict[str, Any]) -> None:
    for key, value in carried.items():
        day[key] = value
    day["show_lowest_balance_marker"] = True
    day["lowest_projected_balance_date"] = day.get("date")


def _day_account_still_negative(day: dict[str, Any], account_id: int | None) -> bool:
    if day.get("is_negative"):
        return True

    balance = _parse_decimal(day.get("lowest_projected_balance"))
    if balance is not None and balance < Decimal("0"):
        return True

    if account_id is not None:
        account_balance = _parse_decimal(
            (day.get("account_balances") or {}).get(str(account_id))
        )
        if account_balance is not None and account_balance < Decimal("0"):
            return True

    heat_level = day.get("heat_level")
    if heat_level in (HEAT_TIGHT, HEAT_DANGEROUS):
        carried_balance = _parse_decimal(day.get("lowest_projected_balance"))
        if carried_balance is not None and carried_balance < Decimal("0"):
            return True
        if day.get("is_negative"):
            return True

    return False


def carry_forward_lowest_markers(days: list[dict[str, Any]]) -> None:
    """
    Repeat the most recent lowest-balance marker on quiet days while that account
    stays projected negative (e.g. before payroll recovery).
    """
    carried: dict[str, Any] | None = None
    carried_account_id: int | None = None

    for day in days:
        if _marker_has_detail(day):
            carried = _extract_carried_marker(day)
            raw_id = day.get("lowest_projected_balance_account_id")
            try:
                carried_account_id = int(raw_id) if raw_id is not None else None
            except (TypeError, ValueError):
                carried_account_id = None
            continue

        if carried and _day_account_still_negative(day, carried_account_id):
            _apply_carried_marker(day, carried)
            continue

        if carried is not None and not _day_account_still_negative(day, carried_account_id):
            carried = None
            carried_account_id = None


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
