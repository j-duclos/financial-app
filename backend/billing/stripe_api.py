"""Thin Stripe SDK wrappers. All network calls go through here so tests can mock them."""
from __future__ import annotations

from typing import Any

import stripe

from billing.stripe_config import require_stripe_secret, require_webhook_secret, stripe_secret_key


def _configure() -> None:
    stripe.api_key = require_stripe_secret()


def signature_error_types() -> tuple[type[BaseException], ...]:
    types: list[type[BaseException]] = []
    for attr in ("SignatureVerificationError",):
        cls = getattr(stripe, attr, None)
        if isinstance(cls, type) and issubclass(cls, BaseException):
            types.append(cls)
    err_mod = getattr(stripe, "error", None)
    if err_mod is not None:
        cls = getattr(err_mod, "SignatureVerificationError", None)
        if isinstance(cls, type) and issubclass(cls, BaseException) and cls not in types:
            types.append(cls)
    return tuple(types) or (Exception,)


def construct_webhook_event(payload: bytes, signature_header: str) -> Any:
    secret = require_webhook_secret()
    if stripe_secret_key():
        stripe.api_key = stripe_secret_key()
    return stripe.Webhook.construct_event(payload, signature_header, secret)


def create_customer(*, email: str | None, name: str, metadata: dict[str, str]) -> Any:
    _configure()
    kwargs: dict[str, Any] = {"name": name, "metadata": metadata}
    if email:
        kwargs["email"] = email
    return stripe.Customer.create(**kwargs)


def list_subscriptions(*, customer: str, limit: int = 10) -> Any:
    _configure()
    return stripe.Subscription.list(customer=customer, limit=limit)


def retrieve_subscription(subscription_id: str) -> Any:
    _configure()
    return stripe.Subscription.retrieve(subscription_id)


def cancel_subscription(subscription_id: str) -> Any:
    """Immediately cancel a Stripe Subscription. Does not delete the Customer."""
    _configure()
    return stripe.Subscription.cancel(subscription_id)


def invalid_request_error_types() -> tuple[type[BaseException], ...]:
    types: list[type[BaseException]] = []
    cls = getattr(stripe, "InvalidRequestError", None)
    if isinstance(cls, type) and issubclass(cls, BaseException):
        types.append(cls)
    err_mod = getattr(stripe, "error", None)
    if err_mod is not None:
        cls = getattr(err_mod, "InvalidRequestError", None)
        if isinstance(cls, type) and issubclass(cls, BaseException) and cls not in types:
            types.append(cls)
    return tuple(types)


def is_definitively_nonbillable_subscription_error(exc: BaseException) -> bool:
    """True when Stripe says this subscription cannot continue billing.

    Fail closed: network, auth, and other Stripe/SDK errors return False.
    """
    types = invalid_request_error_types()
    if not types or not isinstance(exc, types):
        return False
    code = str(getattr(exc, "code", "") or "").strip().lower()
    if code == "resource_missing":
        return True
    return getattr(exc, "http_status", None) == 404


def create_checkout_session(**kwargs: Any) -> Any:
    _configure()
    return stripe.checkout.Session.create(**kwargs)


def list_portal_configurations(*, limit: int = 10) -> Any:
    _configure()
    return stripe.billing_portal.Configuration.list(active=True, limit=limit)


def create_portal_configuration() -> Any:
    """Create a minimal customer-portal config for FlowSight subscriptions."""
    _configure()
    return stripe.billing_portal.Configuration.create(
        business_profile={"headline": "Manage your FlowSight subscription"},
        features={
            "customer_update": {
                "enabled": True,
                "allowed_updates": ["email", "address"],
            },
            "invoice_history": {"enabled": True},
            "payment_method_update": {"enabled": True},
            "subscription_cancel": {
                "enabled": True,
                "mode": "at_period_end",
                "proration_behavior": "none",
            },
        },
    )


def create_portal_session(
    *,
    customer: str,
    return_url: str,
    configuration: str | None = None,
) -> Any:
    _configure()
    kwargs: dict[str, Any] = {"customer": customer, "return_url": return_url}
    if configuration:
        kwargs["configuration"] = configuration
    return stripe.billing_portal.Session.create(**kwargs)


def retrieve_account() -> Any:
    """Read-only account lookup. Does not create charges or checkout sessions."""
    _configure()
    return stripe.Account.retrieve()


def retrieve_price(price_id: str) -> Any:
    """Read-only Price lookup. Does not create charges or checkout sessions."""
    _configure()
    return stripe.Price.retrieve(price_id)
