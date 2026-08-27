"""Canonical per-transaction running balances for account ledger list responses."""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Collection

from accounts.models import Account
from timeline.services.balance_cache import TimelineBalanceCache


def _row_date(row: dict) -> date | None:
    raw = row.get("date")
    if raw is None:
        return None
    if isinstance(raw, date):
        return raw
    try:
        return date.fromisoformat(str(raw)[:10])
    except ValueError:
        return None


def _is_pending_expected_ledger_row(row: dict, as_of: date) -> bool:
    """
    Pending Expected = due PLANNED rule/one-time rows not yet confirmed.

    These belong in the Pending section (web + mobile). They must NOT be folded into
    Recent posted running balances — that produced impossible jumps like Recent Chewy
    Bal $81.15 (which was actually the end-of-Pending balance after Venture -$100).
    """
    status = (row.get("status") or "").upper()
    if status != "PLANNED":
        return False
    row_date = _row_date(row)
    if row_date is None or row_date > as_of:
        return False
    source = (row.get("source") or "").upper()
    if source == "INTEREST":
        return False
    if source == "RULE" or row.get("rule_id") is not None:
        return True
    return source == "ONE_TIME"


def running_balances_for_account_transactions(
    account: Account,
    transaction_ids: Collection[int],
    *,
    as_of: date | None = None,
) -> dict[int, str]:
    """
    Return signed running balance after each requested transaction id.

    Walks ledger-visible history for ``account`` through ``as_of`` using
    TimelineBalanceCache preload, but skips Pending Expected (due PLANNED) amounts
    so Recent posted balances match the web ledger (pending applied only afterward).
    """
    ids = {int(i) for i in transaction_ids if i is not None}
    if not ids:
        return {}

    as_of = as_of or date.today()
    cache = TimelineBalanceCache()
    cache.preload_accounts([account])
    cache.preload_transactions([account.pk], as_of, min_as_of=as_of)

    rows = list(cache._ledger_rows_by_account.get(account.pk, []))
    if not rows:
        return {}

    from timeline.services.ledger import is_superseded_planned_row

    cp = cache._checkpoint_by_account.get(account.pk)
    if cp is not None:
        running = Decimal(str(cp[1]))
    else:
        running = cache.inception_opening_balance(account.pk) or Decimal("0")

    result: dict[int, str] = {}
    for row in rows:
        rid = row.get("id")
        if rid is None:
            continue
        if is_superseded_planned_row(row, rows):
            if rid in ids:
                result[int(rid)] = str(running.quantize(Decimal("0.01")))
            continue
        if _is_pending_expected_ledger_row(row, as_of):
            # Do not apply — Pending section continues from posted ending separately.
            if rid in ids:
                result[int(rid)] = str(running.quantize(Decimal("0.01")))
            continue
        if row.get("source") == "interest":
            # Interest rows still affect balance when present in the ledger preload.
            pass
        running = running + Decimal(str(row["amount"]))
        if int(rid) in ids:
            result[int(rid)] = str(running.quantize(Decimal("0.01")))
    return result
