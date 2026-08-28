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


def _normalize_cache_row_for_pending(row: dict) -> dict:
    """Adapt TimelineBalanceCache rows to timeline pending semantics."""
    src = row.get("source")
    if hasattr(src, "value"):
        src = src.value
    src_l = str(src or "").lower()
    return {
        "date": row.get("date"),
        "status": row.get("status"),
        "source": src_l if src_l in ("rule", "one_time", "interest") else "actual",
        "txn_source": src_l or None,
        "rule_id": row.get("rule_id"),
        "import_match_status": row.get("import_match_status"),
        "plaid_transaction_id": row.get("plaid_transaction_id"),
    }


def _is_pending_expected_ledger_row(row: dict, as_of: date) -> bool:
    from timeline.services.ledger_section_balances import is_pending_expected_timeline_row

    return is_pending_expected_timeline_row(_normalize_cache_row_for_pending(row), as_of)


def posted_ledger_running_after_walk(
    account: Account,
    *,
    as_of: date | None = None,
) -> Decimal:
    """
    Canonical posted-before-pending balance — same ending state as the last Recent row.

    Matches ``ledger_today_balance_before_pending``; exposed for invariant tests.
    """
    as_of = as_of or date.today()
    cache = TimelineBalanceCache()
    cache.preload_accounts([account])
    cache.preload_transactions([account.pk], as_of, min_as_of=as_of)

    rows = list(cache._ledger_rows_by_account.get(account.pk, []))
    if not rows:
        cp = cache._checkpoint_by_account.get(account.pk)
        if cp is not None:
            return Decimal(str(cp[1])).quantize(Decimal("0.01"))
        opening = cache.inception_opening_balance(account.pk) or Decimal("0")
        return opening.quantize(Decimal("0.01"))

    from timeline.services.ledger import is_superseded_planned_row

    cp = cache._checkpoint_by_account.get(account.pk)
    if cp is not None:
        running = Decimal(str(cp[1]))
    else:
        running = cache.inception_opening_balance(account.pk) or Decimal("0")

    for row in rows:
        if is_superseded_planned_row(row, rows):
            continue
        if _is_pending_expected_ledger_row(row, as_of):
            continue
        if row.get("source") == "interest":
            pass
        running = running + Decimal(str(row["amount"]))
    return running.quantize(Decimal("0.01"))


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
            if rid in ids:
                result[int(rid)] = str(running.quantize(Decimal("0.01")))
            continue
        if row.get("source") == "interest":
            pass
        running = running + Decimal(str(row["amount"]))
        if int(rid) in ids:
            result[int(rid)] = str(running.quantize(Decimal("0.01")))
    return result
