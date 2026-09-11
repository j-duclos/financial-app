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
    assert body["checklist"] == {
        "account": False,
        "upcoming_transaction": False,
        "recurring": False,
        "goal": False,
    }


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
    assert body["checklist"]["account"] is True
    assert body["checklist"]["upcoming_transaction"] is False
    assert body["checklist"]["goal"] is False


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


def test_past_transaction_does_not_complete_upcoming_checklist(fresh_client, fresh_user):
    from datetime import timedelta

    from django.utils import timezone

    household = Household.objects.create(name="Past Txn HH")
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
        date=timezone.localdate() - timedelta(days=3),
        payee="Coffee",
        amount=Decimal("-4.00"),
        status=Transaction.Status.CLEARED,
        source=Transaction.Source.ACTUAL,
    )
    body = _status(fresh_client).json()
    assert body["steps"]["transaction"] is True
    assert body["checklist"]["upcoming_transaction"] is False


def test_future_manual_transaction_completes_upcoming_checklist(fresh_client, fresh_user):
    from datetime import timedelta

    from django.utils import timezone

    household = Household.objects.create(name="Future Txn HH")
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
        date=timezone.localdate() + timedelta(days=5),
        payee="Rent",
        amount=Decimal("-1200.00"),
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.ONE_TIME,
    )
    body = _status(fresh_client).json()
    assert body["checklist"]["account"] is True
    assert body["checklist"]["upcoming_transaction"] is True
    assert body["steps"]["forecast_ready"] is True


def _household_checking(user, name):
    household = Household.objects.create(name=name)
    HouseholdMembership.objects.create(
        household=household, user=user, role=HouseholdMembership.Role.OWNER
    )
    account = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Checking",
        currency="USD",
        starting_balance=Decimal("50.00"),
    )
    return household, account


def test_today_transaction_does_not_complete_upcoming_checklist(fresh_client, fresh_user):
    from django.utils import timezone

    _, account = _household_checking(fresh_user, "Today Txn HH")
    Transaction.objects.create(
        account=account,
        date=timezone.localdate(),
        payee="Groceries",
        amount=Decimal("-20.00"),
        status=Transaction.Status.CLEARED,
        source=Transaction.Source.ACTUAL,
    )
    body = _status(fresh_client).json()
    assert body["steps"]["transaction"] is True
    assert body["checklist"]["upcoming_transaction"] is False


def test_rule_future_transaction_does_not_complete_upcoming_checklist(fresh_client, fresh_user):
    from datetime import timedelta

    from django.utils import timezone

    _, account = _household_checking(fresh_user, "Rule Future HH")
    Transaction.objects.create(
        account=account,
        date=timezone.localdate() + timedelta(days=2),
        payee="Generated rent",
        amount=Decimal("-1200.00"),
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.RULE,
    )
    body = _status(fresh_client).json()
    assert body["steps"]["transaction"] is True
    assert body["checklist"]["upcoming_transaction"] is False


def test_plaid_future_transaction_does_not_complete_upcoming_checklist(fresh_client, fresh_user):
    from datetime import timedelta

    from django.utils import timezone

    _, account = _household_checking(fresh_user, "Plaid Future HH")
    Transaction.objects.create(
        account=account,
        date=timezone.localdate() + timedelta(days=4),
        payee="Imported anomaly",
        amount=Decimal("-15.00"),
        status=Transaction.Status.CLEARED,
        source=Transaction.Source.PLAID,
    )
    body = _status(fresh_client).json()
    assert body["steps"]["transaction"] is True
    assert body["checklist"]["upcoming_transaction"] is False


def test_future_manual_income_transfer_and_card_payment_complete_upcoming_checklist(
    fresh_client, fresh_user
):
    from datetime import timedelta

    from django.utils import timezone

    tomorrow = timezone.localdate() + timedelta(days=1)
    _, income_account = _household_checking(fresh_user, "Income Future HH")
    Transaction.objects.create(
        account=income_account,
        date=tomorrow,
        payee="Paycheck",
        amount=Decimal("1800.00"),
        status=Transaction.Status.CLEARED,
        source=Transaction.Source.ACTUAL,
    )
    assert _status(fresh_client).json()["checklist"]["upcoming_transaction"] is True

    transfer_user = User.objects.create_user(username="xfer_onboard", password="testpass123")
    _, transfer_account = _household_checking(transfer_user, "Transfer Future HH")
    transfer_client = APIClient()
    transfer_client.force_authenticate(user=transfer_user)
    Transaction.objects.create(
        account=transfer_account,
        date=tomorrow,
        payee="Transfer",
        amount=Decimal("-50.00"),
        status=Transaction.Status.CLEARED,
        source=Transaction.Source.ACTUAL,
        transaction_type=Transaction.TransactionType.TRANSFER,
    )
    assert (
        transfer_client.get("/api/onboarding/status/").json()["checklist"]["upcoming_transaction"]
        is True
    )

    card_user = User.objects.create_user(username="card_onboard", password="testpass123")
    _, card_account = _household_checking(card_user, "Card Future HH")
    card_client = APIClient()
    card_client.force_authenticate(user=card_user)
    Transaction.objects.create(
        account=card_account,
        date=tomorrow,
        payee="Credit card payment",
        amount=Decimal("-80.00"),
        status=Transaction.Status.CLEARED,
        source=Transaction.Source.ACTUAL,
        transaction_type=Transaction.TransactionType.CREDIT_CARD_PAYMENT,
    )
    assert card_client.get("/api/onboarding/status/").json()["checklist"]["upcoming_transaction"] is True


def test_inactive_recurring_does_not_complete_checklist_recurring(fresh_client, fresh_user):
    household, account = _household_checking(fresh_user, "Inactive Rule HH")
    RecurringRule.objects.create(
        household=household,
        account=account,
        name="Paused rent",
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("1200"),
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        start_date=date(2026, 1, 1),
        active=False,
    )
    body = _status(fresh_client).json()
    assert body["steps"]["recurring"] is True
    assert body["steps"]["forecast_ready"] is True
    assert body["checklist"]["recurring"] is False


def test_active_recurring_completes_checklist_recurring(fresh_client, fresh_user):
    household, account = _household_checking(fresh_user, "Active Rule HH")
    RecurringRule.objects.create(
        household=household,
        account=account,
        name="Paycheck",
        direction=RecurringRule.Direction.INCOME,
        amount=Decimal("2000"),
        frequency=RecurringRule.Frequency.BIWEEKLY,
        interval=1,
        start_date=date(2026, 1, 2),
        active=True,
    )
    body = _status(fresh_client).json()
    assert body["checklist"]["recurring"] is True
    assert body["steps"]["recurring"] is True


def test_active_or_paused_goal_completes_goal_checklist(fresh_client, fresh_user):
    from goals.models import GoalBucket

    household = Household.objects.create(name="Goal HH")
    HouseholdMembership.objects.create(
        household=household, user=fresh_user, role=HouseholdMembership.Role.OWNER
    )
    Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Checking",
        currency="USD",
        starting_balance=Decimal("100.00"),
    )
    GoalBucket.objects.create(
        household=household,
        name="Emergency",
        type=GoalBucket.BucketType.EMERGENCY,
        target_amount=Decimal("1000.00"),
        status=GoalBucket.Status.PAUSED,
    )
    body = _status(fresh_client).json()
    assert body["checklist"]["goal"] is True
    assert body["steps"]["forecast_ready"] is False


def test_archived_goal_does_not_complete_goal_checklist(fresh_client, fresh_user):
    from goals.models import GoalBucket

    household = Household.objects.create(name="Archived Goal HH")
    HouseholdMembership.objects.create(
        household=household, user=fresh_user, role=HouseholdMembership.Role.OWNER
    )
    GoalBucket.objects.create(
        household=household,
        name="Old goal",
        type=GoalBucket.BucketType.CUSTOM,
        target_amount=Decimal("500.00"),
        status=GoalBucket.Status.ARCHIVED,
    )
    body = _status(fresh_client).json()
    assert body["checklist"]["goal"] is False
