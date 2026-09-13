"""Explicit client financial-engine payload for GET /api/timeline/.

Assembles already-canonicalized rows + posted-before-pending anchors.
Does not re-run identity, matching, or recurring construction.
Does not invoke identity DB fallbacks or ``_resolve_ledger_anchors``.

Response contract
-----------------
``engine_shadow.balance_walk_source``:

* ``server`` — Django assigned canonical ``balance_after`` (default / shadow).
* ``client`` — Django skipped the canonical walk; row ``balance_after`` is JSON
  ``null`` (not a missing field and not a leftover cache value). The client
  engine is expected to assign balances from the attached anchors.

``include_engine_shadow`` and ``balance_walk`` are independent:

* default — no ``engine_shadow``, server walk, row ``balance_after`` present
* ``include_engine_shadow=true`` — anchors + server walk
* ``balance_walk=client`` — anchors + skip walk + ``balance_after: null``
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any

CENTS = Decimal("0.01")

BALANCE_WALK_SOURCE_SERVER = "server"
BALANCE_WALK_SOURCE_CLIENT = "client"


def is_client_balance_walk(raw: str | None) -> bool:
    """True only for the explicit ``balance_walk=client`` request flag."""
    return (raw or "").strip().lower() == "client"


def ensure_explicit_financially_active(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Guarantee a boolean ``financially_active`` without DB lookups.

    Identity is already resolved on the timeline path. Missing means participate.
    """
    for row in rows:
        if "financially_active" not in row:
            row["financially_active"] = True
        else:
            row["financially_active"] = bool(row["financially_active"])
    return rows


def _money(value: Decimal) -> str:
    return format(value.quantize(CENTS), "f")


def load_posted_before_pending_anchors(
    account_ids: set[int],
    as_of: date,
) -> dict[int, Decimal]:
    """Single explicit anchor fetch — inject these; do not let the walk reload accounts."""
    if not account_ids:
        return {}
    from accounts.models import Account
    from transactions.services.reconciliation import ledger_today_balances_before_pending

    accounts = list(Account.objects.filter(pk__in=account_ids))
    return {
        int(aid): bal.quantize(CENTS)
        for aid, bal in ledger_today_balances_before_pending(accounts, as_of).items()
    }


def build_engine_shadow_payload(
    rows: list[dict[str, Any]],
    *,
    as_of: date,
    account_id: int | None = None,
    balance_walk_source: str = BALANCE_WALK_SOURCE_SERVER,
    anchors: dict[int, Decimal] | None = None,
) -> dict[str, Any]:
    account_ids = {
        int(row["account_id"]) for row in rows if row.get("account_id") is not None
    }
    if account_id is not None:
        account_ids.add(int(account_id))
    if anchors is None:
        resolved = load_posted_before_pending_anchors(account_ids, as_of)
    else:
        resolved = {
            aid: Decimal(str(anchors[aid])).quantize(CENTS)
            for aid in sorted(account_ids)
            if aid in anchors
        }
    return {
        "as_of": as_of.isoformat(),
        "balance_walk_source": balance_walk_source,
        "accounts": [
            {
                "account_id": aid,
                "posted_balance_before_pending": _money(resolved[aid]),
            }
            for aid in sorted(resolved)
        ],
    }


def apply_client_balance_walk_contract(payload: dict[str, Any]) -> dict[str, Any]:
    """Copy payload and null server ``balance_after`` (never leave cache leftovers).

    ``account_summary.ending_balance`` is no longer a canonical walk result; it
    falls back to chronological ``running_balance`` for JSON shape stability.
    """
    out = dict(payload)
    timeline = []
    last_running: dict[Any, Any] = {}
    for row in payload.get("timeline") or []:
        copied = dict(row)
        copied["balance_after"] = None
        timeline.append(copied)
        aid = copied.get("account_id")
        if aid is not None:
            last_running[aid] = copied.get("running_balance")
    out["timeline"] = timeline
    summaries = []
    for summary in payload.get("account_summary") or []:
        s = dict(summary)
        aid = s.get("account_id")
        if aid in last_running and last_running[aid] is not None:
            s["ending_balance"] = last_running[aid]
        summaries.append(s)
    if "account_summary" in payload:
        out["account_summary"] = summaries
    return out


def attach_engine_shadow_payload(
    payload: dict[str, Any],
    *,
    as_of: date,
    account_id: int | None = None,
    balance_walk_source: str = BALANCE_WALK_SOURCE_SERVER,
    copy_rows: bool = True,
    anchors: dict[int, Decimal] | None = None,
) -> dict[str, Any]:
    """Attach ``engine_shadow``. Copy rows when ``payload`` may be a shared cache dict."""
    attached = dict(payload)
    if copy_rows:
        timeline = [dict(row) for row in (payload.get("timeline") or [])]
        ensure_explicit_financially_active(timeline)
        attached["timeline"] = timeline
    else:
        timeline = payload.get("timeline") or []
        ensure_explicit_financially_active(timeline)
        attached["timeline"] = timeline
    attached["engine_shadow"] = build_engine_shadow_payload(
        timeline,
        as_of=as_of,
        account_id=account_id,
        balance_walk_source=balance_walk_source,
        anchors=anchors,
    )
    return attached
