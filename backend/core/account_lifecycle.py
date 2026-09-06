"""User data export and safe account deletion.

Ownership assumptions (enforced here and covered by tests):

* Ledger data (accounts, transactions, rules, goals, categories, budgets,
  scenarios, Plaid Items) belongs to a Household, not a User.
* HouseholdMembership is the authorization boundary. Export includes data
  for households the user belongs to — the same access as the rest of the app.
* A household may have multiple members (OWNER / MEMBER). There is no
  created_by on PlaidItem; Items are household-owned.
* CASE A: user is the only member → household (and its data) is deleted after
  exclusive Plaid revocation.
* CASE B: user is not the sole remaining owner → membership is removed;
  household data stays.
* CASE C: user is the sole OWNER and other members remain → deletion is
  blocked until ownership is transferred. We do not auto-promote members.

Stripe: cancel the live subscription immediately. Do not delete the Stripe
Customer (Stripe retains payment records). Local BillingSubscription is
removed with the User (CASCADE).

Plaid: revoke via /item/remove only for Items on households that will be
deleted (exclusive). Shared-household Items are left intact.

In-memory JSON export is used for expected household sizes. Backups and
Stripe/Plaid vendor logs are not erased by this process.
"""
from __future__ import annotations

import csv
import io
import json
import logging
from datetime import date, datetime
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.serializers.json import DjangoJSONEncoder
from django.db import transaction
from django.utils import timezone

from core.email_identity import is_email_verified, normalize_email
from core.models import Household, HouseholdMembership
from core.utils import get_households_for_user, get_user_profile

logger = logging.getLogger(__name__)

User = get_user_model()

EXPORT_VERSION = 1
DELETE_CONFIRMATION_PHRASE = "DELETE"
OWNER_TRANSFER_CODE = "household_owner_transfer_required"
EMAIL_VERIFICATION_CODE = "email_verification_required"


class AccountDeletionBlocked(Exception):
    def __init__(self, reasons: list[dict]):
        self.reasons = reasons
        super().__init__("Account deletion is blocked.")


class AccountDeletionError(Exception):
    def __init__(self, detail: str, code: str = "deletion_failed"):
        self.detail = detail
        self.code = code
        super().__init__(detail)


def _jsonable(value):
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return value


def export_filename(when=None) -> str:
    stamp = timezone.localdate() if when is None else when
    if hasattr(stamp, "date"):
        stamp = stamp.date()
    return f"financial-app-export-{stamp.isoformat()}.json"


def csv_filename(when=None) -> str:
    stamp = timezone.localdate() if when is None else when
    if hasattr(stamp, "date"):
        stamp = stamp.date()
    return f"financial-app-transactions-{stamp.isoformat()}.csv"


def sanitize_csv_cell(value) -> str:
    text = "" if value is None else str(value)
    if text[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return f"'{text}"
    return text


def _household_ids_for_user(user) -> list[int]:
    return list(get_households_for_user(user).values_list("id", flat=True))


def _serialize_user(user) -> dict:
    profile = get_user_profile(user)
    return {
        "id": user.pk,
        "username": user.username,
        "email": user.email or "",
        "email_verified": is_email_verified(user),
        "display_name": getattr(profile, "display_name", "") or "",
        "date_joined": _jsonable(getattr(user, "date_joined", None)),
    }


def _serialize_billing(user) -> dict:
    from billing.services import get_or_create_billing_subscription, subscription_grants_premium

    billing = get_or_create_billing_subscription(user)
    return {
        "plan": "PREMIUM" if subscription_grants_premium(billing) else "FREE",
        "status": billing.status,
        "cancel_at_period_end": bool(billing.cancel_at_period_end),
        "current_period_end": _jsonable(billing.current_period_end),
    }


def export_user_data(user) -> dict:
    """Portable JSON payload of household data the user is authorized to access.

    Does not include password hashes, JWTs, Stripe secrets/IDs, Plaid access
    tokens or ciphertext, or Django secret keys. Stripe customer/subscription
    IDs are omitted (no user-portability need). Plaid institution names are
    included; Item access tokens are not.
    """
    from accounts.models import Account
    from budgets.models import Budget, SpendingTarget
    from categories.models import Category
    from goals.models import GoalBucket
    from timeline.models import RecurringRule, Scenario
    from transactions.models import Transaction

    households = list(get_households_for_user(user).order_by("id"))
    hh_ids = [h.pk for h in households]
    accounts = list(
        Account.objects.filter(household_id__in=hh_ids).order_by("id")
    )
    account_ids = [a.pk for a in accounts]
    account_name = {a.pk: a.name for a in accounts}
    categories = list(Category.objects.filter(household_id__in=hh_ids).order_by("id"))
    category_name = {c.pk: c.name for c in categories}

    transactions = Transaction.objects.filter(account_id__in=account_ids).order_by("date", "id")
    txn_rows = []
    for txn in transactions.iterator(chunk_size=2000):
        txn_rows.append(
            {
                "id": txn.pk,
                "account_id": txn.account_id,
                "account": account_name.get(txn.account_id, ""),
                "date": _jsonable(txn.date),
                "payee": txn.payee,
                "memo": txn.memo,
                "amount": _jsonable(txn.amount),
                "status": txn.status,
                "source": txn.source,
                "cleared": txn.cleared,
                "reconciled": txn.reconciled,
                "category_id": txn.category_id,
                "category": category_name.get(txn.category_id, "") if txn.category_id else "",
                "imported_description": txn.imported_description,
                "is_pending": txn.is_pending,
                "import_match_status": txn.import_match_status,
            }
        )

    return {
        "export_version": EXPORT_VERSION,
        "generated_at": timezone.now().isoformat(),
        "notes": (
            "This file contains financial data for households your account can access. "
            "Shared household data may include records created by other members."
        ),
        "user": _serialize_user(user),
        "households": [{"id": h.pk, "name": h.name} for h in households],
        "accounts": [
            {
                "id": a.pk,
                "household_id": a.household_id,
                "name": a.name,
                "display_name": a.display_name,
                "account_type": a.account_type,
                "role": a.role,
                "status": a.status,
                "currency": a.currency,
                "starting_balance": _jsonable(a.starting_balance),
                "current_balance": _jsonable(a.current_balance),
            }
            for a in accounts
        ],
        "transactions": txn_rows,
        "recurring_rules": [
            {
                "id": r.pk,
                "household_id": r.household_id,
                "name": r.name,
                "account_id": r.account_id,
                "direction": r.direction,
                "amount": _jsonable(r.amount),
                "frequency": r.frequency,
                "active": r.active,
                "start_date": _jsonable(r.start_date),
                "end_date": _jsonable(r.end_date),
                "notes": r.notes or "",
            }
            for r in RecurringRule.objects.filter(household_id__in=hh_ids).order_by("id")
        ],
        "goals": [
            {
                "id": g.pk,
                "household_id": g.household_id,
                "name": g.name,
                "type": g.type,
                "status": g.status,
                "target_amount": _jsonable(g.target_amount),
                "allocated_amount": _jsonable(g.allocated_amount),
                "target_date": _jsonable(g.target_date),
                "linked_account_id": g.linked_account_id,
            }
            for g in GoalBucket.objects.filter(household_id__in=hh_ids).order_by("id")
        ],
        "categories": [
            {
                "id": c.pk,
                "household_id": c.household_id,
                "name": c.name,
                "category_type": c.category_type,
                "parent_id": c.parent_id,
            }
            for c in categories
        ],
        "budgets": [
            {
                "id": b.pk,
                "household_id": b.household_id,
                "category_id": b.category_id,
                "year": b.year,
                "month": b.month,
                "planned_amount": _jsonable(b.planned_amount),
            }
            for b in Budget.objects.filter(household_id__in=hh_ids).order_by("id")
        ],
        "spending_targets": [
            {
                "id": t.pk,
                "household_id": t.household_id,
                "name": t.name,
                "category_id": t.category_id,
                "target_amount": _jsonable(t.target_amount),
                "period": t.period,
            }
            for t in SpendingTarget.objects.filter(household_id__in=hh_ids).order_by("id")
        ],
        "scenarios": [
            {
                "id": s.pk,
                "household_id": s.household_id,
                "name": s.name,
                "description": s.description,
                "template": s.template,
            }
            for s in Scenario.objects.filter(household_id__in=hh_ids).order_by("id")
        ],
        "billing": _serialize_billing(user),
    }


def export_user_data_json_bytes(user) -> tuple[bytes, str]:
    payload = export_user_data(user)
    body = json.dumps(payload, cls=DjangoJSONEncoder, indent=2).encode("utf-8")
    return body, export_filename()


def iter_export_transactions(user):
    from accounts.models import Account
    from transactions.models import Transaction

    hh_ids = _household_ids_for_user(user)
    accounts = {
        a.pk: a
        for a in Account.objects.filter(household_id__in=hh_ids).only("id", "name")
    }
    qs = (
        Transaction.objects.filter(account_id__in=accounts.keys())
        .select_related("category")
        .order_by("date", "id")
    )
    for txn in qs.iterator(chunk_size=2000):
        yield {
            "date": txn.date.isoformat() if txn.date else "",
            "account": accounts[txn.account_id].name,
            "payee": txn.payee,
            "amount": str(txn.amount),
            "category": txn.category.name if txn.category_id else "",
            "status": txn.status,
            "source": txn.source,
            "notes": txn.memo or "",
        }


def export_transactions_csv_bytes(user) -> tuple[bytes, str]:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["date", "account", "payee", "amount", "category", "status", "source", "notes"])
    for row in iter_export_transactions(user):
        writer.writerow(
            [
                sanitize_csv_cell(row["date"]),
                sanitize_csv_cell(row["account"]),
                sanitize_csv_cell(row["payee"]),
                sanitize_csv_cell(row["amount"]),
                sanitize_csv_cell(row["category"]),
                sanitize_csv_cell(row["status"]),
                sanitize_csv_cell(row["source"]),
                sanitize_csv_cell(row["notes"]),
            ]
        )
    return buffer.getvalue().encode("utf-8"), csv_filename()


def _household_snapshot(membership: HouseholdMembership) -> dict:
    household = membership.household
    members = list(HouseholdMembership.objects.filter(household=household))
    owners = [m for m in members if m.role == HouseholdMembership.Role.OWNER]
    return {
        "household_id": household.pk,
        "household_name": household.name,
        "user_role": membership.role,
        "member_count": len(members),
        "owner_count": len(owners),
        "exclusive": len(members) == 1,
        "sole_owner_with_other_members": (
            membership.role == HouseholdMembership.Role.OWNER
            and len(owners) == 1
            and owners[0].user_id == membership.user_id
            and len(members) > 1
        ),
    }


def build_deletion_preflight(user) -> dict:
    from billing.services import get_or_create_billing_subscription, subscription_grants_premium

    memberships = HouseholdMembership.objects.select_related("household").filter(user=user)
    snapshots = [_household_snapshot(m) for m in memberships]
    blocking = []
    for snap in snapshots:
        if snap["sole_owner_with_other_members"]:
            blocking.append(
                {
                    "code": OWNER_TRANSFER_CODE,
                    "household_id": snap["household_id"],
                    "household_name": snap["household_name"],
                }
            )
    has_email = bool(normalize_email(getattr(user, "email", "")))
    email_ok = (not has_email) or is_email_verified(user)
    if has_email and not email_ok:
        blocking.append(
            {
                "code": EMAIL_VERIFICATION_CODE,
                "detail": "Verify your email before deleting your account.",
            }
        )
    billing = get_or_create_billing_subscription(user)
    return {
        "can_delete": len(blocking) == 0,
        "blocking_reasons": blocking,
        "active_subscription": subscription_grants_premium(billing),
        "has_email": has_email,
        "email_verified": is_email_verified(user),
        "households": snapshots,
    }


def validate_household_deletion(user) -> list[dict]:
    preflight = build_deletion_preflight(user)
    ownership_blocks = [r for r in preflight["blocking_reasons"] if r.get("code") == OWNER_TRANSFER_CODE]
    if ownership_blocks:
        raise AccountDeletionBlocked(ownership_blocks)
    return preflight["households"]


def cancel_user_billing(user) -> None:
    """Cancel a live Stripe subscription immediately. Does not delete the Customer.

    Stripe keeps its own payment records. Local billing rows are removed later
    with the User. If Stripe cancellation fails, the local account is left intact.
    """
    from billing.exceptions import BillingConfigurationError
    from billing.services import (
        get_or_create_billing_subscription,
        subscription_grants_premium,
        downgrade_to_free,
    )
    from billing.stripe_api import cancel_subscription, list_subscriptions

    billing = get_or_create_billing_subscription(user)
    sub_id = (billing.stripe_subscription_id or "").strip()
    needs_remote = bool(sub_id) or subscription_grants_premium(billing)
    if not needs_remote:
        return
    try:
        if sub_id:
            cancel_subscription(sub_id)
        elif billing.stripe_customer_id:
            listed = list_subscriptions(customer=billing.stripe_customer_id, limit=10)
            data = listed.get("data") if isinstance(listed, dict) else getattr(listed, "data", []) or []
            canceled_any = False
            for sub in data:
                status = (sub.get("status") if isinstance(sub, dict) else getattr(sub, "status", "")) or ""
                sid = sub.get("id") if isinstance(sub, dict) else getattr(sub, "id", None)
                if status.lower() in ("active", "trialing") and sid:
                    cancel_subscription(str(sid))
                    canceled_any = True
            if subscription_grants_premium(billing) and not canceled_any and not sub_id:
                raise AccountDeletionError(
                    "We couldn't find a Stripe subscription to cancel. Your account was not deleted.",
                    code="stripe_cancellation_failed",
                )
        elif subscription_grants_premium(billing):
            raise AccountDeletionError(
                "Your subscription cannot be canceled automatically right now. Your account was not deleted.",
                code="stripe_cancellation_failed",
            )
    except AccountDeletionError:
        raise
    except BillingConfigurationError as exc:
        logger.warning("Stripe not configured during account deletion user_id=%s", user.pk)
        raise AccountDeletionError(
            "Billing cannot be canceled right now. Your account was not deleted.",
            code="stripe_cancellation_failed",
        ) from exc
    except Exception as exc:
        logger.exception("Stripe subscription cancel failed user_id=%s", user.pk)
        raise AccountDeletionError(
            "We couldn't cancel your subscription. Your account was not deleted. Please try again.",
            code="stripe_cancellation_failed",
        ) from exc
    downgrade_to_free(billing, status="canceled")


def _plaid_error_code(exc) -> str:
    raw = getattr(exc, "body", None)
    if isinstance(raw, (bytes, bytearray)):
        raw = raw.decode("utf-8", errors="replace")
    if not isinstance(raw, str) or not raw.strip():
        return ""
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return ""
    return str(parsed.get("error_code") or "")


def _revoke_plaid_item_or_raise(plaid_item) -> None:
    from plaid import ApiException
    from plaid.model.item_remove_request import ItemRemoveRequest
    from plaid_link.crypto import PlaidTokenDecryptError, decrypt_plaid_access_token
    from plaid_link.plaid_api_client import get_plaid_client

    try:
        client = get_plaid_client()
        token = decrypt_plaid_access_token(plaid_item.access_token_cipher)
        client.item_remove(ItemRemoveRequest(access_token=token))
    except PlaidTokenDecryptError as exc:
        logger.exception("Plaid token decrypt failed item_id=%s household_id=%s", plaid_item.pk, plaid_item.household_id)
        raise AccountDeletionError(
            "We couldn't revoke a linked-bank connection. Your account was not deleted.",
            code="plaid_revocation_failed",
        ) from exc
    except ApiException as exc:
        if _plaid_error_code(exc) in ("ITEM_NOT_FOUND", "ITEM_NOT_FOUND_ERROR"):
            return
        logger.exception("Plaid item/remove failed item_id=%s household_id=%s", plaid_item.pk, plaid_item.household_id)
        raise AccountDeletionError(
            "We couldn't revoke a linked-bank connection. Your account was not deleted.",
            code="plaid_revocation_failed",
        ) from exc
    except Exception as exc:
        logger.exception("Plaid item/remove failed item_id=%s household_id=%s", plaid_item.pk, plaid_item.household_id)
        raise AccountDeletionError(
            "We couldn't revoke a linked-bank connection. Your account was not deleted.",
            code="plaid_revocation_failed",
        ) from exc


def revoke_exclusive_plaid_items(user, exclusive_household_ids: list[int]) -> None:
    from plaid_link.models import PlaidItem

    if not exclusive_household_ids:
        return
    items = list(PlaidItem.objects.filter(household_id__in=exclusive_household_ids))
    for item in items:
        _revoke_plaid_item_or_raise(item)


def _exclusive_household_ids(snapshots: list[dict]) -> list[int]:
    return [s["household_id"] for s in snapshots if s.get("exclusive")]


def delete_user_account(user, *, current_password: str, confirmation: str) -> None:
    if (confirmation or "").strip() != DELETE_CONFIRMATION_PHRASE:
        raise AccountDeletionError(
            'Type DELETE to confirm account deletion.',
            code="confirmation_required",
        )
    if not user.check_password(current_password):
        raise AccountDeletionError(
            "Current password is incorrect.",
            code="incorrect_password",
        )
    preflight = build_deletion_preflight(user)
    if not preflight["can_delete"]:
        email_block = next(
            (r for r in preflight["blocking_reasons"] if r.get("code") == EMAIL_VERIFICATION_CODE),
            None,
        )
        if email_block and not any(r.get("code") == OWNER_TRANSFER_CODE for r in preflight["blocking_reasons"]):
            raise AccountDeletionError(
                "Verify your email before deleting your account.",
                code=EMAIL_VERIFICATION_CODE,
            )
        raise AccountDeletionBlocked(preflight["blocking_reasons"])

    snapshots = preflight["households"]
    exclusive_ids = _exclusive_household_ids(snapshots)
    cancel_user_billing(user)
    revoke_exclusive_plaid_items(user, exclusive_ids)

    user_id = user.pk
    with transaction.atomic():
        if exclusive_ids:
            Household.objects.filter(pk__in=exclusive_ids).delete()
        user.delete()
    logger.info("Deleted user_id=%s exclusive_households=%s", user_id, exclusive_ids)
