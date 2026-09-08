"""Development-only plan override. Production Stripe authority must stay intact."""
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from django.test import override_settings
from rest_framework.test import APIClient

from billing.entitlements import (
    EntitlementDenied,
    FEATURE_FORECAST_DAYS,
    FEATURE_GOALS,
    FEATURE_MANUAL_ACCOUNTS,
    FEATURE_RECURRING_RULES,
    require_goal_slot,
    require_payment_planner_full,
    require_plaid_bank_sync,
    require_recurring_rule_slot,
    user_may_use_reports_advanced,
)
from billing.models import BillingSubscription
from billing.plan_override import (
    active_test_plan_override,
    plan_test_override_enabled,
    set_own_test_plan_override,
)
from billing.services import (
    get_billing_status_payload,
    get_entitlements,
    get_or_create_billing_subscription,
    get_user_plan,
    user_has_premium,
)
from billing.tests.helpers import grant_premium
from core.models import UserProfile
from core.utils import get_user_profile

User = get_user_model()

OVERRIDE_ON = dict(DEBUG=True, ALLOW_PLAN_TEST_OVERRIDE=True, ON_RENDER=False)


def _billing_snapshot(user):
    row = BillingSubscription.objects.filter(user=user).first()
    if row is None:
        return None
    return {
        "pk": row.pk,
        "plan": row.plan,
        "status": row.status,
        "stripe_customer_id": row.stripe_customer_id,
        "stripe_subscription_id": row.stripe_subscription_id,
        "stripe_price_id": row.stripe_price_id,
        "cancel_at_period_end": row.cancel_at_period_end,
    }


@pytest.mark.django_db
def test_new_user_is_free_with_null_override(user):
    profile = get_user_profile(user)
    assert profile.test_plan_override is None
    assert get_user_plan(user) == BillingSubscription.Plan.FREE
    assert user_has_premium(user) is False


@pytest.mark.django_db
def test_override_disabled_premium_field_is_ignored(user):
    profile = get_user_profile(user)
    profile.test_plan_override = UserProfile.TestPlanOverride.PREMIUM
    profile.save(update_fields=["test_plan_override", "updated_at"])
    assert plan_test_override_enabled() is False
    assert active_test_plan_override(user) is None
    assert user_has_premium(user) is False
    assert get_user_plan(user) == BillingSubscription.Plan.FREE
    payload = get_billing_status_payload(user)
    assert payload["plan"] == "FREE"
    assert payload["is_premium"] is False
    assert "test_override_available" not in payload
    assert "test_plan_override" not in payload
    assert "effective_plan" not in payload


@pytest.mark.django_db
@override_settings(DEBUG=False, ALLOW_PLAN_TEST_OVERRIDE=True, ON_RENDER=False)
def test_debug_false_ignores_override(user):
    set_own_test_plan_override(user, "PREMIUM")
    assert plan_test_override_enabled() is False
    assert user_has_premium(user) is False
    payload = get_billing_status_payload(user)
    assert payload["is_premium"] is False
    assert "test_override_available" not in payload


@pytest.mark.django_db
@override_settings(DEBUG=True, ALLOW_PLAN_TEST_OVERRIDE=False, ON_RENDER=False)
def test_allow_flag_false_ignores_override(user):
    profile = get_user_profile(user)
    profile.test_plan_override = UserProfile.TestPlanOverride.PREMIUM
    profile.save(update_fields=["test_plan_override", "updated_at"])
    assert plan_test_override_enabled() is False
    assert user_has_premium(user) is False


@pytest.mark.django_db
@override_settings(DEBUG=True, ALLOW_PLAN_TEST_OVERRIDE=True, ON_RENDER=True)
def test_on_render_never_honors_override(user):
    set_own_test_plan_override(user, "PREMIUM")
    assert plan_test_override_enabled() is False
    assert user_has_premium(user) is False


@pytest.mark.django_db
@override_settings(**OVERRIDE_ON)
def test_override_premium_grants_premium_entitlements(user):
    set_own_test_plan_override(user, "PREMIUM")
    assert user_has_premium(user) is True
    entitlements = get_entitlements(user)
    assert entitlements["plan"] == "PREMIUM"
    assert entitlements["is_premium"] is True
    assert entitlements["plaid_bank_sync"] is True
    assert entitlements["payment_planner_full"] is True
    assert entitlements["reports_advanced"] is True
    assert entitlements["limits"]["linked_institutions"] is None
    assert entitlements["limits"][FEATURE_MANUAL_ACCOUNTS] is None
    assert entitlements["limits"][FEATURE_RECURRING_RULES] is None
    assert entitlements["limits"][FEATURE_FORECAST_DAYS] == 365
    assert entitlements["limits"][FEATURE_GOALS] is None
    payload = get_billing_status_payload(user)
    assert payload["plan"] == "PREMIUM"
    assert payload["is_premium"] is True
    assert payload["test_override_available"] is True
    assert payload["test_plan_override"] == "PREMIUM"
    assert payload["effective_plan"] == "PREMIUM"
    assert payload["status"] == "inactive"
    assert payload["has_stripe_customer"] is False


@pytest.mark.django_db
@override_settings(**OVERRIDE_ON)
def test_override_free_forces_free_even_with_stripe_premium(user):
    grant_premium(user)
    assert user_has_premium(user) is True
    set_own_test_plan_override(user, "FREE")
    assert user_has_premium(user) is False
    entitlements = get_entitlements(user)
    assert entitlements["plan"] == "FREE"
    assert entitlements["plaid_bank_sync"] is False
    assert entitlements["payment_planner_full"] is False
    assert entitlements["reports_advanced"] is False
    assert entitlements["limits"][FEATURE_MANUAL_ACCOUNTS] == 3
    assert entitlements["limits"][FEATURE_RECURRING_RULES] == 10
    assert entitlements["limits"][FEATURE_FORECAST_DAYS] == 90
    assert entitlements["limits"][FEATURE_GOALS] == 2
    billing = BillingSubscription.objects.get(user=user)
    assert billing.status == "active"
    assert billing.plan == BillingSubscription.Plan.PREMIUM


@pytest.mark.django_db
@override_settings(**OVERRIDE_ON)
def test_null_override_uses_stripe(user):
    grant_premium(user)
    set_own_test_plan_override(user, "FREE")
    set_own_test_plan_override(user, None)
    assert get_user_profile(user).test_plan_override is None
    assert user_has_premium(user) is True
    payload = get_billing_status_payload(user)
    assert payload["test_plan_override"] is None
    assert payload["effective_plan"] == "PREMIUM"


@pytest.mark.django_db
def test_endpoint_unavailable_when_disabled(authenticated_client, api_client):
    r = authenticated_client.post("/api/dev/test-plan/", {"plan": "PREMIUM"}, format="json")
    assert r.status_code == 404
    unauth = api_client.post("/api/dev/test-plan/", {"plan": "PREMIUM"}, format="json")
    assert unauth.status_code == 404


@pytest.mark.django_db
@override_settings(**OVERRIDE_ON)
def test_endpoint_requires_authentication(api_client):
    r = api_client.post("/api/dev/test-plan/", {"plan": "PREMIUM"}, format="json")
    assert r.status_code in (401, 403)


@pytest.mark.django_db
@override_settings(**OVERRIDE_ON)
def test_endpoint_sets_own_override_and_does_not_touch_billing(authenticated_client, user):
    before = _billing_snapshot(user)
    r = authenticated_client.post("/api/dev/test-plan/", {"plan": "PREMIUM"}, format="json")
    assert r.status_code == 200
    body = r.json()
    assert body["test_plan_override"] == "PREMIUM"
    assert body["effective_plan"] == "PREMIUM"
    assert _billing_snapshot(user) == before
    assert not BillingSubscription.objects.filter(user=user).exists()
    status_r = authenticated_client.get("/api/billing/status/")
    assert status_r.status_code == 200
    status_body = status_r.json()
    assert status_body["effective_plan"] == "PREMIUM"
    assert status_body["entitlements"]["plaid_bank_sync"] is True
    billing_after_status = BillingSubscription.objects.get(user=user)
    assert billing_after_status.status == "inactive"
    assert billing_after_status.stripe_customer_id in (None, "")
    assert billing_after_status.plan == BillingSubscription.Plan.FREE


@pytest.mark.django_db
@override_settings(**OVERRIDE_ON)
def test_user_cannot_modify_another_users_override(authenticated_client, user):
    other = User.objects.create_user(username="otheroverride", password="testpass123")
    r = authenticated_client.post(
        "/api/dev/test-plan/",
        {"plan": "PREMIUM", "user_id": other.pk},
        format="json",
    )
    assert r.status_code == 200
    assert r.json()["test_plan_override"] == "PREMIUM"
    assert get_user_profile(user).test_plan_override == "PREMIUM"
    other_profile = UserProfile.objects.filter(user=other).first()
    if other_profile is not None:
        assert other_profile.test_plan_override is None
    other_client = APIClient()
    other_client.force_authenticate(user=other)
    other_status = other_client.get("/api/billing/status/")
    assert other_status.json()["is_premium"] is False
    assert other_status.json()["test_plan_override"] is None


@pytest.mark.django_db
def test_profile_api_does_not_expose_test_plan_override(authenticated_client, user):
    get_user_profile(user)
    r = authenticated_client.get("/api/profile/")
    assert r.status_code == 200
    assert "test_plan_override" not in r.json()


@pytest.mark.django_db
@override_settings(**OVERRIDE_ON)
def test_endpoint_clears_override_with_null(authenticated_client, user):
    authenticated_client.post("/api/dev/test-plan/", {"plan": "PREMIUM"}, format="json")
    r = authenticated_client.post("/api/dev/test-plan/", {"plan": None}, format="json")
    assert r.status_code == 200
    assert r.json()["test_plan_override"] is None
    assert r.json()["effective_plan"] == "FREE"
    assert get_user_profile(user).test_plan_override is None


@pytest.mark.django_db
@override_settings(**OVERRIDE_ON)
@patch("insights.views.build_dashboard_summary", return_value={"ok": True})
def test_simulated_premium_allows_365_forecast(mock_summary, authenticated_client, user):
    authenticated_client.post("/api/dev/test-plan/", {"plan": "PREMIUM"}, format="json")
    r = authenticated_client.get("/api/insights/dashboard/summary/?forecast_days=365")
    assert r.status_code == 200
    mock_summary.assert_called_once()


@pytest.mark.django_db
@override_settings(**OVERRIDE_ON)
@patch("insights.views.build_dashboard_summary", return_value={"ok": True})
def test_simulated_free_blocks_365_forecast(mock_summary, authenticated_client, user):
    grant_premium(user)
    authenticated_client.post("/api/dev/test-plan/", {"plan": "FREE"}, format="json")
    r = authenticated_client.get("/api/insights/dashboard/summary/?forecast_days=365")
    assert r.status_code == 403
    assert r.json()["feature"] == "operational_forecast_days"
    mock_summary.assert_not_called()


@pytest.mark.django_db
@override_settings(**OVERRIDE_ON)
def test_simulated_premium_unlimited_manual_accounts(authenticated_client, household, user):
    authenticated_client.post("/api/dev/test-plan/", {"plan": "PREMIUM"}, format="json")
    for i in range(4):
        r = authenticated_client.post(
            "/api/accounts/",
            {
                "household": household.id,
                "name": f"Manual {i}",
                "account_type": "CHECKING",
                "currency": "USD",
            },
            format="json",
        )
        assert r.status_code == 201, r.data


@pytest.mark.django_db
@override_settings(**OVERRIDE_ON)
def test_simulated_free_keeps_manual_account_cap(authenticated_client, household, user):
    grant_premium(user)
    authenticated_client.post("/api/dev/test-plan/", {"plan": "FREE"}, format="json")
    for i in range(3):
        r = authenticated_client.post(
            "/api/accounts/",
            {
                "household": household.id,
                "name": f"Cap {i}",
                "account_type": "CHECKING",
                "currency": "USD",
            },
            format="json",
        )
        assert r.status_code == 201, r.data
    r = authenticated_client.post(
        "/api/accounts/",
        {
            "household": household.id,
            "name": "Cap 4",
            "account_type": "CHECKING",
            "currency": "USD",
        },
        format="json",
    )
    assert r.status_code == 403
    assert r.json()["code"] == "plan_limit_reached"


@pytest.mark.django_db
@override_settings(**OVERRIDE_ON)
def test_simulated_premium_plaid_entitlement_does_not_bypass_plaid_config(
    authenticated_client, household, user
):
    authenticated_client.post("/api/dev/test-plan/", {"plan": "PREMIUM"}, format="json")
    with patch("plaid_link.views.plaid_configured", return_value=False):
        r = authenticated_client.post(
            "/api/plaid/link-token/",
            {"household_id": household.id},
            format="json",
        )
    assert r.status_code == 503
    with patch("plaid_link.views.plaid_configured", return_value=True), patch(
        "plaid_link.views.create_link_token", return_value="link-sandbox-token"
    ):
        r = authenticated_client.post(
            "/api/plaid/link-token/",
            {"household_id": household.id},
            format="json",
        )
    assert r.status_code == 200


@pytest.mark.django_db
@override_settings(**OVERRIDE_ON)
def test_downgrade_simulation_does_not_delete_accounts(authenticated_client, household, account, user):
    authenticated_client.post("/api/dev/test-plan/", {"plan": "PREMIUM"}, format="json")
    extra = authenticated_client.post(
        "/api/accounts/",
        {
            "household": household.id,
            "name": "Kept extra",
            "account_type": "SAVINGS",
            "currency": "USD",
        },
        format="json",
    )
    assert extra.status_code == 201
    extra_id = extra.json()["id"]
    authenticated_client.post("/api/dev/test-plan/", {"plan": "FREE"}, format="json")
    from accounts.models import Account

    assert Account.objects.filter(pk=account.pk).exists()
    assert Account.objects.filter(pk=extra_id).exists()


@pytest.mark.django_db
@override_settings(**OVERRIDE_ON)
def test_simulated_premium_feature_gates(user):
    set_own_test_plan_override(user, "PREMIUM")
    require_recurring_rule_slot(user)
    require_goal_slot(user)
    require_payment_planner_full(user)
    require_plaid_bank_sync(user)
    assert user_may_use_reports_advanced(user) is True


@pytest.mark.django_db
@override_settings(**OVERRIDE_ON)
def test_simulated_free_feature_gates(user):
    grant_premium(user)
    set_own_test_plan_override(user, "FREE")
    with pytest.raises(EntitlementDenied):
        require_payment_planner_full(user)
    with pytest.raises(EntitlementDenied):
        require_plaid_bank_sync(user)
    assert user_may_use_reports_advanced(user) is False
