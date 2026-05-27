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
    record_contribution,
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
    txn = post_transaction(user, savings.id, AS_OF, "Deposit", Decimal("500"))
    record_contribution(
        bucket,
        transaction=txn,
        account_id=savings.id,
        amount=Decimal("500"),
        contrib_date=AS_OF,
        source=GoalContribution.Source.MANUAL,
    )
    bucket.refresh_from_db()
    assert bucket.allocated_amount == Decimal("500.00")
    assert bucket_reserve_for_account(savings.id) == Decimal("500.00")


def test_account_bucket_summary(user, savings, bucket):
    txn = post_transaction(user, savings.id, AS_OF, "Fund", Decimal("4000"))
    record_contribution(
        bucket,
        transaction=txn,
        account_id=savings.id,
        amount=Decimal("4000"),
        contrib_date=AS_OF,
        source=GoalContribution.Source.MANUAL,
    )
    summary = account_bucket_summary(savings.id, today=AS_OF)
    assert Decimal(summary["allocated_total"]) == Decimal("4000.00")
    balance = Decimal(summary["balance"])
    assert Decimal(summary["available_unallocated"]) == balance - Decimal("4000.00")


def test_bucket_opt_out_excluded_from_reserve(user, household, savings, bucket):
    txn = post_transaction(user, savings.id, AS_OF, "Fund", Decimal("1000"))
    record_contribution(
        bucket,
        transaction=txn,
        account_id=savings.id,
        amount=Decimal("1000"),
        contrib_date=AS_OF,
        source=GoalContribution.Source.MANUAL,
    )
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

    txn = post_transaction(user, savings.id, AS_OF, "Allocate", Decimal("4000"))
    record_contribution(
        bucket,
        transaction=txn,
        account_id=savings.id,
        amount=Decimal("4000"),
        contrib_date=AS_OF,
        source=GoalContribution.Source.MANUAL,
    )
    summary = calculate_account_forecast_summary(user, savings, as_of_date=AS_OF, days=30)
    reserve = Decimal(summary["bucket_allocation"])
    assert reserve >= Decimal("4000.00")
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


def test_sync_allocated_from_contributions(bucket, user, savings):
    txn = post_transaction(user, savings.id, AS_OF, "A", Decimal("100"))
    record_contribution(
        bucket, transaction=txn, account_id=savings.id, amount=Decimal("100"), contrib_date=AS_OF, source="manual"
    )
    txn2 = post_transaction(user, savings.id, AS_OF, "B", Decimal("250"))
    record_contribution(
        bucket, transaction=txn2, account_id=savings.id, amount=Decimal("250"), contrib_date=AS_OF, source="manual"
    )
    sync_bucket_allocated_amount(bucket)
    bucket.refresh_from_db()
    assert bucket.allocated_amount == Decimal("350.00")
