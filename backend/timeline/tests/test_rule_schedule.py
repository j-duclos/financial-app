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
    cat, _ = Category.objects.get_or_create(
        household=household,
        name="Salary",
        category_type=Category.CategoryType.INCOME,
        defaults={"sort_order": 1},
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
    cat, _ = Category.objects.get_or_create(
        household=household,
        name="Salary",
        category_type=Category.CategoryType.INCOME,
        defaults={"sort_order": 1},
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
def test_second_immediate_update_same_day(api_client, user, household):
    """Repeated same-day edits must not violate uniq_rule_schedule_rule_effective_from."""
    api_client.force_authenticate(user=user)
    acct = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Pay",
        currency="USD",
    )
    cat, _ = Category.objects.get_or_create(
        household=household,
        name="Salary",
        category_type=Category.CategoryType.INCOME,
        defaults={"sort_order": 1},
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
        start_date=today,
        active=True,
    )
    RecurringRuleSchedule.objects.create(
        rule=rule,
        effective_from=today,
        account=acct,
        category=cat,
        direction=rule.direction,
        amount=Decimal("2000.00"),
        currency="USD",
        frequency=rule.frequency,
        interval=1,
        day_of_month=1,
        start_date=today,
    )
    for amount in ("2100.00", "2200.00", "2300.00"):
        r = api_client.patch(
            f"/api/rules/{rule.id}/",
            {"amount": amount},
            format="json",
        )
        assert r.status_code == 200, r.content
    rule.refresh_from_db()
    assert rule.amount == Decimal("2300.00")
    assert RecurringRuleSchedule.objects.filter(rule=rule).count() == 1
    assert (
        RecurringRuleSchedule.objects.get(rule=rule).effective_from == today
    )


@pytest.mark.django_db
def test_reschedule_future_change_same_effective_date(api_client, user, household):
    """Editing an existing future-dated segment replaces it instead of duplicating."""
    api_client.force_authenticate(user=user)
    acct = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Pay",
        currency="USD",
    )
    cat, _ = Category.objects.get_or_create(
        household=household,
        name="Salary",
        category_type=Category.CategoryType.INCOME,
        defaults={"sort_order": 1},
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
    for amount in ("2250.00", "2300.00"):
        r = api_client.patch(
            f"/api/rules/{rule.id}/",
            {"amount": amount, "change_effective_date": future.isoformat()},
            format="json",
        )
        assert r.status_code == 200, r.content
    assert RecurringRuleSchedule.objects.filter(rule=rule, effective_from=future).count() == 1
    assert resolve_rule_params(rule, future).amount == Decimal("2300.00")
    api_client.force_authenticate(user=user)
    acct = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Pay",
        currency="USD",
    )
    cat, _ = Category.objects.get_or_create(
        household=household,
        name="Salary",
        category_type=Category.CategoryType.INCOME,
        defaults={"sort_order": 1},
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


def _expense_rule(household, account, **kwargs):
    defaults = dict(
        household=household,
        name="Bill",
        account=account,
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("10.00"),
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=1,
        start_date=date(2024, 1, 1),
        active=True,
    )
    defaults.update(kwargs)
    return RecurringRule.objects.create(**defaults)


@pytest.mark.django_db
def test_monthly_occurrence_dates_include_month_boundaries(household):
    acct = Account.objects.create(
        household=household, account_type=Account.AccountType.CHECKING, name="Pay", currency="USD"
    )
    rule = _expense_rule(household, acct, day_of_month=1)
    dates = generate_rule_occurrence_dates(rule, date(2026, 6, 1), date(2026, 6, 30))
    assert dates == [date(2026, 6, 1)]
    rule.day_of_month = 31
    rule.save(update_fields=["day_of_month"])
    dates = generate_rule_occurrence_dates(rule, date(2026, 6, 1), date(2026, 6, 30))
    assert dates == [date(2026, 6, 30)]


@pytest.mark.django_db
def test_weekly_and_every_n_weeks_occurrence_dates(household):
    acct = Account.objects.create(
        household=household, account_type=Account.AccountType.CHECKING, name="Pay", currency="USD"
    )
    weekly = _expense_rule(
        household,
        acct,
        name="Weekly",
        frequency=RecurringRule.Frequency.WEEKLY,
        interval=1,
        day_of_week=4,
        day_of_month=None,
        start_date=date(2026, 5, 1),
    )
    weekly_dates = generate_rule_occurrence_dates(weekly, date(2026, 6, 1), date(2026, 6, 30))
    assert weekly_dates
    assert all(d.weekday() == 4 for d in weekly_dates)
    assert weekly_dates == sorted(weekly_dates)

    every3 = _expense_rule(
        household,
        acct,
        name="Every3",
        frequency=RecurringRule.Frequency.WEEKLY,
        interval=3,
        day_of_week=4,
        day_of_month=None,
        start_date=date(2026, 5, 1),
    )
    every3_dates = generate_rule_occurrence_dates(every3, date(2026, 6, 1), date(2026, 6, 30))
    assert every3_dates
    assert all(d.weekday() == 4 for d in every3_dates)
    if len(every3_dates) >= 2:
        gaps = [(every3_dates[i] - every3_dates[i - 1]).days for i in range(1, len(every3_dates))]
        assert all(g == 21 for g in gaps)


@pytest.mark.django_db
def test_paused_rule_has_no_occurrence_dates_after_pause(household):
    acct = Account.objects.create(
        household=household, account_type=Account.AccountType.CHECKING, name="Pay", currency="USD"
    )
    rule = _expense_rule(
        household,
        acct,
        active=False,
        paused_at=date(2026, 6, 10),
        day_of_month=15,
    )
    assert generate_rule_occurrence_dates(rule, date(2026, 6, 1), date(2026, 6, 30)) == []
    rule.active = True
    rule.paused_at = date(2026, 6, 10)
    rule.save(update_fields=["active", "paused_at"])
    dates = generate_rule_occurrence_dates(rule, date(2026, 6, 1), date(2026, 6, 30))
    assert all(d < date(2026, 6, 10) for d in dates)


@pytest.mark.django_db
def test_leap_year_february_day_clamps_or_exists(household):
    acct = Account.objects.create(
        household=household, account_type=Account.AccountType.CHECKING, name="Pay", currency="USD"
    )
    rule = _expense_rule(household, acct, day_of_month=29, start_date=date(2024, 1, 1))
    leap = generate_rule_occurrence_dates(rule, date(2024, 2, 1), date(2024, 2, 29))
    non_leap = generate_rule_occurrence_dates(rule, date(2025, 2, 1), date(2025, 2, 28))
    assert leap == [date(2024, 2, 29)]
    assert non_leap == [date(2025, 2, 28)]
