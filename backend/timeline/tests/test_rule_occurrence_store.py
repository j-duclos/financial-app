"""Tests for bulk rule occurrence preload store."""
from datetime import date
from decimal import Decimal

import pytest

from accounts.models import Account
from categories.models import Category
from core.models import Household, HouseholdMembership
from timeline.models import RecurringRule
from timeline.services.rule_occurrence_store import (
    RuleOccurrenceStore,
    build_rule_occurrence_store,
    make_rule_occurrence_key,
)
from transactions.models import Transaction

AS_OF = date(2025, 5, 1)


@pytest.fixture
def user(db):
    from django.contrib.auth import get_user_model

    return get_user_model().objects.create_user(username="store_user", password="testpass123")


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="Store HH")
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
    )


@pytest.fixture
def expense_category(db, household):
    return Category.objects.create(
        household=household,
        name="Rent",
        category_type=Category.CategoryType.EXPENSE,
        sort_order=1,
    )


def test_make_rule_occurrence_key_normalizes_ids():
    key = make_rule_occurrence_key(5, 10, AS_OF)
    assert key == (5, 10, AS_OF)


@pytest.mark.django_db
def test_build_rule_occurrence_store_bulk_loads(checking, expense_category, household):
    rule = RecurringRule.objects.create(
        household=household,
        name="Rent",
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
    txn = Transaction.objects.create(
        account=checking,
        date=AS_OF + __import__("datetime").timedelta(days=30),
        payee="Rent",
        amount=Decimal("-1200"),
        category=expense_category,
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.RULE,
        rule=rule,
    )
    store = build_rule_occurrence_store(
        rule_ids=[rule.pk],
        account_ids=[checking.pk],
        start_date=AS_OF,
        end_date=AS_OF + __import__("datetime").timedelta(days=90),
    )
    assert store.existing_loaded == 1
    found = store.get(rule.pk, checking.pk, txn.date)
    assert found is not None
    assert found.pk == txn.pk


@pytest.mark.django_db
def test_store_put_makes_new_creates_visible_without_db_query(checking, expense_category, household):
    rule = RecurringRule.objects.create(
        household=household,
        name="Rent",
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
    store = RuleOccurrenceStore()
    occ_date = AS_OF + __import__("datetime").timedelta(days=30)
    txn = Transaction(
        account=checking,
        date=occ_date,
        payee="Rent",
        amount=Decimal("-1200"),
        category=expense_category,
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.RULE,
        rule=rule,
        pk=9999,
    )
    store.put(txn)
    assert store.get(rule.pk, checking.pk, occ_date) is txn
