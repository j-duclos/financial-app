"""Account relationship CRUD, autopay sync, and scheduled transfer generation."""
from __future__ import annotations

import calendar
from datetime import date, timedelta
from decimal import Decimal
from typing import Iterable

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from accounts.models import Account
from accounts.relationship_models import AccountRelationship
from transactions.models import Transaction, TransferGroup
from transactions.services.posting import create_transfer

RELATIONSHIP_NOTES_PREFIX = "relationship:"


def _household_user(household_id: int):
    from django.contrib.auth import get_user_model

    User = get_user_model()
    return User.objects.filter(household_memberships__household_id=household_id).first()


def _relationship_notes_tag(relationship_id: int) -> str:
    return f"{RELATIONSHIP_NOTES_PREFIX}{relationship_id}"


def _is_protected_transaction(txn: Transaction) -> bool:
    if txn.status != Transaction.Status.PLANNED:
        return True
    if txn.import_match_status == Transaction.ImportMatchStatus.MATCHED:
        return True
    if txn.cleared or txn.reconciled:
        return True
    return False


def _transfer_groups_for_relationship(relationship: AccountRelationship) -> TransferGroup:
    return TransferGroup.objects.filter(
        relationship_id=relationship.pk,
    ).exclude(status=TransferGroup.Status.CANCELED)


def _occurrence_dates(
    relationship: AccountRelationship,
    start_date: date,
    end_date: date,
) -> list[date]:
    """Yield scheduled dates in [start_date, end_date] based on frequency and default_day."""
    if not relationship.is_active:
        return []
    day = relationship.default_day
    freq = relationship.frequency
    out: list[date] = []

    if freq == AccountRelationship.Frequency.ONE_TIME:
        if day:
            try:
                d = date(start_date.year, start_date.month, min(day, 28))
            except ValueError:
                d = date(start_date.year, start_date.month, 28)
            if start_date <= d <= end_date:
                out.append(d)
        return out

    cur = start_date
    while cur <= end_date:
        if freq == AccountRelationship.Frequency.WEEKLY:
            out.append(cur)
            cur += timedelta(days=7)
            continue
        if freq == AccountRelationship.Frequency.BIWEEKLY:
            out.append(cur)
            cur += timedelta(days=14)
            continue
        if freq == AccountRelationship.Frequency.MONTHLY and day:
            last = calendar.monthrange(cur.year, cur.month)[1]
            d = date(cur.year, cur.month, min(day, last))
            if start_date <= d <= end_date:
                out.append(d)
            if cur.month == 12:
                cur = date(cur.year + 1, 1, 1)
            else:
                cur = date(cur.year, cur.month + 1, 1)
            continue
        if freq == AccountRelationship.Frequency.TWICE_MONTHLY and day:
            last = calendar.monthrange(cur.year, cur.month)[1]
            for dom in (min(day, last), min(15, last)):
                d = date(cur.year, cur.month, dom)
                if start_date <= d <= end_date:
                    out.append(d)
            if cur.month == 12:
                cur = date(cur.year + 1, 1, 1)
            else:
                cur = date(cur.year, cur.month + 1, 1)
            continue
        if freq == AccountRelationship.Frequency.QUARTERLY and day:
            for month_offset in (0, 3, 6, 9):
                m = cur.month + month_offset
                y = cur.year
                while m > 12:
                    m -= 12
                    y += 1
                last = calendar.monthrange(y, m)[1]
                d = date(y, m, min(day, last))
                if start_date <= d <= end_date:
                    out.append(d)
            cur = date(cur.year + 1, cur.month, 1)
            continue
        if freq == AccountRelationship.Frequency.YEARLY and day:
            last = calendar.monthrange(cur.year, cur.month)[1]
            d = date(cur.year, cur.month, min(day, last))
            if start_date <= d <= end_date:
                out.append(d)
            cur = date(cur.year + 1, cur.month, 1)
            continue
        break

    return sorted(set(out))


@transaction.atomic
def create_relationship(
    *,
    household_id: int,
    source_account_id: int,
    destination_account_id: int,
    relationship_type: str,
    default_amount: Decimal | None = None,
    default_day: int | None = None,
    frequency: str = AccountRelationship.Frequency.MONTHLY,
    is_active: bool = True,
    notes: str = "",
    user=None,
) -> AccountRelationship:
    source = Account.objects.select_related("household").get(pk=source_account_id)
    dest = Account.objects.get(pk=destination_account_id)
    rel = AccountRelationship(
        household_id=household_id or source.household_id,
        source_account=source,
        destination_account=dest,
        relationship_type=relationship_type,
        default_amount=default_amount,
        default_day=default_day,
        frequency=frequency,
        is_active=is_active,
        notes=notes or "",
    )
    rel.full_clean()
    rel.save()
    if user is None:
        user = _household_user(rel.household_id)
    if user and rel.is_active:
        sync_relationship_forecast_transactions(rel, user=user)
    return rel


@transaction.atomic
def update_relationship(
    relationship: AccountRelationship,
    *,
    user=None,
    **fields,
) -> AccountRelationship:
    for key, val in fields.items():
        if hasattr(relationship, key):
            setattr(relationship, key, val)
    relationship.full_clean()
    relationship.save()
    if user is None:
        user = _household_user(relationship.household_id)
    if user:
        sync_relationship_forecast_transactions(relationship, user=user)
    return relationship


@transaction.atomic
def deactivate_relationship(relationship: AccountRelationship) -> AccountRelationship:
    relationship.is_active = False
    relationship.save(update_fields=["is_active", "updated_at"])
    for tg in _transfer_groups_for_relationship(relationship).filter(
        status=TransferGroup.Status.PLANNED,
    ):
        txs = list(tg.transactions.all())
        if all(not _is_protected_transaction(t) for t in txs):
            for t in txs:
                t.delete()
            tg.delete()
    return relationship


def relationship_has_historical_transfers(relationship: AccountRelationship) -> bool:
    return _transfer_groups_for_relationship(relationship).exclude(
        status=TransferGroup.Status.PLANNED,
    ).exists()


@transaction.atomic
def sync_credit_card_payment_relationship(card: Account) -> AccountRelationship | None:
    """Keep credit_card_payment relationship in sync with autopay fields on the card."""
    if not card.is_credit_card():
        return None

    existing = AccountRelationship.objects.filter(
        destination_account=card,
        relationship_type__in=(
            AccountRelationship.RelationshipType.CREDIT_CARD_PAYMENT,
            AccountRelationship.RelationshipType.AUTOPAY,
        ),
        is_active=True,
    ).first()

    if not card.autopay_enabled or not card.autopay_account_id:
        if existing:
            deactivate_relationship(existing)
        return None

    from_acct = card.autopay_account
    if from_acct is None:
        return None

    amount = None
    at = card.autopay_type or ""
    if at in (Account.AutopayType.FIXED_AMOUNT, Account.AutopayType.CUSTOM_AMOUNT):
        amount = Decimal(str(card.autopay_fixed_amount or 0)) or None

    defaults = {
        "household_id": card.household_id,
        "source_account": from_acct,
        "relationship_type": AccountRelationship.RelationshipType.CREDIT_CARD_PAYMENT,
        "default_amount": amount,
        "default_day": card.get_payment_due_day(),
        "frequency": AccountRelationship.Frequency.MONTHLY,
        "is_active": True,
        "notes": "Synced from credit card autopay settings.",
    }

    if existing:
        for k, v in defaults.items():
            setattr(existing, k, v)
        existing.full_clean()
        existing.save()
        return existing

    return AccountRelationship.objects.create(
        destination_account=card,
        **defaults,
    )


@transaction.atomic
def generate_scheduled_transfers_for_relationship(
    relationship: AccountRelationship,
    start_date: date,
    end_date: date,
    *,
    user=None,
) -> list[TransferGroup]:
    """Create planned transfer groups for each occurrence in the date range."""
    if not relationship.is_active:
        return []
    src = relationship.source_account
    dst = relationship.destination_account
    if not src.participates_in_forecast() or not dst.participates_in_forecast():
        return []
    if relationship.default_amount is None or relationship.default_amount <= 0:
        if relationship.relationship_type not in (
            AccountRelationship.RelationshipType.CREDIT_CARD_PAYMENT,
            AccountRelationship.RelationshipType.AUTOPAY,
        ):
            return []

    if user is None:
        user = _household_user(relationship.household_id)
    if user is None:
        return []

    today = timezone.localdate()
    amount = relationship.default_amount
    if amount is None or amount <= 0:
        return []

    created: list[TransferGroup] = []
    for sched in _occurrence_dates(relationship, start_date, end_date):
        if sched <= today:
            continue
        if _transfer_groups_for_relationship(relationship).filter(
            scheduled_date=sched,
            status__in=(
                TransferGroup.Status.PLANNED,
                TransferGroup.Status.PARTIALLY_MATCHED,
                TransferGroup.Status.MATCHED,
                TransferGroup.Status.CLEARED,
            ),
        ).exists():
            continue
        xfer = create_transfer(
            user,
            from_account_id=relationship.source_account_id,
            to_account_id=relationship.destination_account_id,
            amount=amount,
            transfer_date=sched,
            memo=f"Scheduled {relationship.get_relationship_type_display()}",
            payee=f"Transfer to {relationship.destination_account.name}",
            relationship_id=relationship.pk,
        )
        tg = xfer.from_transaction.transfer_group
        if tg:
            tag = _relationship_notes_tag(relationship.pk)
            tg.notes = tag if not tg.notes else f"{tg.notes} {tag}"
            tg.relationship = relationship
            tg.save(update_fields=["notes", "relationship", "updated_at"])
            created.append(tg)
    return created


@transaction.atomic
def sync_relationship_forecast_transactions(
    relationship: AccountRelationship,
    *,
    window_days: int = 90,
    user=None,
) -> None:
    """
    Generate future planned transfers and update unmodified planned rows when config changes.
    Skips matched/cleared transactions.
    """
    if not relationship.is_active:
        deactivate_relationship(relationship)
        return

    if relationship.relationship_type in (
        AccountRelationship.RelationshipType.CREDIT_CARD_PAYMENT,
        AccountRelationship.RelationshipType.AUTOPAY,
    ):
        return

    if relationship.default_amount is None or relationship.default_amount <= 0:
        return

    today = timezone.localdate()
    end = today + timedelta(days=window_days)
    generate_scheduled_transfers_for_relationship(
        relationship, today + timedelta(days=1), end, user=user,
    )

    amount = relationship.default_amount
    for tg in _transfer_groups_for_relationship(relationship).filter(
        scheduled_date__gt=today,
        status=TransferGroup.Status.PLANNED,
    ):
        txs = list(tg.transactions.all())
        if any(_is_protected_transaction(t) for t in txs):
            continue
        if tg.amount != amount or tg.from_account_id != relationship.source_account_id:
            for t in txs:
                t.delete()
            tg.delete()
            continue
        if tg.to_account_id != relationship.destination_account_id:
            for t in txs:
                t.delete()
            tg.delete()

    generate_scheduled_transfers_for_relationship(
        relationship, today + timedelta(days=1), end, user=user,
    )


def active_relationships_for_accounts(
    account_ids: Iterable[int],
) -> list[AccountRelationship]:
    ids = list(account_ids)
    if not ids:
        return []
    return list(
        AccountRelationship.objects.filter(is_active=True).filter(
            Q(source_account_id__in=ids) | Q(destination_account_id__in=ids)
        )
    )
