import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from core.models import Household, HouseholdMembership
from accounts.models import Account

User = get_user_model()


@pytest.fixture
def other_user(db):
    return User.objects.create_user(username="other", password="otherpass123")


@pytest.fixture
def other_household(db, other_user):
    h = Household.objects.create(name="Other Household")
    HouseholdMembership.objects.create(household=h, user=other_user, role=HouseholdMembership.Role.OWNER)
    return h


def test_cannot_access_other_household_account(
    api_client, user, household, account, other_user, other_household
):
    """User can only see their own household's accounts."""
    other_acc = Account.objects.create(
        household=other_household,
        account_type=Account.AccountType.CHECKING,
        name="Other Checking",
        currency="USD",
    )
    api_client.force_authenticate(user=user)
    # Own household account: 200
    r1 = api_client.get(f"/api/accounts/{account.id}/")
    assert r1.status_code == 200
    # Other household account: 404 (queryset is filtered)
    r2 = api_client.get(f"/api/accounts/{other_acc.id}/")
    assert r2.status_code == 404
