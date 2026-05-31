"""Tests for goal buckets, allocations, and safe-to-spend reserves."""
from datetime import date
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from accounts.models import Account
from core.models import Household, HouseholdMembership
from goals.bucket_services import (
    account_bucket_summary,
    bucket_reserve_for_account,
    calculate_bucket_progress,
    sync_bucket_allocated_amount,
)
from goals.models import GoalBucket, GoalContribution
from transactions.models import Transaction
from transactions.services.posting import post_transaction

User = get_user_model()
AS_OF = date(2025, 6, 1)


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def user(db):
    return User.objects.create_user(username="bucketuser", password="testpass123")


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="Bucket Household")
    HouseholdMembership.objects.create(household=h, user=user, role=HouseholdMembership.Role.OWNER)
    return h


@pytest.fixture
def auth_client(api_client, user):
    api_client.force_authenticate(user=user)
    return api_client


@pytest.fixture
def savings(db, household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.SAVINGS,
        role=Account.AccountRole.EMERGENCY_FUND,
        name="Savings",
        starting_balance=Decimal("10000"),
        currency="USD",
    )


@pytest.fixture
def bucket(db, household, savings):
    return GoalBucket.objects.create(
        household=household,
        name="Emergency Fund",
        type=GoalBucket.BucketType.EMERGENCY,
        target_amount=Decimal("10000"),
        linked_account=savings,
        monthly_target=Decimal("400"),
        priority=GoalBucket.Priority.HIGH,
        status=GoalBucket.Status.ACTIVE,
        include_in_safe_to_spend=True,
    )


def test_contribution_updates_allocated(user, household, savings, bucket):
    post_transaction(user, savings.id, AS_OF, "Deposit", Decimal("500"))
    sync_bucket_allocated_amount(bucket)
    bucket.refresh_from_db()
    assert bucket.allocated_amount == Decimal("500.00")
    assert bucket_reserve_for_account(savings.id, today=AS_OF) == Decimal("10500.00")


def test_account_bucket_summary(user, savings, bucket):
    post_transaction(user, savings.id, AS_OF, "Fund", Decimal("4000"))
    summary = account_bucket_summary(savings.id, today=AS_OF)
    balance = Decimal(summary["balance"])
    assert Decimal(summary["allocated_total"]) == balance
    assert Decimal(summary["available_unallocated"]) == Decimal("0.00")


def test_bucket_opt_out_excluded_from_reserve(user, household, savings, bucket):
    post_transaction(user, savings.id, AS_OF, "Fund", Decimal("1000"))
    bucket.include_in_safe_to_spend = False
    bucket.save()
    assert bucket_reserve_for_account(savings.id) == Decimal("0")


def test_create_bucket_api(auth_client, household, savings):
    r = auth_client.post(
        "/api/buckets/",
        {
            "household": household.id,
            "name": "Vacation",
            "type": "vacation",
            "target_amount": "2000.00",
            "linked_account": savings.id,
            "monthly_target": "100.00",
            "priority": "medium",
        },
        format="json",
    )
    assert r.status_code == 201
    assert Decimal(r.json()["progress_percent"]) > 0


def test_sts_reduced_by_bucket_allocation(auth_client, household, user, savings, bucket):
    from accounts.services.available_to_spend import calculate_account_forecast_summary

    post_transaction(user, savings.id, AS_OF, "Allocate", Decimal("4000"))
    summary = calculate_account_forecast_summary(user, savings, as_of_date=AS_OF, days=30)
    reserve = Decimal(summary["bucket_allocation"])
    assert reserve >= Decimal("14000.00")
    base = Decimal(summary["lowest_projected_balance"]) - Decimal(summary["minimum_buffer"])
    assert Decimal(summary["available_to_spend"]) == base - reserve


def test_linked_savings_shows_account_balance_without_contributions(
    auth_client, household, savings, user
):
    """Single bucket on a savings account uses ledger balance for progress."""
    GoalBucket.objects.create(
        household=household,
        name="Save for House Down Payment",
        type=GoalBucket.BucketType.HOUSE,
        target_amount=Decimal("30000"),
        linked_account=savings,
        priority=GoalBucket.Priority.HIGH,
        status=GoalBucket.Status.ACTIVE,
    )
    r = auth_client.get("/api/buckets/")
    assert r.status_code == 200
    goal = next(g for g in r.json()["results"] if "House" in g["name"])
    assert Decimal(goal["current_amount"]) == Decimal("10000.00")
    assert Decimal(goal["progress_percent"]) > 0


def test_buckets_reports_endpoint(auth_client, household, bucket):
    r = auth_client.get("/api/buckets/reports/")
    assert r.status_code == 200
    data = r.json()
    assert "buckets" in data
    assert "contribution_history" in data
    assert "monthly_funding" in data
    assert "summary" in data


def test_deposit_auto_creates_contribution(bucket, user, savings):
    txn = post_transaction(user, savings.id, AS_OF, "Paycheck", Decimal("250"))
    contrib = GoalContribution.objects.get(transaction_id=txn.pk)
    assert contrib.bucket_id == bucket.id
    assert contrib.amount == Decimal("250.00")
    assert contrib.source == GoalContribution.Source.AUTO


def test_future_rule_txn_does_not_inflate_current_progress(bucket, user, savings):
    from datetime import timedelta
    from transactions.models import Transaction

    future = AS_OF + timedelta(days=30)
    Transaction.objects.create(
        account=savings,
        date=future,
        payee="Save for Rent",
        amount=Decimal("680.00"),
        source=Transaction.Source.RULE,
        status=Transaction.Status.PLANNED,
    )
    progress = calculate_bucket_progress(bucket, today=AS_OF)
    assert Decimal(progress["current_amount"]) == Decimal("10000.00")


def test_report_month_uses_projected_balance(auth_client, household, savings, user, bucket):
    from datetime import timedelta
    from transactions.models import Transaction

    june_end = date(2025, 6, 30)
    Transaction.objects.create(
        account=savings,
        date=june_end,
        payee="Save for Rent",
        amount=Decimal("680.00"),
        source=Transaction.Source.RULE,
        status=Transaction.Status.PLANNED,
    )
    r = auth_client.get("/api/buckets/reports/?month=2025-06")
    assert r.status_code == 200
    goal = r.json()["buckets"][0]
    assert Decimal(goal["current_amount"]) >= Decimal("10000.00")


def test_withdrawal_records_negative_contribution(bucket, user, savings):
    txn = post_transaction(user, savings.id, AS_OF, "Withdrawal", Decimal("-100"))
    contrib = GoalContribution.objects.get(transaction_id=txn.pk)
    assert contrib.amount == Decimal("-100.00")


def test_duplicate_linked_account_rejected(auth_client, household, savings, bucket):
    r = auth_client.post(
        "/api/buckets/",
        {
            "household": household.id,
            "name": "Second goal",
            "type": "custom",
            "target_amount": "1000.00",
            "linked_account": savings.id,
            "monthly_target": "50.00",
            "priority": "low",
        },
        format="json",
    )
    assert r.status_code == 400
    assert "linked_account" in r.json()


def test_sync_allocated_from_contributions(bucket, user, savings):
    post_transaction(user, savings.id, AS_OF, "A", Decimal("100"))
    post_transaction(user, savings.id, AS_OF, "B", Decimal("250"))
    sync_bucket_allocated_amount(bucket)
    bucket.refresh_from_db()
    assert bucket.allocated_amount == Decimal("350.00")
