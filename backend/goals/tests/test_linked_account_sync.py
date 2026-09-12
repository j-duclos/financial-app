"""Linked-account goal sync must not treat forecast rows as contributions."""
from datetime import date, timedelta
from decimal import Decimal
from types import SimpleNamespace

import pytest

from django.contrib.auth import get_user_model
from django.utils import timezone

from accounts.models import Account
from core.models import Household, HouseholdMembership
from goals.linked_account_sync import (
    _eligible_for_linked_contribution,
    sync_linked_goal_contribution_for_transaction,
)
from goals.models import GoalBucket, GoalContribution
from transactions.models import Transaction
from transactions.services.posting import post_transaction

User = get_user_model()
AS_OF = date(2026, 5, 27)


@pytest.fixture
def user(db, household):
    user = User.objects.create_user(username="linked-sync", password="testpass123")
    HouseholdMembership.objects.create(household=household, user=user, role=HouseholdMembership.Role.OWNER)
    return user


@pytest.fixture
def household(db):
    return Household.objects.create(name="Linked HH")


@pytest.fixture
def savings(household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.SAVINGS,
        role=Account.AccountRole.EMERGENCY_FUND,
        name="Savings",
        starting_balance=Decimal("5000"),
        currency="USD",
    )


@pytest.fixture
def bucket(household, savings):
    return GoalBucket.objects.create(
        household=household,
        name="House",
        type=GoalBucket.BucketType.HOUSE,
        target_amount=Decimal("30000"),
        linked_account=savings,
        target_date=date(2026, 12, 1),
        status=GoalBucket.Status.ACTIVE,
    )


@pytest.mark.django_db
def test_planned_future_transaction_does_not_create_contribution(user, savings, bucket):
    txn = Transaction.objects.create(
        account=savings,
        date=AS_OF + timedelta(days=7),
        payee="Scheduled save",
        amount=Decimal("100"),
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.RULE,
    )
    assert sync_linked_goal_contribution_for_transaction(txn) is None
    assert not GoalContribution.objects.filter(transaction_id=txn.pk).exists()


@pytest.mark.django_db
def test_cleared_past_transaction_creates_contribution(user, savings, bucket):
    txn = post_transaction(user, savings.id, AS_OF - timedelta(days=3), "Save", Decimal("150"))
    contrib = sync_linked_goal_contribution_for_transaction(txn)
    assert contrib is not None
    assert contrib.amount == Decimal("150")
    assert contrib.date == AS_OF - timedelta(days=3)
    assert isinstance(contrib.date, date)


def test_eligible_accepts_datetime_date():
    today = timezone.localdate()
    txn = SimpleNamespace(date=today, status=Transaction.Status.CLEARED)
    assert _eligible_for_linked_contribution(txn) is True


def test_eligible_accepts_iso_date_string():
    today = timezone.localdate()
    txn = SimpleNamespace(date=today.isoformat(), status=Transaction.Status.CLEARED)
    assert _eligible_for_linked_contribution(txn) is True


def test_eligible_rejects_invalid_date_text():
    txn = SimpleNamespace(date="not-a-date", status=Transaction.Status.CLEARED)
    assert _eligible_for_linked_contribution(txn) is False


def test_eligible_rejects_future_date():
    future = timezone.localdate() + timedelta(days=3)
    txn = SimpleNamespace(date=future, status=Transaction.Status.CLEARED)
    assert _eligible_for_linked_contribution(txn) is False


def test_eligible_rejects_planned_transaction():
    today = timezone.localdate()
    txn = SimpleNamespace(date=today, status=Transaction.Status.PLANNED)
    assert _eligible_for_linked_contribution(txn) is False


@pytest.mark.django_db
def test_sync_stores_real_date_from_iso_string(user, savings, bucket):
    today = timezone.localdate()
    txn = post_transaction(user, savings.id, today, "ISO save", Decimal("40"))
    txn.date = today.isoformat()
    contrib = sync_linked_goal_contribution_for_transaction(txn)
    assert contrib is not None
    assert contrib.date == today
    assert isinstance(contrib.date, date)
