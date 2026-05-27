"""Projected statement balance at next billing cycle close."""
from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from accounts.models import Account
from accounts.services.projected_statement import calculate_projected_statement_for_account
from core.models import Household, HouseholdMembership
from timeline.models import RecurringRule
from transactions.models import Transaction

User = get_user_model()


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def user(db):
    return User.objects.create_user(username="projstmt", password="testpass123")


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="Proj Stmt HH")
    HouseholdMembership.objects.create(household=h, user=user, role=HouseholdMembership.Role.OWNER)
    return h


@pytest.fixture
def auth_client(api_client, user):
    api_client.force_authenticate(user=user)
    return api_client


@pytest.fixture
def credit_card(db, household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        role=Account.AccountRole.CREDIT_CARD,
        name="Visa",
        currency="USD",
        statement_closing_day=15,
        billing_cycle_end_day=15,
        starting_balance=Decimal("100"),
    )


def test_projected_statement_includes_future_planned_purchase(user, credit_card):
    today = date.today()
    future = today + timedelta(days=3)
    if future.day > 28:
        future = today.replace(day=min(15, today.day)) + timedelta(days=5)
    Transaction.objects.create(
        account=credit_card,
        date=today,
        payee="Starting",
        amount=Decimal("-100"),
    )
    Transaction.objects.create(
        account=credit_card,
        date=future,
        payee="Planned buy",
        amount=Decimal("-50"),
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.ONE_TIME,
    )

    result = calculate_projected_statement_for_account(user, credit_card, as_of_date=today)
    assert result["billing_cycle_end_date"] is not None
    projected = Decimal(result["projected_statement_balance"])
    assert projected >= Decimal("150")


def test_list_api_includes_projected_statement(auth_client, credit_card):
    Transaction.objects.create(
        account=credit_card,
        date=date.today(),
        payee="Purchase",
        amount=Decimal("-25"),
    )
    r = auth_client.get("/api/accounts/?forecast_summary=true&health=true")
    assert r.status_code == 200
    row = next(x for x in r.json()["results"] if x["id"] == credit_card.id)
    assert row.get("projected_statement_balance") is not None
    assert row.get("billing_cycle_end_date") is not None
