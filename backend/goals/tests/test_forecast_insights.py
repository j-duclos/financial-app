"""Tests for goal forecast insights (pace, projections, suggestions)."""
from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from accounts.models import Account
from core.models import Household, HouseholdMembership
from goals.bucket_services import record_contribution
from goals.forecast_insights import (
    PACE_ON_TRACK,
    PACE_STALLED,
    build_funding_info,
    contribution_pace_monthly,
    enrich_goal_forecast,
    projection_headline,
)
from goals.models import GoalBucket, GoalContribution
from transactions.services.posting import post_transaction

User = get_user_model()
AS_OF = date(2026, 5, 27)


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def user(db):
    return User.objects.create_user(username="forecastuser", password="testpass123")


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="Forecast HH")
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
def bucket(household, savings):
    return GoalBucket.objects.create(
        household=household,
        name="House Fund",
        type=GoalBucket.BucketType.HOUSE,
        target_amount=Decimal("30000"),
        allocated_amount=Decimal("12000"),
        linked_account=savings,
        target_date=date(2026, 12, 1),
        monthly_target=Decimal("0"),
        priority=GoalBucket.Priority.HIGH,
        status=GoalBucket.Status.ACTIVE,
    )


def test_stalled_when_no_contributions(bucket):
    pace = contribution_pace_monthly(bucket, today=AS_OF)
    assert pace == Decimal("0")
    progress = {
        "remaining_amount": "18000.00",
        "progress_percent": "40.00",
        "current_amount": "12000.00",
        "target_amount": "30000.00",
        "on_track_status": "behind",
    }
    enriched = enrich_goal_forecast(bucket, progress, today=AS_OF)
    assert enriched["pace_status"] == PACE_STALLED
    assert enriched["projection_headline"] == "No funding activity yet"


def test_pace_from_monthly_target(bucket):
    bucket.monthly_target = Decimal("500")
    bucket.save(update_fields=["monthly_target"])
    pace = contribution_pace_monthly(bucket, today=AS_OF)
    assert pace == Decimal("500")


def test_pace_from_recent_contributions(user, savings, bucket):
    for i in range(3):
        txn = post_transaction(user, savings.id, AS_OF - timedelta(days=30 * (i + 1)), "Save", Decimal("600"))
        record_contribution(
            bucket,
            transaction=txn,
            account_id=savings.id,
            amount=Decimal("600"),
            contrib_date=AS_OF - timedelta(days=30 * (i + 1)),
            source=GoalContribution.Source.MANUAL,
        )
    pace = contribution_pace_monthly(bucket, today=AS_OF)
    assert pace >= Decimal("600")


def test_projection_headline_on_track():
    headline = projection_headline(
        PACE_ON_TRACK,
        date(2026, 11, 1),
        date(2026, 12, 1),
        today=AS_OF,
    )
    assert "On track for" in headline
    assert "Nov 2026" in headline


def test_funding_info_no_rules(bucket):
    info = build_funding_info(bucket)
    assert info["has_automatic_funding"] is False
    assert info["automatic_transfer_label"] is None


def test_goal_detail_endpoint(auth_client, bucket):
    r = auth_client.get(f"/api/buckets/{bucket.id}/detail/")
    assert r.status_code == 200
    data = r.json()
    assert "contribution_history" in data
    assert "forecast_scenarios" in data
    assert len(data["forecast_scenarios"]) == 3
    assert data["goal"]["pace_status"] == PACE_STALLED
