"""Tests for what-if transfer simulation."""
from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model

from accounts.models import Account
from categories.models import Category
from core.models import Household, HouseholdMembership
from timeline.services.transfer_simulation import simulate_transfer_impact

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
    assert base["source_buffer_warning"] is False
