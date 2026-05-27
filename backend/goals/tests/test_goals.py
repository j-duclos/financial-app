"""Tests for FinancialGoal API at /api/goals/."""
from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from accounts.models import Account
from core.models import Household, HouseholdMembership
from goals.models import FinancialGoal
from goals.services import (
    calculate_aggregate_goal_summary,
    calculate_goal_progress,
    dashboard_goals_for_user,
    enrich_goal_progress,
)
from transactions.services.posting import post_transaction

User = get_user_model()
AS_OF = date(2025, 6, 1)


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def user(db):
    return User.objects.create_user(username="goaluser", password="testpass123")


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="Goals Household")
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
        name="Emergency",
        starting_balance=Decimal("4300"),
        currency="USD",
    )


@pytest.fixture
def credit_card(db, household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        role=Account.AccountRole.CREDIT_CARD,
        name="Venture",
        credit_limit=Decimal("5000"),
        currency="USD",
    )


def test_create_savings_goal(auth_client, household, savings):
    r = auth_client.post(
        "/api/goals/",
        {
            "household": household.id,
            "name": "Emergency Fund",
            "goal_type": "emergency_fund",
            "target_amount": "10000.00",
            "linked_account": savings.id,
            "priority": 1,
        },
        format="json",
    )
    assert r.status_code == 201
    data = r.json()
    assert data["goal_type"] == "emergency_fund"
    assert Decimal(data["progress_percent"]) > 0


def test_create_debt_payoff_goal(auth_client, household, credit_card, user):
    post_transaction(user, credit_card.id, AS_OF, "Balance", Decimal("-2310"))
    r = auth_client.post(
        "/api/goals/",
        {
            "household": household.id,
            "name": "Payoff Venture",
            "goal_type": "debt_payoff",
            "target_amount": "2310.00",
            "linked_credit_account": credit_card.id,
            "monthly_contribution": "200.00",
            "priority": 2,
        },
        format="json",
    )
    assert r.status_code == 201
    assert r.json()["is_debt_goal"] is True
    goal = FinancialGoal.objects.get(pk=r.json()["id"])
    assert goal.starting_debt_amount is not None


def test_target_amount_must_be_positive(auth_client, household):
    r = auth_client.post(
        "/api/goals/",
        {
            "household": household.id,
            "name": "Bad",
            "goal_type": "custom",
            "target_amount": "0",
        },
        format="json",
    )
    assert r.status_code == 400


def test_progress_percent_savings_linked_account(user, household, savings):
    goal = FinancialGoal.objects.create(
        household=household,
        name="Emergency Fund",
        goal_type=FinancialGoal.GoalType.EMERGENCY_FUND,
        target_amount=Decimal("10000"),
        linked_account=savings,
        priority=1,
    )
    progress = calculate_goal_progress(goal, today=AS_OF)
    assert Decimal(progress["current_amount"]) >= Decimal("4300.00")
    assert Decimal(progress["progress_percent"]) == Decimal("43.00")


def test_debt_payoff_progress_after_payment(user, household, credit_card):
    post_transaction(user, credit_card.id, AS_OF, "Charges", Decimal("-2310"))
    goal = FinancialGoal.objects.create(
        household=household,
        name="Payoff Venture",
        goal_type=FinancialGoal.GoalType.DEBT_PAYOFF,
        target_amount=Decimal("2310"),
        linked_credit_account=credit_card,
        monthly_contribution=Decimal("200"),
        priority=1,
    )
    progress = calculate_goal_progress(goal, today=AS_OF)
    assert Decimal(progress["progress_percent"]) == Decimal("0.00")

    post_transaction(user, credit_card.id, AS_OF + timedelta(days=1), "Payment", Decimal("1000"))
    progress2 = calculate_goal_progress(goal, today=AS_OF + timedelta(days=1))
    assert Decimal(progress2["progress_percent"]) > 0


def test_projected_completion_from_monthly_contribution(user, household, savings):
    goal = FinancialGoal.objects.create(
        household=household,
        name="House Down Payment",
        goal_type=FinancialGoal.GoalType.HOUSE_DOWN_PAYMENT,
        target_amount=Decimal("20000"),
        linked_account=savings,
        monthly_contribution=Decimal("650"),
        priority=2,
    )
    progress = calculate_goal_progress(goal, today=AS_OF)
    assert progress["projected_completion_date"] is not None


def test_archive_and_complete_goal(auth_client, household):
    create = auth_client.post(
        "/api/goals/",
        {
            "household": household.id,
            "name": "Vacation",
            "goal_type": "vacation",
            "target_amount": "3000.00",
        },
        format="json",
    )
    gid = create.json()["id"]
    arch = auth_client.post(f"/api/goals/{gid}/archive/")
    assert arch.status_code == 200
    assert arch.json()["status"] == "archived"

    create2 = auth_client.post(
        "/api/goals/",
        {
            "household": household.id,
            "name": "Done",
            "goal_type": "custom",
            "target_amount": "100.00",
        },
        format="json",
    )
    gid2 = create2.json()["id"]
    done = auth_client.post(f"/api/goals/{gid2}/complete/")
    assert done.status_code == 200
    assert done.json()["status"] == "completed"


def test_dashboard_returns_top_active_goals_by_priority(auth_client, household, user):
    from goals.bucket_services import dashboard_buckets_for_user
    from goals.models import GoalBucket

    GoalBucket.objects.create(
        household=household,
        name="Low",
        type=GoalBucket.BucketType.CUSTOM,
        target_amount=Decimal("1000"),
        priority=GoalBucket.Priority.LOW,
        status=GoalBucket.Status.ACTIVE,
    )
    GoalBucket.objects.create(
        household=household,
        name="High",
        type=GoalBucket.BucketType.EMERGENCY,
        target_amount=Decimal("10000"),
        priority=GoalBucket.Priority.HIGH,
        status=GoalBucket.Status.ACTIVE,
    )
    GoalBucket.objects.create(
        household=household,
        name="Mid",
        type=GoalBucket.BucketType.VACATION,
        target_amount=Decimal("5000"),
        priority=GoalBucket.Priority.MEDIUM,
        status=GoalBucket.Status.ACTIVE,
    )
    goals = dashboard_buckets_for_user(user, limit=3)
    assert len(goals) == 3
    assert goals[0]["name"] == "High"

    r = auth_client.get("/api/insights/dashboard/summary/?days=30")
    assert r.status_code == 200
    dash_goals = r.json()["goals"]
    assert len(dash_goals) == 3
    assert dash_goals[0]["name"] == "High"


def test_goals_summary_endpoint(auth_client, household, savings):
    FinancialGoal.objects.create(
        household=household,
        name="Fund",
        goal_type=FinancialGoal.GoalType.CUSTOM,
        target_amount=Decimal("5000"),
        linked_account=savings,
        status=FinancialGoal.Status.ACTIVE,
        priority=1,
    )
    r = auth_client.get(f"/api/goals/summary/?household={household.id}")
    assert r.status_code == 200
    assert "total_saved" in r.json()


def test_current_amount_cannot_be_negative(auth_client, household):
    r = auth_client.post(
        "/api/goals/",
        {
            "household": household.id,
            "name": "Bad current",
            "goal_type": "savings",
            "target_amount": "1000",
            "current_amount": "-1",
        },
        format="json",
    )
    assert r.status_code == 400


def test_goal_health_and_milestones(user, household, savings):
    goal = FinancialGoal.objects.create(
        household=household,
        name="House",
        goal_type=FinancialGoal.GoalType.HOUSE_DOWN_PAYMENT,
        target_amount=Decimal("10000"),
        linked_account=savings,
        target_date=AS_OF + timedelta(days=365),
        priority=1,
    )
    progress = enrich_goal_progress(goal, calculate_goal_progress(goal, today=AS_OF))
    assert "goal_health" in progress
    assert progress["milestones"]


def test_goal_health_ahead_when_ahead_of_schedule(user, household):
    """60% actual vs ~0% expected at start of timeline → ahead."""
    today = date.today()
    goal = FinancialGoal.objects.create(
        household=household,
        name="Ahead",
        goal_type=FinancialGoal.GoalType.SAVINGS,
        target_amount=Decimal("10000"),
        current_amount=Decimal("6000"),
        target_date=today + timedelta(days=365),
        priority=1,
    )
    progress = enrich_goal_progress(goal, calculate_goal_progress(goal, today=today))
    assert progress["goal_health"] == "ahead"


def test_goal_forecast_endpoint(auth_client, household, savings):
    FinancialGoal.objects.create(
        household=household,
        name="Fund",
        goal_type=FinancialGoal.GoalType.CUSTOM,
        target_amount=Decimal("5000"),
        linked_account=savings,
        monthly_contribution=Decimal("200"),
        target_date=AS_OF + timedelta(days=180),
        status=FinancialGoal.Status.ACTIVE,
        priority=1,
    )
    goal = FinancialGoal.objects.get()
    r = auth_client.get(f"/api/goals/{goal.id}/forecast/")
    assert r.status_code == 200
    data = r.json()
    assert "projected_completion_date" in data
    assert "monthly_required" in data
    assert "forecast_gap" in data
    assert "goal_health" in data


@pytest.fixture
def checking(db, household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        name="Checking",
        starting_balance=Decimal("5000"),
        currency="USD",
    )


def test_contribute_transfer_updates_progress(auth_client, household, savings, checking, user):
    goal = FinancialGoal.objects.create(
        household=household,
        name="Emergency",
        goal_type=FinancialGoal.GoalType.EMERGENCY_FUND,
        target_amount=Decimal("10000"),
        linked_account=savings,
        status=FinancialGoal.Status.ACTIVE,
        priority=1,
    )
    savings_before = calculate_goal_progress(goal, today=AS_OF)["current_amount"]
    r = auth_client.post(
        f"/api/goals/{goal.id}/contribute/",
        {
            "from_account": checking.id,
            "amount": "500.00",
            "date": AS_OF.isoformat(),
            "method": "transfer",
        },
        format="json",
    )
    assert r.status_code == 200
    goal.refresh_from_db()
    after = calculate_goal_progress(goal, today=AS_OF)
    assert Decimal(after["current_amount"]) > Decimal(savings_before)


def test_contribute_preview_safe_to_spend(auth_client, household, savings, checking, user):
    goal = FinancialGoal.objects.create(
        household=household,
        name="Fund",
        goal_type=FinancialGoal.GoalType.SAVINGS,
        target_amount=Decimal("10000"),
        linked_account=savings,
        status=FinancialGoal.Status.ACTIVE,
        priority=1,
    )
    r = auth_client.post(
        f"/api/goals/{goal.id}/contribute/preview/",
        {
            "from_account": checking.id,
            "amount": "100.00",
            "date": AS_OF.isoformat(),
        },
        format="json",
    )
    assert r.status_code == 200
    data = r.json()
    assert "current_amount" in data
    assert "after_amount" in data
    assert data["safe_to_spend_before"] is not None
    assert data["safe_to_spend_after"] is not None
    assert Decimal(data["safe_to_spend_after"]) < Decimal(data["safe_to_spend_before"])


def test_aggregate_summary_counts_on_track(user, household, savings):
    FinancialGoal.objects.create(
        household=household,
        name="On track",
        goal_type=FinancialGoal.GoalType.SAVINGS,
        target_amount=Decimal("10000"),
        linked_account=savings,
        target_date=AS_OF + timedelta(days=365),
        status=FinancialGoal.Status.ACTIVE,
        priority=1,
    )
    summary = calculate_aggregate_goal_summary(
        list(FinancialGoal.objects.filter(household=household)),
        today=AS_OF,
    )
    assert summary["goals_active_count"] == 1
    assert summary["goals_on_track"] >= 1
    assert "total_saved" in summary
