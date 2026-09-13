"""Build /api/timeline/ response rows from the canonical forecast cache.

The cached household list is treated as immutable. This module filters by
account/date using references, then shallow-copies only the rows that will be
returned (and possibly re-walked).
"""
from __future__ import annotations

from datetime import date
from typing import Any

from timeline.services.ledger_section_balances import (
    assign_canonical_ledger_balance_after,
    transactions_timeline_rows_for_ledger,
)
from timeline.services.timeline_perf import TimelineRequestPerf


def _row_date(row: dict[str, Any]) -> date | None:
    raw = row.get("date")
    if isinstance(raw, date):
        return raw
    try:
        return date.fromisoformat(str(raw)[:10])
    except ValueError:
        return None


def _identity_already_resolved(rows: list[dict[str, Any]]) -> bool:
    return bool(rows) and all("financially_active" in row for row in rows)


def copy_timeline_row(row: dict[str, Any]) -> dict[str, Any]:
    """Shallow copy one cached row. Nested values are scalars or None."""
    return dict(row)


def slice_cached_canonical_rows(
    cached_rows: list[dict[str, Any]],
    *,
    account_id: int | None,
    as_of: date,
    projection_start: date,
    projection_end: date,
    skip_balance_walk: bool = False,
    anchors: dict[int, Any] | None = None,
    perf: TimelineRequestPerf | None = None,
) -> list[dict[str, Any]]:
    """
    Return independent row dicts for the request slice.

    Does not mutate ``cached_rows``. Reuses cached ``financially_active`` when
    present instead of re-running ``resolve_canonical_financial_state``.

    Pass ``anchors`` (posted-before-pending map) so the slice walk does not
    reload ``_resolve_ledger_anchors`` from SQL.
    """
    stage = perf.stage if perf is not None else None

    def _run(name: str, fn):
        if stage is None:
            return fn()
        with stage(name):
            return fn()

    def _filter():
        if account_id is None:
            return list(cached_rows)
        aid = int(account_id)
        return [row for row in cached_rows if int(row.get("account_id") or 0) == aid]

    scoped_refs = _run("filter_ms", _filter)

    reuse_identity = _identity_already_resolved(scoped_refs)
    work_rows = scoped_refs
    if not reuse_identity and scoped_refs:
        def _identity():
            from timeline.services.canonical_ledger import resolve_canonical_financial_state

            copies = [copy_timeline_row(row) for row in scoped_refs]
            resolve_canonical_financial_state(copies)
            return copies

        work_rows = _run("identity_ms", _identity)
    elif perf is not None:
        perf.stages["identity_ms"] = 0.0

    def _slice():
        if account_id is None:
            selected = []
            for row in work_rows:
                rd = _row_date(row)
                if rd is None:
                    continue
                if rd < projection_start or rd > projection_end:
                    continue
                selected.append(row)
            return selected
        return transactions_timeline_rows_for_ledger(
            work_rows,
            account_id=int(account_id),
            as_of=as_of,
            projection_start=projection_start,
            projection_end=projection_end,
        )

    selected_refs = _run("slice_ms", _slice)

    def _copy():
        if work_rows is not scoped_refs:
            # Identity copies are already detached from the cache.
            return list(selected_refs)
        return [copy_timeline_row(row) for row in selected_refs]

    rows = _run("cache_copy_ms", _copy)

    if skip_balance_walk:
        if perf is not None:
            perf.stages["balance_walk_ms"] = 0.0
            perf.meta["balance_walk_skipped"] = True
        return rows

    def _walk():
        assign_canonical_ledger_balance_after(
            rows,
            today=as_of,
            anchors=anchors,
            account_ids={int(account_id)} if account_id is not None else None,
            force=True,
        )
        return rows

    _run("balance_walk_ms", _walk)
    if perf is not None:
        perf.meta["balance_walk_skipped"] = False
    return rows


def stringify_timeline_rows(rows: list[dict[str, Any]]) -> None:
    """In-place JSON-safe date/decimal conversion on already-copied rows."""
    for row in rows:
        d = row.get("date")
        row["date"] = d.isoformat() if hasattr(d, "isoformat") else str(d)
        row["amount"] = str(row["amount"])
        row["running_balance"] = str(row["running_balance"])
        if row.get("balance_after") is not None:
            row["balance_after"] = str(row["balance_after"])


def build_account_summary(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    account_balances: dict[Any, dict[str, Any]] = {}
    for row in rows:
        aid = row["account_id"]
        ending = row.get("balance_after") or row["running_balance"]
        if aid not in account_balances:
            account_balances[aid] = {
                "account_id": aid,
                "account_name": row.get("account_name", ""),
                "ending_balance": ending,
            }
        else:
            account_balances[aid]["ending_balance"] = ending
    return list(account_balances.values())
