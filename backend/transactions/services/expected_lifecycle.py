"""Lifecycle actions for scheduled transactions: forecast → expected → actual / matched / skipped."""
from __future__ import annotations

from datetime import date
from typing import TYPE_CHECKING, Iterable, Optional

from django.db import transaction as db_transaction
from django.utils import timezone

from timeline.models import InterestCycleSkip, RecurringRuleSkip

from ..models import Transaction, TransactionMatch, TransferGroup
from ..rule_transfer_pairs import find_rule_transfer_counterpart_txn
from .immutability import reject_if_reconciled
from .matching import manual_match_transactions
from .posting import delete_transaction_respecting_partner_ledger

if TYPE_CHECKING:
    pass


def _today() -> date:
    return timezone.localdate()


def _coerce_date(value) -> date:
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        return date.fromisoformat(value[:10])
    raise ValueError("date must be YYYY-MM-DD")


def is_planned_scheduled_eligible(txn: Transaction, *, today: date | None = None) -> bool:
    """Rule-backed or one-time planned row that can be confirmed, skipped, or moved."""
    if txn.status != Transaction.Status.PLANNED:
        return False
    if txn.reconciled:
        return False
    if txn.import_match_status == Transaction.ImportMatchStatus.MATCHED:
        return False
    if (txn.plaid_transaction_id or "").strip():
        return False
    if txn.source == Transaction.Source.INTEREST:
        return False
    if txn.scenario_id is not None:
        return False
    if txn.source == Transaction.Source.RULE:
        return True
    if txn.rule_id is not None:
        return True
    if txn.source == Transaction.Source.ONE_TIME:
        return True
    return False


def is_expected_eligible(txn: Transaction, *, today: date | None = None) -> bool:
    """Due scheduled row waiting for confirmation (Expected section)."""
    today = today or _today()
    return is_planned_scheduled_eligible(txn, today=today) and txn.date <= today


def _find_rule_counterpart(txn: Transaction) -> Transaction | None:
    if txn.rule_id is None:
        if txn.transfer_group_id:
            return (
                Transaction.objects.filter(transfer_group_id=txn.transfer_group_id)
                .exclude(pk=txn.pk)
                .first()
            )
        return None
    return find_rule_transfer_counterpart_txn(
        rule_id=txn.rule_id,
        exclude_txn_pk=txn.pk,
        old_date=txn.date,
        old_amount=txn.amount,
        old_account_id=txn.account_id,
        transfer_group_id=txn.transfer_group_id,
    )


def _record_rule_skip(txn: Transaction) -> None:
    if txn.rule_id is not None:
        RecurringRuleSkip.objects.get_or_create(rule_id=txn.rule_id, date=txn.date)


def purge_planned_rule_occurrence(rule_id: int, occurrence_date: date) -> int:
    """
    Remove planned RULE rows for a skipped occurrence on every account (both transfer legs).

    Unlike ``_purge_skipped_rule_occurrence`` in ledger.py, this runs for past-due dates too so
    deleting/skipping the outflow leg does not leave an orphan inflow in Pending.
    """
    if TransactionMatch.objects.filter(
        planned_transaction__rule_id=rule_id,
        planned_transaction__date=occurrence_date,
        imported_transaction__source=Transaction.Source.PLAID,
    ).exists():
        return 0
    qs = Transaction.objects.filter(
        rule_id=rule_id,
        date=occurrence_date,
        source=Transaction.Source.RULE,
        status=Transaction.Status.PLANNED,
    )
    if not qs.exists():
        return 0
    tg_ids = set(
        qs.filter(transfer_group_id__isnull=False).values_list("transfer_group_id", flat=True)
    )
    account_ids = list(qs.values_list("account_id", flat=True).distinct())
    deleted, _ = qs.delete()
    for gid in tg_ids:
        if not Transaction.objects.filter(transfer_group_id=gid).exists():
            TransferGroup.objects.filter(pk=gid).delete()
    from timeline.services.balance_cache import get_active_balance_cache

    cache = get_active_balance_cache()
    if cache is not None:
        for aid in account_ids:
            if aid is not None:
                cache.note_transactions_deleted(aid, rule_id=rule_id, on_date=occurrence_date)
    return deleted


def heal_skipped_occurrence_planned_rows(
    *,
    household_ids: Iterable[int],
    start_date: date,
    end_date: date,
) -> int:
    """Self-heal orphan planned legs left after a skip/delete on the other transfer account."""
    from timeline.models import RecurringRuleSkip

    total = 0
    for rule_id, occ_date in RecurringRuleSkip.objects.filter(
        rule__household_id__in=household_ids,
        date__gte=start_date,
        date__lte=end_date,
    ).values_list("rule_id", "date"):
        total += purge_planned_rule_occurrence(rule_id, occ_date)
    return total


def _record_skip_for_occurrence(txn: Transaction) -> None:
    if txn.source == Transaction.Source.INTEREST:
        anchor = txn.interest_cycle_end_date or txn.date
        InterestCycleSkip.objects.get_or_create(
            account_id=txn.account_id,
            cycle_end_date=anchor,
        )
        return
    _record_rule_skip(txn)
    counterpart = _find_rule_counterpart(txn)
    if counterpart is not None and counterpart.rule_id is not None:
        RecurringRuleSkip.objects.get_or_create(
            rule_id=counterpart.rule_id,
            date=counterpart.date,
        )


def _sync_planned_fields_to_counterpart(
    txn: Transaction,
    *,
    date_value: date | None = None,
    status: str | None = None,
    cleared: bool | None = None,
) -> None:
    counterpart = _find_rule_counterpart(txn)
    if counterpart is None:
        return
    updates: dict = {}
    if date_value is not None:
        updates["date"] = date_value
    if status is not None:
        updates["status"] = status
    if cleared is not None:
        updates["cleared"] = cleared
    if updates:
        Transaction.objects.filter(pk=counterpart.pk).update(**updates)
    if txn.transfer_group_id and date_value is not None:
        TransferGroup.objects.filter(pk=txn.transfer_group_id).update(scheduled_date=date_value)


def _invalidate_household_cache(txn: Transaction) -> None:
    from common.services.cache import invalidate_financial_cache_for_household

    invalidate_financial_cache_for_household(txn.account.household_id)


def confirm_expected_transaction(txn: Transaction, *, user=None) -> Transaction:
    """
    Mark an Expected row as manually posted (non-Plaid primary workflow).

    Converts PLANNED → CLEARED while preserving rule/source metadata for audit.
    """
    reject_if_reconciled(txn, action="confirmed")
    if not is_expected_eligible(txn):
        raise ValueError("Only due, unconfirmed scheduled transactions can be confirmed.")

    with db_transaction.atomic():
        txn.status = Transaction.Status.CLEARED
        txn.cleared = True
        txn.save(update_fields=["status", "cleared", "updated_at"])
        _sync_planned_fields_to_counterpart(
            txn,
            status=Transaction.Status.CLEARED,
            cleared=True,
        )

    _invalidate_household_cache(txn)
    txn.refresh_from_db()
    return txn


def skip_scheduled_transaction(txn: Transaction, *, user=None) -> None:
    """
    Skip a scheduled occurrence — records RecurringRuleSkip and removes the planned row.

    Works for Expected (due) and Forecast (future) planned rows.
    """
    reject_if_reconciled(txn, action="skipped")
    if not is_planned_scheduled_eligible(txn):
        raise ValueError("Only unconfirmed scheduled transactions can be skipped.")

    rule_id = txn.rule_id
    occ_date = txn.date
    household_id = txn.account.household_id

    with db_transaction.atomic():
        _record_skip_for_occurrence(txn)
        delete_transaction_respecting_partner_ledger(txn)
        if rule_id is not None:
            purge_planned_rule_occurrence(rule_id, occ_date)

    from common.services.cache import invalidate_financial_cache_for_household

    invalidate_financial_cache_for_household(household_id)


def move_scheduled_date(txn: Transaction, new_date: date, *, user=None) -> Transaction:
    """
    Move a planned occurrence to a new date.

    Future dates keep PLANNED status (Forecast); today/past dates stay Expected-eligible.
    """
    reject_if_reconciled(txn, action="moved")
    if not is_planned_scheduled_eligible(txn):
        raise ValueError("Only unconfirmed scheduled transactions can be moved.")
    new_date = _coerce_date(new_date)
    old_date = txn.date
    if old_date == new_date:
        return txn

    today = _today()
    new_status = Transaction.Status.PLANNED if new_date > today else Transaction.Status.PLANNED
    new_cleared = False

    with db_transaction.atomic():
        if txn.rule_id is not None:
            RecurringRuleSkip.objects.get_or_create(rule_id=txn.rule_id, date=old_date)
            RecurringRuleSkip.objects.filter(rule_id=txn.rule_id, date=new_date).delete()

        txn.date = new_date
        txn.planned_date = new_date
        txn.status = new_status
        txn.cleared = new_cleared
        txn.save(update_fields=["date", "planned_date", "status", "cleared", "updated_at"])
        _sync_planned_fields_to_counterpart(
            txn,
            date_value=new_date,
            status=new_status,
            cleared=new_cleared,
        )

    _invalidate_household_cache(txn)
    txn.refresh_from_db()
    return txn


def match_expected_to_import(
    planned: Transaction,
    *,
    imported_id: int,
    user=None,
):
    """Resolve Expected row by linking to an unmatched Plaid import."""
    reject_if_reconciled(planned, action="matched")
    if not is_planned_scheduled_eligible(planned):
        raise ValueError("Only unconfirmed scheduled transactions can be matched.")
    return manual_match_transactions(
        planned_id=planned.pk,
        imported_id=imported_id,
        user=user,
    )
