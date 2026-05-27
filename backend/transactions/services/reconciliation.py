"""Bank reconciliation: compare ledger to statement balance and mark cleared transactions."""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from typing import Any, Optional

from django.core.exceptions import ValidationError
from django.db import transaction as db_transaction
from django.db.models import Max, QuerySet, Sum
from django.db.models.functions import Coalesce
from django.utils import timezone

from accounts.models import Account
from timeline.services.ledger import _balance_at_end_of_date, _opening_balance

from ..models import Reconciliation, ReconciliationEntry, Transaction
from .matching import ledger_visible_transactions

BALANCE_TOLERANCE = Decimal("0.01")


def _normalize_credit_balance(account: Account, raw: Decimal) -> Decimal:
    if account.account_type == Account.AccountType.CREDIT and raw > 0:
        return -raw
    return raw


def _as_of_date(as_of: Optional[date] = None) -> date:
    return as_of or timezone.localdate()


def _active_completed_qs(account: Account) -> QuerySet[Reconciliation]:
    return Reconciliation.objects.filter(
        account=account,
        status=Reconciliation.Status.COMPLETED,
        is_active=True,
    )


def last_completed_reconciliation(account: Account) -> Reconciliation | None:
    return (
        _active_completed_qs(account)
        .order_by("-completed_at", "-id")
        .first()
    )


def list_reconciliation_sessions(account: Account) -> QuerySet[Reconciliation]:
    """All completed sessions for history (active and undone)."""
    return (
        Reconciliation.objects.filter(
            account=account,
            status=Reconciliation.Status.COMPLETED,
        )
        .select_related("user", "undone_by")
        .order_by("-completed_at", "-id")
    )


def get_reconciliation_session(session_id: int, account: Account) -> Reconciliation | None:
    return (
        Reconciliation.objects.filter(
            pk=session_id,
            account=account,
            status=Reconciliation.Status.COMPLETED,
        )
        .select_related("user", "account", "undone_by")
        .first()
    )


def _periods_overlap(start1: date, end1: date, start2: date, end2: date) -> bool:
    return start1 <= end2 and start2 <= end1


def validate_no_overlapping_active_session(
    account: Account,
    period_start: date,
    period_end: date,
    *,
    exclude_pk: int | None = None,
) -> None:
    qs = _active_completed_qs(account).filter(
        period_start_date__lte=period_end,
        period_end_date__gte=period_start,
    )
    if exclude_pk is not None:
        qs = qs.exclude(pk=exclude_pk)
    if qs.exists():
        raise ValueError(
            "An active reconciliation session already exists for an overlapping period."
        )


def _reconcile_floor_date(account: Account, as_of: Optional[date] = None) -> date:
    """
    First calendar date that may appear in reconcile lists.
    Day after the last completed period end, or the first unreconciled row on first reconcile.
    """
    as_of = _as_of_date(as_of)
    prev_end = last_reconcile_period_end(account)
    if prev_end is not None:
        return prev_end + timedelta(days=1)
    first = (
        ledger_visible_transactions(
            Transaction.objects.filter(
                account=account,
                reconciled=False,
                date__lte=as_of,
            )
        )
        .order_by("date", "id")
        .values_list("date", flat=True)
        .first()
    )
    return first if first else as_of


def min_reconcile_start_date(account: Account, as_of: Optional[date] = None) -> date:
    """Earliest allowed period start (same as reconcile date floor)."""
    return _reconcile_floor_date(account, as_of)


def last_reconcile_period_end(account: Account) -> date | None:
    prev = last_completed_reconciliation(account)
    if prev is None:
        return None
    if prev.period_end_date:
        return prev.period_end_date
    return (
        Transaction.objects.filter(account=account, reconciliation=prev)
        .aggregate(Max("date"))
        .get("date__max")
    )


def resolve_period_dates(
    account: Account,
    start: Optional[date],
    end: Optional[date],
    as_of: Optional[date] = None,
    *,
    strict: bool = False,
) -> tuple[date, date]:
    as_of = _as_of_date(as_of)
    floor = _reconcile_floor_date(account, as_of)
    period_end = end or as_of
    if period_end > as_of:
        raise ValueError(f"Period end cannot be after today ({as_of.isoformat()}).")
    if start is None:
        period_start = floor
    elif start < floor:
        if strict:
            prev_end = last_reconcile_period_end(account)
            anchor = prev_end.isoformat() if prev_end else "opening balance"
            raise ValueError(
                f"Period start cannot be before {floor.isoformat()} "
                f"(last reconciled through {anchor})."
            )
        period_start = floor
    else:
        period_start = start
    if period_start > period_end:
        raise ValueError("Period start must be on or before period end.")
    return period_start, period_end


def app_current_balance(account: Account, as_of: Optional[date] = None) -> Decimal:
    """Ledger balance through end of ``as_of`` (default today), matching accounts list / timeline."""
    return _balance_at_end_of_date(account.pk, _as_of_date(as_of))


def period_opening_balance(account: Account, period_start: date) -> Decimal:
    """Ledger balance at the start of ``period_start`` (end of prior day)."""
    return _opening_balance(account.pk, period_start)


def last_reconciled_balance(account: Account, as_of: Optional[date] = None) -> Decimal:
    """Balance at end of last completed reconciliation, or before all unreconciled rows."""
    prev = last_completed_reconciliation(account)
    if prev is not None:
        return prev.bank_current_balance

    as_of = _as_of_date(as_of)
    app_bal = app_current_balance(account, as_of)
    unrec_sum = sum_checked_amounts(unreconciled_transactions_qs(account, as_of))
    return app_bal - unrec_sum


def unreconciled_transactions_qs(
    account: Account,
    as_of: Optional[date] = None,
    *,
    start: Optional[date] = None,
    end: Optional[date] = None,
) -> QuerySet[Transaction]:
    """Unreconciled ledger rows on or after the reconcile floor date."""
    as_of = _as_of_date(as_of)
    floor = _reconcile_floor_date(account, as_of)
    effective_start = max(start, floor) if start is not None else floor
    base = Transaction.objects.filter(
        account=account,
        reconciled=False,
        date__gte=effective_start,
        date__lte=as_of,
    )
    if end is not None:
        base = base.filter(date__lte=min(end, as_of))
    return ledger_visible_transactions(base).select_related("category").order_by("date", "id")


def transaction_running_balances(
    account: Account,
    txns: list[Transaction],
    as_of: Optional[date] = None,
) -> dict[int, Decimal]:
    """Cumulative ledger balance after each unreconciled row (matches transaction register)."""
    if not txns:
        return {}
    as_of = _as_of_date(as_of)
    unreconciled_ids = {t.pk for t in txns}

    start = Decimal("0")
    if account.starting_balance is not None:
        start = Decimal(str(account.starting_balance))
    if account.account_type == Account.AccountType.CREDIT and start > 0:
        start = -start

    result: dict[int, Decimal] = {}
    running = start
    ledger_qs = ledger_visible_transactions(
        Transaction.objects.filter(account=account, date__lte=as_of)
    ).order_by("date", "id")
    for txn in ledger_qs:
        running += txn.amount
        if txn.pk in unreconciled_ids:
            balance = running
            if account.account_type == Account.AccountType.CREDIT and balance > 0:
                balance = -balance
            result[txn.pk] = balance
    return result


def sum_checked_amounts(checked: QuerySet[Transaction]) -> Decimal:
    agg = checked.aggregate(total=Coalesce(Sum("amount"), Decimal("0")))
    return Decimal(str(agg["total"]))


def calculating_balance(last_balance: Decimal, checked: QuerySet[Transaction]) -> Decimal:
    return last_balance + sum_checked_amounts(checked)


def difference_remaining(bank_balance: Decimal, calc_balance: Decimal) -> Decimal:
    return bank_balance - calc_balance


def balances_within_tolerance(diff: Decimal, tolerance: Decimal = BALANCE_TOLERANCE) -> bool:
    return abs(diff) <= tolerance


def get_setup_data(
    account: Account,
    as_of: Optional[date] = None,
    *,
    start: Optional[date] = None,
    end: Optional[date] = None,
) -> dict[str, Any]:
    as_of = _as_of_date(as_of)
    floor = _reconcile_floor_date(account, as_of)
    period_start, period_end = resolve_period_dates(account, start, end, as_of, strict=False)

    prev = last_completed_reconciliation(account)
    last_period_end = last_reconcile_period_end(account)
    if prev is not None:
        opening_bal = prev.bank_current_balance
    else:
        opening_bal = period_opening_balance(account, period_start)

    app_bal_period_end = app_current_balance(account, period_end)
    txns = list(
        unreconciled_transactions_qs(
            account, as_of, start=period_start, end=period_end
        )
    )
    running = transaction_running_balances(account, txns, as_of)
    starting = (
        str(_normalize_credit_balance(account, Decimal(str(account.starting_balance))))
        if account.starting_balance is not None
        else None
    )
    return {
        "last_reconciled_balance": opening_bal,
        "period_opening_balance": opening_bal,
        "app_current_balance": app_bal_period_end,
        "unreconciled_transactions": txns,
        "running_balances": running,
        "is_first_reconciliation": prev is None,
        "account_starting_balance": starting,
        "min_start_date": floor,
        "period_start_date": period_start,
        "period_end_date": period_end,
        "last_reconcile_period_end": last_period_end,
        "max_end_date": as_of,
        "latest_session_id": prev.pk if prev else None,
    }


@db_transaction.atomic
def complete_reconciliation(
    *,
    account: Account,
    user,
    bank_current_balance: Decimal,
    checked_transaction_ids: list[int],
    period_start: date,
    period_end: date,
    as_of: Optional[date] = None,
) -> Reconciliation:
    as_of = _as_of_date(as_of)
    period_start, period_end = resolve_period_dates(
        account, period_start, period_end, as_of, strict=True
    )
    validate_no_overlapping_active_session(account, period_start, period_end)
    bank_current_balance = Decimal(str(bank_current_balance))

    prev = last_completed_reconciliation(account)
    if prev is not None:
        opening_bal = prev.bank_current_balance
    else:
        opening_bal = period_opening_balance(account, period_start)
    app_bal = app_current_balance(account, period_end)

    allowed_ids = set(
        unreconciled_transactions_qs(
            account, as_of, start=period_start, end=period_end
        ).values_list("pk", flat=True)
    )
    checked_ids = list(dict.fromkeys(checked_transaction_ids))
    invalid = [pk for pk in checked_ids if pk not in allowed_ids]
    if invalid:
        raise ValueError(f"Invalid or already reconciled transaction ids: {invalid}")

    checked_qs = Transaction.objects.filter(pk__in=checked_ids, account=account)
    final_bal = calculating_balance(opening_bal, checked_qs)
    diff_remaining = difference_remaining(bank_current_balance, final_bal)
    if not balances_within_tolerance(diff_remaining):
        raise ValueError(
            f"Reconciliation does not balance (remaining difference {diff_remaining})."
        )

    running = transaction_running_balances(account, list(checked_qs.order_by("date", "id")), as_of)
    now = timezone.now()
    rec = Reconciliation(
        user=user,
        account=account,
        bank_current_balance=bank_current_balance,
        app_current_balance=app_bal,
        last_reconciled_balance=opening_bal,
        final_reconciled_balance=final_bal,
        difference=Decimal("0"),
        period_start_date=period_start,
        period_end_date=period_end,
        transaction_count=len(checked_ids),
        status=Reconciliation.Status.COMPLETED,
        is_active=True,
        completed_at=now,
    )
    try:
        rec.full_clean()
    except ValidationError as exc:
        raise ValueError("; ".join(exc.messages)) from exc
    rec.save()

    if checked_ids:
        Transaction.objects.filter(pk__in=checked_ids).update(
            reconciled=True,
            reconciled_at=now,
            reconciliation=rec,
            cleared=True,
            status=Transaction.Status.RECONCILED,
        )
        ReconciliationEntry.objects.bulk_create(
            [
                ReconciliationEntry(
                    session=rec,
                    transaction_id=pk,
                    reconciled_balance=running.get(pk),
                )
                for pk in checked_ids
            ]
        )
    return rec


def serialize_session_summary(rec: Reconciliation) -> dict[str, Any]:
    return {
        "id": rec.pk,
        "account_id": rec.account_id,
        "period_start_date": rec.period_start_date.isoformat() if rec.period_start_date else None,
        "period_end_date": rec.period_end_date.isoformat() if rec.period_end_date else None,
        "opening_balance": str(rec.last_reconciled_balance),
        "app_balance": str(rec.app_current_balance),
        "bank_balance": str(rec.bank_current_balance),
        "difference": str(rec.difference),
        "transaction_count": rec.transaction_count,
        "is_active": rec.is_active,
        "is_balanced": abs(rec.difference) <= BALANCE_TOLERANCE,
        "completed_at": rec.completed_at.isoformat() if rec.completed_at else None,
        "completed_by": rec.user.get_username() if rec.user_id else None,
        "undone_at": rec.undone_at.isoformat() if rec.undone_at else None,
        "undone_by": rec.undone_by.get_username() if rec.undone_by_id else None,
    }


def serialize_session_detail(rec: Reconciliation) -> dict[str, Any]:
    summary = serialize_session_summary(rec)
    entries = (
        rec.entries.select_related("transaction", "transaction__category")
        .order_by("transaction__date", "transaction__id")
    )
    summary["account_name"] = rec.account.name
    summary["transactions"] = [
        {
            "id": entry.transaction_id,
            "date": entry.transaction.date.isoformat(),
            "payee": entry.transaction.payee,
            "memo": entry.transaction.memo,
            "category": entry.transaction.category.name if entry.transaction.category_id else None,
            "amount": str(entry.transaction.amount),
            "reconciled_balance": str(entry.reconciled_balance) if entry.reconciled_balance is not None else None,
            "source": entry.transaction.source,
        }
        for entry in entries
    ]
    return summary


@db_transaction.atomic
def undo_reconciliation(*, session: Reconciliation, user) -> dict[str, Any]:
    if session.status != Reconciliation.Status.COMPLETED:
        raise ValueError("Only completed reconciliation sessions can be undone.")
    if not session.is_active:
        raise ValueError("This reconciliation session has already been undone.")

    latest = last_completed_reconciliation(session.account)
    if latest is None or latest.pk != session.pk:
        raise ValueError("Only the latest active reconciliation session can be undone.")

    txn_ids = list(session.entries.values_list("transaction_id", flat=True))
    if not txn_ids:
        txn_ids = list(
            Transaction.objects.filter(reconciliation=session).values_list("pk", flat=True)
        )

    now = timezone.now()
    updated = Transaction.objects.filter(pk__in=txn_ids, reconciliation=session).update(
        reconciled=False,
        reconciled_at=None,
        reconciliation=None,
        status=Transaction.Status.CLEARED,
    )

    session.is_active = False
    session.undone_at = now
    session.undone_by = user
    session.save(update_fields=["is_active", "undone_at", "undone_by", "updated_at"])

    new_last_end = last_reconcile_period_end(session.account)
    return {
        "success": True,
        "account_id": session.account_id,
        "undone_session_id": session.pk,
        "transactions_unreconciled_count": updated,
        "new_last_reconciled_through": new_last_end.isoformat() if new_last_end else None,
    }
