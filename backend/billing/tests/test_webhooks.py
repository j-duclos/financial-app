from unittest.mock import patch

import pytest

from billing.models import BillingSubscription, StripeWebhookEvent
from billing.services import get_or_create_billing_subscription, user_has_premium
from billing.tests.helpers import (
    fake_checkout_session,
    fake_event,
    fake_invoice,
    fake_subscription,
    stripe_configured,
)
from billing.webhooks import process_stripe_event


class FakeSignatureError(Exception):
    pass


@pytest.mark.django_db
def test_webhook_rejects_missing_signature(api_client):
    r = api_client.post(
        "/api/billing/webhook/",
        data=b"{}",
        content_type="application/json",
    )
    assert r.status_code == 400


@pytest.mark.django_db
@stripe_configured
def test_invalid_webhook_signature_is_rejected(api_client):
    with (
        patch("billing.views.signature_error_types", return_value=(FakeSignatureError,)),
        patch("billing.views.construct_webhook_event", side_effect=FakeSignatureError("bad sig")),
    ):
        r = api_client.post(
            "/api/billing/webhook/",
            data=b'{"id":"evt_1"}',
            content_type="application/json",
            HTTP_STRIPE_SIGNATURE="t=1,v1=not-valid",
        )
    assert r.status_code == 400
    assert StripeWebhookEvent.objects.count() == 0


@pytest.mark.django_db
@stripe_configured
def test_valid_subscription_webhook_updates_billing_state(api_client, user):
    sub = fake_subscription(customer="cus_wh", status="active", user_id=user.pk)
    event = fake_event("evt_sub_created", "customer.subscription.created", sub)
    with patch("billing.views.construct_webhook_event", return_value=event):
        r = api_client.post(
            "/api/billing/webhook/",
            data=b"{}",
            content_type="application/json",
            HTTP_STRIPE_SIGNATURE="t=1,v1=valid",
        )
    assert r.status_code == 200
    assert r.json()["status"] == "processed"
    billing = BillingSubscription.objects.get(user=user)
    assert billing.plan == BillingSubscription.Plan.PREMIUM
    assert billing.status == "active"
    assert billing.stripe_customer_id == "cus_wh"
    assert billing.stripe_subscription_id == "sub_1"
    assert billing.stripe_price_id == "price_premium_server"
    assert billing.current_period_end is not None
    assert user_has_premium(user) is True
    assert StripeWebhookEvent.objects.filter(stripe_event_id="evt_sub_created").count() == 1


@pytest.mark.django_db
@stripe_configured
def test_duplicate_webhook_event_is_idempotent(api_client, user):
    sub = fake_subscription(status="active", user_id=user.pk)
    event = fake_event("evt_dup", "customer.subscription.updated", sub)
    with patch("billing.views.construct_webhook_event", return_value=event):
        first = api_client.post(
            "/api/billing/webhook/",
            data=b"{}",
            content_type="application/json",
            HTTP_STRIPE_SIGNATURE="t=1,v1=valid",
        )
        second = api_client.post(
            "/api/billing/webhook/",
            data=b"{}",
            content_type="application/json",
            HTTP_STRIPE_SIGNATURE="t=1,v1=valid",
        )
    assert first.status_code == 200
    assert first.json()["status"] == "processed"
    assert second.status_code == 200
    assert second.json()["status"] == "duplicate"
    assert StripeWebhookEvent.objects.filter(stripe_event_id="evt_dup").count() == 1
    assert BillingSubscription.objects.filter(user=user).count() == 1


@pytest.mark.django_db
@stripe_configured
def test_checkout_completed_webhook_syncs_without_trusting_client(api_client, user):
    session = fake_checkout_session(user_id=user.pk, customer="cus_co", subscription="sub_co")
    sub = fake_subscription(
        sub_id="sub_co", customer="cus_co", status="active", user_id=user.pk
    )
    event = fake_event("evt_checkout", "checkout.session.completed", session)
    with (
        patch("billing.views.construct_webhook_event", return_value=event),
        patch("billing.webhooks.fetch_subscription", return_value=sub),
    ):
        r = api_client.post(
            "/api/billing/webhook/",
            data=b"{}",
            content_type="application/json",
            HTTP_STRIPE_SIGNATURE="t=1,v1=valid",
        )
    assert r.status_code == 200
    billing = BillingSubscription.objects.get(user=user)
    assert billing.stripe_customer_id == "cus_co"
    assert billing.stripe_subscription_id == "sub_co"
    assert billing.plan == BillingSubscription.Plan.PREMIUM
    assert user_has_premium(user) is True


@pytest.mark.django_db
@stripe_configured
def test_subscription_deletion_downgrades_to_free(api_client, user):
    billing = get_or_create_billing_subscription(user)
    billing.plan = BillingSubscription.Plan.PREMIUM
    billing.status = "active"
    billing.stripe_customer_id = "cus_1"
    billing.stripe_subscription_id = "sub_1"
    billing.save()
    sub = fake_subscription(status="canceled", user_id=user.pk)
    event = fake_event("evt_deleted", "customer.subscription.deleted", sub)
    with patch("billing.views.construct_webhook_event", return_value=event):
        r = api_client.post(
            "/api/billing/webhook/",
            data=b"{}",
            content_type="application/json",
            HTTP_STRIPE_SIGNATURE="t=1,v1=valid",
        )
    assert r.status_code == 200
    billing.refresh_from_db()
    assert billing.plan == BillingSubscription.Plan.FREE
    assert billing.status == "canceled"
    assert user_has_premium(user) is False
    # Financial identity is intact; Stripe customer is kept for resubscribe.
    assert billing.stripe_customer_id == "cus_1"


@pytest.mark.django_db
@stripe_configured
def test_payment_failure_does_not_keep_premium_access(api_client, user):
    billing = get_or_create_billing_subscription(user)
    billing.plan = BillingSubscription.Plan.PREMIUM
    billing.status = "active"
    billing.stripe_customer_id = "cus_1"
    billing.stripe_subscription_id = "sub_1"
    billing.save()
    invoice = fake_invoice(subscription="sub_1", customer="cus_1")
    event = fake_event("evt_fail", "invoice.payment_failed", invoice)
    past_due = fake_subscription(status="past_due", user_id=user.pk)
    with (
        patch("billing.views.construct_webhook_event", return_value=event),
        patch("billing.webhooks.fetch_subscription", return_value=past_due),
    ):
        r = api_client.post(
            "/api/billing/webhook/",
            data=b"{}",
            content_type="application/json",
            HTTP_STRIPE_SIGNATURE="t=1,v1=valid",
        )
    assert r.status_code == 200
    billing.refresh_from_db()
    assert billing.plan == BillingSubscription.Plan.FREE
    assert billing.status == "past_due"
    assert user_has_premium(user) is False


@pytest.mark.django_db
@stripe_configured
def test_payment_failure_without_retrieve_still_revokes_access(user):
    billing = get_or_create_billing_subscription(user)
    billing.plan = BillingSubscription.Plan.PREMIUM
    billing.status = "active"
    billing.stripe_subscription_id = "sub_1"
    billing.stripe_customer_id = "cus_1"
    billing.save()
    invoice = fake_invoice(subscription="sub_1")
    event = fake_event("evt_fail2", "invoice.payment_failed", invoice)
    with patch("billing.webhooks.fetch_subscription", return_value=None):
        result = process_stripe_event(event)
    assert result == "processed"
    billing.refresh_from_db()
    assert billing.plan == BillingSubscription.Plan.FREE
    assert billing.status == "past_due"
    assert user_has_premium(user) is False


@pytest.mark.django_db
@stripe_configured
def test_invoice_paid_restores_premium_from_active_subscription(api_client, user):
    billing = get_or_create_billing_subscription(user)
    billing.plan = BillingSubscription.Plan.FREE
    billing.status = "past_due"
    billing.stripe_customer_id = "cus_1"
    billing.stripe_subscription_id = "sub_1"
    billing.save()
    invoice = fake_invoice(subscription="sub_1")
    event = fake_event("evt_paid", "invoice.paid", invoice)
    active = fake_subscription(status="active", user_id=user.pk)
    with (
        patch("billing.views.construct_webhook_event", return_value=event),
        patch("billing.webhooks.fetch_subscription", return_value=active),
    ):
        r = api_client.post(
            "/api/billing/webhook/",
            data=b"{}",
            content_type="application/json",
            HTTP_STRIPE_SIGNATURE="t=1,v1=valid",
        )
    assert r.status_code == 200
    billing.refresh_from_db()
    assert billing.plan == BillingSubscription.Plan.PREMIUM
    assert billing.status == "active"
    assert user_has_premium(user) is True


@pytest.mark.django_db
@stripe_configured
def test_unhandled_event_type_is_ignored(api_client):
    event = fake_event("evt_ping", "ping", {"id": "obj"})
    with patch("billing.views.construct_webhook_event", return_value=event):
        r = api_client.post(
            "/api/billing/webhook/",
            data=b"{}",
            content_type="application/json",
            HTTP_STRIPE_SIGNATURE="t=1,v1=valid",
        )
    assert r.status_code == 200
    assert r.json()["status"] == "ignored"
    assert StripeWebhookEvent.objects.count() == 0
