"""Linked-account goal sync must not treat forecast rows as contributions."""
from datetime import date, timedelta
from decimal import Decimal

import pytest

from django.contrib.auth import get_user_model

from accounts.models import Account
from core.models import Household, HouseholdMembership
from goals.linked_account_sync import sync_linked_goal_contribution_for_transaction
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
