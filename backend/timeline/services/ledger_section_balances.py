"""Transactions-ledger section balances (Pending → Upcoming).

The Transactions UI shows Recent (posted) then Pending then Upcoming. Pending
rows can be dated *before* the last Recent row, so chronological timeline
``running_balance`` values are not the Bal column for those sections.

``assign_canonical_ledger_balance_after`` is the **only** place that performs
the Pending → Upcoming balance walk and sets ``balance_after``. Every consumer
(Transactions, Dashboard, Account Health, Calendar, Extended Cash Risk) reads
those values or reduces over them — none may reconstruct balances with
``running += amount``.

Dashboard forecast metrics use ``forecast_balance_metrics_from_transactions_ledger``,
which is a pure reducer over canonical ``balance_after`` values.
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
    """Match web/mobile isPlannedScheduledTimelineRow (+ ONE_TIME via txn_source)."""
    if _row_status(row) != "PLANNED":
        return False
    match_status = str(row.get("import_match_status") or "").lower()
    if match_status == "matched":
        return False
    if str(row.get("plaid_transaction_id") or "").strip():
        return False
    source = str(row.get("source") or "").lower()
    if source == "interest":
        return False
    if source == "rule":
        return True
    txn_src = str(row.get("txn_source") or "").lower()
    if txn_src == "rule":
        return True
    if row.get("rule_id") is not None and source == "actual":
        return True
    if source == "one_time" or txn_src == "one_time":
        return True
    return False


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


def _read_balance_after(row: dict[str, Any]) -> Decimal | None:
    raw = row.get("balance_after")
    if raw is None:
        return None
    return _decimal(raw).quantize(Decimal("0.01"))


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


def _resolve_ledger_anchors(
    account_ids: set[int],
    today: date,
    anchors: dict[int, Decimal] | None,
) -> dict[int, Decimal]:
    if anchors is not None:
        return {
            aid: _decimal(anchors.get(aid, Decimal("0"))).quantize(Decimal("0.01"))
            for aid in account_ids
        }
    from accounts.models import Account
    from transactions.services.reconciliation import ledger_today_balance_before_pending

    resolved: dict[int, Decimal] = {}
    for acc in Account.objects.filter(pk__in=account_ids):
        resolved[acc.id] = ledger_today_balance_before_pending(acc, today).quantize(
            Decimal("0.01")
        )
    return resolved


def assign_canonical_ledger_balance_after(
    rows: list[dict[str, Any]],
    *,
    today: date,
    anchors: dict[int, Decimal] | None = None,
    account_ids: set[int] | None = None,
    force: bool = False,
) -> list[dict[str, Any]]:
    """
    Canonical financial balance walk — assigns ``balance_after`` once per account.

    Walks Pending → Upcoming from ``posted_balance_before_pending`` (ledger anchor),
    skipping superseded rows (same financially-active set as Transactions).
    """
    if not rows:
        return rows

    if account_ids is None:
        account_ids = {
            int(r["account_id"]) for r in rows if r.get("account_id") is not None
        }
    if not account_ids:
        return rows

    resolved_anchors = _resolve_ledger_anchors(account_ids, today, anchors)

    for aid in sorted(account_ids):
        anchor = resolved_anchors.get(aid)
        if anchor is None:
            continue
        walk = transactions_ledger_walk_rows(
            rows, account_id=aid, today=today, end_date=None
        )
        if not force and walk and all(r.get("balance_after") is not None for r in walk):
            continue
        running = anchor
        for row in walk:
            running = (running + signed_timeline_ledger_amount(row)).quantize(Decimal("0.01"))
            row["balance_after"] = str(running)

    return rows


def rows_need_ledger_balance_after(
    rows: list[dict[str, Any]],
    *,
    today: date,
    account_id: int | None = None,
) -> bool:
    """True when any financially-active pending/upcoming row lacks ``balance_after``."""
    if account_id is not None:
        account_ids = {int(account_id)}
    else:
        account_ids = {
            int(r["account_id"]) for r in rows if r.get("account_id") is not None
        }
    for aid in account_ids:
        walk = transactions_ledger_walk_rows(rows, account_id=aid, today=today)
        if any(r.get("balance_after") is None for r in walk):
            return True
    return False


def annotate_transactions_ledger_balance_after(
    rows: list[dict[str, Any]],
    *,
    account_id: int | None,
    as_of: date,
    posted_ending_balance: Decimal | None,
) -> list[dict[str, Any]]:
    """
    Ensure ``balance_after`` on ledger rows (delegates to canonical assign).

    When ``posted_ending_balance`` is supplied, it overrides the anchor for
    ``account_id``. Skips reassignment when canonical ``balance_after`` is
    already present unless an explicit anchor is passed.
    """
    if not rows:
        return rows

    if posted_ending_balance is None:
        for r in rows:
            rb = r.get("running_balance")
            if rb is not None and r.get("balance_after") is None:
                r["balance_after"] = str(rb)
        return rows

    account_ids = (
        {int(account_id)} if account_id is not None else None
    )
    anchors = None
    if account_id is not None:
        anchors = {
            int(account_id): _decimal(posted_ending_balance).quantize(Decimal("0.01"))
        }

    force = account_id is not None
    if not force and not rows_need_ledger_balance_after(
        rows, today=as_of, account_id=account_id
    ):
        return rows

    return assign_canonical_ledger_balance_after(
        rows,
        today=as_of,
        anchors=anchors,
        account_ids=account_ids,
        force=force,
    )


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


def _after_pending_balance(
    walk: list[dict[str, Any]],
    *,
    today: date,
    ledger_anchor: Decimal,
) -> Decimal:
    """Balance after the pending section (Current Balance when pending exists)."""
    after_pending = ledger_anchor
    for row in walk:
        if _row_date(row) > today:
            break
        bal = _read_balance_after(row)
        if bal is not None:
            after_pending = bal
    return after_pending


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
    Forecast balance metrics — pure reducer over canonical ``balance_after``.

    Does not perform ``running += amount``. Requires rows to carry authoritative
    ``balance_after`` from ``assign_canonical_ledger_balance_after``.
    """
    if rows_need_ledger_balance_after(rows, today=today, account_id=account_id):
        assign_canonical_ledger_balance_after(
            rows,
            today=today,
            anchors={account_id: ledger_anchor},
            account_ids={account_id},
            force=True,
        )

    walk = transactions_ledger_walk_rows(
        rows, account_id=account_id, today=today, end_date=end_date
    )

    opening = _decimal(ledger_anchor).quantize(Decimal("0.01"))
    after_pending = _after_pending_balance(walk, today=today, ledger_anchor=opening)

    lowest = opening
    lowest_date = today
    first_negative_date: date | None = None
    first_negative_balance: Decimal | None = None
    first_below_buffer_date: date | None = None
    first_below_buffer_balance: Decimal | None = None
    end_of_day: dict[date, Decimal] = {}

    if opening < Decimal("0"):
        first_negative_date = today
        first_negative_balance = opening
    if opening < minimum_buffer:
        first_below_buffer_date = today
        first_below_buffer_balance = opening

    last_metric_date: date | None = None
    balance_before_row = after_pending

    for row in walk:
        rd = _row_date(row)
        if rd < today:
            bal = _read_balance_after(row)
            if bal is not None:
                balance_before_row = bal
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

        bal = _read_balance_after(row)
        if bal is None:
            raise ValueError(
                f"canonical balance_after missing for account={account_id} "
                f"date={rd} description={row.get('description')!r}"
            )
        balance_before_row = bal
        end_of_day[rd] = bal
        (
            lowest,
            lowest_date,
            first_negative_date,
            first_negative_balance,
            first_below_buffer_date,
            first_below_buffer_balance,
        ) = _update_balance_metrics(
            bal,
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
        "opening_balance": opening,
        "lowest": lowest,
        "lowest_date": lowest_date,
        "ending": balance_before_row,
        "first_negative_date": first_negative_date,
        "first_negative_balance": first_negative_balance,
        "first_below_buffer_date": first_below_buffer_date,
        "first_below_buffer_balance": first_below_buffer_balance,
        "end_of_day": end_of_day,
    }
