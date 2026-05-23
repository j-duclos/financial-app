"""Tests for forecast-aware available-to-spend."""
from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from accounts.models import Account
from accounts.services.available_to_spend import (
    RISK_STATUS_CRITICAL,
    RISK_STATUS_HEALTHY,
    RISK_STATUS_RISK,
    calculate_account_forecast_summary,
    calculate_forecast_summaries_for_accounts,
)
from categories.models import Category
from core.models import Household, HouseholdMembership
from timeline.models import RecurringRule
from transactions.models import Transaction, TransactionMatch
from transactions.services.posting import create_transfer

User = get_user_model()

AS_OF = date(2025, 5, 1)


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def user(db):
    return User.objects.create_user(username="atsuser", password="testpass123")


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="ATS Household")
    HouseholdMembership.objects.create(household=h, user=user, role=HouseholdMembership.Role.OWNER)
    return h


@pytest.fixture
def auth_client(api_client, user):
    api_client.force_authenticate(user=user)
    return api_client


@pytest.fixture
def checking(db, household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        name="Main Checking",
        starting_balance=Decimal("1000"),
        minimum_buffer=Decimal("200"),
        currency="USD",
    )


@pytest.fixture
def savings(db, household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.SAVINGS,
        role=Account.AccountRole.SAVINGS,
        name="Savings",
        starting_balance=Decimal("5000"),
        minimum_buffer=Decimal("500"),
        currency="USD",
    )


@pytest.fixture
def credit_card(db, household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        role=Account.AccountRole.CREDIT_CARD,
        name="Visa",
        currency="USD",
    )


@pytest.fixture
def expense_category(db, household):
    return Category.objects.create(
        household=household,
        name="Rent",
        category_type=Category.CategoryType.EXPENSE,
        sort_order=1,
    )


def _summary(user, account, **kwargs):
    return calculate_account_forecast_summary(user, account, as_of_date=AS_OF, **kwargs)


def test_no_future_transactions_uses_buffer(user, checking):
    s = _summary(user, checking, days=30)
    assert s["supports_available_to_spend"] is True
    assert Decimal(s["current_balance"]) == Decimal("1000")
    assert Decimal(s["available_to_spend"]) == Decimal("800")
    assert s["risk_status"] == RISK_STATUS_HEALTHY


def test_minimum_buffer_reduces_available(user, checking):
    checking.minimum_buffer = Decimal("400")
    checking.save(update_fields=["minimum_buffer"])
    s = _summary(user, checking, days=30)
    assert Decimal(s["available_to_spend"]) == Decimal("600")


def test_future_bill_reduces_available(user, checking, expense_category):
    Transaction.objects.create(
        account=checking,
        date=AS_OF + timedelta(days=5),
        payee="Rent",
        amount=Decimal("-1500"),
        category=expense_category,
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.ONE_TIME,
    )
    s = _summary(user, checking, days=30)
    assert Decimal(s["lowest_projected_balance"]) == Decimal("-500")
    assert Decimal(s["available_to_spend"]) == Decimal("-700")
    assert s["risk_status"] == RISK_STATUS_CRITICAL


def test_paycheck_later_still_catches_mid_month_risk(user, checking, expense_category):
    Transaction.objects.create(
        account=checking,
        date=AS_OF + timedelta(days=5),
        payee="Rent",
        amount=Decimal("-1500"),
        category=expense_category,
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.ONE_TIME,
    )
    Transaction.objects.create(
        account=checking,
        date=AS_OF + timedelta(days=20),
        payee="Paycheck",
        amount=Decimal("2000"),
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.ONE_TIME,
    )
    s = _summary(user, checking, days=30)
    assert Decimal(s["lowest_projected_balance"]) == Decimal("-500")
    assert Decimal(s["projected_balance_at_window_end"]) == Decimal("1500")
    assert Decimal(s["available_to_spend"]) == Decimal("-700")


def test_uses_lowest_not_ending_balance(user, checking, expense_category):
    Transaction.objects.create(
        account=checking,
        date=AS_OF + timedelta(days=3),
        payee="Bill",
        amount=Decimal("-100"),
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.ONE_TIME,
    )
    Transaction.objects.create(
        account=checking,
        date=AS_OF + timedelta(days=25),
        payee="Bonus",
        amount=Decimal("5000"),
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.ONE_TIME,
    )
    s = _summary(user, checking, days=30)
    assert Decimal(s["lowest_projected_balance"]) == Decimal("900")
    assert Decimal(s["projected_balance_at_window_end"]) == Decimal("5900")
    avail_from_lowest = Decimal(s["lowest_projected_balance"]) - Decimal(s["minimum_buffer"])
    assert Decimal(s["available_to_spend"]) == avail_from_lowest


def test_outgoing_transfer_reduces_source(user, checking, savings, expense_category):
    transfer_cat = Category.objects.create(
        household=checking.household,
        name="Bank Transfer",
        category_type=Category.CategoryType.EXPENSE,
        sort_order=2,
    )
    create_transfer(
        user,
        from_account_id=checking.pk,
        to_account_id=savings.pk,
        amount=Decimal("300"),
        transfer_date=AS_OF + timedelta(days=7),
        from_category_id=transfer_cat.pk,
        payee="To savings",
    )
    src = _summary(user, checking, days=30)
    dst = _summary(user, savings, days=30)
    assert Decimal(src["lowest_projected_balance"]) == Decimal("700")
    assert Decimal(dst["lowest_projected_balance"]) == Decimal("5000")
    assert Decimal(dst["projected_balance_at_window_end"]) == Decimal("5300")


def test_matched_plaid_does_not_double_count(user, checking, expense_category):
    planned = Transaction.objects.create(
        account=checking,
        date=AS_OF,
        payee="Groceries",
        amount=Decimal("-50"),
        category=expense_category,
        status=Transaction.Status.CLEARED,
        source=Transaction.Source.ONE_TIME,
        cleared=True,
    )
    imported = Transaction.objects.create(
        account=checking,
        date=AS_OF,
        payee="GROCERY STORE",
        amount=Decimal("-50"),
        source=Transaction.Source.PLAID,
        plaid_transaction_id="plaid-ats-1",
    )
    TransactionMatch.objects.create(
        planned_transaction=planned,
        imported_transaction=imported,
        match_type=TransactionMatch.MatchType.MANUAL,
        confidence=TransactionMatch.Confidence.MANUAL,
    )
    s = _summary(user, checking, days=30)
    assert Decimal(s["current_balance"]) == Decimal("950")
    assert Decimal(s["upcoming_outflows"]) == Decimal("0")


def test_ignored_duplicate_plaid_excluded(user, checking):
    Transaction.objects.create(
        account=checking,
        date=AS_OF,
        payee="Duplicate",
        amount=Decimal("-100"),
        source=Transaction.Source.PLAID,
        import_match_status=Transaction.ImportMatchStatus.DUPLICATE,
        plaid_transaction_id="dup-1",
    )
    s = _summary(user, checking, days=30)
    assert Decimal(s["current_balance"]) == Decimal("1000")


def test_risk_when_below_buffer_not_zero(user, checking, expense_category):
    checking.minimum_buffer = Decimal("200")
    checking.save(update_fields=["minimum_buffer"])
    Transaction.objects.create(
        account=checking,
        date=AS_OF + timedelta(days=10),
        payee="Bill",
        amount=Decimal("-850"),
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.ONE_TIME,
    )
    s = _summary(user, checking, days=30)
    assert Decimal(s["lowest_projected_balance"]) == Decimal("150")
    assert s["risk_status"] == RISK_STATUS_RISK


def test_credit_card_no_available_to_spend(user, credit_card):
    s = _summary(user, credit_card, days=30)
    assert s["supports_available_to_spend"] is False
    assert s["available_to_spend"] is None


def test_batch_forecast_summaries(user, checking, savings):
    summaries = calculate_forecast_summaries_for_accounts(
        user, [checking, savings], as_of_date=AS_OF, days=30
    )
    assert checking.id in summaries
    assert savings.id in summaries
    assert summaries[checking.id]["supports_available_to_spend"] is True


def test_forecast_summary_api(auth_client, checking):
    r = auth_client.get("/api/accounts/forecast-summary/?days=30")
    assert r.status_code == 200
    data = r.json()
    assert data["days"] == 30
    assert any(a["account_id"] == checking.id for a in data["accounts"])


def test_available_to_spend_detail_api(auth_client, checking):
    r = auth_client.get(f"/api/accounts/{checking.id}/available-to-spend/?days=30")
    assert r.status_code == 200
    assert r.json()["available_to_spend"] is not None


def test_list_with_forecast_summary(auth_client, checking):
    r = auth_client.get("/api/accounts/?forecast_summary=true&balance=true&days=30")
    assert r.status_code == 200
    results = r.json()["results"]
    row = next(x for x in results if x["id"] == checking.id)
    assert row.get("available_to_spend") is not None
    assert row.get("risk_status") is not None


def test_recurring_rule_future_occurrence(user, checking, expense_category):
    RecurringRule.objects.create(
        household=checking.household,
        name="Weekly",
        account=checking,
        category=expense_category,
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("100"),
        currency="USD",
        frequency=RecurringRule.Frequency.WEEKLY,
        interval=1,
        day_of_week=AS_OF.weekday(),
        start_date=AS_OF + timedelta(days=7),
        active=True,
    )
    s = _summary(user, checking, days=30)
    assert Decimal(s["upcoming_outflows"]) > 0
