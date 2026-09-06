import pytest
from django.contrib.auth import get_user_model

from billing.models import BillingSubscription
from billing.services import (
    get_billing_status_payload,
    get_entitlements,
    get_or_create_billing_subscription,
    get_user_plan,
    status_grants_premium,
    user_has_premium,
)

User = get_user_model()


@pytest.mark.django_db
def test_new_user_is_free(user):
    assert get_user_plan(user) == BillingSubscription.Plan.FREE
    assert user_has_premium(user) is False
    entitlements = get_entitlements(user)
    assert entitlements["plan"] == "FREE"
    assert entitlements["is_premium"] is False
    assert entitlements["plaid_bank_sync"] is False
    assert entitlements["limits"]["linked_institutions"] == 0
    assert entitlements["limits"]["manual_accounts"] == 3
    assert entitlements["limits"]["recurring_rules"] == 10
    assert entitlements["limits"]["operational_forecast_days"] == 90
    assert entitlements["limits"]["goals"] == 2


@pytest.mark.django_db
def test_billing_status_for_free_user(user):
    payload = get_billing_status_payload(user)
    assert payload["plan"] == "FREE"
    assert payload["is_premium"] is False
    assert payload["status"] == "inactive"
    assert payload["cancel_at_period_end"] is False
    assert payload["current_period_end"] is None
    assert payload["has_stripe_customer"] is False


@pytest.mark.django_db
def test_stripe_customer_id_does_not_imply_premium(user):
    billing = get_or_create_billing_subscription(user)
    billing.stripe_customer_id = "cus_exists"
    billing.status = "inactive"
    billing.plan = BillingSubscription.Plan.FREE
    billing.save()
    assert user_has_premium(user) is False
    assert get_user_plan(user) == "FREE"


@pytest.mark.django_db
def test_active_subscription_grants_premium(user):
    billing = get_or_create_billing_subscription(user)
    billing.status = "active"
    billing.plan = BillingSubscription.Plan.PREMIUM
    billing.stripe_customer_id = "cus_1"
    billing.stripe_subscription_id = "sub_1"
    billing.save()
    assert user_has_premium(user) is True
    entitlements = get_entitlements(user)
    assert entitlements["plan"] == "PREMIUM"
    assert entitlements["is_premium"] is True
    assert entitlements["plaid_bank_sync"] is True
    assert entitlements["limits"]["linked_institutions"] is None
    assert entitlements["limits"]["manual_accounts"] is None
    assert entitlements["limits"]["recurring_rules"] is None
    assert entitlements["limits"]["operational_forecast_days"] == 365
    assert entitlements["limits"]["goals"] is None


@pytest.mark.django_db
def test_trialing_subscription_grants_premium(user):
    billing = get_or_create_billing_subscription(user)
    billing.status = "trialing"
    billing.save()
    assert user_has_premium(user) is True


@pytest.mark.parametrize(
    "stripe_status",
    [
        "canceled",
        "inactive",
        "unpaid",
        "past_due",
        "incomplete",
        "incomplete_expired",
        "paused",
    ],
)
def test_non_paid_statuses_do_not_grant_premium(stripe_status):
    assert status_grants_premium(stripe_status) is False


@pytest.mark.django_db
def test_canceled_subscription_does_not_grant_premium(user):
    billing = get_or_create_billing_subscription(user)
    billing.status = "canceled"
    billing.plan = BillingSubscription.Plan.PREMIUM  # stale plan must not win
    billing.stripe_customer_id = "cus_1"
    billing.stripe_subscription_id = "sub_1"
    billing.save()
    assert user_has_premium(user) is False
    assert get_user_plan(user) == "FREE"
