from datetime import timedelta

import pytest
from django.contrib.auth import get_user_model
from django.test import Client, override_settings
from django.urls import reverse
from django.utils import timezone

from billing.complimentary import (
    complimentary_premium_expires_at,
    complimentary_status_fields,
    has_complimentary_premium,
)
from billing.entitlements import (
    FEATURE_FORECAST_DAYS,
    FEATURE_GOALS,
    FEATURE_MANUAL_ACCOUNTS,
    FEATURE_RECURRING_RULES,
    require_payment_planner_full,
    require_plaid_bank_sync,
)
from billing.models import BillingSubscription
from billing.plan_override import (
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
from core.utils import get_user_profile

User = get_user_model()

RENDER_PRODUCTION = dict(DEBUG=False, ON_RENDER=True, ALLOW_PLAN_TEST_OVERRIDE=True)
OVERRIDE_ON = dict(DEBUG=True, ALLOW_PLAN_TEST_OVERRIDE=True, ON_RENDER=False)


def _grant_complimentary(user, *, delta: timedelta | None = None):
    profile = get_user_profile(user)
    profile.complimentary_premium_until = timezone.now() + (delta or timedelta(days=30))
    profile.save(update_fields=["complimentary_premium_until", "updated_at"])
    user.profile = profile
    user._profile = profile
    return profile


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
def test_future_complimentary_date_grants_premium(user):
    assert has_complimentary_premium(user) is False
    profile = _grant_complimentary(user)
    assert has_complimentary_premium(user) is True
    assert complimentary_premium_expires_at(user) == profile.complimentary_premium_until
    assert get_user_plan(user) == BillingSubscription.Plan.PREMIUM
    assert user_has_premium(user) is True


@pytest.mark.django_db
def test_expired_complimentary_date_does_not_grant_premium(user):
    _grant_complimentary(user, delta=timedelta(days=-1))
    assert has_complimentary_premium(user) is False
    assert user_has_premium(user) is False
    assert get_user_plan(user) == BillingSubscription.Plan.FREE
    payload = get_billing_status_payload(user)
    assert payload["complimentary_premium"] is False
    assert payload["complimentary_premium_until"] is not None
    assert payload["plan"] == "FREE"
    assert payload["is_premium"] is False


@pytest.mark.django_db
def test_null_complimentary_date_does_not_grant_premium(user):
    profile = get_user_profile(user)
    assert profile.complimentary_premium_until is None
    assert has_complimentary_premium(user) is False
    assert user_has_premium(user) is False
    fields = complimentary_status_fields(user)
    assert fields == {"complimentary_premium": False, "complimentary_premium_until": None}


@pytest.mark.django_db
@override_settings(**RENDER_PRODUCTION)
def test_complimentary_premium_works_on_render_production_settings(user):
    assert plan_test_override_enabled() is False
    _grant_complimentary(user)
    assert has_complimentary_premium(user) is True
    assert user_has_premium(user) is True
    entitlements = get_entitlements(user)
    assert entitlements["plan"] == "PREMIUM"
    assert entitlements["is_premium"] is True
    assert entitlements["plaid_bank_sync"] is True
    assert entitlements["payment_planner_full"] is True
    assert entitlements["reports_advanced"] is True
    assert entitlements["limits"][FEATURE_MANUAL_ACCOUNTS] is None
    assert entitlements["limits"][FEATURE_RECURRING_RULES] is None
    assert entitlements["limits"][FEATURE_FORECAST_DAYS] == 365
    assert entitlements["limits"][FEATURE_GOALS] is None


@pytest.mark.django_db
@override_settings(**RENDER_PRODUCTION)
def test_dev_plan_override_still_ignored_on_render(user):
    set_own_test_plan_override(user, "PREMIUM")
    assert plan_test_override_enabled() is False
    assert user_has_premium(user) is False


@pytest.mark.django_db
@override_settings(**OVERRIDE_ON)
def test_dev_override_precedes_complimentary_premium(user):
    _grant_complimentary(user)
    set_own_test_plan_override(user, "FREE")
    assert user_has_premium(user) is False
    assert get_user_plan(user) == BillingSubscription.Plan.FREE


@pytest.mark.django_db
def test_paid_stripe_user_remains_premium_without_complimentary(user):
    grant_premium(user)
    assert get_user_profile(user).complimentary_premium_until is None
    assert has_complimentary_premium(user) is False
    assert user_has_premium(user) is True
    payload = get_billing_status_payload(user)
    assert payload["plan"] == "PREMIUM"
    assert payload["complimentary_premium"] is False
    assert payload["has_stripe_customer"] is True


@pytest.mark.django_db
def test_complimentary_does_not_overwrite_or_fabricate_stripe_ids(user):
    billing = grant_premium(user)
    billing.stripe_subscription_id = "sub_live"
    billing.save(update_fields=["stripe_subscription_id", "updated_at"])
    before = _billing_snapshot(user)
    _grant_complimentary(user)
    assert user_has_premium(user) is True
    assert _billing_snapshot(user) == before
    payload = get_billing_status_payload(user)
    assert payload["complimentary_premium"] is True
    assert payload["status"] == "active"
    assert payload["has_stripe_customer"] is True
    row = BillingSubscription.objects.get(user=user)
    assert row.stripe_customer_id == "cus_test"
    assert row.stripe_subscription_id == "sub_live"
    assert row.status == "active"


@pytest.mark.django_db
def test_complimentary_does_not_create_billing_row_until_status_api(user):
    _grant_complimentary(user)
    assert user_has_premium(user) is True
    assert BillingSubscription.objects.filter(user=user).exists() is False
    payload = get_billing_status_payload(user)
    row = BillingSubscription.objects.get(user=user)
    assert payload["plan"] == "PREMIUM"
    assert payload["is_premium"] is True
    assert payload["complimentary_premium"] is True
    assert payload["status"] == "inactive"
    assert payload["has_stripe_customer"] is False
    assert row.plan == BillingSubscription.Plan.FREE
    assert row.status == "inactive"
    assert row.stripe_customer_id is None
    assert row.stripe_subscription_id is None


@pytest.mark.django_db
def test_billing_status_payload_exposes_complimentary_fields(authenticated_client, user):
    until = timezone.now() + timedelta(days=14)
    profile = get_user_profile(user)
    profile.complimentary_premium_until = until
    profile.save(update_fields=["complimentary_premium_until", "updated_at"])
    r = authenticated_client.get("/api/billing/status/")
    assert r.status_code == 200
    body = r.json()
    assert body["complimentary_premium"] is True
    assert body["complimentary_premium_until"] == until.isoformat()
    assert body["plan"] == "PREMIUM"
    assert body["is_premium"] is True
    assert body["entitlements"]["is_premium"] is True
    assert body["entitlements"]["plaid_bank_sync"] is True
    assert body["has_stripe_customer"] is False


@pytest.mark.django_db
def test_unauthenticated_status_does_not_expose_complimentary(api_client):
    r = api_client.get("/api/billing/status/")
    assert r.status_code in (401, 403)
    assert "complimentary_premium" not in r.content.decode()


@pytest.mark.django_db
def test_profile_api_does_not_expose_or_accept_complimentary_fields(authenticated_client, user):
    r = authenticated_client.get("/api/profile/")
    assert r.status_code == 200
    assert "complimentary_premium" not in r.json()
    assert "complimentary_premium_until" not in r.json()
    until = (timezone.now() + timedelta(days=90)).isoformat()
    patch = authenticated_client.patch(
        "/api/profile/",
        {"complimentary_premium_until": until, "display_name": "Beta"},
        format="json",
    )
    assert patch.status_code == 200
    assert "complimentary_premium_until" not in patch.json()
    profile = get_user_profile(user)
    profile.refresh_from_db()
    assert profile.complimentary_premium_until is None
    assert profile.display_name == "Beta"


@pytest.mark.django_db
def test_complimentary_user_receives_premium_entitlements(user):
    _grant_complimentary(user)
    require_plaid_bank_sync(user)
    require_payment_planner_full(user)
    entitlements = get_entitlements(user)
    assert entitlements["is_premium"] is True


@pytest.mark.django_db
def test_clearing_complimentary_revokes_premium(user):
    profile = _grant_complimentary(user)
    assert user_has_premium(user) is True
    profile.complimentary_premium_until = None
    profile.save(update_fields=["complimentary_premium_until", "updated_at"])
    user.profile = profile
    assert has_complimentary_premium(user) is False
    assert user_has_premium(user) is False


@pytest.mark.django_db
def test_django_admin_exposes_complimentary_premium_until(user):
    admin = User.objects.create_superuser("beta-admin", "admin@example.com", "adminpass123")
    profile = get_user_profile(user)
    client = Client()
    assert client.login(username="beta-admin", password="adminpass123")
    changelist = client.get(reverse("admin:core_userprofile_changelist"))
    assert changelist.status_code == 200
    assert b"complimentary_premium_until" in changelist.content
    change = client.get(reverse("admin:core_userprofile_change", args=[profile.pk]))
    assert change.status_code == 200
    assert b"complimentary_premium_until" in change.content
    user_change = client.get(reverse("admin:auth_user_change", args=[user.pk]))
    assert user_change.status_code == 200
    assert b"complimentary_premium_until" in user_change.content
    assert admin.pk
