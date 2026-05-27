"""Tests for credit card payoff projection service."""
from datetime import date
from decimal import Decimal

import pytest

from accounts.models import Account
from credit_cards.services.payoff import (
    IMPOSSIBLE_MESSAGE,
    calculate_monthly_interest,
    compare_payment_strategies,
    project_credit_card_payoff,
    resolve_strategy_payment_amount,
)
from transactions.models import Transaction
from transactions.services.posting import create_transfer, post_transaction


@pytest.fixture
def credit_card(household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        name="Visa",
        credit_limit=Decimal("5000"),
        apr=Decimal("18"),
        statement_closing_day=15,
        payment_due_day=10,
        minimum_payment_amount=Decimal("25"),
        statement_balance=Decimal("500"),
        current_balance=Decimal("1000"),
        billing_cycle_end_day=15,
    )


@pytest.fixture
def checking(household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Checking",
        starting_balance=Decimal("10000"),
    )


@pytest.mark.django_db
class TestMonthlyInterest:
    def test_calculate_monthly_interest(self, credit_card):
        interest = calculate_monthly_interest(credit_card, Decimal("1200"))
        assert interest == Decimal("18.00")

    def test_zero_balance_no_interest(self, credit_card):
        assert calculate_monthly_interest(credit_card, Decimal("0")) == Decimal("0")


def _seed_card_debt(credit_card, user, amount: Decimal):
    post_transaction(
        user,
        credit_card.id,
        date.today(),
        "Purchase",
        -amount,
    )
    credit_card.refresh_from_db()


@pytest.mark.django_db
class TestPayoffProjection:
    def test_fixed_payment_payoff(self, credit_card, user):
        _seed_card_debt(credit_card, user, Decimal("1000"))
        result = project_credit_card_payoff(
            credit_card,
            "custom_amount",
            custom_amount=Decimal("250"),
        )
        assert result["payoff_possible"] is True
        assert result["months_to_payoff"] > 0
        assert Decimal(result["total_interest"]) > 0
        assert len(result["schedule"]) == result["months_to_payoff"]

    def test_impossible_when_payment_below_interest(self, credit_card, user):
        _seed_card_debt(credit_card, user, Decimal("5000"))
        result = project_credit_card_payoff(
            credit_card,
            "custom_amount",
            custom_amount=Decimal("10"),
        )
        assert result["payoff_possible"] is False
        assert result["message"] == IMPOSSIBLE_MESSAGE

    def test_total_interest_accumulates(self, credit_card, user):
        _seed_card_debt(credit_card, user, Decimal("1000"))
        result = project_credit_card_payoff(
            credit_card,
            "custom_amount",
            custom_amount=Decimal("200"),
        )
        schedule_interest = sum(
            Decimal(row["interest_charged"]) for row in result["schedule"]
        )
        assert Decimal(result["total_interest"]) == schedule_interest

    def test_minimum_payment_strategy(self, credit_card):
        payment = resolve_strategy_payment_amount(credit_card, "minimum_payment")
        assert payment == Decimal("25")
        result = project_credit_card_payoff(credit_card, "minimum_payment")
        assert "payment_amount" in result

    def test_statement_balance_strategy(self, credit_card):
        payment = resolve_strategy_payment_amount(credit_card, "statement_balance")
        assert payment == Decimal("500")

    def test_current_balance_strategy(self, credit_card, user):
        _seed_card_debt(credit_card, user, Decimal("1000"))
        payment = resolve_strategy_payment_amount(credit_card, "current_balance")
        assert payment == Decimal("1000")

    def test_compare_strategies(self, credit_card):
        data = compare_payment_strategies(
            credit_card,
            fixed_amount=Decimal("300"),
        )
        assert "minimum_payment" in data["strategies"]
        assert "statement_balance" in data["strategies"]
        assert "fixed_amount" in data["strategies"]


@pytest.mark.django_db
class TestPayoffApi:
    @pytest.fixture
    def auth_client(self, api_client, user):
        api_client.force_authenticate(user=user)
        return api_client

    def test_payoff_endpoint_with_strategy(self, auth_client, credit_card, user):
        _seed_card_debt(credit_card, user, Decimal("1000"))
        r = auth_client.get(
            f"/api/accounts/{credit_card.pk}/payoff/",
            {"strategy": "custom_amount", "custom_amount": "250"},
        )
        assert r.status_code == 200
        data = r.json()
        assert data["payoff_possible"] is True
        assert "schedule" in data

    def test_payoff_legacy_monthly_payment(self, auth_client, credit_card, user):
        _seed_card_debt(credit_card, user, Decimal("1000"))
        r = auth_client.get(
            f"/api/accounts/{credit_card.pk}/payoff/",
            {"monthly_payment": "250"},
        )
        assert r.status_code == 200
        assert r.json()["strategy"] == "custom_amount" or "payment_amount" in r.json()

    def test_payoff_compare_endpoint(self, auth_client, credit_card):
        r = auth_client.get(f"/api/accounts/{credit_card.pk}/payoff/compare/")
        assert r.status_code == 200
        assert "strategies" in r.json()


@pytest.mark.django_db
class TestPaymentTransactions:
    def test_credit_card_payment_reduces_owed(self, credit_card, checking, user):
        post_transaction(user, credit_card.id, date.today(), "Purchase", Decimal("-500"))
        create_transfer(
            user,
            checking.id,
            credit_card.id,
            Decimal("200"),
            date.today(),
        )
        credit_card.refresh_from_db()
        assert credit_card.current_balance == Decimal("300")

    def test_credit_card_payment_not_expense(self, credit_card, checking, user, household):
        from categories.models import Category as Cat

        cat_expense = Cat.objects.create(
            household=household,
            name="Groceries",
            category_type=Cat.CategoryType.EXPENSE,
        )
        cat_payment = Cat.objects.create(
            household=household,
            name="Credit Card Payment",
            category_type=Cat.CategoryType.EXPENSE,
        )
        post_transaction(
            user,
            checking.id,
            date.today(),
            "Groceries",
            Decimal("-50"),
            category_id=cat_expense.id,
        )
        create_transfer(
            user,
            checking.id,
            credit_card.id,
            Decimal("100"),
            date.today(),
            from_category_id=cat_payment.id,
        )
        payment_txns = Transaction.objects.filter(
            account=checking,
            amount__lt=0,
            category=cat_payment,
        )
        assert payment_txns.exists()
        assert payment_txns.first().transaction_type == Transaction.TransactionType.TRANSFER
