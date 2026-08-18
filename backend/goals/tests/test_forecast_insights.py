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
    suggested_per_paycheck_amount,
)
from goals.models import GoalBucket, GoalContribution, RuleAllocation
from timeline.models import RecurringRule, Scenario, ScenarioRuleOverride
from transactions.models import Transaction
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
    assert data["goal"]["name"] == bucket.name
    assert data["goal"]["id"] == bucket.id
    assert len(data["contribution_history"]) <= 100


def test_contribution_history_omits_future_planned_rows(user, savings, bucket, auth_client):
    from django.utils import timezone

    today = timezone.localdate()
    past = post_transaction(user, savings.id, today - timedelta(days=10), "Save", Decimal("200"))
    record_contribution(
        bucket,
        transaction=past,
        account_id=savings.id,
        amount=Decimal("200"),
        contrib_date=today - timedelta(days=10),
        source=GoalContribution.Source.MANUAL,
    )
    future_date = today + timedelta(days=14)
    future = post_transaction(user, savings.id, future_date, "Future save", Decimal("183.55"))
    future.status = Transaction.Status.PLANNED
    future.save(update_fields=["status", "updated_at"])
    record_contribution(
        bucket,
        transaction=future,
        account_id=savings.id,
        amount=Decimal("183.55"),
        contrib_date=future_date,
        source=GoalContribution.Source.RULE,
    )

    data = auth_client.get(f"/api/buckets/{bucket.id}/detail/").json()
    history_dates = {row["date"] for row in data["contribution_history"]}
    assert (today - timedelta(days=10)).isoformat() in history_dates
    assert future_date.isoformat() not in history_dates


def test_per_paycheck_uses_weekly_schedule_not_biweekly(household, savings, bucket):
    checking = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        name="Checking",
        starting_balance=Decimal("2000"),
        currency="USD",
    )
    rule = RecurringRule.objects.create(
        household=household,
        name="Weekly pay",
        account=checking,
        direction=RecurringRule.Direction.INCOME,
        amount=Decimal("1000"),
        frequency=RecurringRule.Frequency.WEEKLY,
        interval=1,
        start_date=AS_OF - timedelta(days=30),
        active=True,
    )
    RuleAllocation.objects.create(rule=rule, bucket=bucket, fixed_amount=Decimal("183.55"), active=True)
    progress = {
        "remaining_amount": "28448.38",
        "progress_percent": "5.17",
        "current_amount": "1551.62",
        "target_amount": "30000.00",
        "on_track_status": "behind",
        "monthly_required": "7112.10",
    }
    enriched = enrich_goal_forecast(bucket, progress, today=AS_OF)
    weekly = (Decimal("7112.10") * Decimal("12") / Decimal("52")).quantize(Decimal("0.01"))
    biweekly = (Decimal("7112.10") * Decimal("12") / Decimal("26")).quantize(Decimal("0.01"))
    assert Decimal(enriched["suggested_per_paycheck"]) == weekly
    assert Decimal(enriched["suggested_per_paycheck"]) != biweekly
    assert enriched["paycheck_frequency"] == RecurringRule.Frequency.WEEKLY


def test_per_paycheck_hidden_without_paycheck_schedule(bucket):
    result = suggested_per_paycheck_amount(Decimal("7112.10"), [])
    assert result["suggested_per_paycheck"] is None
    progress = {
        "remaining_amount": "18000.00",
        "progress_percent": "40.00",
        "current_amount": "12000.00",
        "target_amount": "30000.00",
        "on_track_status": "behind",
        "monthly_required": "7112.10",
    }
    enriched = enrich_goal_forecast(bucket, progress, today=AS_OF)
    assert enriched["suggested_per_paycheck"] is None


def test_surplus_when_current_pace_exceeds_needed(bucket):
    bucket.monthly_target = Decimal("900")
    bucket.save(update_fields=["monthly_target"])
    progress = {
        "remaining_amount": "18000.00",
        "progress_percent": "40.00",
        "current_amount": "12000.00",
        "target_amount": "30000.00",
        "on_track_status": "ahead",
        "monthly_required": "500.00",
    }
    enriched = enrich_goal_forecast(bucket, progress, today=AS_OF)
    assert Decimal(enriched["current_contribution_rate"]) == Decimal("900.00")
    assert Decimal(enriched["forecast_gap"]) == Decimal("0.00")
    assert Decimal(enriched["forecast_surplus"]) == Decimal("400.00")


def test_forecast_growth_matches_pace_and_includes_target_month(bucket):
    bucket.monthly_target = Decimal("500")
    bucket.save(update_fields=["monthly_target"])
    progress = {
        "remaining_amount": "18000.00",
        "progress_percent": "40.00",
        "current_amount": "12000.00",
        "target_amount": "30000.00",
        "on_track_status": "behind",
        "monthly_required": "2571.43",
    }
    enriched = enrich_goal_forecast(bucket, progress, today=AS_OF)
    growth = enriched["forecast_growth"]
    assert growth[0]["amount"] == "12000.00"
    assert Decimal(growth[1]["amount"]) == Decimal("12500.00")
    assert any(point["month"] == "2026-12" for point in growth)
    projected = enriched["projected_completion_date"]
    assert projected is not None
    last_at_target = next(
        (point for point in growth if Decimal(point["amount"]) >= Decimal("30000.00")),
        None,
    )
    assert last_at_target is not None
    assert last_at_target["month"] == projected[:7]


def test_scenario_changes_projection_without_mutating_goal(user, household, savings, bucket):
    checking = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        name="Checking",
        starting_balance=Decimal("3000"),
        currency="USD",
    )
    paycheck = RecurringRule.objects.create(
        household=household,
        name="Paycheck",
        account=checking,
        direction=RecurringRule.Direction.INCOME,
        amount=Decimal("2000"),
        frequency=RecurringRule.Frequency.WEEKLY,
        interval=1,
        start_date=AS_OF - timedelta(days=30),
        active=True,
    )
    RuleAllocation.objects.create(
        rule=paycheck, bucket=bucket, percent=Decimal("10"), active=True
    )
    scenario = Scenario.objects.create(household=household, name="Raise")
    ScenarioRuleOverride.objects.create(
        scenario=scenario, rule=paycheck, override_amount=Decimal("4000")
    )
    from goals.forecast_insights import build_goal_detail

    before_target = bucket.monthly_target
    before_allocated = bucket.allocated_amount
    base = build_goal_detail(bucket, user=user, today=AS_OF)
    what_if = build_goal_detail(bucket, user=user, scenario_id=scenario.id, today=AS_OF)
    bucket.refresh_from_db()
    assert bucket.monthly_target == before_target
    assert bucket.allocated_amount == before_allocated
    assert Decimal(what_if["goal"]["current_contribution_rate"]) > Decimal(
        base["goal"]["current_contribution_rate"]
    )
    assert what_if["goal"]["projected_completion_date"] < base["goal"]["projected_completion_date"]
    assert what_if["goal"]["id"] == bucket.id
