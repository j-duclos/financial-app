"""Tests for household debt payoff engine."""
from decimal import Decimal

import pytest

from accounts.models import Account
from credit_cards.services.debt_engine import simulate_household_debt
from transactions.services.posting import post_transaction


@pytest.fixture
def card_a(household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        name="High APR",
        credit_limit=Decimal("5000"),
        apr=Decimal("24"),
        minimum_payment_amount=Decimal("40"),
    )


@pytest.fixture
def card_b(household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        name="Low Balance",
        credit_limit=Decimal("3000"),
        apr=Decimal("18"),
        minimum_payment_amount=Decimal("25"),
    )


def _debt(card, user, amount):
    post_transaction(user, card.id, __import__("datetime").date.today(), "Charge", -amount)


@pytest.mark.django_db
def test_simulate_avalanche_payoff(user, card_a, card_b):
    _debt(card_a, user, Decimal("2000"))
    _debt(card_b, user, Decimal("500"))
    plan = simulate_household_debt(
        [card_a, card_b],
        strategy="avalanche",
        mode="aggressive",
        extra_monthly=Decimal("200"),
    )
    assert Decimal(plan["total_debt"]) > 0
    assert plan["debt_free_possible"] is True
    assert len(plan["cards"]) >= 2
    assert card_a.id in plan["payoff_order"]


@pytest.mark.django_db
def test_simulate_snowball_order(user, card_a, card_b):
    _debt(card_a, user, Decimal("2000"))
    _debt(card_b, user, Decimal("300"))
    plan = simulate_household_debt(
        [card_a, card_b],
        strategy="snowball",
        mode="aggressive",
        extra_monthly=Decimal("300"),
    )
    assert plan["payoff_order"] and plan["payoff_order"][0] == card_b.id


@pytest.mark.django_db
def test_empty_when_no_debt(user, card_a):
    plan = simulate_household_debt([card_a], strategy="avalanche", mode="survival")
    assert plan["total_debt"] == "0.00"
    assert plan["debt_free_possible"] is True
