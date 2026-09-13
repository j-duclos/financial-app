"""Per-request posted-before-pending anchors for GET /api/timeline/.

Load once per request and inject into:

* the canonical slice balance walk (server / shadow)
* engine-shadow / client payload

Not stored on the canonical forecast cache. The cache already invalidates on
``financial_revision`` (posted activity + checkpoints), so a second key would
not stay independently correct — and a single per-request load is enough.

``past_ledger_opening_balance`` is a different financial instant (statement
checkpoint / unreconciled-Recent opening). Reuse the snapshot checkpoint when
present; never substitute ``posted_balance_before_pending``.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Collection, Iterable

from transactions.services.historical_ledger import (
    LedgerAnchorSnapshot,
    ledger_anchor_snapshots_for_accounts,
)

__all__ = [
    "LedgerAnchorSnapshot",
    "load_ledger_anchor_snapshots",
    "posted_before_pending_map",
]


def load_ledger_anchor_snapshots(
    account_ids: Collection[int],
    as_of: date,
) -> dict[int, LedgerAnchorSnapshot]:
    """One Account query + one bulk posted-before-pending walk for ``account_ids``."""
    ids = {int(i) for i in account_ids if i is not None}
    if not ids:
        return {}
    from accounts.models import Account

    accounts = list(Account.objects.filter(pk__in=ids))
    return ledger_anchor_snapshots_for_accounts(accounts, as_of=as_of)


def posted_before_pending_map(
    snapshots: Iterable[LedgerAnchorSnapshot] | dict[int, LedgerAnchorSnapshot],
) -> dict[int, Decimal]:
    if isinstance(snapshots, dict):
        values = snapshots.values()
    else:
        values = snapshots
    return {int(snap.account_id): snap.posted_balance_before_pending for snap in values}
