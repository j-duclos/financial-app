"""Read Stripe settings. Missing keys must not prevent Django startup."""
from __future__ import annotations

import os

from django.conf import settings

from billing.exceptions import BillingConfigurationError

_DEV_FRONTEND_ORIGIN = "http://localhost:5173"


def stripe_secret_key() -> str:
    return (getattr(settings, "STRIPE_SECRET_KEY", "") or "").strip()


def stripe_webhook_secret() -> str:
    return (getattr(settings, "STRIPE_WEBHOOK_SECRET", "") or "").strip()


def stripe_premium_price_id() -> str:
    return (getattr(settings, "STRIPE_PREMIUM_PRICE_ID", "") or "").strip()


def stripe_publishable_key() -> str:
    return (getattr(settings, "STRIPE_PUBLISHABLE_KEY", "") or "").strip()


def require_stripe_secret() -> str:
    key = stripe_secret_key()
    if not key:
        raise BillingConfigurationError(
            "Stripe billing is not configured. Set STRIPE_SECRET_KEY."
        )
    return key


def require_webhook_secret() -> str:
    secret = stripe_webhook_secret()
    if not secret:
        raise BillingConfigurationError(
            "Stripe webhooks are not configured. Set STRIPE_WEBHOOK_SECRET."
        )
    return secret


def require_premium_price_id() -> str:
    price_id = stripe_premium_price_id()
    if not price_id:
        raise BillingConfigurationError(
            "Stripe billing is not configured. Set STRIPE_PREMIUM_PRICE_ID."
        )
    return price_id


def require_checkout_config() -> tuple[str, str]:
    return require_stripe_secret(), require_premium_price_id()


def get_frontend_origin() -> str:
    origin = (getattr(settings, "FRONTEND_ORIGIN", "") or "").strip().rstrip("/")
    if origin:
        return origin
    render_url = os.environ.get("RENDER_EXTERNAL_URL", "").strip().rstrip("/")
    if render_url:
        return render_url
    if getattr(settings, "DEBUG", False):
        return _DEV_FRONTEND_ORIGIN
    raise BillingConfigurationError(
        "Cannot determine frontend origin for Stripe return URLs. Set FRONTEND_ORIGIN."
    )


def checkout_success_url() -> str:
    explicit = (getattr(settings, "BILLING_SUCCESS_URL", "") or "").strip()
    if explicit:
        return explicit
    return f"{get_frontend_origin()}/profile?billing=success&session_id={{CHECKOUT_SESSION_ID}}"


def checkout_cancel_url() -> str:
    explicit = (getattr(settings, "BILLING_CANCEL_URL", "") or "").strip()
    if explicit:
        return explicit
    return f"{get_frontend_origin()}/profile?billing=canceled"


def portal_return_url() -> str:
    explicit = (getattr(settings, "BILLING_PORTAL_RETURN_URL", "") or "").strip()
    if explicit:
        return explicit
    return f"{get_frontend_origin()}/profile"
