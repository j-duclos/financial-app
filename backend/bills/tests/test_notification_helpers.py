"""Tests for bill notification placeholder helpers."""
from datetime import date
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model

from accounts.models import Account
from categories.models import Category
from core.models import Household, HouseholdMembership
from timeline.models import RecurringRule

from bills.notification_helpers import bills_due_within_days, missed_bills

User = get_user_model()


@pytest.fixture
def user(db):
    return User.objects.create_user(username="notifyuser", password="testpass123")


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="Notify Household")
    HouseholdMembership.objects.create(household=h, user=user, role=HouseholdMembership.Role.OWNER)
    return h


@pytest.fixture
def checking(db, household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        name="Main",
        starting_balance=Decimal("5000"),
        currency="USD",
    )


@pytest.fixture
def expense_category(db, household):
    return Category.objects.create(
        household=household,
        name="Utilities",
        category_type=Category.CategoryType.EXPENSE,
    )


def test_bills_due_within_days(user, checking, expense_category):
    RecurringRule.objects.create(
        household=checking.household,
        name="Due Soon",
        account=checking,
        category=expense_category,
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("50"),
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        day_of_month=18,
        start_date=date(2025, 1, 1),
        active=True,
    )
    as_of = date(2026, 6, 15)
    due = bills_due_within_days(user, days=3, as_of_date=as_of)
    assert any(i["name"] == "Due Soon" for i in due)


def test_missed_bills_helper(user, checking, expense_category):
    RecurringRule.objects.create(
        household=checking.household,
        name="Overdue",
        account=checking,
        category=expense_category,
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("100"),
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        day_of_month=1,
        start_date=date(2025, 1, 1),
        active=True,
    )
    missed = missed_bills(user, as_of_date=date(2026, 6, 15))
    assert any(i["name"] == "Overdue" and i["status"] == "late" for i in missed)
