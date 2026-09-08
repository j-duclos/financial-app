"""Idempotent default-household provisioning for first-run and repairs."""
import pytest
from django.contrib.auth import get_user_model

from core.models import Household, HouseholdMembership
from core.utils import ensure_default_household, get_user_profile

pytestmark = pytest.mark.django_db

User = get_user_model()


def test_new_user_gets_a_default_household(api_client):
    r = api_client.post(
        "/api/auth/register/",
        {
            "username": "onboarduser",
            "email": "onboarduser@example.com",
            "password": "UniqueHorseStaple9",
        },
        format="json",
    )
    assert r.status_code == 201, r.data
    profile = r.json()["profile"]
    assert profile["default_household"] is not None
    user = User.objects.get(username="onboarduser")
    assert HouseholdMembership.objects.filter(user=user).count() == 1
    assert user.profile.default_household_id == profile["default_household"]


def test_repeated_ensure_does_not_create_duplicate_households(user):
    first = ensure_default_household(user)
    second = ensure_default_household(user)
    third = ensure_default_household(user)
    assert first is not None
    assert second.pk == first.pk
    assert third.pk == first.pk
    assert Household.objects.filter(memberships__user=user).count() == 1
    assert HouseholdMembership.objects.filter(user=user).count() == 1


def test_single_household_missing_default_is_repaired(user):
    household = Household.objects.create(name="Only HH")
    HouseholdMembership.objects.create(
        household=household, user=user, role=HouseholdMembership.Role.OWNER
    )
    profile = get_user_profile(user)
    assert profile.default_household_id is None
    repaired = ensure_default_household(user)
    profile.refresh_from_db()
    assert repaired.pk == household.pk
    assert profile.default_household_id == household.pk
    assert Household.objects.filter(memberships__user=user).count() == 1


def test_multiple_households_without_default_are_not_arbitrarily_picked(user):
    one = Household.objects.create(name="HH One")
    two = Household.objects.create(name="HH Two")
    HouseholdMembership.objects.create(household=one, user=user, role=HouseholdMembership.Role.OWNER)
    HouseholdMembership.objects.create(household=two, user=user, role=HouseholdMembership.Role.OWNER)
    profile = get_user_profile(user)
    profile.default_household = None
    profile.save(update_fields=["default_household"])
    assert ensure_default_household(user) is None
    profile.refresh_from_db()
    assert profile.default_household_id is None
    assert Household.objects.filter(memberships__user=user).count() == 2


def test_profile_get_creates_first_household_and_is_idempotent(authenticated_client, user):
    assert HouseholdMembership.objects.filter(user=user).count() == 0
    first = authenticated_client.get("/api/profile/")
    assert first.status_code == 200
    hid = first.json()["default_household"]
    assert hid is not None
    assert HouseholdMembership.objects.filter(user=user).count() == 1
    second = authenticated_client.get("/api/profile/")
    assert second.json()["default_household"] == hid
    assert Household.objects.filter(memberships__user=user).count() == 1


def test_profile_get_repairs_single_household_default(authenticated_client, user):
    household = Household.objects.create(name="Solo")
    HouseholdMembership.objects.create(
        household=household, user=user, role=HouseholdMembership.Role.OWNER
    )
    r = authenticated_client.get("/api/profile/")
    assert r.status_code == 200
    assert r.json()["default_household"] == household.pk
