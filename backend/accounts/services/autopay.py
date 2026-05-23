"""Generate planned autopay transfers from credit card settings."""
from __future__ import annotations

from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from accounts.models import Account
from accounts.services.relationships import sync_credit_card_payment_relationship
from transactions.models import Transaction, Transfer, TransferGroup
from transactions.services.posting import create_transfer

AUTOPAY_MEMO = "Autopay (scheduled)"
AUTOPAY_PAYEE = "Credit card autopay"


def _autopay_amount(account: Account) -> Decimal | None:
    at = account.autopay_type or ""
    if at == Account.AutopayType.MINIMUM_PAYMENT:
        return Decimal(str(account.minimum_payment_amount or 0))
    if at == Account.AutopayType.STATEMENT_BALANCE:
        return Decimal(str(account.statement_balance or 0))
    if at == Account.AutopayType.CURRENT_BALANCE:
        return Decimal(str(account.current_balance or 0))
    if at in (Account.AutopayType.FIXED_AMOUNT, Account.AutopayType.CUSTOM_AMOUNT):
        return Decimal(str(account.autopay_fixed_amount or 0))
    return None


def _existing_autopay_transfer_group(account: Account) -> TransferGroup | None:
    """Find a planned autopay transfer group to this card (not yet cleared)."""
    return (
        TransferGroup.objects.filter(
            to_account=account,
            status__in=(
                TransferGroup.Status.PLANNED,
                TransferGroup.Status.PARTIALLY_MATCHED,
            ),
            notes__icontains="autopay",
        )
        .order_by("-scheduled_date")
        .first()
    )


def _cash_account_types() -> tuple[str, ...]:
    return (
        Account.AccountType.CHECKING,
        Account.AccountType.SAVINGS,
        Account.AccountType.CASH,
    )


@transaction.atomic
def sync_autopay_for_account(account: Account, user=None) -> TransferGroup | None:
    """
    Create or update a planned transfer from autopay_account → credit card.
    Removes stale planned autopay when disabled or misconfigured.
    """
    if not account.is_credit_card():
        return None

    existing = _existing_autopay_transfer_group(account)

    rel = sync_credit_card_payment_relationship(account)

    if not account.autopay_enabled or not account.autopay_account_id:
        if existing and existing.status == TransferGroup.Status.PLANNED:
            Transaction.objects.filter(transfer_group=existing).delete()
            existing.delete()
        return None

    from_acct = account.autopay_account
    if from_acct is None or from_acct.account_type not in _cash_account_types():
        return None
    if from_acct.pk == account.pk:
        return None

    pay_date = account.next_payment_due_date
    if pay_date is None:
        return None

    amount = _autopay_amount(account)
    if amount is None or amount <= 0:
        if existing and existing.status == TransferGroup.Status.PLANNED:
            Transaction.objects.filter(transfer_group=existing).delete()
            existing.delete()
        return None

    if existing:
        if (
            existing.from_account_id == from_acct.pk
            and existing.scheduled_date == pay_date
            and existing.amount == amount
        ):
            return existing
        if existing.status == TransferGroup.Status.PLANNED:
            Transaction.objects.filter(transfer_group=existing).delete()
            existing.delete()

    today = timezone.localdate()
    if pay_date <= today:
        return None

    if user is None:
        from django.contrib.auth import get_user_model

        User = get_user_model()
        user = User.objects.filter(
            household_memberships__household_id=account.household_id
        ).first()
    if user is None:
        return None

    rel_id = rel.pk if rel else None
    xfer = create_transfer(
        user,
        from_account_id=from_acct.pk,
        to_account_id=account.pk,
        amount=amount,
        transfer_date=pay_date,
        memo=AUTOPAY_MEMO,
        payee=AUTOPAY_PAYEE,
        relationship_id=rel_id,
    )
    tg = xfer.from_transaction.transfer_group
    if tg:
        tg.notes = "autopay"
        if rel_id:
            tg.relationship_id = rel_id
        tg.save(update_fields=["notes", "relationship", "updated_at"])
    return tg
