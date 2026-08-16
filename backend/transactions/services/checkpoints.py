"""
Completed reconciliations as authoritative signed-balance checkpoints.

A current/as-of ledger balance is:

    checkpoint.bank_current_balance
    + ledger-visible transactions after the checkpoint through as-of

instead of replaying every reconciled row from account inception.

``bank_current_balance`` is the verified statement ending balance stored at
complete time (already signed; credit debt is negative).
"""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from typing import Collection, Iterable

from django.db.models import Q

from accounts.models import Account
from transactions.models import Reconciliation, Transaction


def _as_of(as_of: date | None) -> date:
    from django.utils import timezone

    return as_of or timezone.localdate()


def latest_completed_reconciliation_as_of(
    account: Account,
    as_of: date | None = None,
) -> Reconciliation | None:
    """
    Latest active completed reconciliation whose period end is on or before ``as_of``.

    Used as the balance checkpoint for that date. Does not return a checkpoint
    that closes after ``as_of``.
    """
    as_of = _as_of(as_of)
    return (
        Reconciliation.objects.filter(
            account=account,
            status=Reconciliation.Status.COMPLETED,
            is_active=True,
            period_end_date__isnull=False,
            period_end_date__lte=as_of,
        )
        .order_by("-period_end_date", "-completed_at", "-id")
        .first()
    )


def bulk_latest_completed_reconciliations(
    account_ids: Collection[int],
    as_of: date | None = None,
) -> dict[int, Reconciliation]:
    """
    Latest valid checkpoint per account as of ``as_of``, in one query.

    Picks the first row per account from a descending period-end ordering
    (SQLite-safe; no DISTINCT ON).
    """
    ids = [int(i) for i in account_ids if i is not None]
    if not ids:
        return {}
    as_of = _as_of(as_of)
    recs = (
        Reconciliation.objects.filter(
            account_id__in=ids,
            status=Reconciliation.Status.COMPLETED,
            is_active=True,
            period_end_date__isnull=False,
            period_end_date__lte=as_of,
        )
        .order_by("account_id", "-period_end_date", "-completed_at", "-id")
    )
    latest: dict[int, Reconciliation] = {}
    for rec in recs.iterator():
        if rec.account_id not in latest:
            latest[rec.account_id] = rec
    return latest


def checkpoint_signed_balance(rec: Reconciliation, account: Account | None = None) -> Decimal:
    """Verified ending balance from a completed session (signed)."""
    raw = Decimal(str(rec.bank_current_balance))
    acc = account
    if acc is None:
        acc = getattr(rec, "account", None)
    if acc is not None and acc.account_type == Account.AccountType.CREDIT and raw > 0:
        return -raw
    return raw


def post_checkpoint_q(period_end: date) -> Q:
    """
    Ledger rows that are not already included in the checkpoint ending balance.

    Reconciled rows on ``period_end`` are inside the checkpoint. Unreconciled
    same-day rows (posted after the close) are not.
    """
    return Q(date__gt=period_end) | Q(date=period_end, reconciled=False)


def post_checkpoint_transaction_filter(
    account_ids_by_period_end: dict[int, date],
    *,
    date_lte: date,
    date_lt: date | None = None,
) -> Q:
    """OR of per-account post-checkpoint windows through ``date_lte`` / ``date_lt``."""
    q = Q()
    for account_id, period_end in account_ids_by_period_end.items():
        part = Q(account_id=account_id) & post_checkpoint_q(period_end)
        if date_lt is not None:
            part &= Q(date__lt=date_lt)
        else:
            part &= Q(date__lte=date_lte)
        q |= part
    return q


def inception_account_ids(
    account_ids: Iterable[int],
    checkpoints: dict[int, Reconciliation],
) -> list[int]:
    return [aid for aid in account_ids if aid not in checkpoints]
