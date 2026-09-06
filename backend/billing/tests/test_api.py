from unittest.mock import MagicMock, patch

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from billing.models import BillingSubscription
from billing.services import get_or_create_billing_subscription
from billing.tests.helpers import stripe_configured

User = get_user_model()


@pytest.mark.django_db
def test_status_endpoint_requires_auth(api_client):
    r = api_client.get("/api/billing/status/")
    assert r.status_code in (401, 403)


@pytest.mark.django_db
def test_status_endpoint_for_free_user(authenticated_client, user):
    r = authenticated_client.get("/api/billing/status/")
    assert r.status_code == 200
    body = r.json()
    assert body["plan"] == "FREE"
    assert body["is_premium"] is False
    assert body["status"] == "inactive"
    assert body["cancel_at_period_end"] is False
    assert body["current_period_end"] is None
    assert body["has_stripe_customer"] is False
    assert "STRIPE_SECRET_KEY" not in str(body)
    assert "sk_" not in str(body)


@pytest.mark.django_db
def test_status_endpoint_for_premium_user(authenticated_client, user):
    billing = get_or_create_billing_subscription(user)
    billing.status = "active"
    billing.plan = BillingSubscription.Plan.PREMIUM
    billing.stripe_customer_id = "cus_live"
    billing.save()
    r = authenticated_client.get("/api/billing/status/")
    assert r.status_code == 200
    body = r.json()
    assert body["plan"] == "PREMIUM"
    assert body["is_premium"] is True
    assert body["has_stripe_customer"] is True


@pytest.mark.django_db
def test_register_does_not_require_stripe(api_client):
    r = api_client.post(
        "/api/auth/register/",
        {"username": "newbillinguser", "password": "testpass123"},
        format="json",
    )
    assert r.status_code == 201
    created = User.objects.get(username="newbillinguser")
    assert not BillingSubscription.objects.filter(user=created).exists()
    client = APIClient()
    client.force_authenticate(user=created)
    status_r = client.get("/api/billing/status/")
    assert status_r.status_code == 200
    assert status_r.json()["plan"] == "FREE"
    billing = BillingSubscription.objects.get(user=created)
    assert billing.stripe_customer_id is None
    assert billing.stripe_subscription_id is None


@pytest.mark.django_db
def test_checkout_requires_authentication(api_client):
    r = api_client.post("/api/billing/create-checkout-session/", {}, format="json")
    assert r.status_code in (401, 403)


@pytest.mark.django_db
def test_checkout_fails_safely_without_stripe_config(authenticated_client):
    r = authenticated_client.post("/api/billing/create-checkout-session/", {}, format="json")
    assert r.status_code == 503
    assert "not configured" in r.json()["detail"].lower()


@pytest.mark.django_db
@stripe_configured
def test_checkout_uses_server_price_id_not_client_price(authenticated_client, user):
    with (
        patch("billing.services.create_customer") as mock_customer,
        patch("billing.services.list_subscriptions") as mock_list,
        patch("billing.services.create_checkout_session") as mock_session,
    ):
        mock_customer.return_value = MagicMock(id="cus_new")
        mock_list.return_value = MagicMock(data=[])
        mock_session.return_value = MagicMock(
            id="cs_test", url="https://checkout.stripe.com/c/pay/cs_test"
        )
        r = authenticated_client.post(
            "/api/billing/create-checkout-session/",
            {"price_id": "price_evil_from_client", "user_id": 99999},
            format="json",
        )
    assert r.status_code == 200
    assert r.json()["url"].startswith("https://checkout.stripe.com/")
    kwargs = mock_session.call_args.kwargs
    assert kwargs["line_items"][0]["price"] == "price_premium_server"
    assert kwargs["customer"] == "cus_new"
    assert kwargs["mode"] == "subscription"
    assert kwargs["metadata"]["django_user_id"] == str(user.pk)
    assert "price_evil" not in str(kwargs)
    billing = BillingSubscription.objects.get(user=user)
    assert billing.stripe_customer_id == "cus_new"


@pytest.mark.django_db
@stripe_configured
def test_checkout_creates_then_reuses_stripe_customer(authenticated_client, user):
    with (
        patch("billing.services.create_customer") as mock_customer,
        patch("billing.services.list_subscriptions") as mock_list,
        patch("billing.services.create_checkout_session") as mock_session,
    ):
        mock_customer.return_value = MagicMock(id="cus_once")
        mock_list.return_value = MagicMock(data=[])
        mock_session.return_value = MagicMock(id="cs_1", url="https://checkout.stripe.com/pay/1")
        first = authenticated_client.post("/api/billing/create-checkout-session/", {}, format="json")
        second = authenticated_client.post("/api/billing/create-checkout-session/", {}, format="json")
    assert first.status_code == 200
    assert second.status_code == 200
    assert mock_customer.call_count == 1
    assert mock_session.call_args_list[1].kwargs["customer"] == "cus_once"
    billing = BillingSubscription.objects.get(user=user)
    assert billing.stripe_customer_id == "cus_once"


@pytest.mark.django_db
@stripe_configured
def test_checkout_rejects_duplicate_active_subscription(authenticated_client, user):
    billing = get_or_create_billing_subscription(user)
    billing.status = "active"
    billing.plan = BillingSubscription.Plan.PREMIUM
    billing.stripe_customer_id = "cus_live"
    billing.stripe_subscription_id = "sub_live"
    billing.save()
    with patch("billing.services.create_checkout_session") as mock_session:
        r = authenticated_client.post("/api/billing/create-checkout-session/", {}, format="json")
    assert r.status_code == 409
    mock_session.assert_not_called()


@pytest.mark.django_db
@stripe_configured
def test_checkout_rejects_live_stripe_subscription_if_local_state_lags(authenticated_client, user):
    from billing.tests.helpers import fake_subscription

    billing = get_or_create_billing_subscription(user)
    billing.stripe_customer_id = "cus_live"
    billing.status = "inactive"
    billing.save()
    live = fake_subscription(customer="cus_live", status="active", user_id=user.pk)
    with (
        patch("billing.services.list_subscriptions", return_value=MagicMock(data=[live])),
        patch("billing.services.create_checkout_session") as mock_session,
    ):
        r = authenticated_client.post("/api/billing/create-checkout-session/", {}, format="json")
    assert r.status_code == 409
    mock_session.assert_not_called()
    billing.refresh_from_db()
    assert billing.status == "active"
    assert billing.plan == BillingSubscription.Plan.PREMIUM


@pytest.mark.django_db
def test_portal_requires_authentication(api_client):
    r = api_client.post("/api/billing/create-portal-session/", {}, format="json")
    assert r.status_code in (401, 403)


@pytest.mark.django_db
@stripe_configured
def test_portal_requires_authenticated_users_stripe_customer(authenticated_client, user):
    r = authenticated_client.post("/api/billing/create-portal-session/", {}, format="json")
    assert r.status_code == 400
    assert "customer" in r.json()["detail"].lower()


@pytest.mark.django_db
@stripe_configured
def test_portal_uses_own_customer_not_request_body(authenticated_client, user):
    other = User.objects.create_user(username="otherbill", password="testpass123")
    other_billing = get_or_create_billing_subscription(other)
    other_billing.stripe_customer_id = "cus_other"
    other_billing.save()
    billing = get_or_create_billing_subscription(user)
    billing.stripe_customer_id = "cus_mine"
    billing.save()
    with patch("billing.services.create_portal_session") as mock_portal:
        mock_portal.return_value = MagicMock(url="https://billing.stripe.com/p/session/mine")
        r = authenticated_client.post(
            "/api/billing/create-portal-session/",
            {"customer": "cus_other", "user_id": other.pk},
            format="json",
        )
    assert r.status_code == 200
    assert r.json()["url"] == "https://billing.stripe.com/p/session/mine"
    mock_portal.assert_called_once()
    assert mock_portal.call_args.kwargs["customer"] == "cus_mine"
