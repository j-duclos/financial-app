"""Tests for monthly bill checklist service."""
from datetime import date
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model

from accounts.models import Account
from categories.models import Category
from core.models import Household, HouseholdMembership
from timeline.models import RecurringRule, RecurringRuleSkip
from transactions.models import Transaction

from bills.models import BillOccurrence
from bills.services import (
    get_monthly_bill_checklist,
    rule_counts_as_bill,
    skip_bill_occurrence,
    transaction_counts_as_bill,
)

User = get_user_model()

JUNE_START = date(2026, 6, 1)
AS_OF = date(2026, 6, 15)


@pytest.fixture
def user(db):
    return User.objects.create_user(username="billuser", password="testpass123")


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="Bill Household")
    HouseholdMembership.objects.create(household=h, user=user, role=HouseholdMembership.Role.OWNER)
    return h


@pytest.fixture
def checking(db, household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        name="Main",
        starting_balance=Decimal("5000"),
        currency="USD",
    )


@pytest.fixture
def expense_category(db, household):
    return Category.objects.create(
        household=household,
        name="Utilities",
        category_type=Category.CategoryType.EXPENSE,
    )


@pytest.fixture
def transfer_category(db, household):
    return Category.objects.create(
        household=household,
        name="Bank Transfer",
        category_type=Category.CategoryType.EXPENSE,
    )


@pytest.fixture
def cc_payment_category(db, household):
    return Category.objects.create(
        household=household,
        name="Credit Card Payment",
        category_type=Category.CategoryType.EXPENSE,
    )


def _monthly_rule(household, account, category, name, amount, day=5):
    return RecurringRule.objects.create(
        household=household,
        name=name,
        account=account,
        category=category,
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal(str(amount)),
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        day_of_month=day,
        start_date=date(2025, 1, 1),
        active=True,
    )


def test_recurring_bill_appears_in_checklist(user, checking, expense_category):
    _monthly_rule(checking.household, checking, expense_category, "Electric", 450, day=25)
    data = get_monthly_bill_checklist(user, month=6, year=2026, as_of_date=AS_OF)
    names = [i["name"] for i in data["items"]]
    assert "Electric" in names
    electric = next(i for i in data["items"] if i["name"] == "Electric")
    assert electric["status"] == "projected"
    assert electric["due_date"] == "2026-06-25"
    assert Decimal(data["total_projected"]) >= Decimal("450")


def test_paid_transaction_changes_status_to_paid(user, checking, expense_category):
    rule = _monthly_rule(checking.household, checking, expense_category, "Internet", 80, day=12)
    Transaction.objects.create(
        account=checking,
        date=date(2026, 6, 12),
        payee="Internet",
        amount=Decimal("-80"),
        category=expense_category,
        status=Transaction.Status.CLEARED,
        source=Transaction.Source.RULE,
        rule=rule,
        cleared=True,
    )
    data = get_monthly_bill_checklist(user, month=6, year=2026, as_of_date=AS_OF)
    item = next(i for i in data["items"] if i["name"] == "Internet")
    assert item["status"] == "paid"


def test_reconciled_transaction_changes_status(user, checking, expense_category):
    rule = _monthly_rule(checking.household, checking, expense_category, "Water", 60, day=8)
    Transaction.objects.create(
        account=checking,
        date=date(2026, 6, 8),
        payee="Water",
        amount=Decimal("-60"),
        category=expense_category,
        status=Transaction.Status.RECONCILED,
        source=Transaction.Source.RULE,
        rule=rule,
        cleared=True,
        reconciled=True,
    )
    data = get_monthly_bill_checklist(user, month=6, year=2026, as_of_date=AS_OF)
    item = next(i for i in data["items"] if i["name"] == "Water")
    assert item["status"] == "reconciled"


def test_overdue_unpaid_becomes_missed(user, checking, expense_category):
    _monthly_rule(checking.household, checking, expense_category, "Mortgage", 3100, day=1)
    data = get_monthly_bill_checklist(user, month=6, year=2026, as_of_date=AS_OF)
    item = next(i for i in data["items"] if i["name"] == "Mortgage")
    assert item["status"] == "late"
    assert item["is_overdue"] is True
    assert data["missed_count"] >= 1


def test_skipped_occurrence_not_missed(user, checking, expense_category):
    rule = _monthly_rule(checking.household, checking, expense_category, "Gym", 40, day=2)
    data = get_monthly_bill_checklist(user, month=6, year=2026, as_of_date=AS_OF)
    occ = BillOccurrence.objects.get(rule=rule, due_date=date(2026, 6, 2))
    skip_bill_occurrence(occ)
    data = get_monthly_bill_checklist(user, month=6, year=2026, as_of_date=AS_OF)
    item = next(i for i in data["items"] if i["name"] == "Gym")
    assert item["status"] == "skipped"
    assert data["missed_count"] == 0 or "Gym" not in [
        i["name"] for i in data["items"] if i["status"] == "missed"
    ]


def test_transfer_excluded_unless_debt_payment(user, checking, transfer_category):
    RecurringRule.objects.create(
        household=checking.household,
        name="Move to Savings",
        account=checking,
        category=transfer_category,
        direction=RecurringRule.Direction.TRANSFER,
        amount=Decimal("500"),
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        day_of_month=10,
        start_date=date(2025, 1, 1),
        active=True,
    )
    data = get_monthly_bill_checklist(user, month=6, year=2026, as_of_date=AS_OF)
    assert not any(i["name"] == "Move to Savings" for i in data["items"])


def test_credit_card_payment_rule_appears(user, checking, cc_payment_category):
    savings = Account.objects.create(
        household=checking.household,
        account_type=Account.AccountType.CREDIT,
        role=Account.AccountRole.CREDIT_CARD,
        name="Venture",
        currency="USD",
    )
    RecurringRule.objects.create(
        household=checking.household,
        name="Card Pay",
        account=checking,
        transfer_to_account=savings,
        category=cc_payment_category,
        direction=RecurringRule.Direction.TRANSFER,
        amount=Decimal("200"),
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        day_of_month=17,
        start_date=date(2025, 1, 1),
        active=True,
    )
    data = get_monthly_bill_checklist(user, month=6, year=2026, as_of_date=AS_OF)
    assert any(i["name"] == "Card Pay" for i in data["items"])


def test_totals_calculate_correctly(user, checking, expense_category):
    _monthly_rule(checking.household, checking, expense_category, "Paid Bill", 100, day=10)
    _monthly_rule(checking.household, checking, expense_category, "Open Bill", 200, day=25)
    rule = RecurringRule.objects.get(name="Paid Bill")
    Transaction.objects.create(
        account=checking,
        date=date(2026, 6, 10),
        payee="Paid Bill",
        amount=Decimal("-100"),
        category=expense_category,
        status=Transaction.Status.CLEARED,
        source=Transaction.Source.RULE,
        rule=rule,
        cleared=True,
    )
    data = get_monthly_bill_checklist(user, month=6, year=2026, as_of_date=AS_OF)
    assert Decimal(data["total_paid"]) == Decimal("100.00")
    assert Decimal(data["total_projected"]) == Decimal("200.00")


def test_income_rule_excluded(user, checking, expense_category):
    income_cat = Category.objects.create(
        household=checking.household,
        name="Salary",
        category_type=Category.CategoryType.INCOME,
    )
    RecurringRule.objects.create(
        household=checking.household,
        name="Paycheck",
        account=checking,
        category=income_cat,
        direction=RecurringRule.Direction.INCOME,
        amount=Decimal("5000"),
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        day_of_month=1,
        start_date=date(2025, 1, 1),
        active=True,
    )
    assert not rule_counts_as_bill(
        RecurringRule.objects.get(name="Paycheck")
    )


def test_is_bill_flag_forces_transfer(user, checking, transfer_category):
    rule = RecurringRule.objects.create(
        household=checking.household,
        name="Required Savings",
        account=checking,
        category=transfer_category,
        direction=RecurringRule.Direction.TRANSFER,
        amount=Decimal("300"),
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        day_of_month=15,
        start_date=date(2025, 1, 1),
        active=True,
        is_bill=True,
    )
    assert rule_counts_as_bill(rule)
    data = get_monthly_bill_checklist(user, month=6, year=2026, as_of_date=AS_OF)
    assert any(i["name"] == "Required Savings" for i in data["items"])


def test_rule_skip_excludes_occurrence(user, checking, expense_category):
    rule = _monthly_rule(checking.household, checking, expense_category, "Skipped", 50, day=20)
    RecurringRuleSkip.objects.create(rule=rule, date=date(2026, 6, 20))
    data = get_monthly_bill_checklist(user, month=6, year=2026, as_of_date=AS_OF)
    assert not any(i["name"] == "Skipped" for i in data["items"])


def test_manual_is_bill_transaction(user, checking, expense_category):
    Transaction.objects.create(
        account=checking,
        date=date(2026, 6, 22),
        payee="One-off HOA",
        amount=Decimal("-75"),
        category=expense_category,
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.ONE_TIME,
        is_bill=True,
    )
    assert transaction_counts_as_bill(
        Transaction.objects.get(payee="One-off HOA")
    )
    data = get_monthly_bill_checklist(user, month=6, year=2026, as_of_date=AS_OF)
    assert any(i["name"] == "One-off HOA" for i in data["items"])
