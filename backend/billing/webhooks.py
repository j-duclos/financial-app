"""Stripe webhook processing. Stripe is the authoritative source of paid entitlement."""
from __future__ import annotations

import logging
from typing import Any

from django.db import IntegrityError, transaction
from django.utils import timezone

from billing.models import StripeWebhookEvent
from billing.services import (
    apply_stripe_subscription,
    downgrade_to_free,
    fetch_subscription,
    resolve_billing_for_customer,
    resolve_billing_for_subscription_id,
    resolve_billing_for_user_id,
    resolve_user_id_from_metadata,
    _normalize_stripe_id,
    _obj_get,
)

logger = logging.getLogger(__name__)

HANDLED_EVENT_TYPES = frozenset(
    {
        "checkout.session.completed",
        "customer.subscription.created",
        "customer.subscription.updated",
        "customer.subscription.deleted",
        "invoice.payment_failed",
        "invoice.paid",
        "invoice.payment_succeeded",
    }
)


def event_id_and_type(event: Any) -> tuple[str, str]:
    event_id = str(_obj_get(event, "id") or "").strip()
    event_type = str(_obj_get(event, "type") or "").strip()
    return event_id, event_type


def event_data_object(event: Any) -> Any:
    data = _obj_get(event, "data") or {}
    return _obj_get(data, "object")


def extract_invoice_subscription_id(invoice: Any) -> str | None:
    sub = _obj_get(invoice, "subscription")
    sid = _normalize_stripe_id(sub)
    if sid:
        return sid
    parent = _obj_get(invoice, "parent")
    details = _obj_get(parent, "subscription_details") if parent is not None else None
    return _normalize_stripe_id(_obj_get(details, "subscription") if details is not None else None)


def _resolve_billing_from_subscription(subscription: Any):
    billing = resolve_billing_for_subscription_id(_obj_get(subscription, "id"))
    if billing:
        return billing
    billing = resolve_billing_for_customer(_obj_get(subscription, "customer"))
    if billing:
        return billing
    user_id = resolve_user_id_from_metadata(_obj_get(subscription, "metadata"))
    return resolve_billing_for_user_id(user_id)


def _sync_subscription_object(subscription: Any, *, deleted: bool = False) -> None:
    billing = _resolve_billing_from_subscription(subscription)
    if billing is None:
        logger.warning(
            "Stripe subscription event could not be mapped to a user (sub=%s customer=%s)",
            _obj_get(subscription, "id"),
            _obj_get(subscription, "customer"),
        )
        return
    apply_stripe_subscription(billing, subscription, deleted=deleted)


def handle_checkout_session_completed(session: Any) -> None:
    if str(_obj_get(session, "mode") or "subscription") not in ("subscription", ""):
        return
    user_id = resolve_user_id_from_metadata(_obj_get(session, "metadata"))
    if user_id is None:
        raw_ref = _obj_get(session, "client_reference_id")
        try:
            user_id = int(raw_ref) if raw_ref is not None else None
        except (TypeError, ValueError):
            user_id = None
    billing = resolve_billing_for_user_id(user_id)
    if billing is None:
        billing = resolve_billing_for_customer(_obj_get(session, "customer"))
    if billing is None:
        logger.warning(
            "checkout.session.completed could not be mapped to a user (session=%s)",
            _obj_get(session, "id"),
        )
        return
    customer_id = _normalize_stripe_id(_obj_get(session, "customer"))
    if customer_id:
        billing.stripe_customer_id = customer_id
        billing.save(update_fields=["stripe_customer_id", "updated_at"])
    subscription_id = _normalize_stripe_id(_obj_get(session, "subscription"))
    subscription = _obj_get(session, "subscription")
    if subscription_id and not isinstance(subscription, dict) and not hasattr(subscription, "status"):
        subscription = fetch_subscription(subscription_id)
    if subscription is not None and _obj_get(subscription, "status") is not None:
        apply_stripe_subscription(billing, subscription)
    elif subscription_id:
        billing.stripe_subscription_id = subscription_id
        billing.save(update_fields=["stripe_subscription_id", "updated_at"])


def handle_invoice_event(invoice: Any, *, payment_failed: bool) -> None:
    subscription_id = extract_invoice_subscription_id(invoice)
    subscription = fetch_subscription(subscription_id)
    if subscription is not None:
        _sync_subscription_object(subscription)
        return
    billing = resolve_billing_for_subscription_id(subscription_id)
    if billing is None:
        billing = resolve_billing_for_customer(_obj_get(invoice, "customer"))
    if billing is None:
        logger.warning(
            "Invoice event could not be mapped to a billing row (invoice=%s)",
            _obj_get(invoice, "id"),
        )
        return
    if payment_failed:
        # Fail closed: a failed invoice must not leave Premium granted indefinitely.
        downgrade_to_free(billing, status="past_due")


def apply_event_payload(event: Any) -> None:
    event_type = str(_obj_get(event, "type") or "")
    obj = event_data_object(event)
    if event_type == "checkout.session.completed":
        handle_checkout_session_completed(obj)
        return
    if event_type in (
        "customer.subscription.created",
        "customer.subscription.updated",
    ):
        _sync_subscription_object(obj)
        return
    if event_type == "customer.subscription.deleted":
        _sync_subscription_object(obj, deleted=True)
        return
    if event_type == "invoice.payment_failed":
        handle_invoice_event(obj, payment_failed=True)
        return
    if event_type in ("invoice.paid", "invoice.payment_succeeded"):
        handle_invoice_event(obj, payment_failed=False)


@transaction.atomic
def process_stripe_event(event: Any) -> str:
    """Process a verified Stripe event. Returns 'processed' or 'duplicate'."""
    event_id, event_type = event_id_and_type(event)
    if not event_id:
        raise ValueError("Stripe event missing id")
    if StripeWebhookEvent.objects.filter(stripe_event_id=event_id).exists():
        return "duplicate"
    try:
        StripeWebhookEvent.objects.create(
            stripe_event_id=event_id,
            event_type=event_type,
            livemode=bool(_obj_get(event, "livemode") or False),
            processed_at=timezone.now(),
        )
    except IntegrityError:
        return "duplicate"
    apply_event_payload(event)
    return "processed"
