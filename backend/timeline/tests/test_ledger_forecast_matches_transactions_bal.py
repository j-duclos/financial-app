"""Forecast metrics must match Transactions Bal (ledger_anchor walk), not running_balance."""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model

from accounts.models import Account
from core.models import Household, HouseholdMembership
from timeline.services.ledger import build_forecast_projection_timeline, forecast_account_balance_metrics
from timeline.services.ledger_section_balances import annotate_transactions_ledger_balance_after
from transactions.models import Transaction

User = get_user_model()


@pytest.fixture
def user(db):
    return User.objects.create_user(username="ledger_forecast_bal", password="testpass123")


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="Ledger Forecast HH")
    HouseholdMembership.objects.create(
        household=h, user=user, role=HouseholdMembership.Role.OWNER
    )
    return h


@pytest.fixture
def main_checking(household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        name="Main",
        starting_balance=Decimal("1784.18"),
        minimum_buffer=Decimal("503.43"),
        currency="USD",
        include_in_forecast=True,
    )


@pytest.mark.django_db
def test_lowest_matches_balance_after_not_chronological_running_balance(
    user, main_checking
):
    def _planned(day, payee, amount):
        return Transaction.objects.create(
            account=main_checking,
            date=day,
            payee=payee,
            amount=amount,
            status=Transaction.Status.PLANNED,
            source=Transaction.Source.ONE_TIME,
        )

    today = date(2026, 8, 27)
    anchor = Decimal("1784.18")
    aug_28 = date(2026, 8, 28)
    sep_2 = date(2026, 9, 2)
    sep_4 = date(2026, 9, 4)

    _planned(aug_28, "Gen's Rent", Decimal("1500.00"))
    _planned(aug_28, "Rent", Decimal("-3100.00"))
    _planned(aug_28, "Lou", Decimal("500.00"))
    _planned(aug_28, "Electric bill", Decimal("-405.00"))
    _planned(aug_28, "Water Bill", Decimal("-180.00"))
    _planned(sep_2, "Exeterfina Loan", Decimal("-393.79"))
    _planned(sep_2, "FORTIVA", Decimal("-42.74"))
    _planned(sep_2, "Cursor", Decimal("-66.00"))
    _planned(sep_4, "Hulu", Decimal("-35.00"))
    _planned(sep_4, "Payroll", Decimal("1835.52"))
    _planned(sep_4, "ATT Pmt", Decimal("-200.00"))
    _planned(date(2026, 9, 10), "Electric", Decimal("-500.00"))

    end = today + timedelta(days=30)
    rows = build_forecast_projection_timeline(
        user,
        today=today,
        end_date=end,
        caller="test_ledger_forecast",
        account_id=main_checking.pk,
    )
    annotate_transactions_ledger_balance_after(
        rows,
        account_id=main_checking.pk,
        as_of=today,
        posted_ending_balance=anchor,
    )

    hulu = next(r for r in rows if "Hulu" in (r.get("description") or ""))
    hulu_bal = Decimal(str(hulu["balance_after"]))
    hulu_rb = Decimal(str(hulu["running_balance"]))

    metrics = forecast_account_balance_metrics(
        rows,
        account_id=main_checking.pk,
        today=today,
        end_date=end,
        minimum_buffer=main_checking.minimum_buffer,
    )

    annotated_lowest = min(
        Decimal(str(r["balance_after"]))
        for r in rows
        if r.get("balance_after") is not None
        and today <= date.fromisoformat(str(r["date"])[:10]) <= end
    )

    assert metrics["lowest"] == annotated_lowest
    assert metrics["lowest"] == hulu_bal or metrics["lowest"] <= hulu_bal
    assert metrics["lowest"] != Decimal("-1005.43")
    assert metrics["lowest"] != (hulu_bal - main_checking.minimum_buffer)
    if hulu_rb != hulu_bal:
        assert metrics["lowest"] != hulu_rb
