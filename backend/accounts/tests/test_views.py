"""Tests for account API saving interest_rate and interest_cycle_end_day."""
import pytest
from rest_framework.test import APIClient

from core.models import Household, HouseholdMembership
from accounts.models import Account

from django.contrib.auth import get_user_model

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
def auth_client(api_client, user):
    api_client.force_authenticate(user=user)
    return api_client


def test_create_savings_account_saves_interest_rate_and_cycle_day(auth_client, household):
    """POST with interest_rate and interest_cycle_end_day must persist them."""
    payload = {
        "household": household.id,
        "name": "My Savings",
        "account_type": "SAVINGS",
        "currency": "USD",
        "interest_rate": "4.50",
        "interest_cycle_end_day": 15,
    }
    r = auth_client.post("/api/accounts/", payload, format="json")
    assert r.status_code == 201, r.data
    data = r.json()
    assert data.get("interest_rate") is not None
    assert float(data["interest_rate"]) == 4.5
    assert data.get("interest_cycle_end_day") == 15

    # Refetch and verify persisted
    acc_id = data["id"]
    r2 = auth_client.get(f"/api/accounts/{acc_id}/")
    assert r2.status_code == 200
    data2 = r2.json()
    assert float(data2["interest_rate"]) == 4.5
    assert data2["interest_cycle_end_day"] == 15


def test_patch_savings_account_updates_interest_rate_and_cycle_day(auth_client, household):
    """PATCH with interest_rate and interest_cycle_end_day must update them."""
    acc = Account.objects.create(
        household=household,
        account_type=Account.AccountType.SAVINGS,
        name="Savings",
        currency="USD",
    )
    payload = {
        "interest_rate": "5.25",
        "interest_cycle_end_day": 1,
    }
    r = auth_client.patch(f"/api/accounts/{acc.id}/", payload, format="json")
    assert r.status_code == 200, r.data
    data = r.json()
    assert float(data["interest_rate"]) == 5.25
    assert data["interest_cycle_end_day"] == 1

    acc.refresh_from_db()
    assert float(acc.interest_rate) == 5.25
    assert acc.interest_cycle_end_day == 1


def test_create_checking_account_accepts_null_credit_card_amounts(auth_client, household):
    """Frontend sends null for credit-only balance fields on non-credit creates."""
    payload = {
        "household": household.id,
        "name": "Main Checking",
        "account_type": "CHECKING",
        "currency": "USD",
        "role": "spending",
        "minimum_buffer": "0",
        "current_balance": None,
        "statement_balance": None,
        "minimum_payment_amount": None,
        "autopay_fixed_amount": None,
        "autopay_enabled": False,
        "autopay_type": "",
    }
    r = auth_client.post("/api/accounts/", payload, format="json")
    assert r.status_code == 201, r.data


def test_create_checking_account_infers_spending_role(auth_client, household):
    payload = {
        "household": household.id,
        "name": "Main Checking",
        "account_type": "CHECKING",
        "currency": "USD",
    }
    r = auth_client.post("/api/accounts/", payload, format="json")
    assert r.status_code == 201, r.data
    data = r.json()
    assert data["role"] == "spending"
    assert data["role_display"] == "Spending"
    assert data["minimum_buffer"] == "0"


def test_create_account_with_explicit_role_and_minimum_buffer(auth_client, household):
    payload = {
        "household": household.id,
        "name": "Emergency",
        "account_type": "SAVINGS",
        "currency": "USD",
        "role": "emergency_fund",
        "minimum_buffer": "500.00",
    }
    r = auth_client.post("/api/accounts/", payload, format="json")
    assert r.status_code == 201, r.data
    data = r.json()
    assert data["role"] == "emergency_fund"
    assert data["role_display"] == "Emergency Fund"
    assert float(data["minimum_buffer"]) == 500.0


def test_patch_account_updates_role(auth_client, household):
    acc = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Checking",
        currency="USD",
        role=Account.AccountRole.SPENDING,
    )
    r = auth_client.patch(
        f"/api/accounts/{acc.id}/",
        {"role": "bills", "minimum_buffer": "100.00"},
        format="json",
    )
    assert r.status_code == 200, r.data
    data = r.json()
    assert data["role"] == "bills"
    assert data["role_display"] == "Bills"
    assert float(data["minimum_buffer"]) == 100.0

    acc.refresh_from_db()
    assert acc.role == Account.AccountRole.BILLS
    assert float(acc.minimum_buffer) == 100.0


def test_create_credit_account_infers_credit_card_role(auth_client, household):
    payload = {
        "household": household.id,
        "name": "Visa",
        "account_type": "CREDIT",
        "currency": "USD",
    }
    r = auth_client.post("/api/accounts/", payload, format="json")
    assert r.status_code == 201, r.data
    assert r.json()["role"] == "credit_card"


def test_infer_role_from_account_type():
    assert Account.infer_role_from_account_type(Account.AccountType.CHECKING) == Account.AccountRole.SPENDING
    assert Account.infer_role_from_account_type(Account.AccountType.SAVINGS) == Account.AccountRole.SAVINGS
    assert Account.infer_role_from_account_type(Account.AccountType.CREDIT) == Account.AccountRole.CREDIT_CARD
    assert Account.infer_role_from_account_type(Account.AccountType.CASH) == Account.AccountRole.OTHER
