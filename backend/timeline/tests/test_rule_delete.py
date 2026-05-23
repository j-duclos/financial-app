"""Deleting a recurring rule should remove future materialized transactions, not orphan them."""
from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Account
from categories.models import Category
from core.models import Household, HouseholdMembership
from timeline.models import RecurringRule
from transactions.models import Transaction, Transfer

User = get_user_model()


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def user(db):
    return User.objects.create_user(username="rule_del_user", password="testpass123")


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="H")
    HouseholdMembership.objects.create(household=h, user=user, role=HouseholdMembership.Role.OWNER)
    return h


@pytest.mark.django_db
def test_delete_rule_removes_future_not_past_transactions(api_client, user, household):
    api_client.force_authenticate(user=user)
    acct = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Checking",
        currency="USD",
    )
    cat = Category.objects.create(
        household=household,
        name="Insurance",
        category_type=Category.CategoryType.EXPENSE,
        sort_order=1,
    )
    rule = RecurringRule.objects.create(
        household=household,
        name="Progressive",
        account=acct,
        category=cat,
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("306.66"),
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=15,
        start_date=date(2025, 1, 1),
        active=True,
    )
    today = timezone.localdate()
    past = today - timedelta(days=5)
    future = today + timedelta(days=14)
    past_txn = Transaction.objects.create(
        account=acct,
        date=past,
        payee="Progressive",
        amount=Decimal("-306.66"),
        category=cat,
        source=Transaction.Source.RULE,
        rule=rule,
    )
    future_txn = Transaction.objects.create(
        account=acct,
        date=future,
        payee="Progressive",
        amount=Decimal("-306.66"),
        category=cat,
        source=Transaction.Source.RULE,
        rule=rule,
    )
    r = api_client.delete(f"/api/rules/{rule.id}/")
    assert r.status_code in (204, 200), r.content
    assert not RecurringRule.objects.filter(pk=rule.pk).exists()
    assert not Transaction.objects.filter(pk=future_txn.pk).exists()
    assert Transaction.objects.filter(pk=past_txn.pk).exists()
    past_txn.refresh_from_db()
    assert past_txn.rule_id is None


@pytest.mark.django_db
def test_delete_rule_removes_transfer_pair_future(api_client, user, household):
    api_client.force_authenticate(user=user)
    bank = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Chase",
        currency="USD",
    )
    card = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        name="Savor",
        currency="USD",
    )
    cat = Category.objects.create(
        household=household,
        name="Credit Card Payment",
        category_type=Category.CategoryType.EXPENSE,
        sort_order=1,
    )
    rule = RecurringRule.objects.create(
        household=household,
        name="Pay card",
        account=bank,
        transfer_to_account=card,
        category=cat,
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("100.00"),
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=20,
        start_date=date(2025, 1, 1),
        active=True,
    )
    today = timezone.localdate()
    d = today + timedelta(days=7)
    out_t = Transaction.objects.create(
        account=bank,
        date=d,
        payee="Pay card",
        amount=Decimal("-100.00"),
        category=cat,
        source=Transaction.Source.RULE,
        rule=rule,
    )
    in_t = Transaction.objects.create(
        account=card,
        date=d,
        payee="Pay card",
        amount=Decimal("100.00"),
        source=Transaction.Source.RULE,
        rule=rule,
    )
    Transfer.objects.create(from_transaction=out_t, to_transaction=in_t, amount=Decimal("100.00"), date=d)
    r = api_client.delete(f"/api/rules/{rule.id}/")
    assert r.status_code in (204, 200), r.content
    assert not Transaction.objects.filter(pk__in=[out_t.pk, in_t.pk]).exists()
    assert Transfer.objects.count() == 0
