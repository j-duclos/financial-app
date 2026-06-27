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


@pytest.mark.django_db
def test_materialize_resolves_due_occurrence_date(user, household, checking):
    from django.utils import timezone

    from categories.models import Category
    from timeline.services.ledger import build_timeline

    today = timezone.localdate()
    income_category = Category.objects.create(
        household=household,
        name="Payroll",
        category_type=Category.CategoryType.INCOME,
        sort_order=1,
    )
    rule = RecurringRule.objects.create(
        household=household,
        name="Payroll",
        account=checking,
        category=income_category,
        direction=RecurringRule.Direction.INCOME,
        amount=Decimal("1835.52"),
        currency="USD",
        frequency=RecurringRule.Frequency.WEEKLY,
        interval=1,
        start_date=today,
        active=True,
    )
    Transaction.objects.create(
        account=checking,
        date=today,
        payee="Payroll",
        memo="",
        amount=Decimal("1835.52"),
        category=income_category,
        status=Transaction.Status.CLEARED,
        source=Transaction.Source.PLAID,
        plaid_transaction_id="plaid-test-import",
    )
    assert Transaction.objects.filter(rule=rule, date=today).count() == 0

    build_timeline(
        user,
        start_date=today - timedelta(days=7),
        end_date=today + timedelta(days=30),
        as_of_date=today,
        projection_only=True,
    )
    assert Transaction.objects.filter(rule=rule, date=today).count() == 0

    summary = materialize_recurring_transactions_for_user(
        user,
        account_ids=[checking.pk],
        rule_ids=[rule.pk],
        occurrence_date=today,
    )
    resolved_id = summary.get("resolved_transaction_id")
    assert resolved_id is not None, summary
    txn = Transaction.objects.get(pk=resolved_id)
    assert txn.date == today
    assert txn.rule_id == rule.pk
    assert txn.status == Transaction.Status.PLANNED
    assert txn.source == Transaction.Source.RULE
    assert any(
        o["transaction_id"] == resolved_id and o["date"] == today.isoformat()
        for o in summary["occurrences"]
    )


@pytest.mark.django_db
def test_ensure_creates_exact_date_when_nearby_match_exists(user, household, checking):
    from django.utils import timezone

    from categories.models import Category
    from timeline.services.materialization import ensure_planned_occurrence_transaction

    today = timezone.localdate()
    income_category = Category.objects.create(
        household=household,
        name="Payroll",
        category_type=Category.CategoryType.INCOME,
        sort_order=1,
    )
    rule = RecurringRule.objects.create(
        household=household,
        name="Payroll",
        account=checking,
        category=income_category,
        direction=RecurringRule.Direction.INCOME,
        amount=Decimal("1835.52"),
        currency="USD",
        frequency=RecurringRule.Frequency.WEEKLY,
        interval=1,
        start_date=today - timedelta(days=14),
        active=True,
    )
    prior_date = today - timedelta(days=2)
    prior_txn = Transaction.objects.create(
        account=checking,
        date=prior_date,
        payee="Payroll",
        memo="",
        amount=Decimal("1835.52"),
        category=income_category,
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.RULE,
        rule=rule,
        import_match_status=Transaction.ImportMatchStatus.MATCHED,
    )
    resolved = ensure_planned_occurrence_transaction(
        user,
        rule_id=rule.pk,
        account_id=checking.pk,
        occurrence_date=today,
    )
    assert resolved is not None
    assert resolved.date == today
    assert resolved.pk != prior_txn.pk


@pytest.mark.django_db
def test_resolve_occurrence_api(user, household, checking):
    from django.utils import timezone
    from rest_framework.test import APIClient

    from categories.models import Category

    today = timezone.localdate()
    income_category = Category.objects.create(
        household=household,
        name="Payroll",
        category_type=Category.CategoryType.INCOME,
        sort_order=1,
    )
    rule = RecurringRule.objects.create(
        household=household,
        name="Payroll",
        account=checking,
        category=income_category,
        direction=RecurringRule.Direction.INCOME,
        amount=Decimal("1835.52"),
        currency="USD",
        frequency=RecurringRule.Frequency.WEEKLY,
        interval=1,
        start_date=today,
        active=True,
    )
    client = APIClient()
    client.force_authenticate(user=user)
    resp = client.post(
        "/api/timeline/resolve-occurrence/",
        {
            "rule_id": rule.pk,
            "account_id": checking.pk,
            "occurrence_date": today.isoformat(),
        },
        format="json",
    )
    assert resp.status_code == 200, resp.content
    txn_id = resp.json()["transaction_id"]
    txn = Transaction.objects.get(pk=txn_id)
    assert txn.rule_id == rule.pk
    assert txn.date == today
