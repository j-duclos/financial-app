"""Updating a recurring rule must refresh future forecast rows (amount, schedule)."""
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
from timeline.services.ledger import build_timeline
from transactions.models import Transaction

User = get_user_model()


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def user(db):
    return User.objects.create_user(username="rule_upd_user", password="testpass123")


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="H")
    HouseholdMembership.objects.create(household=h, user=user, role=HouseholdMembership.Role.OWNER)
    return h


@pytest.mark.django_db
def test_update_rule_removes_stale_future_occurrences_and_rebuilds(api_client, user, household):
    api_client.force_authenticate(user=user)
    acct = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Main",
        currency="USD",
        include_in_forecast=True,
    )
    cat = Category.objects.create(
        household=household,
        name="Dog Food",
        category_type=Category.CategoryType.EXPENSE,
        sort_order=1,
    )
    today = timezone.localdate()
    old_start = today + timedelta(days=7)
    while old_start.weekday() != 4:
        old_start += timedelta(days=1)

    rule = RecurringRule.objects.create(
        household=household,
        name="Chewy",
        account=acct,
        category=cat,
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("80.21"),
        currency="USD",
        frequency=RecurringRule.Frequency.WEEKLY,
        interval=1,
        day_of_week=4,
        start_date=old_start,
        active=True,
    )

    end = today + timedelta(days=120)
    build_timeline(user, today, end, account_id=acct.id)
    stale = Transaction.objects.filter(rule=rule, date=old_start).first()
    assert stale is not None
    assert stale.amount == Decimal("-80.21")

    new_start = old_start + timedelta(days=7)
    while new_start.weekday() != 4:
        new_start += timedelta(days=1)

    r = api_client.patch(
        f"/api/rules/{rule.id}/",
        {
            "amount": "79.46",
            "interval": 3,
            "start_date": new_start.isoformat(),
        },
        format="json",
    )
    assert r.status_code == 200, r.content
    assert not Transaction.objects.filter(pk=stale.pk).exists()

    build_timeline(user, today, end, account_id=acct.id)
    assert not Transaction.objects.filter(rule=rule, date=old_start).exists()
    refreshed = Transaction.objects.filter(rule=rule, date__gte=today).order_by("date").first()
    assert refreshed is not None
    assert refreshed.date >= new_start
    assert refreshed.amount == Decimal("-79.46")


@pytest.mark.django_db
def test_update_rule_does_not_change_past_transaction_amount(api_client, user, household):
    api_client.force_authenticate(user=user)
    acct = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Main",
        currency="USD",
        include_in_forecast=True,
    )
    cat = Category.objects.create(
        household=household,
        name="Shopping",
        category_type=Category.CategoryType.EXPENSE,
        sort_order=1,
    )
    today = timezone.localdate()
    past = today - timedelta(days=30)
    rule = RecurringRule.objects.create(
        household=household,
        name="Affirm",
        account=acct,
        category=cat,
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("48.17"),
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=past.day,
        start_date=past,
        active=True,
    )
    past_txn = Transaction.objects.create(
        account=acct,
        date=past,
        payee="Affirm",
        amount=Decimal("-48.17"),
        category=cat,
        source=Transaction.Source.RULE,
        rule=rule,
    )
    r = api_client.patch(
        f"/api/rules/{rule.id}/",
        {"amount": "99.00", "name": "Affirm Updated", "category_id": cat.id},
        format="json",
    )
    assert r.status_code == 200, r.content
    past_txn.refresh_from_db()
    assert past_txn.amount == Decimal("-48.17")
    assert past_txn.payee == "Affirm"
