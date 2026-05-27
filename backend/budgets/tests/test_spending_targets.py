"""Tests for spending target calculations and API."""
from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model

from accounts.models import Account
from budgets.models import SpendingTarget
from budgets.services.spending_targets import (
    STATUS_ABOVE,
    STATUS_APPROACHING,
    STATUS_WITHIN,
    calculate_target_metrics,
    period_bounds,
    recommendations_from_spending_targets,
    spending_targets_summary,
)
from categories.models import Category
from core.models import Household, HouseholdMembership
from transactions.models import Transaction

User = get_user_model()
AS_OF = date(2026, 5, 15)


@pytest.fixture
def user(db):
    return User.objects.create_user(username="stuser", password="testpass123")


@pytest.fixture
def household(user):
    h = Household.objects.create(name="ST Home")
    HouseholdMembership.objects.create(household=h, user=user, role=HouseholdMembership.Role.OWNER)
    return h


@pytest.fixture
def expense_category(household):
    return Category.objects.create(
        household=household,
        name="Groceries",
        category_type=Category.CategoryType.EXPENSE,
    )


@pytest.fixture
def transfer_category(household):
    return Category.objects.create(
        household=household,
        name="Transfer",
        category_type=Category.CategoryType.EXPENSE,
        is_system=True,
    )


@pytest.fixture
def checking(household):
    return Account.objects.create(
        household=household,
        name="Main",
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        starting_balance=Decimal("5000"),
    )


@pytest.fixture
def target(household, expense_category):
    return SpendingTarget.objects.create(
        household=household,
        category=expense_category,
        target_amount=Decimal("700"),
        period=SpendingTarget.Period.MONTHLY,
        warning_threshold_percent=Decimal("80"),
    )


@pytest.mark.django_db
def test_period_bounds_monthly():
    start, end = period_bounds("monthly", date(2026, 5, 15))
    assert start == date(2026, 5, 1)
    assert end == date(2026, 5, 31)


@pytest.mark.django_db
def test_spent_excludes_transfers(
    user, household, checking, expense_category, transfer_category, target
):
    Transaction.objects.create(
        account=checking,
        date=AS_OF,
        payee="Groceries",
        amount=Decimal("-100"),
        category=expense_category,
        status=Transaction.Status.CLEARED,
    )
    Transaction.objects.create(
        account=checking,
        date=AS_OF,
        payee="Xfer",
        amount=Decimal("-200"),
        category=transfer_category,
        status=Transaction.Status.CLEARED,
    )
    metrics = calculate_target_metrics(target, anchor=AS_OF, today=AS_OF, include_forecast=False)
    assert Decimal(metrics["spent_so_far"]) == Decimal("100")


@pytest.mark.django_db
def test_credit_card_payment_category_excluded(
    user, household, checking, expense_category, target
):
    cc_pay = Category.objects.create(
        household=household,
        name="Credit Card Payment",
        category_type=Category.CategoryType.EXPENSE,
        is_system=True,
    )
    Transaction.objects.create(
        account=checking,
        date=AS_OF,
        payee="Card pay",
        amount=Decimal("-500"),
        category=cc_pay,
        status=Transaction.Status.CLEARED,
    )
    Transaction.objects.create(
        account=checking,
        date=AS_OF,
        payee="Food",
        amount=Decimal("-50"),
        category=expense_category,
        status=Transaction.Status.CLEARED,
    )
    metrics = calculate_target_metrics(target, anchor=AS_OF, today=AS_OF, include_forecast=False)
    assert Decimal(metrics["spent_so_far"]) == Decimal("50")


@pytest.mark.django_db
def test_projected_includes_planned_future(user, household, checking, expense_category, target):
    Transaction.objects.create(
        account=checking,
        date=AS_OF,
        payee="So far",
        amount=Decimal("-420"),
        category=expense_category,
        status=Transaction.Status.CLEARED,
    )
    Transaction.objects.create(
        account=checking,
        date=AS_OF + timedelta(days=10),
        payee="Future shop",
        amount=Decimal("-200"),
        category=expense_category,
        status=Transaction.Status.PLANNED,
    )
    metrics = calculate_target_metrics(target, anchor=AS_OF, today=AS_OF, include_forecast=True)
    assert Decimal(metrics["spent_so_far"]) == Decimal("420")
    assert Decimal(metrics["projected_period_spend"]) >= Decimal("620")
    assert metrics["status"] in (STATUS_ABOVE, STATUS_APPROACHING)


@pytest.mark.django_db
def test_above_target_status(user, household, checking, expense_category, target):
    Transaction.objects.create(
        account=checking,
        date=AS_OF,
        payee="Big shop",
        amount=Decimal("-750"),
        category=expense_category,
        status=Transaction.Status.CLEARED,
    )
    metrics = calculate_target_metrics(target, anchor=AS_OF, today=AS_OF, include_forecast=False)
    assert metrics["status"] == STATUS_ABOVE
    assert Decimal(metrics["projected_over_under"]) > 0


@pytest.mark.django_db
def test_approaching_threshold(user, household, checking, expense_category, target):
    Transaction.objects.create(
        account=checking,
        date=AS_OF,
        payee="Shop",
        amount=Decimal("-580"),
        category=expense_category,
        status=Transaction.Status.CLEARED,
    )
    metrics = calculate_target_metrics(target, anchor=AS_OF, today=AS_OF, include_forecast=False)
    assert metrics["status"] == STATUS_APPROACHING


@pytest.mark.django_db
def test_recommendation_generated(user, target, household, checking, expense_category):
    Transaction.objects.create(
        account=checking,
        date=AS_OF,
        payee="Spend",
        amount=Decimal("-800"),
        category=expense_category,
        status=Transaction.Status.CLEARED,
    )
    recs = recommendations_from_spending_targets(user, anchor=AS_OF)
    assert len(recs) >= 1
    assert "Groceries" in recs[0]["why"] or "groceries" in recs[0]["why"].lower()


@pytest.fixture
def api_client():
    from rest_framework.test import APIClient

    return APIClient()


@pytest.mark.django_db
def test_summary_endpoint(api_client, user, household, target):
    api_client.force_authenticate(user=user)
    r = api_client.get("/api/spending-targets/summary/")
    assert r.status_code == 200
    assert "targets" in r.json()
    assert "total_monthly_targets" in r.json()
