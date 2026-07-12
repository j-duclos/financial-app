"""Tests for canonical account balance helpers."""
from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from accounts.models import Account
from accounts.services.balances import (
    bulk_signed_ledger_balances,
    compute_net_worth,
    credit_owed_from_signed_balance,
    signed_ledger_balance,
)
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


def test_bulk_signed_ledger_balances_matches_per_account(checking, credit_card):
    today = date.today()
    Transaction.objects.create(
        account=checking,
        date=today,
        payee="Spend",
        amount=Decimal("-50"),
        status=Transaction.Status.CLEARED,
        source=Transaction.Source.ONE_TIME,
    )
    accounts = [checking, credit_card]
    balance_map = bulk_signed_ledger_balances(accounts, today)
    assert balance_map[checking.pk] == signed_ledger_balance(checking, today)
    assert balance_map[credit_card.pk] == signed_ledger_balance(credit_card, today)


def test_bulk_signed_ledger_balances_single_query(checking, credit_card):
    accounts = [checking, credit_card]
    with CaptureQueriesContext(connection) as ctx:
        bulk_signed_ledger_balances(accounts, date.today())
    assert len(ctx.captured_queries) == 1


def test_credit_owed_from_signed_balance():
    assert credit_owed_from_signed_balance(Decimal("100")) == Decimal("0")
    assert credit_owed_from_signed_balance(Decimal("-250")) == Decimal("250")


def test_compute_net_worth_accepts_balance_map(checking, credit_card):
    today = date.today()
    balance_map = bulk_signed_ledger_balances([checking, credit_card], today)
    assert compute_net_worth(
        [checking, credit_card], today, balance_by_account=balance_map
    ) == signed_ledger_balance(checking, today) + signed_ledger_balance(
        credit_card, today
    )
