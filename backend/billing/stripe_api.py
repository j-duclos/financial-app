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


def create_checkout_session(**kwargs: Any) -> Any:
    _configure()
    return stripe.checkout.Session.create(**kwargs)


def create_portal_session(*, customer: str, return_url: str) -> Any:
    _configure()
    return stripe.billing_portal.Session.create(customer=customer, return_url=return_url)
