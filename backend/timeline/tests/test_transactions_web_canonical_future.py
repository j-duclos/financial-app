"""Canonical Transactions timeline must include future manual/rule activity.

Web Upcoming reads TimelineRow.balance_after only. The browser must not merge
a second /transactions/ list to invent missing forecast rows.
"""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.utils import timezone

from accounts.models import Account
from core.models import Household, HouseholdMembership
from timeline.models import RecurringRule
from timeline.services.ledger import build_forecast_projection_timeline
from transactions.models import Reconciliation, Transaction
from transactions.services.posting import post_transaction

User = get_user_model()

AS_OF = date(2026, 9, 10)
FORECAST_DAYS = 30


@pytest.fixture
def user(db):
    return User.objects.create_user(username="web_canon_future", password="testpass123")


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="Web Canon Future HH")
    HouseholdMembership.objects.create(
        household=h, user=user, role=HouseholdMembership.Role.OWNER
    )
    return h


@pytest.fixture
def checking(household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        name="Checking",
        starting_balance=Decimal("1000.00"),
        currency="USD",
        include_in_forecast=True,
    )


def _rows(user, account, *, today=AS_OF):
    cache.clear()
    return build_forecast_projection_timeline(
        user,
        today=today,
        end_date=today + timedelta(days=FORECAST_DAYS),
        caller="test_web_canonical_future",
        account_id=account.pk,
    )


def _account_rows(rows, account_id):
    return [r for r in rows if r.get("account_id") == account_id]


def _by_payee(rows, account_id, payee: str):
    for row in _account_rows(rows, account_id):
        if (row.get("description") or "") == payee:
            return row
    raise AssertionError(f"No timeline row for {payee!r}")


@pytest.mark.django_db
def test_future_manual_expense_is_on_canonical_timeline(user, checking):
    future = AS_OF + timedelta(days=1)
    post_transaction(user, checking.pk, future, "Manual grocery", Decimal("-200.00"))
    row = _by_payee(_rows(user, checking), checking.pk, "Manual grocery")
    assert Decimal(str(row["amount"])) == Decimal("-200.00")
    assert Decimal(str(row["balance_after"])) == Decimal("800.00")


@pytest.mark.django_db
def test_future_manual_income_is_on_canonical_timeline(user, checking):
    future = AS_OF + timedelta(days=1)
    post_transaction(user, checking.pk, future, "Bonus", Decimal("500.00"))
    row = _by_payee(_rows(user, checking), checking.pk, "Bonus")
    assert Decimal(str(row["amount"])) == Decimal("500.00")
    assert Decimal(str(row["balance_after"])) == Decimal("1500.00")


@pytest.mark.django_db
def test_recurring_plus_manual_balance_after_sequence(user, household, checking):
    RecurringRule.objects.create(
        household=household,
        account=checking,
        name="Paycheck",
        direction=RecurringRule.Direction.INCOME,
        amount=Decimal("2000.00"),
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        day_of_month=11,
        start_date=date(2026, 9, 11),
        end_date=date(2026, 9, 11),
        active=True,
    )
    RecurringRule.objects.create(
        household=household,
        account=checking,
        name="Rent",
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("1500.00"),
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        day_of_month=12,
        start_date=date(2026, 9, 12),
        end_date=date(2026, 9, 12),
        active=True,
    )
    Transaction.objects.create(
        account=checking,
        date=date(2026, 9, 13),
        payee="Planned purchase",
        amount=Decimal("-200.00"),
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.ONE_TIME,
    )
    rows = _account_rows(_rows(user, checking), checking.pk)
    future = [r for r in rows if r["date"] > AS_OF]
    by_desc = {r["description"]: Decimal(str(r["balance_after"])) for r in future}
    assert by_desc["Paycheck"] == Decimal("3000.00")
    assert by_desc["Rent"] == Decimal("1500.00")
    assert by_desc["Planned purchase"] == Decimal("1300.00")


@pytest.mark.django_db
def test_closed_reconciliation_does_not_drop_future_or_double_count_history(user, checking):
    period_end = date(2026, 8, 17)
    Reconciliation.objects.create(
        user=user,
        account=checking,
        bank_current_balance=Decimal("1000.00"),
        app_current_balance=Decimal("1000.00"),
        last_reconciled_balance=Decimal("1000.00"),
        final_reconciled_balance=Decimal("1000.00"),
        difference=Decimal("0"),
        status=Reconciliation.Status.COMPLETED,
        is_active=True,
        completed_at=timezone.now(),
        period_start_date=date(2026, 8, 1),
        period_end_date=period_end,
    )
    Transaction.objects.create(
        account=checking,
        date=period_end,
        payee="Sealed history",
        amount=Decimal("-27.13"),
        status=Transaction.Status.RECONCILED,
        source=Transaction.Source.ACTUAL,
        reconciled=True,
    )
    Transaction.objects.create(
        account=checking,
        date=date(2026, 8, 18),
        payee="Post-checkpoint coffee",
        amount=Decimal("-10.00"),
        status=Transaction.Status.CLEARED,
        source=Transaction.Source.ACTUAL,
        cleared=True,
    )
    post_transaction(
        user, checking.pk, AS_OF + timedelta(days=1), "Future bill", Decimal("-200.00")
    )
    rows = _rows(user, checking, today=AS_OF)
    account_rows = _account_rows(rows, checking.pk)
    payees = [r.get("description") for r in account_rows]
    assert "Sealed history" not in payees or all(
        r.get("date") > period_end for r in account_rows if r.get("description") == "Sealed history"
    )
    future = _by_payee(rows, checking.pk, "Future bill")
    assert future["date"] > AS_OF
    assert Decimal(str(future["amount"])) == Decimal("-200.00")
    assert Decimal(str(future["balance_after"])) == Decimal("790.00")
    assert "Post-checkpoint coffee" not in [
        r.get("description") for r in account_rows if r["date"] > AS_OF
    ]
