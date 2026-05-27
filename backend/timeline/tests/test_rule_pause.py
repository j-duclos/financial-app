"""Pausing a recurring rule removes future materialized rows and blocks re-materialization."""
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
    return User.objects.create_user(username="rule_pause_user", password="testpass123")


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="H")
    HouseholdMembership.objects.create(household=h, user=user, role=HouseholdMembership.Role.OWNER)
    return h


@pytest.mark.django_db
def test_pause_rule_removes_transactions_after_pause_date(api_client, user, household):
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
        name="Streaming",
        category_type=Category.CategoryType.EXPENSE,
        sort_order=1,
    )
    today = timezone.localdate()
    rule = RecurringRule.objects.create(
        household=household,
        name="Hulu",
        account=acct,
        category=cat,
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("29.18"),
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=today.day,
        start_date=today - timedelta(days=60),
        active=True,
    )
    on_pause_day = Transaction.objects.create(
        account=acct,
        date=today,
        payee="Hulu",
        amount=Decimal("-29.18"),
        category=cat,
        source=Transaction.Source.RULE,
        rule=rule,
    )
    after_pause = Transaction.objects.create(
        account=acct,
        date=today + timedelta(days=14),
        payee="Hulu",
        amount=Decimal("-29.18"),
        category=cat,
        source=Transaction.Source.RULE,
        rule=rule,
    )
    past = Transaction.objects.create(
        account=acct,
        date=today - timedelta(days=10),
        payee="Hulu",
        amount=Decimal("-29.18"),
        category=cat,
        source=Transaction.Source.RULE,
        rule=rule,
    )

    r = api_client.post(f"/api/rules/{rule.id}/pause/")
    assert r.status_code == 200, r.content
    rule.refresh_from_db()
    assert rule.active is False
    assert rule.paused_at == today
    assert Transaction.objects.filter(pk=after_pause.pk).exists() is False
    assert Transaction.objects.filter(pk=on_pause_day.pk).exists() is True
    assert Transaction.objects.filter(pk=past.pk).exists() is True

    end = today + timedelta(days=90)
    build_timeline(user, today, end, account_id=acct.id)
    assert not Transaction.objects.filter(rule=rule, date__gt=today).exists()


@pytest.mark.django_db
def test_resume_rule_allows_future_materialization_again(api_client, user, household):
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
        name="Streaming",
        category_type=Category.CategoryType.EXPENSE,
        sort_order=1,
    )
    today = timezone.localdate()
    future = today + timedelta(days=21)
    while future.weekday() != 4:
        future += timedelta(days=1)
    rule = RecurringRule.objects.create(
        household=household,
        name="Chewy",
        account=acct,
        category=cat,
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("79.46"),
        currency="USD",
        frequency=RecurringRule.Frequency.WEEKLY,
        interval=1,
        day_of_week=4,
        start_date=future,
        active=True,
    )
    api_client.post(f"/api/rules/{rule.id}/pause/")
    rule.refresh_from_db()
    assert rule.active is False

    r = api_client.post(f"/api/rules/{rule.id}/resume/")
    assert r.status_code == 200, r.content
    rule.refresh_from_db()
    assert rule.active is True
    assert rule.paused_at is None

    build_timeline(user, today, future + timedelta(days=7), account_id=acct.id)
    assert Transaction.objects.filter(rule=rule, date__gte=future).exists()
