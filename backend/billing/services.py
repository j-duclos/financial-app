"""Billing entitlements and Stripe Checkout/Portal orchestration.

Premium access is granted only from locally synchronized Stripe subscription
status. Presence of a Stripe Customer ID does not imply Premium.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone as dt_timezone
from typing import Any

from django.contrib.auth import get_user_model
from django.db import transaction

from billing.exceptions import BillingConfigurationError
from billing.models import BillingSubscription
from billing.stripe_api import (
    create_checkout_session,
    create_customer,
    create_portal_session,
    list_subscriptions,
    retrieve_subscription,
)
from billing.stripe_config import (
    checkout_cancel_url,
    checkout_success_url,
    portal_return_url,
    require_checkout_config,
    require_premium_price_id,
    require_stripe_secret,
)

logger = logging.getLogger(__name__)

User = get_user_model()

# Central definition of which Stripe subscription statuses grant paid access.
# past_due / unpaid / canceled / incomplete / paused do not grant Premium.
PAID_ACCESS_STATUSES = frozenset({"active", "trialing"})

METADATA_USER_ID_KEY = "django_user_id"


class BillingConflictError(Exception):
    """User already has a live Premium subscription."""


def status_grants_premium(status: str | None) -> bool:
    return (status or "").strip().lower() in PAID_ACCESS_STATUSES


def get_or_create_billing_subscription(user) -> BillingSubscription:
    billing, _created = BillingSubscription.objects.get_or_create(
        user=user,
        defaults={
            "plan": BillingSubscription.Plan.FREE,
            "status": "inactive",
        },
    )
    return billing


def subscription_grants_premium(billing: BillingSubscription | None) -> bool:
    if billing is None:
        return False
    return status_grants_premium(billing.status)


def get_user_plan(user) -> str:
    billing = get_or_create_billing_subscription(user)
    if subscription_grants_premium(billing):
        return BillingSubscription.Plan.PREMIUM
    return BillingSubscription.Plan.FREE


def user_has_premium(user) -> bool:
    return get_user_plan(user) == BillingSubscription.Plan.PREMIUM


def get_entitlements(user) -> dict[str, Any]:
    from billing.entitlements import build_entitlement_payload

    return build_entitlement_payload(user)


def get_billing_status_payload(user) -> dict[str, Any]:
    billing = get_or_create_billing_subscription(user)
    is_premium = subscription_grants_premium(billing)
    period_end = billing.current_period_end
    return {
        "plan": BillingSubscription.Plan.PREMIUM if is_premium else BillingSubscription.Plan.FREE,
        "is_premium": is_premium,
        "status": billing.status,
        "cancel_at_period_end": bool(billing.cancel_at_period_end),
        "current_period_end": period_end.isoformat() if period_end else None,
        "has_stripe_customer": bool(billing.stripe_customer_id),
        "entitlements": get_entitlements(user),
    }


def _obj_get(obj: Any, key: str, default: Any = None) -> Any:
    if obj is None:
        return default
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _normalize_stripe_id(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, dict):
        value = value.get("id")
    else:
        nested_id = getattr(value, "id", None)
        if nested_id and not isinstance(value, str):
            value = nested_id
    text = str(value).strip() if value is not None else ""
    return text or None


def extract_current_period_end(subscription: Any) -> datetime | None:
    ts = _obj_get(subscription, "current_period_end")
    if not ts:
        items = _obj_get(subscription, "items")
        data = _obj_get(items, "data") if items is not None else None
        if data:
            ts = _obj_get(data[0], "current_period_end")
    if not ts:
        return None
    try:
        return datetime.fromtimestamp(int(ts), tz=dt_timezone.utc)
    except (TypeError, ValueError, OSError):
        return None


def extract_price_id(subscription: Any) -> str:
    items = _obj_get(subscription, "items")
    data = _obj_get(items, "data") if items is not None else None
    if data:
        price = _obj_get(data[0], "price")
        if isinstance(price, str) and price:
            return price
        price_id = _obj_get(price, "id") if price is not None else None
        if price_id:
            return str(price_id)
    plan = _obj_get(subscription, "plan")
    plan_id = _obj_get(plan, "id") if plan is not None else None
    return str(plan_id) if plan_id else ""


def apply_stripe_subscription(
    billing: BillingSubscription,
    subscription: Any,
    *,
    deleted: bool = False,
) -> BillingSubscription:
    """Synchronize local billing state from a Stripe Subscription object."""
    sub_id = _normalize_stripe_id(_obj_get(subscription, "id"))
    if sub_id:
        billing.stripe_subscription_id = sub_id
    customer_id = _normalize_stripe_id(_obj_get(subscription, "customer"))
    if customer_id:
        billing.stripe_customer_id = customer_id
    raw_status = "canceled" if deleted else str(_obj_get(subscription, "status") or "inactive")
    billing.status = raw_status
    billing.cancel_at_period_end = bool(_obj_get(subscription, "cancel_at_period_end") or False)
    if deleted:
        billing.cancel_at_period_end = False
    billing.current_period_end = extract_current_period_end(subscription)
    price_id = extract_price_id(subscription)
    if price_id:
        billing.stripe_price_id = price_id
    grants = status_grants_premium(billing.status)
    billing.plan = (
        BillingSubscription.Plan.PREMIUM if grants else BillingSubscription.Plan.FREE
    )
    billing.save()
    return billing


def downgrade_to_free(
    billing: BillingSubscription,
    *,
    status: str = "canceled",
) -> BillingSubscription:
    """Revoke paid access. Financial data is never deleted."""
    billing.plan = BillingSubscription.Plan.FREE
    billing.status = status
    billing.cancel_at_period_end = False
    billing.save(
        update_fields=["plan", "status", "cancel_at_period_end", "updated_at"]
    )
    return billing


def _user_metadata(user) -> dict[str, str]:
    return {METADATA_USER_ID_KEY: str(user.pk)}


def get_or_create_stripe_customer(user, billing: BillingSubscription) -> str:
    if billing.stripe_customer_id:
        return billing.stripe_customer_id
    require_stripe_secret()
    with transaction.atomic():
        locked = BillingSubscription.objects.select_for_update().get(pk=billing.pk)
        if locked.stripe_customer_id:
            return locked.stripe_customer_id
        email = (getattr(user, "email", None) or "").strip() or None
        customer = create_customer(
            email=email,
            name=user.get_username(),
            metadata=_user_metadata(user),
        )
        customer_id = _normalize_stripe_id(_obj_get(customer, "id"))
        if not customer_id:
            raise BillingConfigurationError("Stripe did not return a customer id.")
        locked.stripe_customer_id = customer_id
        locked.save(update_fields=["stripe_customer_id", "updated_at"])
        billing.stripe_customer_id = customer_id
        return customer_id


def _iter_subscription_list(result: Any):
    data = _obj_get(result, "data") or []
    return list(data)


def find_live_premium_subscription(customer_id: str) -> Any | None:
    result = list_subscriptions(customer=customer_id, limit=10)
    for sub in _iter_subscription_list(result):
        if status_grants_premium(str(_obj_get(sub, "status") or "")):
            return sub
    return None


def create_premium_checkout_session(user) -> dict[str, str]:
    """Create a Stripe Checkout Session for Premium. Price ID is server-selected."""
    require_checkout_config()
    billing = get_or_create_billing_subscription(user)
    if subscription_grants_premium(billing):
        raise BillingConflictError("You already have an active Premium subscription.")

    customer_id = get_or_create_stripe_customer(user, billing)
    existing = find_live_premium_subscription(customer_id)
    if existing is not None:
        apply_stripe_subscription(billing, existing)
        raise BillingConflictError("You already have an active Premium subscription.")

    price_id = require_premium_price_id()
    metadata = _user_metadata(user)
    session = create_checkout_session(
        mode="subscription",
        customer=customer_id,
        line_items=[{"price": price_id, "quantity": 1}],
        success_url=checkout_success_url(),
        cancel_url=checkout_cancel_url(),
        client_reference_id=str(user.pk),
        metadata=metadata,
        subscription_data={"metadata": metadata},
    )
    url = _obj_get(session, "url")
    session_id = _obj_get(session, "id")
    if not url:
        raise BillingConfigurationError("Stripe Checkout did not return a session URL.")
    return {"url": str(url), "session_id": str(session_id or "")}


def create_customer_portal_session(user) -> dict[str, str]:
    require_stripe_secret()
    billing = get_or_create_billing_subscription(user)
    if not billing.stripe_customer_id:
        raise BillingConfigurationError(
            "No billing customer on file. Start a Premium subscription first."
        )
    session = create_portal_session(
        customer=billing.stripe_customer_id,
        return_url=portal_return_url(),
    )
    url = _obj_get(session, "url")
    if not url:
        raise BillingConfigurationError("Stripe Customer Portal did not return a session URL.")
    return {"url": str(url)}


def resolve_user_id_from_metadata(metadata: Any) -> int | None:
    if not metadata:
        return None
    raw = _obj_get(metadata, METADATA_USER_ID_KEY)
    if raw is None:
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def resolve_billing_for_customer(customer_id: str | None) -> BillingSubscription | None:
    cid = _normalize_stripe_id(customer_id)
    if not cid:
        return None
    return BillingSubscription.objects.filter(stripe_customer_id=cid).select_related("user").first()


def resolve_billing_for_subscription_id(subscription_id: str | None) -> BillingSubscription | None:
    sid = _normalize_stripe_id(subscription_id)
    if not sid:
        return None
    return (
        BillingSubscription.objects.filter(stripe_subscription_id=sid)
        .select_related("user")
        .first()
    )


def resolve_billing_for_user_id(user_id: int | None) -> BillingSubscription | None:
    if user_id is None:
        return None
    user = User.objects.filter(pk=user_id).first()
    if user is None:
        return None
    return get_or_create_billing_subscription(user)


def fetch_subscription(subscription_id: str | None) -> Any | None:
    sid = _normalize_stripe_id(subscription_id)
    if not sid:
        return None
    try:
        return retrieve_subscription(sid)
    except Exception:
        logger.warning("Failed to retrieve Stripe subscription %s", sid, exc_info=True)
        return None
