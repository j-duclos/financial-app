import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from core.models import Household, HouseholdMembership
from accounts.models import Account
from categories.models import Category

User = get_user_model()


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def user(db):
    return User.objects.create_user(username="testuser", password="testpass123")


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="Test Household")
    HouseholdMembership.objects.create(household=h, user=user, role=HouseholdMembership.Role.OWNER)
    return h


@pytest.fixture
def category(db, household):
    return Category.objects.create(
        household=household, name="Groceries", category_type=Category.CategoryType.EXPENSE, sort_order=1
    )


@pytest.fixture
def account(db, household):
    return Account.objects.create(
        household=household, account_type=Account.AccountType.CHECKING, name="Checking", currency="USD"
    )


@pytest.fixture
def authenticated_client(api_client, user):
    api_client.force_authenticate(user=user)
    return api_client
