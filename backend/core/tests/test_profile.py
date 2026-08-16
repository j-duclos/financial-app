from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from accounts.models import Account
from core.models import Household, HouseholdMembership, UserProfile
from core.phone_e164 import normalize_to_e164

User = get_user_model()


@pytest.fixture
def other_user(db):
    return User.objects.create_user(username="other_profile", password="testpass123")


@pytest.fixture
def other_household(db, other_user):
    h = Household.objects.create(name="Other HH")
    HouseholdMembership.objects.create(
        household=h, user=other_user, role=HouseholdMembership.Role.OWNER
    )
    return h


@pytest.fixture
def other_account(db, other_household):
    return Account.objects.create(
        household=other_household,
        account_type=Account.AccountType.CHECKING,
        name="Other checking",
        currency="USD",
        starting_balance=Decimal("10.00"),
    )


@pytest.fixture
def second_household(db, user):
    h = Household.objects.create(name="Second HH")
    HouseholdMembership.objects.create(household=h, user=user, role=HouseholdMembership.Role.OWNER)
    return h


@pytest.fixture
def second_account(db, second_household):
    return Account.objects.create(
        household=second_household,
        account_type=Account.AccountType.SAVINGS,
        name="Savings",
        currency="USD",
        starting_balance=Decimal("20.00"),
    )


def test_normalize_to_e164_us_and_plus():
    assert normalize_to_e164("5204615387") == "+15204615387"
    assert normalize_to_e164("(520) 461-5387") == "+15204615387"
    assert normalize_to_e164("+15204615387") == "+15204615387"
    assert normalize_to_e164("15204615387") == "+15204615387"
    assert normalize_to_e164("123") is None
    assert normalize_to_e164("") is None
    assert normalize_to_e164("   ") is None


def test_get_profile(authenticated_client, user):
    r = authenticated_client.get("/api/profile/")
    assert r.status_code == 200
    body = r.json()
    assert body["username"] == user.username
    assert "password" not in body
    assert "display_name" in body
    assert "phone_e164" in body
    assert "default_household" in body
    assert "default_account" in body
    assert body["default_forecast_days"] == 30


def test_profile_get_is_read_only(authenticated_client, user):
    before = UserProfile.objects.filter(user=user).count()
    authenticated_client.get("/api/profile/")
    after = UserProfile.objects.filter(user=user).count()
    assert after in (before, before + 1)
    UserProfile.objects.get(user=user)
    authenticated_client.get("/api/profile/")
    assert UserProfile.objects.filter(user=user).count() == 1


def test_patch_display_name(authenticated_client, user):
    r = authenticated_client.patch(
        "/api/profile/", {"display_name": "Alex"}, format="json"
    )
    assert r.status_code == 200
    assert r.json()["display_name"] == "Alex"
    assert UserProfile.objects.get(user=user).display_name == "Alex"


def test_patch_phone_normalizes_to_e164(authenticated_client, user):
    r = authenticated_client.patch(
        "/api/profile/", {"phone_e164": "(520) 461-5387"}, format="json"
    )
    assert r.status_code == 200, r.data
    assert r.json()["phone_e164"] == "+15204615387"
    assert UserProfile.objects.get(user=user).phone_e164 == "+15204615387"


def test_patch_invalid_phone_rejected(authenticated_client):
    r = authenticated_client.patch("/api/profile/", {"phone_e164": "123"}, format="json")
    assert r.status_code == 400
    assert "phone_e164" in r.json()


def test_patch_blank_phone_clears(authenticated_client, user):
    UserProfile.objects.filter(user=user).update(phone_e164="+15204615387")
    r = authenticated_client.patch("/api/profile/", {"phone_e164": ""}, format="json")
    assert r.status_code == 200
    assert r.json()["phone_e164"] == ""
    r = authenticated_client.patch("/api/profile/", {"phone_e164": None}, format="json")
    assert r.status_code == 200
    assert r.json()["phone_e164"] == ""


def test_valid_default_household_and_account(authenticated_client, household, account):
    r = authenticated_client.patch(
        "/api/profile/",
        {"default_household": household.pk, "default_account": account.pk},
        format="json",
    )
    assert r.status_code == 200, r.data
    assert r.json()["default_household"] == household.pk
    assert r.json()["default_account"] == account.pk


def test_foreign_household_rejected(authenticated_client, other_household):
    r = authenticated_client.patch(
        "/api/profile/", {"default_household": other_household.pk}, format="json"
    )
    assert r.status_code == 400


def test_foreign_account_rejected(authenticated_client, household, other_account):
    r = authenticated_client.patch(
        "/api/profile/",
        {"default_household": household.pk, "default_account": other_account.pk},
        format="json",
    )
    assert r.status_code == 400


def test_account_outside_selected_household_rejected(
    authenticated_client, household, second_account
):
    r = authenticated_client.patch(
        "/api/profile/",
        {"default_household": household.pk, "default_account": second_account.pk},
        format="json",
    )
    assert r.status_code == 400
    assert "default_account" in r.json()


def test_username_is_not_writable(authenticated_client, user):
    r = authenticated_client.patch(
        "/api/profile/", {"username": "hacker"}, format="json"
    )
    assert r.status_code == 200
    user.refresh_from_db()
    assert user.username == "testuser"
    assert r.json()["username"] == "testuser"


@pytest.mark.parametrize("days", [30, 60, 90, 180])
def test_patch_default_forecast_days_allowed(authenticated_client, user, days):
    r = authenticated_client.patch(
        "/api/profile/", {"default_forecast_days": days}, format="json"
    )
    assert r.status_code == 200
    assert r.json()["default_forecast_days"] == days
    assert UserProfile.objects.get(user=user).default_forecast_days == days


@pytest.mark.parametrize("days", [1, 45, 9999])
def test_patch_default_forecast_days_rejects_unsupported(authenticated_client, days):
    r = authenticated_client.patch(
        "/api/profile/", {"default_forecast_days": days}, format="json"
    )
    assert r.status_code == 400
    assert "default_forecast_days" in r.json()


def test_legacy_profile_without_saved_forecast_defaults_to_30(authenticated_client, user):
    profile, _ = UserProfile.objects.get_or_create(user=user)
    UserProfile.objects.filter(pk=profile.pk).update(default_forecast_days=45)
    r = authenticated_client.get("/api/profile/")
    assert r.status_code == 200
    assert r.json()["default_forecast_days"] == 30
