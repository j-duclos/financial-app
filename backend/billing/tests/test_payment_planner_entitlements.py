"""Direct API bypass tests for Payment Planner Premium gates."""
from datetime import date
from decimal import Decimal

import pytest

from accounts.models import Account
from billing.models import BillingSubscription
from billing.services import get_or_create_billing_subscription, user_has_premium
from billing.tests.helpers import grant_premium
from transactions.services.posting import post_transaction

pytestmark = pytest.mark.django_db

PLAN_PATH = "/api/credit-cards/plan/"


def _credit_card(household, user, *, balance="500"):
    card = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        name="Visa",
        credit_limit=Decimal("2000"),
        apr=Decimal("19.99"),
        minimum_payment_amount=Decimal("25"),
    )
    post_transaction(user, card.id, date.today(), "Charge", -Decimal(balance))
    return card


def _assert_premium_required(response, feature="payment_planner_full"):
    assert response.status_code == 403
    body = response.json()
    assert body["code"] == "premium_required"
    assert body["feature"] == feature
    assert body["upgrade_required"] is True
    assert body["detail"]
    assert "stripe" not in str(body).lower()
    assert "sk_" not in str(body)
    return body


def test_unauthenticated_plan_requires_auth(api_client):
    response = api_client.get(PLAN_PATH, {"strategy": "avalanche", "mode": "aggressive"})
    assert response.status_code == 401


def test_unauthenticated_payoff_requires_auth(api_client, household, user):
    card = _credit_card(household, user)
    response = api_client.get(f"/api/accounts/{card.pk}/payoff/")
    assert response.status_code == 401
    body = response.json()
    assert body.get("code") != "premium_required"


def test_free_user_cannot_call_plan(authenticated_client, household, user):
    _credit_card(household, user)
    response = authenticated_client.get(
        PLAN_PATH, {"strategy": "avalanche", "mode": "aggressive"}
    )
    _assert_premium_required(response)


def test_free_user_cannot_call_payoff(authenticated_client, household, user):
    card = _credit_card(household, user)
    response = authenticated_client.get(
        f"/api/accounts/{card.pk}/payoff/",
        {"strategy": "custom_amount", "custom_amount": "50"},
    )
    _assert_premium_required(response)


def test_premium_user_can_call_plan(authenticated_client, household, user):
    grant_premium(user)
    _credit_card(household, user)
    response = authenticated_client.get(
        PLAN_PATH, {"strategy": "avalanche", "mode": "aggressive"}
    )
    assert response.status_code == 200
    body = response.json()
    assert "cards" in body
    assert "total_debt" in body


def test_premium_user_can_call_payoff(authenticated_client, household, user):
    grant_premium(user)
    card = _credit_card(household, user)
    response = authenticated_client.get(
        f"/api/accounts/{card.pk}/payoff/",
        {"strategy": "custom_amount", "custom_amount": "50"},
    )
    assert response.status_code == 200
    assert "schedule" in response.json()


def test_trialing_user_can_call_plan(authenticated_client, household, user):
    billing = get_or_create_billing_subscription(user)
    billing.status = "trialing"
    billing.plan = BillingSubscription.Plan.PREMIUM
    billing.save()
    assert user_has_premium(user) is True
    _credit_card(household, user)
    response = authenticated_client.get(
        PLAN_PATH, {"strategy": "avalanche", "mode": "aggressive"}
    )
    assert response.status_code == 200


@pytest.mark.parametrize(
    "stripe_status",
    ["past_due", "unpaid", "canceled", "incomplete", "paused"],
)
def test_non_paid_statuses_cannot_call_plan(authenticated_client, household, user, stripe_status):
    billing = get_or_create_billing_subscription(user)
    billing.status = stripe_status
    billing.plan = BillingSubscription.Plan.PREMIUM
    billing.stripe_customer_id = "cus_exists"
    billing.stripe_subscription_id = "sub_exists"
    billing.save()
    assert user_has_premium(user) is False
    _credit_card(household, user)
    response = authenticated_client.get(
        PLAN_PATH, {"strategy": "avalanche", "mode": "aggressive"}
    )
    _assert_premium_required(response)


def test_stripe_customer_id_alone_does_not_unlock_plan(authenticated_client, household, user):
    billing = get_or_create_billing_subscription(user)
    billing.stripe_customer_id = "cus_exists"
    billing.status = "inactive"
    billing.save()
    _credit_card(household, user)
    response = authenticated_client.get(
        PLAN_PATH, {"strategy": "avalanche", "mode": "aggressive"}
    )
    _assert_premium_required(response)
