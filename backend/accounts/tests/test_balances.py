"""Tests for canonical account balance helpers."""
from datetime import date, timedelta
from decimal import Decimal

import pytest

from accounts.models import Account
from accounts.services.balances import compute_net_worth, signed_ledger_balance
from core.models import Household
from transactions.models import Transaction


@pytest.fixture
def household(db):
    return Household.objects.create(name="Balance HH")


@pytest.fixture
def checking(household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Main",
        starting_balance=Decimal("1000"),
    )


@pytest.fixture
def credit_card(household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        name="Card",
        current_balance=Decimal("500"),
    )


def test_signed_ledger_balance_ignores_future_transactions(checking):
    today = date.today()
    Transaction.objects.create(
        account=checking,
        date=today,
        payee="Today",
        amount=Decimal("-100"),
        status=Transaction.Status.CLEARED,
        source=Transaction.Source.ONE_TIME,
    )
    Transaction.objects.create(
        account=checking,
        date=today + timedelta(days=365),
        payee="Future paycheck",
        amount=Decimal("50000"),
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.ONE_TIME,
    )
    assert signed_ledger_balance(checking, today) == Decimal("900")


def test_compute_net_worth_matches_ledger_signed_balances(checking, credit_card):
    today = date.today()
    Transaction.objects.create(
        account=checking,
        date=today,
        payee="Spend",
        amount=Decimal("-200"),
        status=Transaction.Status.CLEARED,
        source=Transaction.Source.ONE_TIME,
    )
    Transaction.objects.create(
        account=credit_card,
        date=today,
        payee="Purchase",
        amount=Decimal("-300"),
        status=Transaction.Status.CLEARED,
        source=Transaction.Source.ONE_TIME,
    )
    credit_card.current_balance = Decimal("300")
    credit_card.save(update_fields=["current_balance"])
    total = compute_net_worth([checking, credit_card], today)
    assert total == signed_ledger_balance(checking, today) + signed_ledger_balance(credit_card, today)
    assert total == Decimal("500")
