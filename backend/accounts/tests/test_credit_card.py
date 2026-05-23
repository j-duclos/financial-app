"""Credit card modeling: balances, dates, autopay, Plaid matching."""
from datetime import date
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone

from accounts.models import Account
from accounts.services.autopay import sync_autopay_for_account
from accounts.services.credit_card import (
    apply_credit_card_balance_change,
    apply_transaction_to_credit_card_balance,
    calculate_next_payment_due_date,
    calculate_next_statement_date,
    close_statement_for_account,
    sync_current_balance_from_ledger,
)
from transactions.models import Transaction, TransferGroup
from transactions.services.matching import match_imported_transaction
from transactions.services.posting import create_transfer, post_transaction

User = get_user_model()


@pytest.fixture
def credit_card(household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        name="Visa",
        credit_limit=Decimal("5000"),
        apr=Decimal("18.99"),
        statement_closing_day=15,
        payment_due_day=10,
        current_balance=Decimal("0"),
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
class TestCreditCardAccount:
    def test_create_credit_card_with_fields(self, authenticated_client, household):
        r = authenticated_client.post(
            "/api/accounts/",
            {
                "household": household.id,
                "name": "Amex",
                "account_type": "CREDIT",
                "credit_limit": "3000.00",
                "apr": "21.5",
                "statement_closing_day": 20,
                "payment_due_day": 5,
                "current_balance": "150.00",
                "currency": "USD",
            },
            format="json",
        )
        assert r.status_code == 201, r.content
        data = r.json()
        assert data["account_type"] == "CREDIT"
        assert data["credit_limit"] == "3000.00"
        assert data["statement_closing_day"] == 20

    def test_available_credit_calculation(self, credit_card):
        credit_card.current_balance = Decimal("1200")
        credit_card.credit_limit = Decimal("5000")
        credit_card.save()
        assert credit_card.available_credit == Decimal("3800")

    def test_utilization_calculation(self, credit_card):
        credit_card.current_balance = Decimal("2500")
        credit_card.credit_limit = Decimal("5000")
        credit_card.save()
        assert credit_card.utilization_percent == Decimal("50.00")

    def test_utilization_none_without_limit(self, credit_card):
        credit_card.credit_limit = None
        credit_card.current_balance = Decimal("100")
        credit_card.save()
        assert credit_card.utilization_percent is None


@pytest.mark.django_db
class TestStatementDates:
    def test_next_statement_date(self):
        # May 16 2026, closing day 15 → next close June 15
        today = date(2026, 5, 16)
        assert calculate_next_statement_date(15, today) == date(2026, 6, 15)

    def test_next_statement_date_same_month_if_before_close(self):
        today = date(2026, 5, 10)
        assert calculate_next_statement_date(15, today) == date(2026, 5, 15)

    def test_payment_due_date_month_end(self):
        # Due day 31 in April → April 30
        today = date(2026, 4, 1)
        assert calculate_next_payment_due_date(31, today) == date(2026, 4, 30)

    def test_payment_due_date_february(self):
        today = date(2026, 2, 1)
        assert calculate_next_payment_due_date(31, today) == date(2026, 2, 28)


@pytest.mark.django_db
class TestBalanceChanges:
    def test_purchase_increases_current_balance(self, credit_card, user):
        post_transaction(
            user,
            credit_card.id,
            date.today(),
            "Store",
            Decimal("-50.00"),
        )
        credit_card.refresh_from_db()
        assert credit_card.current_balance == Decimal("50.00")

    def test_payment_decreases_current_balance(self, credit_card, user):
        credit_card.current_balance = Decimal("200")
        credit_card.save(update_fields=["current_balance"])
        post_transaction(
            user,
            credit_card.id,
            date.today(),
            "Payment",
            Decimal("75.00"),
        )
        credit_card.refresh_from_db()
        assert credit_card.current_balance == Decimal("125.00")

    def test_refund_decreases_current_balance(self, credit_card):
        credit_card.current_balance = Decimal("100")
        credit_card.save(update_fields=["current_balance"])
        Transaction.objects.create(
            account=credit_card,
            date=date.today(),
            payee="Refund",
            amount=Decimal("25.00"),
            transaction_type=Transaction.TransactionType.CREDIT_CARD_REFUND,
        )
        credit_card.refresh_from_db()
        assert credit_card.current_balance == Decimal("75.00")

    def test_interest_charge_increases_current_balance(self, credit_card):
        credit_card.current_balance = Decimal("100")
        credit_card.save(update_fields=["current_balance"])
        Transaction.objects.create(
            account=credit_card,
            date=date.today(),
            payee="Interest",
            amount=Decimal("-12.50"),
            transaction_type=Transaction.TransactionType.INTEREST_CHARGE,
        )
        credit_card.refresh_from_db()
        assert credit_card.current_balance == Decimal("112.50")


@pytest.mark.django_db
class TestAutopay:
    def test_autopay_creates_future_payment(self, credit_card, checking, user):
        credit_card.autopay_enabled = True
        credit_card.autopay_account = checking
        credit_card.autopay_type = Account.AutopayType.MINIMUM_PAYMENT
        credit_card.minimum_payment_amount = Decimal("35")
        credit_card.next_payment_due_date = date.today().replace(day=28)
        if credit_card.next_payment_due_date <= date.today():
            credit_card.next_payment_due_date = date(
                credit_card.next_payment_due_date.year,
                credit_card.next_payment_due_date.month + 1,
                28,
            )
        credit_card.save()

        tg = sync_autopay_for_account(credit_card, user=user)
        assert tg is not None
        assert tg.from_account_id == checking.id
        assert tg.to_account_id == credit_card.id
        assert tg.amount == Decimal("35")

    def test_autopay_does_not_duplicate(self, credit_card, checking, user):
        credit_card.autopay_enabled = True
        credit_card.autopay_account = checking
        credit_card.autopay_type = Account.AutopayType.FIXED_AMOUNT
        credit_card.autopay_fixed_amount = Decimal("100")
        future = date.today().replace(year=date.today().year + 1, month=6, day=10)
        credit_card.next_payment_due_date = future
        credit_card.save()

        tg1 = sync_autopay_for_account(credit_card, user=user)
        tg2 = sync_autopay_for_account(credit_card, user=user)
        assert tg1 is not None
        assert tg2 is not None
        assert tg1.pk == tg2.pk
        assert (
            TransferGroup.objects.filter(
                to_account=credit_card, notes__icontains="autopay"
            ).count()
            == 1
        )


@pytest.mark.django_db
class TestPayoffAndInterest:
    def test_payoff_to_avoid_interest(self, credit_card, user):
        credit_card.statement_balance = Decimal("500")
        credit_card.last_statement_date = date.today().replace(day=1)
        credit_card.save()
        post_transaction(
            user,
            credit_card.id,
            date.today(),
            "Payment",
            Decimal("200.00"),
        )
        credit_card.refresh_from_db()
        assert credit_card.payoff_to_avoid_interest == Decimal("300.00")

    def test_estimated_monthly_interest(self, credit_card):
        credit_card.statement_balance = Decimal("1000")
        credit_card.apr = Decimal("12.00")
        credit_card.save()
        assert credit_card.estimated_monthly_interest == Decimal("10.00")

    def test_projected_interest_if_unpaid(self, credit_card):
        credit_card.statement_balance = Decimal("2000")
        credit_card.apr = Decimal("24.00")
        credit_card.save()
        assert credit_card.projected_interest_if_unpaid == Decimal("40.00")


@pytest.mark.django_db
class TestPlaidAutopayMatch:
    def test_plaid_payment_matches_planned_card_payment(
        self, credit_card, checking, user
    ):
        """Plaid checking outflow matches a planned credit-card payment transfer."""
        future = date.today().replace(year=date.today().year + 1, month=8, day=10)
        create_transfer(
            user,
            from_account_id=checking.id,
            to_account_id=credit_card.id,
            amount=Decimal("150.00"),
            transfer_date=future,
            memo="Autopay (scheduled)",
            payee="Credit card autopay",
        )
        planned = Transaction.objects.filter(
            account=checking,
            transfer_group__to_account=credit_card,
            amount=Decimal("-150.00"),
        ).first()
        assert planned is not None

        imported = Transaction.objects.create(
            account=checking,
            date=future,
            payee="CAPITAL ONE ONLINE PMT",
            amount=Decimal("-150.00"),
            source=Transaction.Source.PLAID,
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
            plaid_transaction_id="plaid-test-autopay-1",
            imported_description="CAPITAL ONE ONLINE PMT",
        )
        m = match_imported_transaction(imported)
        assert m is not None
        imported.refresh_from_db()
        assert imported.import_match_status == Transaction.ImportMatchStatus.MATCHED


@pytest.mark.django_db
class TestStatementClose:
    def test_close_statement(self, credit_card):
        credit_card.current_balance = Decimal("750")
        credit_card.save(update_fields=["current_balance"])
        period_start = date(2026, 4, 16)
        period_end = date(2026, 5, 15)
        stmt = close_statement_for_account(credit_card, period_start, period_end)
        credit_card.refresh_from_db()
        assert stmt.statement_balance == Decimal("750")
        assert credit_card.statement_balance == Decimal("750")
        assert credit_card.last_statement_date == period_end
