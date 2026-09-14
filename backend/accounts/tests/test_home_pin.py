from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from accounts.models import Account
from accounts.services.home_pin import HOME_PIN_LIMIT_MESSAGE, HOME_PIN_INACTIVE_MESSAGE
from core.models import Household, HouseholdMembership

User = get_user_model()


@pytest.fixture
def auth_client(api_client, user):
    api_client.force_authenticate(user=user)
    return api_client


def _checking(household, name="Checking", **kwargs):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name=name,
        currency="USD",
        **kwargs,
    )


def test_list_includes_unpinned_home_fields(auth_client, household):
    acc = _checking(household)
    r = auth_client.get("/api/accounts/?balance=true&active_only=true")
    assert r.status_code == 200
    row = next(item for item in r.json()["results"] if item["id"] == acc.id)
    assert row["pinned_to_home"] is False
    assert row["home_pin_order"] is None


def test_pin_first_account(auth_client, household):
    acc = _checking(household)
    r = auth_client.patch(f"/api/accounts/{acc.id}/", {"pinned_to_home": True}, format="json")
    assert r.status_code == 200, r.data
    assert r.json()["pinned_to_home"] is True
    assert r.json()["home_pin_order"] == 1
    acc.refresh_from_db()
    assert acc.pinned_to_home is True
    assert acc.home_pin_order == 1


def test_pin_up_to_four_and_reject_fifth(auth_client, household):
    accounts = [_checking(household, name=f"A{i}") for i in range(5)]
    for acc in accounts[:4]:
        r = auth_client.patch(f"/api/accounts/{acc.id}/", {"pinned_to_home": True}, format="json")
        assert r.status_code == 200, r.data
    orders = [
        Account.objects.get(pk=acc.pk).home_pin_order for acc in accounts[:4]
    ]
    assert orders == [1, 2, 3, 4]

    fifth = auth_client.patch(
        f"/api/accounts/{accounts[4].id}/", {"pinned_to_home": True}, format="json"
    )
    assert fifth.status_code == 400
    assert HOME_PIN_LIMIT_MESSAGE in str(fifth.data)
    accounts[4].refresh_from_db()
    assert accounts[4].pinned_to_home is False
    assert accounts[4].home_pin_order is None


def test_unpin_compacts_remaining_order(auth_client, household):
    first, second, third = [_checking(household, name=n) for n in ("One", "Two", "Three")]
    for acc in (first, second, third):
        auth_client.patch(f"/api/accounts/{acc.id}/", {"pinned_to_home": True}, format="json")

    r = auth_client.patch(f"/api/accounts/{second.id}/", {"pinned_to_home": False}, format="json")
    assert r.status_code == 200
    assert r.json()["pinned_to_home"] is False
    assert r.json()["home_pin_order"] is None
    first.refresh_from_db()
    third.refresh_from_db()
    second.refresh_from_db()
    assert first.home_pin_order == 1
    assert third.home_pin_order == 2
    assert second.home_pin_order is None


def test_pin_order_is_deterministic_via_home_pin_order(auth_client, household):
    first = _checking(household, name="First")
    second = _checking(household, name="Second")
    auth_client.patch(f"/api/accounts/{first.id}/", {"pinned_to_home": True}, format="json")
    auth_client.patch(
        f"/api/accounts/{second.id}/",
        {"pinned_to_home": True, "home_pin_order": 1},
        format="json",
    )
    first.refresh_from_db()
    second.refresh_from_db()
    assert second.home_pin_order == 1
    assert first.home_pin_order == 2


def test_cannot_pin_closed_account(auth_client, household):
    acc = _checking(household, name="Closed", status=Account.Status.CLOSED, is_active=False)
    r = auth_client.patch(f"/api/accounts/{acc.id}/", {"pinned_to_home": True}, format="json")
    assert r.status_code == 400
    assert HOME_PIN_INACTIVE_MESSAGE in str(r.data)
    acc.refresh_from_db()
    assert acc.pinned_to_home is False


def test_closed_account_keeps_existing_pin(auth_client, household):
    acc = _checking(household)
    auth_client.patch(f"/api/accounts/{acc.id}/", {"pinned_to_home": True}, format="json")
    Account.objects.filter(pk=acc.pk).update(status=Account.Status.CLOSED, is_active=False)
    acc.refresh_from_db()
    assert acc.pinned_to_home is True
    assert acc.home_pin_order == 1


def test_cannot_pin_another_users_account(auth_client, household, db):
    other = User.objects.create_user(username="pin-other", password="x")
    other_hh = Household.objects.create(name="Other pin HH")
    HouseholdMembership.objects.create(
        household=other_hh, user=other, role=HouseholdMembership.Role.OWNER
    )
    foreign = _checking(other_hh, name="Theirs")
    r = auth_client.patch(f"/api/accounts/{foreign.id}/", {"pinned_to_home": True}, format="json")
    assert r.status_code == 404
    foreign.refresh_from_db()
    assert foreign.pinned_to_home is False


def test_pins_are_household_wide(auth_client, household, api_client):
    acc = _checking(household)
    assert auth_client.patch(
        f"/api/accounts/{acc.id}/", {"pinned_to_home": True}, format="json"
    ).status_code == 200

    roommate = User.objects.create_user(username="pin-roommate", password="x")
    HouseholdMembership.objects.create(
        household=household, user=roommate, role=HouseholdMembership.Role.MEMBER
    )
    other_client = APIClient()
    other_client.force_authenticate(user=roommate)
    r = other_client.get("/api/accounts/?balance=true&active_only=true")
    assert r.status_code == 200
    row = next(item for item in r.json()["results"] if item["id"] == acc.id)
    assert row["pinned_to_home"] is True
    assert row["home_pin_order"] == 1


def test_pin_only_patch_does_not_invalidate_financial_cache(auth_client, household):
    acc = _checking(household)
    with patch("accounts.signals.invalidate_financial_cache_for_household") as mock_inv:
        r = auth_client.patch(
            f"/api/accounts/{acc.id}/", {"pinned_to_home": True}, format="json"
        )
    assert r.status_code == 200, r.data
    mock_inv.assert_not_called()


def test_pin_to_home_action(auth_client, household):
    acc = _checking(household)
    r = auth_client.post(f"/api/accounts/{acc.id}/pin-to-home/", {"pinned_to_home": True}, format="json")
    assert r.status_code == 200, r.data
    assert r.json()["home_pin_order"] == 1
    r2 = auth_client.post(
        f"/api/accounts/{acc.id}/pin-to-home/", {"pinned_to_home": False}, format="json"
    )
    assert r2.status_code == 200
    assert r2.json()["pinned_to_home"] is False
