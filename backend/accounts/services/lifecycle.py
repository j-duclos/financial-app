"""Account lifecycle: archive, close, soft delete, restore."""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from accounts.models import Account
from accounts.relationship_models import AccountRelationship
from accounts.services.relationships import active_relationships_for_accounts, deactivate_relationship
from core.models import UserProfile
from timeline.models import RecurringRule, ScenarioRuleOverride
from timeline.services.ledger import build_timeline, generate_rule_occurrences
from transactions.models import TransferGroup


def _account_balance(account: Account) -> Decimal:
    from django.db.models import Sum
    from django.db.models.functions import Coalesce
    from transactions.models import Transaction

    tx_sum = (
        Transaction.objects.filter(account=account).aggregate(
            s=Coalesce(Sum("amount"), Decimal("0"))
        )["s"]
        or Decimal("0")
    )
    start = account.starting_balance or Decimal("0")
    return start + tx_sum


def _future_recurring_count(account: Account, user) -> int:
    today = timezone.localdate()
    end = today.replace(year=today.year + 1) if today.month < 12 else today.replace(
        year=today.year + 1, month=1, day=today.day
    )
    count = 0
    rules = RecurringRule.objects.filter(
        household_id=account.household_id, active=True
    ).filter(Q(account_id=account.pk) | Q(transfer_to_account_id=account.pk))
    for rule in rules:
        occ = generate_rule_occurrences(rule, today, end)
        count += sum(1 for d in occ if d > today)
    return count


def _future_planned_transfer_count(account: Account) -> int:
    today = timezone.localdate()
    return (
        TransferGroup.objects.filter(
            scheduled_date__gt=today,
            status=TransferGroup.Status.PLANNED,
        )
        .filter(Q(from_account_id=account.pk) | Q(to_account_id=account.pk))
        .count()
    )


def _has_plaid_link(account: Account) -> bool:
    return hasattr(account, "plaid_link") and account.plaid_link is not None


def lifecycle_preflight(account: Account, user, *, action: str) -> dict[str, Any]:
    """Warnings shown before archive / close / delete."""
    today = timezone.localdate()
    balance = _account_balance(account)
    warnings: list[str] = []

    recurring = _future_recurring_count(account, user)
    if recurring:
        warnings.append(
            f"This account has {recurring} future scheduled recurring payment"
            f"{'' if recurring == 1 else 's'}."
        )

    transfers = _future_planned_transfer_count(account)
    if transfers:
        warnings.append(
            f"This account has {transfers} upcoming planned transfer"
            f"{'' if transfers == 1 else 's'}."
        )

    rels = active_relationships_for_accounts([account.pk])
    if rels:
        warnings.append(
            f"{len(rels)} active account relationship"
            f"{'' if len(rels) == 1 else 's'} will be deactivated."
        )

    if balance != 0:
        warnings.append(f"Current ledger balance is {balance} (non-zero).")

    if _has_plaid_link(account) and account.plaid_sync_enabled:
        warnings.append("Plaid sync is enabled for this account.")

    if action == "close":
        warnings.append("Closing will stop future recurring and transfer generation.")
    elif action == "archive":
        warnings.append("Archiving hides this account from active views and stops forecasting.")
    elif action == "delete":
        warnings.append(
            "Deleting permanently removes this account, its transactions, recurring rules, and statement lines."
        )

    future_payments = 0
    try:
        rows = build_timeline(
            user,
            start_date=today,
            end_date=today.replace(year=today.year + 1),
            account_id=account.pk,
            projection_only=True,
            caller="account_lifecycle",
        )
        future_payments = sum(
            1
            for r in rows
            if r.get("account_id") == account.pk
            and r.get("date")
            and r["date"] > today
            and r.get("amount")
            and Decimal(str(r["amount"])) < 0
        )
    except Exception:
        pass
    if future_payments:
        warnings.append(
            f"Forecast shows {future_payments} upcoming outflow"
            f"{'' if future_payments == 1 else 's'} on this account."
        )

    return {
        "action": action,
        "account_id": account.pk,
        "balance": str(balance),
        "non_zero_balance": balance != 0,
        "future_recurring_count": recurring,
        "future_transfer_count": transfers,
        "active_relationship_count": len(rels),
        "plaid_linked": _has_plaid_link(account),
        "plaid_sync_enabled": account.plaid_sync_enabled,
        "warnings": warnings,
    }


def _deactivate_relationships(account: Account) -> int:
    count = 0
    for rel in active_relationships_for_accounts([account.pk]):
        deactivate_relationship(rel)
        count += 1
    return count


def _cancel_future_planned_transfers(account: Account) -> int:
    today = timezone.localdate()
    groups = TransferGroup.objects.filter(
        scheduled_date__gt=today,
        status=TransferGroup.Status.PLANNED,
    ).filter(Q(from_account_id=account.pk) | Q(to_account_id=account.pk))
    n = 0
    for tg in groups:
        tg.status = TransferGroup.Status.CANCELED
        tg.save(update_fields=["status", "updated_at"])
        n += 1
    return n


@transaction.atomic
def archive_account(
    account: Account,
    *,
    reason: str = "",
    preserve_recurring: bool = False,
) -> Account:
    now = timezone.now()
    account.status = Account.Status.ARCHIVED
    account.archived_at = now
    account.archived = True
    account.is_active = False
    account.is_hidden = False
    account.include_in_forecast = False
    account.plaid_sync_enabled = False
    account.archive_reason = (reason or "")[:255]
    account.save()
    _deactivate_relationships(account)
    if not preserve_recurring:
        _cancel_future_planned_transfers(account)
    return account


@transaction.atomic
def close_account(
    account: Account,
    *,
    closed_at: date | None = None,
    reason: str = "",
    force: bool = False,
) -> Account:
    close_date = closed_at or timezone.localdate()
    balance = _account_balance(account)
    if balance != 0 and not force:
        raise ValueError(
            f"Account balance is {balance}. Pass force=true to close anyway."
        )
    account.status = Account.Status.CLOSED
    account.closed_at = close_date
    account.archived = False
    account.is_active = False
    account.is_hidden = False
    account.include_in_forecast = False
    account.plaid_sync_enabled = False
    account.close_reason = (reason or "")[:255]
    account.save()
    _deactivate_relationships(account)
    _cancel_future_planned_transfers(account)
    return account


@transaction.atomic
def _clear_account_references(account: Account) -> None:
    """Detach FK pointers without deleting historical rows."""
    UserProfile.objects.filter(default_account=account).update(default_account=None)
    ScenarioRuleOverride.objects.filter(override_account=account).update(override_account=None)
    RecurringRule.objects.filter(transfer_to_account=account).update(transfer_to_account=None)


def soft_delete_account(account: Account) -> Account:
    now = timezone.now()
    _clear_account_references(account)
    account.status = Account.Status.DELETED
    account.deleted_at = now
    account.archived = False
    account.is_active = False
    account.is_hidden = True
    account.include_in_forecast = False
    account.plaid_sync_enabled = False
    account.save()
    _deactivate_relationships(account)
    _cancel_future_planned_transfers(account)
    return account


@transaction.atomic
def restore_account(
    account: Account,
    *,
    target_status: str | None = None,
    reenable_plaid: bool = False,
    reenable_forecast: bool = True,
) -> Account:
    """Restore archived, closed, or deleted account to active (or archived)."""
    if target_status is None:
        target_status = Account.Status.ACTIVE
    if target_status not in (
        Account.Status.ACTIVE,
        Account.Status.ARCHIVED,
    ):
        raise ValueError("target_status must be active or archived")

    account.status = target_status
    account.deleted_at = None
    account.is_hidden = False

    if target_status == Account.Status.ACTIVE:
        account.archived = False
        account.archived_at = None
        account.closed_at = None
        account.is_active = True
        account.include_in_forecast = reenable_forecast
        account.plaid_sync_enabled = reenable_plaid or _has_plaid_link(account)
    else:
        account.archived = True
        account.archived_at = account.archived_at or timezone.now()
        account.is_active = False
        account.include_in_forecast = False
        account.plaid_sync_enabled = False

    account.save()
    return account
