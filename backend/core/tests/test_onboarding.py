from datetime import date
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from accounts.models import Account
from core.models import Household, HouseholdMembership, UserProfile
from core.onboarding import is_forecast_ready, setup_flags_for_user
from timeline.models import RecurringRule
from transactions.models import Transaction

User = get_user_model()


@pytest.fixture
def fresh_user(db):
    return User.objects.create_user(username="new_onboard", password="testpass123")


@pytest.fixture
def fresh_client(api_client, fresh_user):
    api_client.force_authenticate(user=fresh_user)
    return api_client


def _status(client: APIClient):
    return client.get("/api/onboarding/status/")


def test_brand_new_user_onboarding_status(fresh_client):
    r = _status(fresh_client)
    assert r.status_code == 200
    body = r.json()
    assert body["completed"] is False
    assert body["dismissed"] is False
    assert body["show_welcome"] is True
    assert body["steps"] == {
        "account": False,
        "transaction": False,
        "recurring": False,
        "forecast_ready": False,
    }
    assert body["progress"] == {"completed_steps": 0, "total_steps": 4}


def test_account_only_is_not_forecast_ready(fresh_client, fresh_user):
    household = Household.objects.create(name="New HH")
    HouseholdMembership.objects.create(
        household=household, user=fresh_user, role=HouseholdMembership.Role.OWNER
    )
    Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Checking",
        currency="USD",
        starting_balance=Decimal("0.00"),
    )
    body = _status(fresh_client).json()
    assert body["steps"]["account"] is True
    assert body["steps"]["transaction"] is False
    assert body["steps"]["recurring"] is False
    assert body["steps"]["forecast_ready"] is False
    assert body["show_welcome"] is True
    assert body["progress"]["completed_steps"] == 1


def test_zero_dollar_account_is_not_missing_setup(fresh_user):
    household = Household.objects.create(name="Zero HH")
    HouseholdMembership.objects.create(
        household=household, user=fresh_user, role=HouseholdMembership.Role.OWNER
    )
    Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Empty checking",
        currency="USD",
        starting_balance=Decimal("0.00"),
    )
    flags = setup_flags_for_user(fresh_user)
    assert flags.has_account is True
    assert flags.forecast_ready is False


def test_account_plus_transaction_is_forecast_ready(fresh_client, fresh_user):
    household = Household.objects.create(name="Txn HH")
    HouseholdMembership.objects.create(
        household=household, user=fresh_user, role=HouseholdMembership.Role.OWNER
    )
    account = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Checking",
        currency="USD",
        starting_balance=Decimal("50.00"),
    )
    Transaction.objects.create(
        account=account,
        date=date(2026, 9, 1),
        payee="Coffee",
        amount=Decimal("-4.00"),
        status=Transaction.Status.CLEARED,
        source=Transaction.Source.ACTUAL,
    )
    body = _status(fresh_client).json()
    assert body["steps"]["account"] is True
    assert body["steps"]["transaction"] is True
    assert body["steps"]["recurring"] is False
    assert body["steps"]["forecast_ready"] is True
    assert body["completed"] is True
    assert body["show_welcome"] is False
    assert body["progress"]["completed_steps"] == 3


def test_account_plus_recurring_is_forecast_ready(fresh_client, fresh_user):
    household = Household.objects.create(name="Rule HH")
    HouseholdMembership.objects.create(
        household=household, user=fresh_user, role=HouseholdMembership.Role.OWNER
    )
    account = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Checking",
        currency="USD",
    )
    RecurringRule.objects.create(
        household=household,
        account=account,
        name="Paycheck",
        direction=RecurringRule.Direction.INCOME,
        amount=Decimal("2000"),
        frequency=RecurringRule.Frequency.BIWEEKLY,
        interval=1,
        start_date=date(2026, 1, 2),
    )
    body = _status(fresh_client).json()
    assert body["steps"]["recurring"] is True
    assert body["steps"]["forecast_ready"] is True
    assert body["completed"] is True
    assert body["show_welcome"] is False


def test_forecast_ready_helper():
    assert is_forecast_ready(has_account=True, has_transaction=True, has_recurring=False) is True
    assert is_forecast_ready(has_account=True, has_transaction=False, has_recurring=True) is True
    assert is_forecast_ready(has_account=True, has_transaction=False, has_recurring=False) is False
    assert is_forecast_ready(has_account=False, has_transaction=True, has_recurring=True) is False


def test_explicit_complete(fresh_client, fresh_user):
    r = fresh_client.post("/api/onboarding/complete/")
    assert r.status_code == 200
    body = r.json()
    assert body["completed"] is True
    assert body["show_welcome"] is False
    profile = UserProfile.objects.get(user=fresh_user)
    assert profile.onboarding_completed_at is not None


def test_dismiss_hides_welcome_without_completing(fresh_client, fresh_user):
    r = fresh_client.post("/api/onboarding/dismiss/")
    assert r.status_code == 200
    body = r.json()
    assert body["dismissed"] is True
    assert body["completed"] is False
    assert body["show_welcome"] is False
    profile = UserProfile.objects.get(user=fresh_user)
    assert profile.onboarding_dismissed_at is not None
    assert profile.onboarding_completed_at is None


def test_established_legacy_user_does_not_see_welcome(authenticated_client, user, household, account):
    Transaction.objects.create(
        account=account,
        date=date(2026, 1, 1),
        payee="Existing",
        amount=Decimal("-10.00"),
        status=Transaction.Status.CLEARED,
        source=Transaction.Source.ACTUAL,
    )
    body = _status(authenticated_client).json()
    assert body["steps"]["forecast_ready"] is True
    assert body["show_welcome"] is False
    assert body["completed"] is True


def test_status_does_not_include_other_household_data(fresh_client, fresh_user, household, account):
    Transaction.objects.create(
        account=account,
        date=date(2026, 1, 1),
        payee="Other user txn",
        amount=Decimal("-25.00"),
        status=Transaction.Status.CLEARED,
        source=Transaction.Source.ACTUAL,
    )
    body = _status(fresh_client).json()
    assert body["steps"]["account"] is False
    assert body["steps"]["transaction"] is False
    assert body["steps"]["forecast_ready"] is False


def test_onboarding_requires_auth(api_client):
    assert api_client.get("/api/onboarding/status/").status_code == 401
    assert api_client.post("/api/onboarding/complete/").status_code == 401
    assert api_client.post("/api/onboarding/dismiss/").status_code == 401
