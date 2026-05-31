"""Timeline row order must match Transactions ledger (income before same-day outflows when ids say so)."""
from datetime import date
from decimal import Decimal

import pytest

from accounts.models import Account
from categories.models import Category
from core.models import Household, HouseholdMembership
from timeline.services.ledger import (
    build_timeline,
    timeline_row_process_order,
    timeline_rows_chronological_key,
)


@pytest.fixture
def hh(db, user):
    h = Household.objects.create(name="Order HH")
    HouseholdMembership.objects.create(household=h, user=user, role=HouseholdMembership.Role.OWNER)
    return h


@pytest.fixture
def checking(db, hh):
    return Account.objects.create(
        household=hh,
        account_type=Account.AccountType.CHECKING,
        name="Chase",
        starting_balance=Decimal("84"),
        currency="USD",
        include_in_forecast=True,
    )


def test_projected_rows_sort_before_materialized_transactions():
    """Matches web compareTimelineRows: missing transaction_id sorts before real ids."""
    projected = {"date": date(2026, 6, 12), "transaction_id": None, "description": "Paycheck"}
    materialized = {"date": date(2026, 6, 12), "transaction_id": 42, "description": "Card Pmt"}
    assert timeline_row_process_order(projected) < timeline_row_process_order(materialized)
    assert timeline_rows_chronological_key(projected) < timeline_rows_chronological_key(materialized)


@pytest.mark.django_db
def test_same_day_running_balance_matches_ledger_order(user, hh, checking):
    """Planned income (lower txn id) before outflows — lowest balance stays non-negative."""
    today = date(2026, 5, 28)
    pay_day = date(2026, 6, 12)
    expense_cat = Category.objects.create(
        household=hh,
        name="Bills",
        category_type=Category.CategoryType.EXPENSE,
        sort_order=1,
    )
    income_cat = Category.objects.create(
        household=hh,
        name="Salary",
        category_type=Category.CategoryType.INCOME,
        sort_order=0,
    )
    from transactions.models import Transaction

    Transaction.objects.create(
        account=checking,
        category=income_cat,
        date=pay_day,
        amount=Decimal("1835.52"),
        payee="Payroll",
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.ACTUAL,
    )
    Transaction.objects.create(
        account=checking,
        category=expense_cat,
        date=pay_day,
        amount=Decimal("-102"),
        payee="Credit Card Pmt",
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.ACTUAL,
    )

    rows = build_timeline(
        user,
        start_date=today,
        end_date=pay_day,
        account_id=checking.id,
        as_of_date=today,
        projection_only=True,
    )
    day_rows = [r for r in rows if r["date"] == pay_day and r["account_id"] == checking.id]
    ordered = sorted(day_rows, key=timeline_row_process_order)
    payroll = next(r for r in ordered if "Payroll" in r["description"])
    payment = next(r for r in ordered if "Credit" in r["description"])
    assert ordered.index(payroll) < ordered.index(payment)

    lows = [Decimal(str(r["running_balance"])) for r in day_rows]
    assert min(lows) >= 0
    assert Decimal(str(payroll["running_balance"])) > 0
