"""Tests for dedicated recurring-rule materialization."""
from datetime import date, timedelta
from decimal import Decimal

import pytest

from accounts.models import Account
from categories.models import Category
from core.models import Household, HouseholdMembership
from timeline.models import RecurringRule
from timeline.services.materialization import materialize_recurring_transactions_for_user
from transactions.models import Transaction

AS_OF = date(2025, 5, 1)


@pytest.fixture
def user(db):
    from django.contrib.auth import get_user_model

    return get_user_model().objects.create_user(username="mat_user", password="testpass123")


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="Mat HH")
    HouseholdMembership.objects.create(household=h, user=user, role=HouseholdMembership.Role.OWNER)
    return h


@pytest.fixture
def checking(db, household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Checking",
        starting_balance=Decimal("1000"),
        currency="USD",
        include_in_forecast=True,
    )


@pytest.fixture
def expense_category(db, household):
    return Category.objects.create(
        household=household,
        name="Rent",
        category_type=Category.CategoryType.EXPENSE,
        sort_order=1,
    )


@pytest.fixture
def monthly_rule(db, household, checking, expense_category):
    return RecurringRule.objects.create(
        household=household,
        name="Monthly Rent",
        account=checking,
        category=expense_category,
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("1200"),
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=1,
        start_date=AS_OF,
        active=True,
    )


@pytest.mark.django_db
def test_materialize_creates_future_rule_transactions(user, monthly_rule):
    before = Transaction.objects.filter(rule=monthly_rule).count()
    summary = materialize_recurring_transactions_for_user(
        user,
        through_date=AS_OF + timedelta(days=90),
        rule_ids=[monthly_rule.pk],
    )
    after = Transaction.objects.filter(rule=monthly_rule).count()
    assert after > before
    assert summary["rules_processed"] == 1
    assert summary["transactions_created"] >= 1
    assert summary["occurrences_generated"] >= 1


@pytest.mark.django_db
def test_materialize_is_idempotent(user, monthly_rule):
    materialize_recurring_transactions_for_user(
        user,
        through_date=AS_OF + timedelta(days=60),
        rule_ids=[monthly_rule.pk],
    )
    count_after_first = Transaction.objects.filter(rule=monthly_rule).count()
    second = materialize_recurring_transactions_for_user(
        user,
        through_date=AS_OF + timedelta(days=60),
        rule_ids=[monthly_rule.pk],
    )
    count_after_second = Transaction.objects.filter(rule=monthly_rule).count()
    assert count_after_second == count_after_first
    assert second["transactions_created"] == 0


@pytest.mark.django_db
def test_timeline_read_does_not_create_transactions(user, monthly_rule, checking):
    from timeline.services.ledger import build_timeline

    before = Transaction.objects.filter(rule=monthly_rule).count()
    build_timeline(
        user,
        start_date=AS_OF,
        end_date=AS_OF + timedelta(days=90),
        as_of_date=AS_OF,
        projection_only=True,
    )
    after = Transaction.objects.filter(rule=monthly_rule).count()
    assert after == before
