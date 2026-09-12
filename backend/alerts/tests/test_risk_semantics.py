from datetime import date, timedelta
from decimal import Decimal
from unittest.mock import patch

import pytest

from accounts.models import Account
from alerts.models import ProjectedFundsAlert
from alerts.services.evaluate import (
    detect_risks_from_timeline,
    evaluate_projected_funds_alerts_for_household,
)
from common.services.cache import invalidate_financial_cache_for_household
from transactions.models import Transaction
from transactions.services.posting import create_transfer

TODAY = date(2026, 9, 7)


def _checking(household, *, balance: str, name: str = "Main Checking") -> Account:
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name=name,
        currency="USD",
        starting_balance=Decimal(balance),
        include_in_forecast=True,
    )


def _planned_debit(account, *, days: int, amount: str, payee: str = "Bill") -> Transaction:
    return Transaction.objects.create(
        account=account,
        date=TODAY + timedelta(days=days),
        payee=payee,
        amount=Decimal(amount),
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.ONE_TIME,
        planned_date=TODAY + timedelta(days=days),
    )


def _planned_inflow(account, *, days: int, amount: str, payee: str = "Paycheck") -> Transaction:
    return Transaction.objects.create(
        account=account,
        date=TODAY + timedelta(days=days),
        payee=payee,
        amount=Decimal(amount),
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.ONE_TIME,
        planned_date=TODAY + timedelta(days=days),
    )


def _eval(household):
    invalidate_financial_cache_for_household(household.id)
    return evaluate_projected_funds_alerts_for_household(
        household.id,
        today=TODAY,
        send_notifications=False,
    )


@pytest.mark.django_db
def test_checking_safe_debit_creates_no_alert(user, household):
    account = _checking(household, balance="1000.00")
    _planned_debit(account, days=3, amount="-500.00")
    _eval(household)
    assert ProjectedFundsAlert.objects.filter(household=household).count() == 0


@pytest.mark.django_db
def test_checking_overdraft_creates_alert_with_shortfall(user, household):
    account = _checking(household, balance="300.00")
    txn = _planned_debit(account, days=3, amount="-500.00")
    _eval(household)
    alert = ProjectedFundsAlert.objects.get(household=household)
    assert alert.alert_type == ProjectedFundsAlert.AlertType.INSUFFICIENT_FUNDS
    assert alert.transaction_id == txn.id
    assert alert.amount == Decimal("500.00")
    assert alert.projected_balance_before == Decimal("300.00")
    assert alert.projected_balance_after == Decimal("-200.00")
    assert alert.shortfall == Decimal("200.00")
    assert alert.severity == ProjectedFundsAlert.Severity.AT_RISK
    assert alert.resolved_at is None


@pytest.mark.django_db
def test_exact_zero_after_is_not_overdraft(user, household):
    account = _checking(household, balance="500.00")
    _planned_debit(account, days=2, amount="-500.00")
    _eval(household)
    assert ProjectedFundsAlert.objects.filter(household=household).count() == 0


@pytest.mark.django_db
def test_second_payment_is_the_risk_occurrence(user, household):
    account = _checking(household, balance="1000.00")
    first = _planned_debit(account, days=2, amount="-700.00", payee="First")
    second = _planned_debit(account, days=4, amount="-500.00", payee="Second")
    _eval(household)
    alerts = list(ProjectedFundsAlert.objects.filter(household=household, resolved_at__isnull=True))
    assert len(alerts) == 1
    assert alerts[0].transaction_id == second.id
    assert alerts[0].projected_balance_before == Decimal("300.00")
    assert alerts[0].projected_balance_after == Decimal("-200.00")
    assert alerts[0].shortfall == Decimal("200.00")
    assert first.id != second.id


@pytest.mark.django_db
def test_income_before_bill_clears_risk(user, household):
    account = _checking(household, balance="300.00")
    _planned_inflow(account, days=2, amount="1000.00")
    _planned_debit(account, days=3, amount="-800.00")
    _eval(household)
    assert ProjectedFundsAlert.objects.filter(household=household, resolved_at__isnull=True).count() == 0


@pytest.mark.django_db
def test_income_after_bill_keeps_risk_on_bill(user, household):
    account = _checking(household, balance="300.00")
    bill = _planned_debit(account, days=2, amount="-800.00", payee="Rent")
    _planned_inflow(account, days=3, amount="1000.00")
    _eval(household)
    alert = ProjectedFundsAlert.objects.get(household=household, resolved_at__isnull=True)
    assert alert.transaction_id == bill.id
    assert alert.projected_balance_after == Decimal("-500.00")


@pytest.mark.django_db
def test_transfer_risk_is_source_leg_only(user, household):
    checking = _checking(household, balance="200.00", name="Main Checking")
    savings = Account.objects.create(
        household=household,
        account_type=Account.AccountType.SAVINGS,
        name="Savings",
        currency="USD",
        starting_balance=Decimal("5000.00"),
        include_in_forecast=True,
    )
    due = TODAY + timedelta(days=2)
    with patch("transactions.services.posting.timezone.localdate", return_value=TODAY):
        create_transfer(user, checking.id, savings.id, Decimal("500.00"), due, payee="Move to Savings")
    _eval(household)
    alerts = list(ProjectedFundsAlert.objects.filter(household=household, resolved_at__isnull=True))
    assert len(alerts) == 1
    assert alerts[0].account_id == checking.id
    assert alerts[0].shortfall == Decimal("300.00")


@pytest.mark.django_db
def test_credit_card_payment_evaluates_funding_account_once(user, household):
    checking = _checking(household, balance="100.00")
    card = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        name="Visa",
        currency="USD",
        starting_balance=Decimal("400.00"),
        credit_limit=Decimal("2000.00"),
        include_in_forecast=True,
    )
    due = TODAY + timedelta(days=1)
    with patch("transactions.services.posting.timezone.localdate", return_value=TODAY):
        create_transfer(user, checking.id, card.id, Decimal("250.00"), due, payee="Card payment")
    _eval(household)
    alerts = list(ProjectedFundsAlert.objects.filter(household=household, resolved_at__isnull=True))
    assert len(alerts) == 1
    assert alerts[0].account_id == checking.id
    assert alerts[0].alert_type == ProjectedFundsAlert.AlertType.INSUFFICIENT_FUNDS
    assert ProjectedFundsAlert.objects.filter(account=card, resolved_at__isnull=True).count() == 0


@pytest.mark.django_db
def test_credit_purchase_over_limit_creates_credit_risk(user, household):
    card = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        name="Visa",
        currency="USD",
        starting_balance=Decimal("900.00"),
        credit_limit=Decimal("1000.00"),
        include_in_forecast=True,
    )
    txn = _planned_debit(card, days=2, amount="-200.00", payee="Store")
    _eval(household)
    alert = ProjectedFundsAlert.objects.get(household=household, resolved_at__isnull=True)
    assert alert.account_id == card.id
    assert alert.transaction_id == txn.id
    assert alert.alert_type == ProjectedFundsAlert.AlertType.CREDIT_LIMIT_RISK
    assert alert.projected_balance_after < 0
    assert alert.shortfall == Decimal("100.00")


@pytest.mark.django_db
def test_plaid_match_does_not_duplicate_planned_risk(user, household):
    account = _checking(household, balance="300.00")
    planned = _planned_debit(account, days=1, amount="-500.00", payee="Rent")
    _eval(household)
    assert ProjectedFundsAlert.objects.filter(resolved_at__isnull=True).count() == 1

    Transaction.objects.create(
        account=account,
        date=planned.date,
        payee="Rent",
        amount=Decimal("-500.00"),
        status=Transaction.Status.CLEARED,
        source=Transaction.Source.PLAID,
        plaid_transaction_id="plaid-rent-1",
        import_match_status=Transaction.ImportMatchStatus.MATCHED,
    )
    planned.import_match_status = Transaction.ImportMatchStatus.MATCHED
    planned.save(update_fields=["import_match_status"])
    _eval(household)
    assert ProjectedFundsAlert.objects.filter(household=household, resolved_at__isnull=True).count() == 0
    assert ProjectedFundsAlert.objects.filter(household=household).count() == 1


@pytest.mark.django_db
def test_adding_income_resolves_existing_alert(user, household):
    account = _checking(household, balance="300.00")
    _planned_debit(account, days=3, amount="-500.00")
    _eval(household)
    assert ProjectedFundsAlert.objects.filter(resolved_at__isnull=True).count() == 1
    _planned_inflow(account, days=2, amount="1000.00")
    _eval(household)
    alert = ProjectedFundsAlert.objects.get(household=household)
    assert alert.resolved_at is not None


@pytest.mark.django_db
def test_risk_returning_reactivates_same_fingerprint(user, household):
    account = _checking(household, balance="300.00")
    bill = _planned_debit(account, days=3, amount="-500.00")
    _eval(household)
    fingerprint = ProjectedFundsAlert.objects.get().fingerprint
    paycheck = _planned_inflow(account, days=2, amount="1000.00")
    _eval(household)
    assert ProjectedFundsAlert.objects.get().resolved_at is not None
    paycheck.delete()
    _eval(household)
    alert = ProjectedFundsAlert.objects.get(household=household)
    assert alert.fingerprint == fingerprint
    assert alert.resolved_at is None
    assert alert.transaction_id == bill.id


@pytest.mark.django_db
def test_due_today_is_critical(user, household):
    account = _checking(household, balance="100.00")
    _planned_debit(account, days=0, amount="-200.00")
    _eval(household)
    alert = ProjectedFundsAlert.objects.get()
    assert alert.severity == ProjectedFundsAlert.Severity.CRITICAL


@pytest.mark.django_db
@pytest.mark.django_db
def test_detect_risks_uses_balance_after_not_absolute_compare():
    """projected_before < debit_amount, not abs() mix-ups (300 vs 500)."""
    rows = [
        {
            "date": TODAY + timedelta(days=2),
            "account_id": 1,
            "amount": Decimal("-500.00"),
            "type": "OUTFLOW",
            "status": "PLANNED",
            "source": "one_time",
            "txn_source": "one_time",
            "balance_after": Decimal("-200.00"),
            "transaction_id": 9,
            "rule_id": None,
            "description": "Bill",
            "import_match_status": None,
            "plaid_transaction_id": None,
        }
    ]
    account = Account(id=1, account_type=Account.AccountType.CHECKING, name="Checking")
    detected = detect_risks_from_timeline(
        rows,
        household_id=1,
        accounts_by_id={1: account},
        today=TODAY,
    )
    assert len(detected) == 1
    assert detected[0].projected_balance_before == Decimal("300.00")
    assert detected[0].shortfall == Decimal("200.00")
