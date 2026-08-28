"""
Canonical historical ledger walk for Recent transaction running balances.

Posted Recent balances are computed dynamically on each request — never read from
a persisted per-transaction running_balance column.

Pipeline:
  checkpoint opening (or account starting balance)
  → ledger-visible unreconciled rows through as_of (date ASC, id ASC)
  → skip pending expected + canonical inactive rows
  → balance_after = prior + signed amount
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Collection, Iterable

from accounts.models import Account
from transactions.models import Transaction


@dataclass(frozen=True)
class HistoricalLedgerStep:
    transaction_id: int
    date: date
    description: str
    signed_amount: Decimal
    balance_before: Decimal
    balance_after: Decimal
    participates: bool


def signed_transaction_ledger_amount(txn: Transaction) -> Decimal:
    """Signed cash effect on the account (amount is stored signed in the DB)."""
    return Decimal(str(txn.amount or "0")).quantize(Decimal("0.01"))


def _timeline_row_from_transaction(txn: Transaction) -> dict:
    source = (txn.source or "").lower()
    return {
        "date": txn.date,
        "status": txn.status,
        "source": source,
        "txn_source": source,
        "rule_id": txn.rule_id,
        "import_match_status": txn.import_match_status,
        "plaid_transaction_id": (txn.plaid_transaction_id or "").strip() or None,
        "amount": txn.amount,
        "account_id": txn.account_id,
        "description": txn.payee or "",
        "transfer_group_id": txn.transfer_group_id,
    }


def historical_walk_opening_balance(account: Account, as_of: date) -> Decimal:
    """Balance immediately before the first post-checkpoint unreconciled ledger row."""
    from transactions.services.checkpoints import (
        bulk_latest_completed_reconciliations,
        checkpoint_signed_balance,
    )

    rec = bulk_latest_completed_reconciliations([account.pk], as_of).get(account.pk)
    if rec is not None:
        return checkpoint_signed_balance(rec, account).quantize(Decimal("0.01"))
    if account.starting_balance is not None:
        opening = Decimal(str(account.starting_balance))
        if account.account_type == Account.AccountType.CREDIT and opening > 0:
            opening = -opening
        return opening.quantize(Decimal("0.01"))
    return Decimal("0.00")


def iter_historical_ledger_steps(
    account: Account,
    *,
    as_of: date,
) -> tuple[Decimal, list[HistoricalLedgerStep]]:
    """
    Walk canonical historical ledger rows through ``as_of``.

    Returns (opening_balance, steps) where each participating step's ``balance_after``
    is the displayed Recent Balance for that transaction.
    """
    from timeline.services.canonical_ledger import row_participates_financially
    from timeline.services.ledger_section_balances import is_pending_expected_timeline_row
    from transactions.services.matching import ledger_visible_transactions
    from transactions.services.reconciliation import filter_superseded_planned_transactions

    from transactions.services.checkpoints import bulk_latest_completed_reconciliations, post_checkpoint_q

    opening = historical_walk_opening_balance(account, as_of)
    rec = bulk_latest_completed_reconciliations([account.pk], as_of).get(account.pk)
    q = Transaction.objects.filter(account=account, date__lte=as_of, reconciled=False)
    if rec is not None and rec.period_end_date is not None:
        q = q.filter(post_checkpoint_q(rec.period_end_date))
    txns = list(
        ledger_visible_transactions(q).order_by("date", "id").select_related("account")
    )
    txns = filter_superseded_planned_transactions(txns)
    timeline_rows = [_timeline_row_from_transaction(t) for t in txns]

    running = opening
    steps: list[HistoricalLedgerStep] = []
    for txn, row in zip(txns, timeline_rows):
        signed = signed_transaction_ledger_amount(txn)
        pending = is_pending_expected_timeline_row(row, as_of)
        participates = (not pending) and row_participates_financially(row, timeline_rows)
        balance_before = running
        balance_after = running
        if participates:
            balance_after = (running + signed).quantize(Decimal("0.01"))
            running = balance_after
        steps.append(
            HistoricalLedgerStep(
                transaction_id=txn.pk,
                date=txn.date,
                description=txn.payee or "",
                signed_amount=signed,
                balance_before=balance_before,
                balance_after=balance_after,
                participates=participates,
            )
        )
    return opening, steps


def running_balances_after_historical_walk(
    account: Account,
    transaction_ids: Collection[int],
    *,
    as_of: date | None = None,
) -> dict[int, str]:
    """
    ``balance_after`` for each requested transaction id that participates in the walk.

    Skipped rows (pending expected, superseded, canonical inactive) are omitted —
    clients must derive display balances by walking the visible sequence locally.
    """
    ids = {int(i) for i in transaction_ids if i is not None}
    if not ids:
        return {}
    as_of = as_of or date.today()
    _, steps = iter_historical_ledger_steps(account, as_of=as_of)
    return {
        step.transaction_id: str(step.balance_after)
        for step in steps
        if step.participates and step.transaction_id in ids
    }


def posted_balance_before_pending_from_steps(
    account: Account,
    *,
    as_of: date | None = None,
) -> Decimal:
    """Ending Recent balance — last participating historical step's balance_after."""
    as_of = as_of or date.today()
    _, steps = iter_historical_ledger_steps(account, as_of=as_of)
    participating = [s for s in steps if s.participates]
    if participating:
        return participating[-1].balance_after
    return historical_walk_opening_balance(account, as_of)


def validate_historical_ledger_chain(
    *,
    opening_balance: Decimal,
    steps: Iterable[HistoricalLedgerStep],
) -> None:
    """Assert balance_after = prior balance_after + signed_amount for every participating row."""
    expected = opening_balance.quantize(Decimal("0.01"))
    for step in steps:
        if not step.participates:
            continue
        if step.balance_before.quantize(Decimal("0.01")) != expected:
            raise AssertionError(
                f"txn {step.transaction_id} balance_before {step.balance_before} != {expected}"
            )
        if step.balance_after.quantize(Decimal("0.01")) != (
            expected + step.signed_amount
        ).quantize(Decimal("0.01")):
            raise AssertionError(
                f"txn {step.transaction_id} balance_after {step.balance_after} != "
                f"{expected} + {step.signed_amount}"
            )
        expected = step.balance_after


def debug_log_historical_ledger(account: Account, *, as_of: date, limit: int = 40) -> None:
    """Development-only walk print (LEDGER_WALK_DEBUG_ACCOUNT=id|name)."""
    raw = os.environ.get("LEDGER_WALK_DEBUG_ACCOUNT", "").strip()
    if not raw:
        return
    try:
        want = int(raw)
    except ValueError:
        want = None
    if want is not None and want != account.pk:
        return
    if want is None and account.name.lower() != raw.lower():
        return
    opening, steps = iter_historical_ledger_steps(account, as_of=as_of)
    print(f"Starting balance: {opening}")
    print("date\tid\tdescription\tsigned\tbalance_before\tbalance_after\tparticipates")
    for step in steps[:limit]:
        print(
            f"{step.date}\t{step.transaction_id}\t{step.description}\t{step.signed_amount}\t"
            f"{step.balance_before}\t{step.balance_after}\t{step.participates}"
        )
