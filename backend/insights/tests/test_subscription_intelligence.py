from datetime import date, timedelta
from decimal import Decimal

import pytest

from categories.models import Category
from insights.services.subscription_intelligence import (
    build_subscription_intelligence,
    rule_is_subscription,
    rule_monthly_expense_amount,
)
from timeline.models import RecurringRule
from transactions.models import Transaction


@pytest.mark.django_db
def test_rule_is_subscription_by_category(household, account):
    streaming = Category.objects.create(
        household=household,
        name="Streaming",
        category_type=Category.CategoryType.EXPENSE,
    )
    rule = RecurringRule.objects.create(
        household=household,
        name="Netflix",
        account=account,
        category=streaming,
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("15.99"),
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        day_of_month=17,
        start_date=date(2024, 1, 1),
        active=True,
    )
    assert rule_is_subscription(rule) is True


@pytest.mark.django_db
def test_rule_is_subscription_by_name(household, account):
    rule = RecurringRule.objects.create(
        household=household,
        name="Planet Fitness",
        account=account,
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("24.99"),
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        day_of_month=1,
        start_date=date(2024, 1, 1),
        active=True,
    )
    assert rule_is_subscription(rule) is True


@pytest.mark.django_db
def test_monthly_amount_weekly():
    rule = RecurringRule(
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("10"),
        frequency=RecurringRule.Frequency.WEEKLY,
        interval=1,
    )
    monthly = rule_monthly_expense_amount(rule)
    assert monthly == Decimal("43.33")


@pytest.mark.django_db
def test_build_subscription_intelligence_totals(user, household, account):
    streaming = Category.objects.create(
        household=household,
        name="Streaming",
        category_type=Category.CategoryType.EXPENSE,
    )
    RecurringRule.objects.create(
        household=household,
        name="Netflix",
        account=account,
        category=streaming,
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("15.99"),
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        day_of_month=17,
        start_date=date(2024, 1, 1),
        active=True,
    )
    RecurringRule.objects.create(
        household=household,
        name="Spotify",
        account=account,
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("10.99"),
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        day_of_month=5,
        start_date=date(2024, 1, 1),
        active=True,
    )
    data = build_subscription_intelligence(user)
    assert data["subscription_count"] == 2
    assert Decimal(data["monthly_commitments_total"]) == Decimal("26.98")
    names = [s["name"] for s in data["subscriptions"]]
    assert "Netflix" in names
    assert "Spotify" in names


@pytest.mark.django_db
def test_detects_recurring_plaid_charges(user, household, account):
    today = date.today()
    for i in range(3):
        Transaction.objects.create(
            account=account,
            date=today - timedelta(days=30 * i),
            payee="Adobe",
            amount=Decimal("-54.99"),
            source=Transaction.Source.PLAID,
            status=Transaction.Status.CLEARED,
        )
    data = build_subscription_intelligence(user, today=today)
    assert data["subscription_count"] == 0
    assert len(data["suggested"]) >= 1
    assert data["suggested"][0]["name"].lower().startswith("adobe")


@pytest.mark.django_db
def test_subscription_intelligence_api(authenticated_client, user, household, account):
    streaming = Category.objects.create(
        household=household,
        name="Streaming",
        category_type=Category.CategoryType.EXPENSE,
    )
    RecurringRule.objects.create(
        household=household,
        name="Netflix",
        account=account,
        category=streaming,
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("15.99"),
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        day_of_month=17,
        start_date=date(2024, 1, 1),
        active=True,
    )
    res = authenticated_client.get("/api/insights/subscriptions/")
    assert res.status_code == 200
    body = res.json()
    assert body["subscription_count"] == 1
    assert Decimal(body["monthly_commitments_total"]) == Decimal("15.99")
