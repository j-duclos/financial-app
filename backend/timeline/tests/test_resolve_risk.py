"""Tests for resolve-risk workflow."""
from decimal import Decimal

import pytest

from accounts.models import Account
from timeline.services.resolve_risk import (
    account_eligible_for_resolve_risk,
    build_resolve_risk_plan,
)


@pytest.mark.django_db
def test_account_eligible_when_critical(user, household):
    checking = Account.objects.create(
        household=household,
        name="Main",
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        starting_balance=Decimal("500"),
        minimum_buffer=Decimal("200"),
        currency="USD",
        include_in_forecast=True,
    )
    forecast = {
        "supports_available_to_spend": True,
        "risk_status": "critical",
        "lowest_projected_balance": "-100.00",
        "risk_date": "2026-06-17",
        "minimum_buffer": "200",
    }
    assert account_eligible_for_resolve_risk(checking, forecast) is True


@pytest.mark.django_db
def test_credit_not_eligible(user, household):
    card = Account.objects.create(
        household=household,
        name="Venture",
        account_type=Account.AccountType.CREDIT,
        role=Account.AccountRole.CREDIT_CARD,
        currency="USD",
        include_in_forecast=True,
    )
    forecast = {
        "supports_available_to_spend": False,
        "risk_status": "critical",
        "lowest_projected_balance": "-500.00",
    }
    assert account_eligible_for_resolve_risk(card, forecast) is False


@pytest.mark.django_db
def test_build_resolve_risk_plan_structure(user, household):
    checking = Account.objects.create(
        household=household,
        name="Main",
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        starting_balance=Decimal("200"),
        minimum_buffer=Decimal("100"),
        currency="USD",
        include_in_forecast=True,
    )
    savings = Account.objects.create(
        household=household,
        name="Savings",
        account_type=Account.AccountType.SAVINGS,
        role=Account.AccountRole.SAVINGS,
        starting_balance=Decimal("5000"),
        minimum_buffer=Decimal("500"),
        currency="USD",
        include_in_forecast=True,
    )
    plan = build_resolve_risk_plan(user, checking.id, days=30)
    assert "eligible" in plan
    if plan["eligible"]:
        assert plan["summary"]["account_name"] == "Main"
        assert isinstance(plan["actions"], list)
