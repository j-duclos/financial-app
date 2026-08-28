"""
Canonical financial identity for timeline / ledger rows.

Required pipeline (before ``assign_canonical_ledger_balance_after``):

    resolve_canonical_financial_state(rows)
    → assign_canonical_ledger_balance_after(rows)

Match, superseded, and shadow semantics are resolved here once. Downstream
consumers (Transactions, Dashboard, Calendar, Reconciliation, Web, Mobile)
read ``financially_active`` and related metadata — they must not independently
re-derive financial participation from status, import_match_status, or rule_id.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date
from decimal import Decimal
from typing import Any

from timeline.services.ledger import (
    SAME_ACCOUNT_DATE_WINDOW_DAYS,
    _is_paired_transfer_timeline_row,
    _is_unmatched_plaid_import_row,
    _planned_and_posting_likely_same,
    _timeline_amounts_match,
    _timeline_row_date,
    is_shadowed_by_matched_rule_sibling,
    is_superseded_planned_row,
    timeline_rows_chronological_key,
)


class SuppressionReason:
    """Why a row does not carry an independent financial effect."""

    SUPSERSED_BY_POSTING = "superseded_by_posting"
    SHADOW_RULE_SIBLING = "shadow_rule_sibling"
    IMPORT_MATCH_FULFILLED = "import_match_fulfilled"


def _find_superseding_posting_row(row: dict, account_rows: list[dict]) -> dict | None:
    """Return the cleared/reconciled posting that fulfills this planned row, if any."""
    if _is_paired_transfer_timeline_row(row):
        return None
    status = (row.get("status") or "").upper()
    if status != "PLANNED":
        return None
    row_date = _timeline_row_date(row.get("date"))
    if row_date is None:
        return None
    try:
        amt = Decimal(str(row.get("amount")))
    except Exception:
        return None
    abs_amt = abs(amt)
    for other in account_rows:
        if other is row or other.get("account_id") != row.get("account_id"):
            continue
        other_date = _timeline_row_date(other.get("date"))
        if other_date != row_date:
            continue
        other_status = (other.get("status") or "").upper()
        if other_status not in ("CLEARED", "RECONCILED"):
            continue
        if row.get("rule_id") is not None and other.get("rule_id") == row.get("rule_id"):
            return other
        if _is_unmatched_plaid_import_row(other) and _planned_and_posting_likely_same(row, other):
            continue
        other_amt = Decimal(str(other.get("amount")))
        if abs(abs(other_amt) - abs_amt) < Decimal("0.05"):
            return other
        if _planned_and_posting_likely_same(row, other):
            return other
    return None


def _find_shadow_canonical_sibling(row: dict, account_rows: list[dict]) -> dict | None:
    """Return the matched rule sibling that covers this shadow occurrence."""
    if _is_paired_transfer_timeline_row(row):
        return None
    rule_id = row.get("rule_id")
    if rule_id is None:
        return None
    account_id = row.get("account_id")
    row_date = _timeline_row_date(row.get("date"))
    if row_date is None or account_id is None:
        return None
    if (row.get("import_match_status") or "").lower() == "matched":
        return None
    try:
        amt = Decimal(str(row.get("amount")))
    except Exception:
        return None
    for other in account_rows:
        if other is row:
            continue
        if other.get("account_id") != account_id or other.get("rule_id") != rule_id:
            continue
        if (other.get("import_match_status") or "").lower() != "matched":
            continue
        other_date = _timeline_row_date(other.get("date"))
        if other_date is None:
            continue
        if abs((other_date - row_date).days) > SAME_ACCOUNT_DATE_WINDOW_DAYS:
            continue
        other_amt = other.get("amount")
        if other_amt is not None and _timeline_amounts_match(amt, other_amt):
            return other
    from transactions.services.matching import _matched_rule_occurrence_covers

    covered = _matched_rule_occurrence_covers(
        rule_id=int(rule_id),
        account_id=int(account_id),
        on_date=row_date,
        amount=amt,
    )
    if covered is None:
        return None
    tid = row.get("transaction_id")
    if tid is not None and int(tid) == covered.pk:
        return None
    for other in account_rows:
        if other.get("transaction_id") == covered.pk:
            return other
    return {"transaction_id": covered.pk}


def _resolve_single_row_state(row: dict, account_rows: list[dict]) -> None:
    """Annotate one row with canonical financial identity metadata."""
    row.pop("suppression_reason", None)
    row.pop("canonical_transaction_id", None)
    row.pop("fulfilled_by_transaction_id", None)

    ims = (row.get("import_match_status") or "").lower()
    tid = row.get("transaction_id")

    if ims == "matched" and (row.get("txn_source") or "").lower() == "plaid":
        row["financially_active"] = True
        row["canonical_transaction_id"] = tid
        return

    if ims == "matched" and (row.get("status") or "").upper() == "PLANNED":
        row["financially_active"] = False
        row["suppression_reason"] = SuppressionReason.IMPORT_MATCH_FULFILLED
        return

    if is_shadowed_by_matched_rule_sibling(row, account_rows):
        shadow = _find_shadow_canonical_sibling(row, account_rows)
        row["financially_active"] = False
        row["suppression_reason"] = SuppressionReason.SHADOW_RULE_SIBLING
        row["canonical_transaction_id"] = shadow.get("transaction_id") if shadow else None
        return

    if is_superseded_planned_row(row, account_rows):
        posting = _find_superseding_posting_row(row, account_rows)
        row["financially_active"] = False
        row["suppression_reason"] = SuppressionReason.SUPSERSED_BY_POSTING
        canonical_tid = posting.get("transaction_id") if posting else None
        row["canonical_transaction_id"] = canonical_tid
        row["fulfilled_by_transaction_id"] = canonical_tid
        return

    row["financially_active"] = True
    row["canonical_transaction_id"] = tid


def resolve_canonical_financial_state(rows: list[dict]) -> None:
    """
    Resolve match/suppression for every row before balance assignment or API serialization.

    Sets ``financially_active``, ``suppression_reason``, ``canonical_transaction_id``,
    and ``fulfilled_by_transaction_id`` on each row in place.
    """
    if not rows:
        return
    by_account: dict[int, list[dict]] = defaultdict(list)
    for row in rows:
        aid = row.get("account_id")
        if aid is not None:
            by_account[int(aid)].append(row)
    for row in rows:
        aid = row.get("account_id")
        acct_rows = by_account.get(int(aid), []) if aid is not None else []
        _resolve_single_row_state(row, acct_rows)


def row_participates_financially(row: dict, account_rows: list[dict]) -> bool:
    """
    Single predicate for whether a row carries an independent financial effect.

    Prefer pre-resolved ``financially_active`` from ``resolve_canonical_financial_state``.
    """
    if "financially_active" in row:
        return bool(row["financially_active"])
    if is_superseded_planned_row(row, account_rows):
        return False
    if is_shadowed_by_matched_rule_sibling(row, account_rows):
        return False
    return True


def resolve_canonical_ledger_entries(
    rows: list[dict],
    *,
    account_id: int | None = None,
    resolve: bool = True,
) -> list[dict]:
    """
    Ordered financially-active ledger entries for one account (or all accounts).

    This is the row set that must feed ``assign_canonical_ledger_balance_after`` and
    match what Transactions /timeline/ serializes for pending/upcoming sections.
    """
    if resolve:
        resolve_canonical_financial_state(rows)
    scoped = rows
    if account_id is not None:
        scoped = [r for r in rows if int(r.get("account_id") or 0) == int(account_id)]
    by_account: dict[int, list[dict]] = defaultdict(list)
    for row in scoped:
        aid = row.get("account_id")
        if aid is not None:
            by_account[int(aid)].append(row)
    active: list[dict] = []
    for row in scoped:
        aid = row.get("account_id")
        acct_rows = by_account.get(int(aid), []) if aid is not None else []
        if row_participates_financially(row, acct_rows):
            active.append(row)
    active.sort(key=timeline_rows_chronological_key)
    return active


def build_canonical_ledger_with_balances(
    rows: list[dict],
    *,
    today: date,
    anchors: dict[int, Decimal] | None = None,
    account_ids: set[int] | None = None,
    force: bool = False,
) -> list[dict]:
    """Full canonical pipeline: resolve identity, then assign balance_after once."""
    from timeline.services.ledger_section_balances import assign_canonical_ledger_balance_after

    resolve_canonical_financial_state(rows)
    assign_canonical_ledger_balance_after(
        rows,
        today=today,
        anchors=anchors,
        account_ids=account_ids,
        force=force,
    )
    return rows
