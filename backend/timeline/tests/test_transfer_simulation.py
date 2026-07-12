"""Tests for what-if transfer simulation."""
from datetime import date, timedelta
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model

from accounts.models import Account
from categories.models import Category
from core.models import Household, HouseholdMembership
from timeline.services.transfer_simulation import (
    prepare_transfer_simulation_context,
    simulate_transfer_impact,
)

User = get_user_model()


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="Sim Household")
    HouseholdMembership.objects.create(household=h, user=user, role=HouseholdMembership.Role.OWNER)
    return h


@pytest.fixture
def checking(household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Main",
        currency="USD",
        starting_balance=Decimal("500.00"),
        minimum_buffer=Decimal("100.00"),
    )


@pytest.fixture
def savings(household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.SAVINGS,
        name="Savings",
        currency="USD",
        starting_balance=Decimal("5000.00"),
        minimum_buffer=Decimal("500.00"),
    )


def test_simulate_transfer_improves_stressed_checking(user, checking, savings):
    """Transfer from savings should raise projected checking balance on a future stress day."""
    today = date.today()
    stress = today + timedelta(days=14)
    from transactions.models import Transaction

    cat = Category.objects.create(
        household=checking.household,
        name="Rent",
        category_type=Category.CategoryType.EXPENSE,
        sort_order=1,
    )
    Transaction.objects.create(
        account=checking,
        date=stress,
        payee="Rent",
        amount=Decimal("-2000.00"),
        status=Transaction.Status.PLANNED,
    )

    base = simulate_transfer_impact(
        user,
        from_account_id=savings.id,
        to_account_id=checking.id,
        amount=Decimal("800.00"),
        transfer_date=stress,
        focus_date=stress,
        household_id=checking.household_id,
        horizon="3m",
    )
    assert base["from_account_id"] == savings.id
    assert base["to_account_id"] == checking.id
    assert base["simulated_lowest_projected_balance"] is not None
    assert base["simulated_horizon_lowest_projected_balance"] == base["simulated_lowest_projected_balance"]
    assert base["source_buffer_warning"] is False


def test_horizon_improvement_equals_simulated_minus_base(user, checking, savings):
    today = date.today()
    day_iso = (today + timedelta(days=5)).isoformat()
    base_calendar = {
        "days": [
            {
                "date": day_iso,
                "account_balances": {str(checking.id): "-1565.79", str(savings.id): "5000.00"},
            }
        ],
        "summary": {},
    }
    sim_calendar = {
        "days": [
            {
                "date": day_iso,
                "account_balances": {str(checking.id): "0.00", str(savings.id): "3434.21"},
            }
        ],
        "summary": {},
    }

    prepared = prepare_transfer_simulation_context(
        user,
        horizon="14d",
        as_of_date=today,
        household_id=checking.household_id,
        accounts=[checking, savings],
        accounts_by_id={checking.id: checking, savings.id: savings},
        timeline_rows=[],
    )
    prepared.base_calendar = base_calendar
    with patch(
        "timeline.services.transfer_simulation.build_timeline",
        return_value=[],
    ):
        with patch(
            "timeline.services.transfer_simulation.build_timeline_calendar",
            return_value=sim_calendar,
        ):
            result = simulate_transfer_impact(
                user,
                from_account_id=savings.id,
                to_account_id=checking.id,
                amount=Decimal("1565.79"),
                transfer_date=today + timedelta(days=3),
                prepared_context=prepared,
            )

    base = Decimal(result["base_horizon_lowest_projected_balance"])
    simulated = Decimal(result["simulated_horizon_lowest_projected_balance"])
    assert result["simulated_lowest_projected_balance"] == result["simulated_horizon_lowest_projected_balance"]
    assert result["base_lowest_projected_balance"] == result["base_horizon_lowest_projected_balance"]
    assert result["horizon_lowest_date"] == result["simulated_horizon_lowest_date"]
    assert simulated - base == Decimal("1565.79")


def test_prepared_context_builds_base_timeline_once(user, checking, savings):
    today = date.today()
    with patch(
        "timeline.services.transfer_simulation.build_timeline",
        return_value=[],
    ) as mock_timeline:
        with patch(
            "timeline.services.transfer_simulation.build_timeline_calendar",
            return_value={"days": [], "summary": {}},
        ):
            prepared = prepare_transfer_simulation_context(
                user,
                horizon="14d",
                as_of_date=today,
                household_id=checking.household_id,
                accounts=[checking, savings],
                accounts_by_id={checking.id: checking, savings.id: savings},
            )
            simulate_transfer_impact(
                user,
                from_account_id=savings.id,
                to_account_id=checking.id,
                amount=Decimal("50"),
                transfer_date=today,
                prepared_context=prepared,
            )
            simulate_transfer_impact(
                user,
                from_account_id=savings.id,
                to_account_id=checking.id,
                amount=Decimal("75"),
                transfer_date=today,
                prepared_context=prepared,
            )

    base_builds = [
        c.kwargs.get("caller")
        for c in mock_timeline.call_args_list
        if c.kwargs.get("caller") == "transfer_simulation_base"
    ]
    scenario_builds = [
        c.kwargs.get("caller")
        for c in mock_timeline.call_args_list
        if c.kwargs.get("caller") == "transfer_simulation_scenario"
    ]
    assert len(base_builds) == 1
    assert len(scenario_builds) == 2
