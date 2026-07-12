"""Tests for Dashboard Lowest Projected Cash metric."""
from datetime import date, timedelta
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model

from accounts.models import Account
from accounts.services.lowest_projected_cash import (
    account_eligible_for_lowest_projected_cash,
    get_lowest_projected_cash,
    get_lowest_projected_cash_from_forecasts,
)
from categories.models import Category
from core.models import Household, HouseholdMembership
from goals.models import GoalBucket
from insights.services.dashboard_summary import _build_dashboard_summary
from timeline.services.ledger import build_timeline, recompute_timeline_running_balances
from transactions.models import Transaction

User = get_user_model()
AS_OF = date(2025, 7, 1)


@pytest.fixture
def user(db):
    return User.objects.create_user(username="lpcuser", password="testpass123")


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="LPC Household")
    HouseholdMembership.objects.create(household=h, user=user, role=HouseholdMembership.Role.OWNER)
    return h


@pytest.fixture
def expense_category(db, household):
    return Category.objects.create(
        household=household,
        name="Bills",
        category_type=Category.CategoryType.EXPENSE,
        sort_order=1,
    )


@pytest.fixture
def main(db, household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        name="Main",
        starting_balance=Decimal("1000"),
        minimum_buffer=Decimal("1000"),
        currency="USD",
    )


@pytest.fixture
def bills(db, household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.BILLS,
        name="Bills",
        starting_balance=Decimal("800"),
        minimum_buffer=Decimal("100"),
        currency="USD",
    )


@pytest.fixture
def credit_card(db, household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        role=Account.AccountRole.CREDIT_CARD,
        name="Visa",
        starting_balance=Decimal("-5000"),
        currency="USD",
    )


def _build_rows(user, accounts, as_of: date, days: int = 30):
    end = as_of + timedelta(days=days)
    rows = build_timeline(
        user,
        start_date=as_of,
        end_date=end,
        as_of_date=as_of,
        projection_only=True,
        caller="test_lowest_projected_cash",
    )
    return rows


def test_case_a_main_lower_than_bills(user, main, bills, expense_category):
    """Main lowest = -500 on July 8; Bills lowest = 200 on July 12 → pick Main."""
    july_8 = AS_OF + timedelta(days=7)
    july_12 = AS_OF + timedelta(days=11)
    Transaction.objects.create(
        account=main,
        date=july_8,
        payee="Big bill",
        amount=Decimal("-1500"),
        category=expense_category,
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.ONE_TIME,
    )
    Transaction.objects.create(
        account=bills,
        date=july_12,
        payee="Small bill",
        amount=Decimal("-600"),
        category=expense_category,
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.ONE_TIME,
    )
    rows = _build_rows(user, [main, bills], AS_OF)
    result = get_lowest_projected_cash([main, bills], rows, today=AS_OF, end_date=AS_OF + timedelta(days=30))

    assert result is not None
    assert Decimal(result["amount"]) == Decimal("-500.00")
    assert result["account_id"] == main.id
    assert result["account_name"] == "Main"
    assert result["date"] == july_8.isoformat()
    assert result["is_negative"] is True


def test_case_b_bills_lower_than_main(user, main, bills, expense_category):
    """Main lowest = 500; Bills lowest = 300 → pick Bills."""
    Transaction.objects.create(
        account=main,
        date=AS_OF + timedelta(days=5),
        payee="Expense",
        amount=Decimal("-500"),
        category=expense_category,
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.ONE_TIME,
    )
    Transaction.objects.create(
        account=bills,
        date=AS_OF + timedelta(days=10),
        payee="Bills hit",
        amount=Decimal("-500"),
        category=expense_category,
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.ONE_TIME,
    )
    rows = _build_rows(user, [main, bills], AS_OF)
    result = get_lowest_projected_cash([main, bills], rows, today=AS_OF, end_date=AS_OF + timedelta(days=30))

    assert result is not None
    assert Decimal(result["amount"]) == Decimal("300.00")
    assert result["account_id"] == bills.id


def test_case_c_buffers_and_goals_do_not_affect_lowest(user, main, household):
    """Lowest projected cash stays 500 even with high buffer and goal reserves."""
    GoalBucket.objects.create(
        household=household,
        name="Emergency",
        type=GoalBucket.BucketType.EMERGENCY,
        target_amount=Decimal("10000"),
        linked_account=main,
        status=GoalBucket.Status.ACTIVE,
        include_in_safe_to_spend=True,
    )
    main.minimum_buffer = Decimal("1000")
    main.save(update_fields=["minimum_buffer"])
    Transaction.objects.create(
        account=main,
        date=AS_OF + timedelta(days=3),
        payee="Spend",
        amount=Decimal("-500"),
        category=Category.objects.create(
            household=household,
            name="Misc",
            category_type=Category.CategoryType.EXPENSE,
            sort_order=2,
        ),
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.ONE_TIME,
    )
    rows = _build_rows(user, [main], AS_OF)
    result = get_lowest_projected_cash([main], rows, today=AS_OF, end_date=AS_OF + timedelta(days=30))

    assert result is not None
    assert Decimal(result["amount"]) == Decimal("500.00")
    assert result["is_negative"] is False


def test_case_d_credit_card_excluded(user, main, credit_card, expense_category):
    Transaction.objects.create(
        account=credit_card,
        date=AS_OF + timedelta(days=2),
        payee="Charge",
        amount=Decimal("-8000"),
        category=expense_category,
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.ONE_TIME,
    )
    rows = _build_rows(user, [main, credit_card], AS_OF)
    result = get_lowest_projected_cash([main, credit_card], rows, today=AS_OF, end_date=AS_OF + timedelta(days=30))

    assert result is not None
    assert result["account_id"] == main.id
    assert not account_eligible_for_lowest_projected_cash(credit_card)


def test_from_forecasts_picks_single_lowest_main_over_bills(user, main, bills):
    """Main -298.74 on Jul 8 beats Bills 200 on Jul 10 — no summing."""
    forecasts = {
        main.id: {
            "supports_available_to_spend": True,
            "lowest_projected_balance": "-298.74",
            "lowest_projected_balance_date": "2026-07-08",
            "minimum_buffer": "1000",
            "bucket_allocation": "2000",
            "available_to_spend": "-3298.74",
        },
        bills.id: {
            "supports_available_to_spend": True,
            "lowest_projected_balance": "200.00",
            "lowest_projected_balance_date": "2026-07-10",
            "minimum_buffer": "100",
            "bucket_allocation": "0",
            "available_to_spend": "100.00",
        },
    }
    result = get_lowest_projected_cash_from_forecasts([main, bills], forecasts)

    assert result is not None
    assert result["amount"] == "-298.74"
    assert result["account_id"] == main.id
    assert result["account_name"] == "Main"
    assert result["date"] == "2026-07-08"
    assert result["is_negative"] is True


def test_dashboard_uses_forecasts_not_second_timeline(user, main, expense_category):
    from contextlib import ExitStack

    Transaction.objects.create(
        account=main,
        date=AS_OF + timedelta(days=4),
        payee="Bill",
        amount=Decimal("-400"),
        category=expense_category,
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.ONE_TIME,
    )

    with ExitStack() as stack:
        mock_from_forecasts = stack.enter_context(
            patch(
                "insights.services.dashboard_summary.get_lowest_projected_cash_from_forecasts",
                return_value={
                    "amount": "-298.74",
                    "account_id": main.id,
                    "account_name": "Main",
                    "date": "2026-07-08",
                    "is_negative": True,
                },
            ),
        )
        mock_timeline_lpc = stack.enter_context(
            patch("insights.services.dashboard_summary.get_lowest_projected_cash")
        )
        mock_build = stack.enter_context(
            patch("insights.services.dashboard_summary.build_timeline", return_value=[])
        )
        stack.enter_context(
            patch(
                "insights.services.dashboard_summary.calculate_forecast_summaries_for_accounts",
                return_value={main.id: {"supports_available_to_spend": True}},
            )
        )
        stack.enter_context(
            patch(
                "insights.services.dashboard_summary.calculate_account_health_for_accounts",
                return_value={},
            )
        )
        stack.enter_context(patch("insights.services.dashboard_summary.build_upcoming_events", return_value=[]))
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
        result = _build_dashboard_summary(user, days=30, as_of_date=AS_OF, mode="fast")

    assert mock_build.call_count == 1
    assert mock_from_forecasts.call_count == 1
    mock_timeline_lpc.assert_not_called()
    assert result["lowest_projected_cash"]["amount"] == "-298.74"


def test_pure_helper_does_not_query_database(user, main):
    rows = [
        {
            "date": AS_OF,
            "account_id": main.id,
            "amount": Decimal("-200"),
            "running_balance": Decimal("800"),
        }
    ]
    opening = {main.id: Decimal("1000")}
    recompute_timeline_running_balances(rows, opening=opening, account_ids={main.id})

    with patch("accounts.services.lowest_projected_cash.forecast_lowest_balance_from_rows") as mock_forecast:
        mock_forecast.return_value = (Decimal("800"), AS_OF, main.id)
        get_lowest_projected_cash([main], rows, today=AS_OF, end_date=AS_OF + timedelta(days=30))

    assert mock_forecast.call_count == 1
    assert mock_forecast.call_args.kwargs.get("opening") is not None
