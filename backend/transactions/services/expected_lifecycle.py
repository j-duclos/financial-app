"""Lifecycle actions for scheduled transactions: forecast → expected → actual / matched / skipped."""
from __future__ import annotations

from datetime import date, timedelta
from typing import TYPE_CHECKING, Iterable, Optional

from django.db import transaction as db_transaction
from django.db.models import Exists, OuterRef, Q
from django.utils import timezone

from timeline.models import InterestCycleSkip, RecurringRuleSkip

from ..models import MatchSuggestion, Transaction, TransactionMatch, Transfer, TransferGroup
from ..rule_transfer_pairs import find_rule_transfer_counterpart_txn
from .immutability import reject_if_reconciled
from .matching import (
    AMOUNT_TOLERANCE,
    SAME_ACCOUNT_DATE_WINDOW_DAYS,
    manual_match_transactions,
    score_candidate,
)

# Hard incompatibilities only. Description / merchant-family rejects are for
# automatic matching; this user action uses them to rank, not to hide a unique bank post.
_RESOLUTION_HARD_REJECTS = frozenset(
    {
        "different_account",
        "amount_mismatch",
        "plaid_id_mismatch",
        "date_outside_window",
    }
)
from .posting import delete_transaction_respecting_partner_ledger, get_transfer_group_sibling

if TYPE_CHECKING:
    pass


class ImportResolutionError(ValueError):
    """Automatic import resolution failed without mutating rows."""


class AmbiguousImportResolution(ImportResolutionError):
    """Multiple equally plausible bank imports; refuse to guess."""


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
    if counterpart is None and date_value is None:
        return
    updates: dict = {}
    if status is not None:
        updates["status"] = status
    if cleared is not None:
        updates["cleared"] = cleared
    if counterpart is not None and updates:
        Transaction.objects.filter(pk=counterpart.pk).update(**updates)
    if date_value is not None:
        from transactions.services.posting import sync_transfer_pair_date

        sync_transfer_pair_date(txn, date_value)


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
        from transactions.services.posting import sync_transfer_pair_date

        sync_transfer_pair_date(txn, new_date, lookup_date=old_date)
        _sync_planned_fields_to_counterpart(
            txn,
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


def has_bank_import_provenance(txn: Transaction) -> bool:
    """True when the row carries an immutable bank/import identifier."""
    if (txn.plaid_transaction_id or "").strip():
        return True
    if (txn.pending_transaction_id or "").strip():
        return True
    return txn.source == Transaction.Source.PLAID


def _rank_bank_imports_for_expected_resolution(
    planned: Transaction,
) -> list[tuple[Transaction, int]]:
    """
    Rank real bank records that could fulfill this planned occurrence.

    Does not require source=PLAID or UNMATCHED — materialized ACTUAL rows that still
    carry a bank id are eligible. Description/payee similarity is used only to rank.
    """
    if planned.amount is None:
        return []
    household_id = planned.account.household_id
    low = planned.date - timedelta(days=SAME_ACCOUNT_DATE_WINDOW_DAYS)
    high = planned.date + timedelta(days=SAME_ACCOUNT_DATE_WINDOW_DAYS)
    nearby = (
        Transaction.objects.filter(
            account_id=planned.account_id,
            account__household_id=household_id,
            date__gte=low,
            date__lte=high,
            scenario__isnull=True,
        )
        .exclude(pk=planned.pk)
        .exclude(
            import_match_status__in=[
                Transaction.ImportMatchStatus.DUPLICATE,
                Transaction.ImportMatchStatus.IGNORED,
            ]
        )
        .exclude(Exists(TransactionMatch.objects.filter(imported_transaction_id=OuterRef("pk"))))
        .exclude(Exists(TransactionMatch.objects.filter(planned_transaction_id=OuterRef("pk"))))
        .select_related("account")
    )
    ranked: list[tuple[Transaction, int]] = []
    for row in nearby:
        if not has_bank_import_provenance(row):
            continue
        if row.amount is None:
            continue
        if abs(row.amount - planned.amount) > AMOUNT_TOLERANCE:
            continue
        if (
            row.transfer_group_id
            and planned.transfer_group_id
            and row.transfer_group_id != planned.transfer_group_id
        ):
            continue
        sc, parts = score_candidate(row, planned)
        reject = parts.get("reject")
        if reject in _RESOLUTION_HARD_REJECTS:
            continue
        ranked.append((row, max(sc, 0)))
    ranked.sort(key=lambda item: (-item[1], item[0].pk))
    return ranked


def find_unique_bank_import_for_expected_resolution(planned: Transaction) -> Transaction:
    """
    Return the single bank import that can safely replace this planned row.

    Raises ImportResolutionError when none exist and AmbiguousImportResolution when
    two or more candidates share the top score.
    """
    ranked = _rank_bank_imports_for_expected_resolution(planned)
    if not ranked:
        raise ImportResolutionError(
            "No matching imported bank transaction was found for this scheduled item."
        )
    best_score = ranked[0][1]
    ties = [row for row, score in ranked if score == best_score]
    if len(ties) > 1:
        raise AmbiguousImportResolution(
            "Multiple imported bank transactions could match this scheduled item, "
            "so it was not changed."
        )
    return ranked[0][0]


def _migrate_planned_leg_transfer_to_imported(
    planned: Transaction,
    imported: Transaction,
) -> Transaction | None:
    """
    Move transfer/payment linkage from the planned leg onto the imported bank row.

    Does not delete the counterpart and does not mark the import DUPLICATE.
    """
    counterpart = get_transfer_group_sibling(planned)
    if counterpart is None:
        counterpart = _find_rule_counterpart(planned)

    from_xfer = Transfer.objects.filter(from_transaction_id=planned.pk).first()
    if from_xfer is not None:
        if counterpart is None:
            counterpart = from_xfer.to_transaction
        from_xfer.from_transaction = imported
        from_xfer.save(update_fields=["from_transaction_id"])
    to_xfer = Transfer.objects.filter(to_transaction_id=planned.pk).first()
    if to_xfer is not None:
        if counterpart is None:
            counterpart = to_xfer.from_transaction
        to_xfer.to_transaction = imported
        to_xfer.save(update_fields=["to_transaction_id"])

    if counterpart is not None and counterpart.pk in (planned.pk, imported.pk):
        counterpart = None
    return counterpart


def resolve_expected_as_imported(planned: Transaction, *, user=None) -> dict:
    """
    Replace a scheduled/planned duplicate with the already-imported bank record.

    The imported row stays the visible canonical ledger record. The planned
    occurrence is removed. For two-leg transfers / card payments, only the
    matching planned leg is removed; the counterpart is preserved and re-linked.
    """
    reject_if_reconciled(planned, action="matched")
    if user is not None:
        from core.utils import get_households_for_user

        if not get_households_for_user(user).filter(pk=planned.account.household_id).exists():
            raise ImportResolutionError("You do not have access to this transaction.")
    if not is_planned_scheduled_eligible(planned):
        raise ImportResolutionError(
            "Only unconfirmed scheduled transactions can be matched to an import."
        )

    imported = find_unique_bank_import_for_expected_resolution(planned)

    planned_id = planned.pk
    household_id = planned.account.household_id
    imported_id = imported.pk

    with db_transaction.atomic():
        planned = (
            Transaction.objects.select_for_update()
            .select_related("account")
            .get(pk=planned_id)
        )
        imported = (
            Transaction.objects.select_for_update()
            .select_related("account")
            .get(pk=imported_id)
        )
        reject_if_reconciled(planned, action="matched")
        if not is_planned_scheduled_eligible(planned):
            raise ImportResolutionError(
                "Only unconfirmed scheduled transactions can be matched to an import."
            )

        TransactionMatch.objects.filter(
            Q(planned_transaction_id=planned.pk)
            | Q(imported_transaction_id=planned.pk)
            | Q(planned_transaction_id=imported.pk)
            | Q(imported_transaction_id=imported.pk)
        ).delete()
        MatchSuggestion.objects.filter(
            Q(planned_transaction_id=planned.pk)
            | Q(imported_transaction_id=planned.pk)
            | Q(planned_transaction_id=imported.pk)
            | Q(imported_transaction_id=imported.pk)
        ).delete()

        counterpart = _migrate_planned_leg_transfer_to_imported(planned, imported)
        tg_id = planned.transfer_group_id or imported.transfer_group_id

        imported_updates: list[str] = []
        if planned.rule_id and not imported.rule_id:
            imported.rule_id = planned.rule_id
            imported_updates.append("rule_id")
        if imported.import_match_status != Transaction.ImportMatchStatus.MATCHED:
            imported.import_match_status = Transaction.ImportMatchStatus.MATCHED
            imported_updates.append("import_match_status")
        if tg_id and imported.transfer_group_id != tg_id:
            imported.transfer_group_id = tg_id
            imported_updates.append("transfer_group_id")
        if imported_updates:
            imported.save(update_fields=[*imported_updates, "updated_at"])

        # Delete only this planned leg. Never use skip/pair helpers that remove both legs.
        planned.delete()

        if tg_id:
            tg = TransferGroup.objects.filter(pk=tg_id).first()
            if tg is not None:
                from .matching import _refresh_transfer_group_status

                _refresh_transfer_group_status(tg)
                if not Transaction.objects.filter(transfer_group_id=tg.pk).exists():
                    tg.delete()

        db_transaction.on_commit(
            lambda hid=household_id: _invalidate_household_cache_id(hid)
        )

    return {
        "resolved": True,
        "imported_transaction_id": imported_id,
        "removed_planned_transaction_id": planned_id,
        "preserved_counterpart_transaction_id": counterpart.pk if counterpart is not None else None,
    }


def _invalidate_household_cache_id(household_id: int) -> None:
    from common.services.cache import invalidate_financial_cache_for_household

    invalidate_financial_cache_for_household(household_id)
