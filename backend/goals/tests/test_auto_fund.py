"""Tests for paycheck → goal bucket auto-fund transfer rules."""
from datetime import date
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from accounts.models import Account
from core.models import Household, HouseholdMembership
from goals.auto_fund import (
    apply_bucket_funding_config,
    find_auto_fund_transfer_rule,
    sync_auto_fund_transfer_rule,
)
from goals.models import GoalBucket, RuleAllocation
from timeline.models import RecurringRule

User = get_user_model()


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def user(db):
    return User.objects.create_user(username="autofunduser", password="testpass123")


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="Auto Fund HH")
    HouseholdMembership.objects.create(household=h, user=user, role=HouseholdMembership.Role.OWNER)
    return h


@pytest.fixture
def auth_client(api_client, user):
    api_client.force_authenticate(user=user)
    return api_client


@pytest.fixture
def checking(db, household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Checking",
        starting_balance=Decimal("5000"),
        currency="USD",
    )


@pytest.fixture
def savings(db, household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.SAVINGS,
        name="Savings",
        starting_balance=Decimal("1000"),
        currency="USD",
    )


@pytest.fixture
def paycheck(db, household, checking):
    return RecurringRule.objects.create(
        household=household,
        name="Paycheck",
        account=checking,
        direction=RecurringRule.Direction.INCOME,
        amount=Decimal("3000"),
        frequency=RecurringRule.Frequency.BIWEEKLY,
        start_date=date(2025, 1, 3),
        active=True,
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
        auto_fund_enabled=True,
        status=GoalBucket.Status.ACTIVE,
    )


def test_apply_funding_creates_transfer_rule(user, bucket, paycheck, checking, savings):
    apply_bucket_funding_config(
        bucket,
        auto_fund_enabled=True,
        income_rule_id=paycheck.pk,
        fixed_amount=Decimal("400"),
    )
    transfer = find_auto_fund_transfer_rule(bucket)
    assert transfer is not None
    assert transfer.active is True
    assert transfer.direction == RecurringRule.Direction.TRANSFER
    assert transfer.account_id == checking.pk
    assert transfer.transfer_to_account_id == savings.pk
    assert transfer.amount == Decimal("400.00")
    assert transfer.frequency == paycheck.frequency

    alloc = RuleAllocation.objects.get(bucket=bucket, rule=paycheck)
    assert alloc.fixed_amount == Decimal("400.00")


def test_disable_auto_fund_deactivates_transfer_rule(user, bucket, paycheck):
    apply_bucket_funding_config(
        bucket,
        auto_fund_enabled=True,
        income_rule_id=paycheck.pk,
        fixed_amount=Decimal("200"),
    )
    assert find_auto_fund_transfer_rule(bucket).active is True

    bucket.auto_fund_enabled = False
    bucket.save(update_fields=["auto_fund_enabled"])
    sync_auto_fund_transfer_rule(bucket)

    transfer = find_auto_fund_transfer_rule(bucket)
    assert transfer is not None
    assert transfer.active is False


def test_same_account_skips_transfer_rule(user, household, checking, paycheck, bucket):
    bucket.linked_account = checking
    bucket.save(update_fields=["linked_account"])
    apply_bucket_funding_config(
        bucket,
        auto_fund_enabled=True,
        income_rule_id=paycheck.pk,
        fixed_amount=Decimal("100"),
    )
    assert find_auto_fund_transfer_rule(bucket) is None
    assert RuleAllocation.objects.filter(bucket=bucket).exists()


def test_funding_api(auth_client, bucket, paycheck):
    r = auth_client.patch(
        f"/api/buckets/{bucket.pk}/funding/",
        {
            "auto_fund_enabled": True,
            "income_rule_id": paycheck.pk,
            "fixed_amount": "350.00",
        },
        format="json",
    )
    assert r.status_code == 200, r.content
    assert r.data["auto_fund_transfer_rule_id"] is not None
    transfer = find_auto_fund_transfer_rule(bucket)
    assert transfer.amount == Decimal("350.00")


def test_funding_api_percent(auth_client, bucket, paycheck):
    r = auth_client.patch(
        f"/api/buckets/{bucket.pk}/funding/",
        {
            "auto_fund_enabled": True,
            "income_rule_id": paycheck.pk,
            "percent": "10",
        },
        format="json",
    )
    assert r.status_code == 200, r.content
    transfer = find_auto_fund_transfer_rule(bucket)
    assert transfer.amount == Decimal("300.00")
