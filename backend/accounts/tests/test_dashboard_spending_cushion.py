"""Tests for dashboard Spending Cushion aggregate efficiency and correctness."""
from datetime import date
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from django.test.utils import override_settings

from accounts.models import Account
from accounts.services.available_to_spend import (
    DASHBOARD_SPENDING_CUSHION_ROLES,
    calculate_forecast_summaries_for_accounts,
    dashboard_safe_to_spend_aggregate,
)
from common.services.cache import get_dashboard_summary_cache_key
from core.models import Household, HouseholdMembership
from goals.models import GoalBucket
from insights.services.dashboard_summary import build_dashboard_summary

User = get_user_model()
AS_OF = date(2025, 5, 1)


@pytest.fixture
def user(db):
    return User.objects.create_user(username="cushionuser", password="testpass123")


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="Cushion Household")
    HouseholdMembership.objects.create(household=h, user=user, role=HouseholdMembership.Role.OWNER)
    return h


@pytest.fixture
def spending(db, household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        name="Spending",
        starting_balance=Decimal("1000"),
        minimum_buffer=Decimal("200"),
        currency="USD",
    )


@pytest.fixture
def bills(db, household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.BILLS,
        name="Bills",
        starting_balance=Decimal("500"),
        minimum_buffer=Decimal("100"),
        currency="USD",
    )


@pytest.fixture
def savings(db, household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.SAVINGS,
        role=Account.AccountRole.SAVINGS,
        name="Savings",
        starting_balance=Decimal("5000"),
        minimum_buffer=Decimal("500"),
        currency="USD",
    )


def _mock_forecast_summary(account_id: int, available: str, *, role_supports: bool = True) -> dict:
    return {
        "account_id": account_id,
        "supports_available_to_spend": role_supports,
        "available_to_spend": available,
        "lowest_projected_balance": str(Decimal(available) + Decimal("300")),
        "minimum_buffer": "200",
        "bucket_allocation": "100",
        "risk_status": "watch",
        "risk_date": AS_OF.isoformat(),
        "risk_reason": "Low cushion",
    }


def test_dashboard_spending_cushion_reuses_supplied_forecast_summaries(user, spending, bills):
    accounts_by_id = {spending.id: spending, bills.id: bills}
    forecasts = {
        spending.id: _mock_forecast_summary(spending.id, "700.00"),
        bills.id: _mock_forecast_summary(bills.id, "-200.00"),
    }

    with patch(
        "accounts.services.available_to_spend.calculate_forecast_summaries_for_accounts"
    ) as mock_batch:
        result = dashboard_safe_to_spend_aggregate(
            accounts_by_id,
            user=user,
            forecast_summaries=forecasts,
        )
        mock_batch.assert_not_called()

    assert result["amount"] == "500.00"
    assert result["total_safe_to_spend"] == "500.00"
    assert result["accounts_included"] == 2
    assert len(result["components"]) == 2


def test_dashboard_spending_cushion_skips_build_timeline_when_summaries_provided(
    user, spending
):
    forecasts = {spending.id: _mock_forecast_summary(spending.id, "800.00")}

    with patch("accounts.services.available_to_spend.build_timeline") as mock_build:
        dashboard_safe_to_spend_aggregate(
            {spending.id: spending},
            user=user,
            forecast_summaries=forecasts,
            timeline_rows=[],
        )
        mock_build.assert_not_called()


def test_dashboard_spending_cushion_skips_forecast_batch_when_summaries_provided(
    user, spending
):
    forecasts = {spending.id: _mock_forecast_summary(spending.id, "800.00")}

    with patch(
        "accounts.services.available_to_spend.calculate_forecast_summaries_for_accounts"
    ) as mock_batch:
        dashboard_safe_to_spend_aggregate(
            {spending.id: spending},
            user=user,
            forecast_summaries=forecasts,
        )
        mock_batch.assert_not_called()


def test_bucket_reserves_loaded_in_bulk_during_forecast_batch(user, spending, bills, savings):
    GoalBucket.objects.create(
        household=spending.household,
        name="Emergency",
        type=GoalBucket.BucketType.EMERGENCY,
        target_amount=Decimal("1000"),
        linked_account=spending,
        status=GoalBucket.Status.ACTIVE,
        include_in_safe_to_spend=True,
    )
    GoalBucket.objects.create(
        household=bills.household,
        name="Bills reserve",
        type=GoalBucket.BucketType.CUSTOM,
        target_amount=Decimal("500"),
        linked_account=bills,
        status=GoalBucket.Status.ACTIVE,
        include_in_safe_to_spend=True,
    )

    with patch("goals.bucket_services.bucket_reserves_by_account") as mock_bulk:
        mock_bulk.return_value = {
            spending.id: Decimal("50"),
            bills.id: Decimal("25"),
        }
        with patch("accounts.services.available_to_spend.build_timeline", return_value=[]):
            summaries = calculate_forecast_summaries_for_accounts(
                user,
                [spending, bills, savings],
                as_of_date=AS_OF,
                days=30,
                timeline_rows=[],
            )

    assert mock_bulk.call_count == 1
    bulk_account_ids = set(mock_bulk.call_args[0][1])
    assert spending.id in bulk_account_ids
    assert bills.id in bulk_account_ids
    assert summaries[spending.id]["bucket_allocation"] == "50"
    assert summaries[bills.id]["bucket_allocation"] == "25"


def test_only_spending_and_bills_roles_included(user, spending, bills, savings):
    forecasts = {
        spending.id: _mock_forecast_summary(spending.id, "700.00"),
        bills.id: _mock_forecast_summary(bills.id, "300.00"),
        savings.id: _mock_forecast_summary(savings.id, "4000.00"),
    }
    accounts_by_id = {spending.id: spending, bills.id: bills, savings.id: savings}

    result = dashboard_safe_to_spend_aggregate(
        accounts_by_id,
        user=user,
        forecast_summaries=forecasts,
    )

    assert result["accounts_included"] == 2
    included_ids = {c["account_id"] for c in result["components"]}
    assert included_ids == {spending.id, bills.id}
    assert savings.role not in DASHBOARD_SPENDING_CUSHION_ROLES


def test_aggregate_amount_unchanged_with_precomputed_summaries(user, spending, bills):
    accounts = [spending, bills]
    accounts_by_id = {a.id: a for a in accounts}

    with patch("accounts.services.available_to_spend.build_timeline", return_value=[]):
        forecasts = calculate_forecast_summaries_for_accounts(
            user, accounts, as_of_date=AS_OF, days=30, timeline_rows=[]
        )

    direct = dashboard_safe_to_spend_aggregate(
        accounts_by_id,
        user=user,
        forecast_summaries=forecasts,
    )
    recomputed = dashboard_safe_to_spend_aggregate(
        accounts,
        user=user,
        timeline_rows=[],
        as_of_date=AS_OF,
        days=30,
    )

    assert direct["amount"] == recomputed["amount"]
    assert direct["total_safe_to_spend"] == recomputed["total_safe_to_spend"]


def test_dashboard_request_builds_timeline_at_most_once(user, spending):
    from contextlib import ExitStack

    with ExitStack() as stack:
        mock_build = stack.enter_context(
            patch("insights.services.dashboard_summary.build_timeline", return_value=[])
        )
        stack.enter_context(
            patch(
                "insights.services.dashboard_summary.calculate_forecast_summaries_for_accounts",
                return_value={spending.id: _mock_forecast_summary(spending.id, "800.00")},
            )
        )
        stack.enter_context(
            patch(
                "insights.services.dashboard_summary.calculate_account_health_for_accounts",
                return_value={},
            )
        )
        stack.enter_context(
            patch("insights.services.dashboard_summary.build_upcoming_events", return_value=[])
        )
        stack.enter_context(
            patch(
                "insights.services.dashboard_summary.build_upcoming_groups",
                return_value={"groups": [], "truncated": False, "total_event_count": 0},
            )
        )
        stack.enter_context(patch("goals.bucket_services.dashboard_buckets_for_user", return_value=[]))
        stack.enter_context(
            patch(
                "goals.bucket_services.calculate_aggregate_bucket_summary",
                return_value={"goals_active_count": 0, "warnings": []},
            )
        )
        stack.enter_context(patch("bills.services.build_dashboard_bill_summary", return_value={}))
        stack.enter_context(
            patch("credit_cards.services.debt_engine.build_dashboard_debt_summary", return_value={})
        )
        stack.enter_context(
            patch("insights.services.dashboard_insights.build_dashboard_insights", return_value=[])
        )
        mock_rec_ctx = stack.enter_context(
            patch("recommendations.services.engine.build_recommendation_context")
        )
        stack.enter_context(
            patch("recommendations.services.engine.build_dashboard_recommendation_list", return_value=[])
        )
        stack.enter_context(
            patch("recommendations.services.engine.recommendation_timeline_hints", return_value=[])
        )
        mock_rec_ctx.return_value = object()

        from insights.services.dashboard_summary import _build_dashboard_summary

        _build_dashboard_summary(user, days=30, as_of_date=AS_OF)

    assert mock_build.call_count == 1


def test_dashboard_cache_invalidates_on_buffer_change(user, household, spending):
    today = AS_OF
    before = get_dashboard_summary_cache_key(
        user_id=user.pk,
        household_ids=[household.id],
        forecast_days=30,
        as_of_date=today,
    )
    spending.minimum_buffer = Decimal("999")
    spending.save(update_fields=["minimum_buffer"])
    after = get_dashboard_summary_cache_key(
        user_id=user.pk,
        household_ids=[household.id],
        forecast_days=30,
        as_of_date=today,
    )
    assert before != after


def test_dashboard_cache_invalidates_on_goal_reservation_change(user, household, spending):
    today = AS_OF

    with patch("insights.services.dashboard_summary._build_dashboard_summary") as mock_build:
        mock_build.return_value = {"safe_to_spend": {"amount": "100.00"}}
        build_dashboard_summary(user, days=30, as_of_date=today)
        assert mock_build.call_count == 1

        GoalBucket.objects.create(
            household=household,
            name="Reserve",
            type=GoalBucket.BucketType.EMERGENCY,
            target_amount=Decimal("1000"),
            linked_account=spending,
            status=GoalBucket.Status.ACTIVE,
            include_in_safe_to_spend=True,
        )

        build_dashboard_summary(user, days=30, as_of_date=today)
        assert mock_build.call_count == 2


@override_settings(DEBUG=True, ENABLE_PERF_LOGS=True)
def test_dashboard_spending_cushion_perf_logging(user, spending, capsys):
    forecasts = {spending.id: _mock_forecast_summary(spending.id, "800.00")}
    dashboard_safe_to_spend_aggregate(
        {spending.id: spending},
        user=user,
        forecast_summaries=forecasts,
    )
    captured = capsys.readouterr().out
    assert "[PERF] dashboard_spending_cushion reused_forecast=true" in captured
    assert "[PERF] dashboard_spending_cushion timeline_builds=0" in captured


def test_structured_breakdown_fields(user, spending):
    forecasts = {spending.id: _mock_forecast_summary(spending.id, "-500.00")}
    result = dashboard_safe_to_spend_aggregate(
        {spending.id: spending},
        user=user,
        forecast_summaries=forecasts,
    )

    assert result["amount"] == "-500.00"
    assert result["earliest_issue_date"] == AS_OF.isoformat()
    component = result["components"][0]
    assert component["account_id"] == spending.id
    assert "lowest_projected_balance" in component
    assert "minimum_buffer" in component
    assert "reserved_goals" in component
    assert component["spending_cushion"] == "-500.00"
