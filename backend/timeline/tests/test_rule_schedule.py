"""Future-effective recurring rule schedule segments."""
from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Account
from categories.models import Category
from core.models import Household, HouseholdMembership
from timeline.models import RecurringRule, RecurringRuleSchedule
from timeline.services.ledger import build_timeline
from timeline.services.rule_schedule import generate_rule_occurrence_dates, resolve_rule_params
from transactions.models import Transaction

User = get_user_model()


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def user(db):
    return User.objects.create_user(username="rule_sched_user", password="testpass123")


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="H")
    HouseholdMembership.objects.create(household=h, user=user, role=HouseholdMembership.Role.OWNER)
    return h


@pytest.mark.django_db
def test_future_effective_change_keeps_amount_until_date(api_client, user, household):
    api_client.force_authenticate(user=user)
    acct = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Pay",
        currency="USD",
        include_in_forecast=True,
    )
    cat = Category.objects.create(
        household=household,
        name="Salary",
        category_type=Category.CategoryType.INCOME,
        sort_order=1,
    )
    today = timezone.localdate()
    start = today - timedelta(days=60)
    while start.weekday() != 4:
        start += timedelta(days=1)
    effective = today + timedelta(days=45)
    while effective.weekday() != 4:
        effective += timedelta(days=1)

    rule = RecurringRule.objects.create(
        household=household,
        name="Paycheck",
        account=acct,
        category=cat,
        direction=RecurringRule.Direction.INCOME,
        amount=Decimal("2000.00"),
        currency="USD",
        frequency=RecurringRule.Frequency.BIWEEKLY,
        interval=1,
        day_of_week=4,
        start_date=start,
        active=True,
    )
    RecurringRuleSchedule.objects.create(
        rule=rule,
        effective_from=start,
        account=acct,
        category=cat,
        direction=rule.direction,
        amount=Decimal("2000.00"),
        currency="USD",
        frequency=rule.frequency,
        interval=1,
        day_of_week=4,
        start_date=start,
    )

    r = api_client.patch(
        f"/api/rules/{rule.id}/",
        {
            "amount": "2200.00",
            "change_effective_date": effective.isoformat(),
        },
        format="json",
    )
    assert r.status_code == 200, r.content
    rule.refresh_from_db()
    assert rule.amount == Decimal("2000.00")

    before = today + timedelta(days=1)
    while before.weekday() != 4 or before >= effective:
        before += timedelta(days=1)
    assert before < effective
    assert resolve_rule_params(rule, before).amount == Decimal("2000.00")
    assert resolve_rule_params(rule, effective).amount == Decimal("2200.00")

    end = effective + timedelta(days=90)
    build_timeline(user, today, end, account_id=acct.id)
    before_txn = Transaction.objects.filter(rule=rule, date=before).first()
    after_txn = Transaction.objects.filter(rule=rule, date=effective).first()
    assert before_txn is not None
    assert before_txn.amount == Decimal("2000.00")
    assert after_txn is not None
    assert after_txn.amount == Decimal("2200.00")


@pytest.mark.django_db
def test_immediate_change_updates_rule_row(api_client, user, household):
    api_client.force_authenticate(user=user)
    acct = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Pay",
        currency="USD",
    )
    cat = Category.objects.create(
        household=household,
        name="Salary",
        category_type=Category.CategoryType.INCOME,
        sort_order=1,
    )
    today = timezone.localdate()
    rule = RecurringRule.objects.create(
        household=household,
        name="Paycheck",
        account=acct,
        category=cat,
        direction=RecurringRule.Direction.INCOME,
        amount=Decimal("2000.00"),
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=1,
        start_date=today - timedelta(days=90),
        active=True,
    )
    RecurringRuleSchedule.objects.create(
        rule=rule,
        effective_from=rule.start_date,
        account=acct,
        category=cat,
        direction=rule.direction,
        amount=Decimal("2000.00"),
        currency="USD",
        frequency=rule.frequency,
        interval=1,
        day_of_month=1,
        start_date=rule.start_date,
    )
    past = today - timedelta(days=30)
    past_txn = Transaction.objects.create(
        account=acct,
        date=past,
        payee="Paycheck",
        amount=Decimal("2000.00"),
        category=cat,
        source=Transaction.Source.RULE,
        rule=rule,
    )
    r = api_client.patch(
        f"/api/rules/{rule.id}/",
        {"amount": "2200.00"},
        format="json",
    )
    assert r.status_code == 200, r.content
    rule.refresh_from_db()
    assert rule.amount == Decimal("2200.00")
    past_txn.refresh_from_db()
    assert past_txn.amount == Decimal("2000.00")


@pytest.mark.django_db
def test_cancel_scheduled_change(api_client, user, household):
    api_client.force_authenticate(user=user)
    acct = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Pay",
        currency="USD",
    )
    cat = Category.objects.create(
        household=household,
        name="Salary",
        category_type=Category.CategoryType.INCOME,
        sort_order=1,
    )
    today = timezone.localdate()
    future = today + timedelta(days=30)
    rule = RecurringRule.objects.create(
        household=household,
        name="Paycheck",
        account=acct,
        category=cat,
        direction=RecurringRule.Direction.INCOME,
        amount=Decimal("2000.00"),
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=1,
        start_date=today - timedelta(days=30),
        active=True,
    )
    RecurringRuleSchedule.objects.create(
        rule=rule,
        effective_from=rule.start_date,
        account=acct,
        category=cat,
        direction=rule.direction,
        amount=Decimal("2000.00"),
        currency="USD",
        frequency=rule.frequency,
        interval=1,
        day_of_month=1,
        start_date=rule.start_date,
    )
    RecurringRuleSchedule.objects.create(
        rule=rule,
        effective_from=future,
        account=acct,
        category=cat,
        direction=rule.direction,
        amount=Decimal("2200.00"),
        currency="USD",
        frequency=rule.frequency,
        interval=1,
        day_of_month=1,
        start_date=rule.start_date,
    )
    r = api_client.patch(
        f"/api/rules/{rule.id}/",
        {"cancel_scheduled_change": True},
        format="json",
    )
    assert r.status_code == 200, r.content
    assert not RecurringRuleSchedule.objects.filter(rule=rule, effective_from__gt=today).exists()
    assert resolve_rule_params(rule, future).amount == Decimal("2000.00")
