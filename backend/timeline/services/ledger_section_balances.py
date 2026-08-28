"""Transactions-ledger section balances (Pending → Upcoming).

The Transactions UI shows Recent (posted) then Pending then Upcoming. Pending
rows can be dated *before* the last Recent row, so chronological timeline
``running_balance`` values are not the Bal column for those sections.

Instead, Bal continues from the posted Recent ending balance through Pending
then Upcoming in section order. That continuation is owned here — clients must
render ``balance_after`` and must not recompute it.

Dashboard / Account Health forecast metrics must use this same walk — not
chronological ``running_balance`` — so lowest balance matches Transactions Bal.
"""
from __future__ import annotations

from datetime import date, timedelta
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


def _decimal(val) -> Decimal:
    if isinstance(val, Decimal):
        return val
    return Decimal(str(val))


def transactions_ledger_walk_rows(
    rows: list[dict[str, Any]],
    *,
    account_id: int,
    today: date,
    end_date: date | None = None,
) -> list[dict[str, Any]]:
    """
    Pending then Upcoming rows for one account — same sequence as Transactions Bal.

    Skips superseded planned rows and optional ``end_date`` cutoff on upcoming.
    """
    from timeline.services.ledger import is_superseded_planned_row

    account_rows = [r for r in rows if int(r.get("account_id") or 0) == int(account_id)]
    pending = sorted(
        (r for r in account_rows if is_pending_expected_timeline_row(r, today)),
        key=_sort_key,
    )
    upcoming = sorted(
        (r for r in account_rows if is_forecast_timeline_row(r, today)),
        key=_sort_key,
    )
    walk: list[dict[str, Any]] = []
    for row in pending + upcoming:
        if is_superseded_planned_row(row, account_rows):
            continue
        if end_date is not None and _row_date(row) > end_date:
            continue
        walk.append(row)
    return walk


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


def _update_balance_metrics(
    bal: Decimal,
    rd: date,
    *,
    today: date,
    end_date: date,
    minimum_buffer: Decimal,
    lowest: Decimal,
    lowest_date: date,
    first_negative_date: date | None,
    first_negative_balance: Decimal | None,
    first_below_buffer_date: date | None,
    first_below_buffer_balance: Decimal | None,
) -> tuple[
    Decimal,
    date,
    date | None,
    Decimal | None,
    date | None,
    Decimal | None,
]:
    if rd < today or rd > end_date:
        return (
            lowest,
            lowest_date,
            first_negative_date,
            first_negative_balance,
            first_below_buffer_date,
            first_below_buffer_balance,
        )
    if bal < lowest:
        lowest = bal
        lowest_date = rd
    if first_negative_date is None and bal < Decimal("0"):
        first_negative_date = rd
        first_negative_balance = bal
    if first_below_buffer_date is None and bal < minimum_buffer:
        first_below_buffer_date = rd
        first_below_buffer_balance = bal
    return (
        lowest,
        lowest_date,
        first_negative_date,
        first_negative_balance,
        first_below_buffer_date,
        first_below_buffer_balance,
    )


def forecast_balance_metrics_from_transactions_ledger(
    rows: list[dict[str, Any]],
    *,
    account_id: int,
    today: date,
    end_date: date,
    minimum_buffer: Decimal,
    ledger_anchor: Decimal,
) -> dict[str, Any]:
    """
    Forecast balance metrics using the Transactions ledger walk (Pending → Upcoming).

    ``ledger_anchor`` is the posted Recent ending balance (``ledger_today_balance_before_pending``).
    Each step uses ``signed_timeline_ledger_amount`` — the same math as ``balance_after``.
    """
    walk = transactions_ledger_walk_rows(
        rows, account_id=account_id, today=today, end_date=end_date
    )

    running = _decimal(ledger_anchor).quantize(Decimal("0.01"))

    for row in walk:
        if _row_date(row) >= today:
            break
        running = (running + signed_timeline_ledger_amount(row)).quantize(Decimal("0.01"))

    lowest = running
    lowest_date = today
    first_negative_date: date | None = None
    first_negative_balance: Decimal | None = None
    first_below_buffer_date: date | None = None
    first_below_buffer_balance: Decimal | None = None
    end_of_day: dict[date, Decimal] = {}

    if running < Decimal("0"):
        first_negative_date = today
        first_negative_balance = running
    if running < minimum_buffer:
        first_below_buffer_date = today
        first_below_buffer_balance = running

    last_metric_date: date | None = None
    balance_before_row = running

    for row in walk:
        rd = _row_date(row)
        if rd < today:
            balance_before_row = running
            running = (running + signed_timeline_ledger_amount(row)).quantize(Decimal("0.01"))
            continue
        if rd > end_date:
            break

        if last_metric_date is None and rd > today:
            gap = today
            while gap < rd:
                end_of_day[gap] = balance_before_row
                (
                    lowest,
                    lowest_date,
                    first_negative_date,
                    first_negative_balance,
                    first_below_buffer_date,
                    first_below_buffer_balance,
                ) = _update_balance_metrics(
                    balance_before_row,
                    gap,
                    today=today,
                    end_date=end_date,
                    minimum_buffer=minimum_buffer,
                    lowest=lowest,
                    lowest_date=lowest_date,
                    first_negative_date=first_negative_date,
                    first_negative_balance=first_negative_balance,
                    first_below_buffer_date=first_below_buffer_date,
                    first_below_buffer_balance=first_below_buffer_balance,
                )
                gap += timedelta(days=1)
        elif last_metric_date is not None and rd > last_metric_date + timedelta(days=1):
            gap = last_metric_date + timedelta(days=1)
            while gap < rd:
                end_of_day[gap] = balance_before_row
                (
                    lowest,
                    lowest_date,
                    first_negative_date,
                    first_negative_balance,
                    first_below_buffer_date,
                    first_below_buffer_balance,
                ) = _update_balance_metrics(
                    balance_before_row,
                    gap,
                    today=today,
                    end_date=end_date,
                    minimum_buffer=minimum_buffer,
                    lowest=lowest,
                    lowest_date=lowest_date,
                    first_negative_date=first_negative_date,
                    first_negative_balance=first_negative_balance,
                    first_below_buffer_date=first_below_buffer_date,
                    first_below_buffer_balance=first_below_buffer_balance,
                )
                gap += timedelta(days=1)

        running = (running + signed_timeline_ledger_amount(row)).quantize(Decimal("0.01"))
        balance_before_row = running
        end_of_day[rd] = running
        (
            lowest,
            lowest_date,
            first_negative_date,
            first_negative_balance,
            first_below_buffer_date,
            first_below_buffer_balance,
        ) = _update_balance_metrics(
            running,
            rd,
            today=today,
            end_date=end_date,
            minimum_buffer=minimum_buffer,
            lowest=lowest,
            lowest_date=lowest_date,
            first_negative_date=first_negative_date,
            first_negative_balance=first_negative_balance,
            first_below_buffer_date=first_below_buffer_date,
            first_below_buffer_balance=first_below_buffer_balance,
        )
        last_metric_date = rd

    fill_from = today if last_metric_date is None else last_metric_date + timedelta(days=1)
    d = fill_from
    while d <= end_date:
        end_of_day[d] = balance_before_row
        (
            lowest,
            lowest_date,
            first_negative_date,
            first_negative_balance,
            first_below_buffer_date,
            first_below_buffer_balance,
        ) = _update_balance_metrics(
            balance_before_row,
            d,
            today=today,
            end_date=end_date,
            minimum_buffer=minimum_buffer,
            lowest=lowest,
            lowest_date=lowest_date,
            first_negative_date=first_negative_date,
            first_negative_balance=first_negative_balance,
            first_below_buffer_date=first_below_buffer_date,
            first_below_buffer_balance=first_below_buffer_balance,
        )
        d += timedelta(days=1)

    return {
        "opening_balance": _decimal(ledger_anchor).quantize(Decimal("0.01")),
        "lowest": lowest,
        "lowest_date": lowest_date,
        "ending": balance_before_row,
        "first_negative_date": first_negative_date,
        "first_negative_balance": first_negative_balance,
        "first_below_buffer_date": first_below_buffer_date,
        "first_below_buffer_balance": first_below_buffer_balance,
        "end_of_day": end_of_day,
    }
