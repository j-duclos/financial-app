"""Transactions-ledger section balances (Pending → Upcoming).

The Transactions UI shows Recent (posted) then Pending then Upcoming. Pending
rows can be dated *before* the last Recent row, so chronological timeline
``running_balance`` values are not the Bal column for those sections.

Instead, Bal continues from the posted Recent ending balance through Pending
then Upcoming in section order. That continuation is owned here — clients must
render ``balance_after`` and must not recompute it.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any


def _row_date(row: dict[str, Any]) -> date:
    raw = row.get("date")
    if isinstance(raw, date):
        return raw
    return date.fromisoformat(str(raw)[:10])


def _row_status(row: dict[str, Any]) -> str:
    return str(row.get("status") or "").upper()


def _is_projected_interest(row: dict[str, Any]) -> bool:
    return str(row.get("source") or "").lower() == "interest"


def _is_planned_scheduled(row: dict[str, Any]) -> bool:
    if _row_status(row) != "PLANNED":
        return False
    match_status = str(row.get("import_match_status") or "").lower()
    if match_status == "matched":
        return False
    if str(row.get("plaid_transaction_id") or "").strip():
        return False
    source = str(row.get("source") or "").lower()
    if source == "rule":
        return True
    txn_src = str(row.get("txn_source") or "").lower()
    if txn_src == "rule":
        return True
    return row.get("rule_id") is not None and source == "actual"


def is_pending_expected_timeline_row(row: dict[str, Any], today: date) -> bool:
    if _is_projected_interest(row):
        return False
    return _row_date(row) <= today and _is_planned_scheduled(row)


def is_forecast_timeline_row(row: dict[str, Any], today: date) -> bool:
    return _row_date(row) > today


def signed_timeline_ledger_amount(row: dict[str, Any]) -> Decimal:
    """Match web/mobile signedTimelineLedgerAmount for ledger continuation."""
    raw = Decimal(str(row.get("amount") or "0"))
    row_type = str(row.get("type") or "").upper()
    if row_type in ("OUTFLOW", "EXPENSE"):
        return -abs(raw)
    if row_type in ("INFLOW", "INCOME"):
        return abs(raw)
    return raw


def _sort_key(row: dict[str, Any]) -> tuple:
    d = _row_date(row)
    tid = row.get("transaction_id")
    tid_key = int(tid) if tid is not None else 0
    desc = str(row.get("description") or "")
    return (d, tid_key, desc)


def annotate_transactions_ledger_balance_after(
    rows: list[dict[str, Any]],
    *,
    account_id: int | None,
    as_of: date,
    posted_ending_balance: Decimal | None,
) -> list[dict[str, Any]]:
    """
    Set ``balance_after`` on account-scoped rows for the Transactions ledger.

    Walks Pending then Upcoming from ``posted_ending_balance``. When the anchor
    is missing, falls back to each row's chronological ``running_balance``.
    """
    if not rows:
        return rows

    scoped = [
        r
        for r in rows
        if account_id is None or int(r.get("account_id") or 0) == int(account_id)
    ]
    pending = sorted(
        (r for r in scoped if is_pending_expected_timeline_row(r, as_of)),
        key=_sort_key,
    )
    upcoming = sorted(
        (r for r in scoped if is_forecast_timeline_row(r, as_of)),
        key=_sort_key,
    )

    # Default: expose chronological running_balance as balance_after for all rows.
    for r in rows:
        rb = r.get("running_balance")
        if rb is not None and r.get("balance_after") is None:
            r["balance_after"] = str(rb)

    if posted_ending_balance is None:
        return rows

    running = Decimal(str(posted_ending_balance)).quantize(Decimal("0.01"))
    for r in pending + upcoming:
        running = (running + signed_timeline_ledger_amount(r)).quantize(Decimal("0.01"))
        r["balance_after"] = str(running)

    return rows
