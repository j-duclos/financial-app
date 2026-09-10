"""Canonical transfer balance preview — no persistence.

Before/after balances come from the same Pending → Upcoming ledger walk
Transactions uses (``canonical_projected_balance_before_occurrence``). This
module does not reconstruct projected balances from starting_balance + DB rows
+ a separate 90-day timeline.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any

from django.utils import timezone

from accounts.models import Account
from accounts.services.balances import credit_owed_from_signed_balance
from core.utils import get_households_for_user
from timeline.services.canonical_timeline_cache import get_or_build_canonical_forecast_timeline
from timeline.services.ledger_section_balances import canonical_projected_balance_before_occurrence
from transactions.models import Transaction


def _decimal(val: Any) -> Decimal:
    if val is None:
        return Decimal("0")
    if isinstance(val, Decimal):
        return val
    return Decimal(str(val))


def _fmt(val: Decimal | None) -> str | None:
    if val is None:
        return None
    return str(val.quantize(Decimal("0.01")))


def _expand_exclude_to_transfer_group_legs(exclude_transaction_ids: list[int]) -> list[int]:
    """Exclude both legs of the edited transfer group — not similar descriptions."""
    ids = {int(i) for i in exclude_transaction_ids if i is not None}
    if not ids:
        return []
    group_ids = [
        g
        for g in Transaction.objects.filter(pk__in=ids).values_list("transfer_group_id", flat=True)
        if g is not None
    ]
    if group_ids:
        ids.update(
            Transaction.objects.filter(transfer_group_id__in=group_ids).values_list("pk", flat=True)
        )
    return sorted(ids)


def _sort_txn_id_for_account(exclude_ids: list[int], account_id: int) -> int | None:
    if not exclude_ids:
        return None
    return (
        Transaction.objects.filter(pk__in=exclude_ids, account_id=account_id)
        .order_by("id")
        .values_list("pk", flat=True)
        .first()
    )


def preview_transfer_balances(
    user,
    *,
    from_account_id: int,
    to_account_id: int | None,
    amount: Decimal,
    transfer_date: date,
    exclude_transaction_ids: list[int] | None = None,
) -> dict[str, Any]:
    """
    Preview signed balances before/after a hypothetical transfer on transfer_date.

    Uses the canonical Transactions forecast timeline and ledger walk. Does not persist.
    For edits, pass exclude_transaction_ids for the existing pair; both transfer-group
    legs are omitted so the transfer does not count itself.
    """
    amt = abs(_decimal(amount)).quantize(Decimal("0.01"))
    if amt < 0:
        raise ValueError("Amount must be zero or greater")

    households = get_households_for_user(user)
    from_acc = Account.objects.filter(pk=from_account_id, household__in=households).first()
    if not from_acc:
        raise ValueError("Source account not found")

    to_acc: Account | None = None
    if to_account_id is not None:
        to_acc = Account.objects.filter(pk=to_account_id, household__in=households).first()
        if not to_acc:
            raise ValueError("Destination account not found")
        if from_acc.household_id != to_acc.household_id:
            raise ValueError("Accounts must belong to the same household")
        if from_account_id == to_account_id:
            raise ValueError("From and to accounts must differ")

    today = timezone.localdate()
    forecast_days = max(30, (transfer_date - today).days + 1)
    exclude = _expand_exclude_to_transfer_group_legs(list(exclude_transaction_ids or []))

    rows, _hit = get_or_build_canonical_forecast_timeline(
        user,
        today=today,
        forecast_days=forecast_days,
        household_id=from_acc.household_id,
        caller="transfer_balance_preview",
    )

    source_before = canonical_projected_balance_before_occurrence(
        rows,
        account_id=from_acc.pk,
        today=today,
        on_date=transfer_date,
        exclude_transaction_ids=exclude,
        sort_transaction_id=_sort_txn_id_for_account(exclude, from_acc.pk),
    )
    source_after = source_before if amt == 0 else (source_before - amt).quantize(Decimal("0.01"))

    dest_before: Decimal | None = None
    dest_after: Decimal | None = None
    if to_acc is not None:
        dest_before = canonical_projected_balance_before_occurrence(
            rows,
            account_id=to_acc.pk,
            today=today,
            on_date=transfer_date,
            exclude_transaction_ids=exclude,
            sort_transaction_id=_sort_txn_id_for_account(exclude, to_acc.pk),
        )
        dest_after = dest_before if amt == 0 else (dest_before + amt).quantize(Decimal("0.01"))

    result: dict[str, Any] = {
        "from_account_id": from_account_id,
        "to_account_id": to_account_id,
        "amount": str(amt),
        "transfer_date": transfer_date.isoformat(),
        "source_balance_before": _fmt(source_before),
        "source_balance_after": _fmt(source_after),
    }

    if to_acc is not None and dest_before is not None and dest_after is not None:
        result["destination_balance_before"] = _fmt(dest_before)
        result["destination_balance_after"] = _fmt(dest_after)
        if to_acc.account_type == Account.AccountType.CREDIT:
            result["destination_balance_owed_before"] = _fmt(
                credit_owed_from_signed_balance(dest_before)
            )
            result["destination_balance_owed_after"] = _fmt(
                credit_owed_from_signed_balance(dest_after)
            )

    return result
