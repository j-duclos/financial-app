"""Shared Stripe mocks for billing tests. No real Stripe network calls."""
from __future__ import annotations

from django.test import override_settings

STRIPE_TEST_SETTINGS = dict(
    STRIPE_SECRET_KEY="sk_test_dummy",
    STRIPE_WEBHOOK_SECRET="whsec_dummy",
    STRIPE_PREMIUM_PRICE_ID="price_premium_server",
    FRONTEND_ORIGIN="http://localhost:5173",
    DEBUG=True,
)

stripe_configured = override_settings(**STRIPE_TEST_SETTINGS)


def fake_event(event_id: str, event_type: str, data_object, *, livemode: bool = False):
    return {
        "id": event_id,
        "type": event_type,
        "livemode": livemode,
        "data": {"object": data_object},
    }


def fake_subscription(
    *,
    sub_id="sub_1",
    customer="cus_1",
    status="active",
    price_id="price_premium_server",
    cancel_at_period_end=False,
    current_period_end=1_800_000_000,
    user_id=None,
):
    metadata = {"django_user_id": str(user_id)} if user_id is not None else {}
    return {
        "id": sub_id,
        "customer": customer,
        "status": status,
        "cancel_at_period_end": cancel_at_period_end,
        "current_period_end": current_period_end,
        "metadata": metadata,
        "items": {
            "data": [
                {
                    "price": {"id": price_id},
                    "current_period_end": current_period_end,
                }
            ]
        },
    }


def fake_checkout_session(
    *,
    session_id="cs_1",
    customer="cus_1",
    subscription="sub_1",
    user_id=1,
    mode="subscription",
):
    return {
        "id": session_id,
        "mode": mode,
        "customer": customer,
        "subscription": subscription,
        "client_reference_id": str(user_id),
        "metadata": {"django_user_id": str(user_id)},
    }


def fake_invoice(*, invoice_id="in_1", customer="cus_1", subscription="sub_1"):
    return {
        "id": invoice_id,
        "customer": customer,
        "subscription": subscription,
    }
