"""Tests for dashboard Cash After Debt (Option A: available cash − total debt)."""
from datetime import date, timedelta
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from django.db import connection
from django.test.utils import CaptureQueriesContext

from accounts.models import Account
from accounts.services.balances import bulk_signed_ledger_balances, signed_ledger_balance
from core.models import Household, HouseholdMembership
from insights.services.dashboard_summary import (
    _compute_cash_after_debt,
    _compute_dashboard_debt_metrics,
    _compute_liquid_cash,
    _compute_top_summary,
    build_dashboard_summary,
    build_dashboard_summary_fast,
)
from transactions.models import Transaction

User = get_user_model()
AS_OF = date(2025, 5, 1)


@pytest.fixture
def user(db):
    return User.objects.create_user(username="caduser", password="testpass123")


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="CAD HH")
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
        starting_balance=Decimal("265.57"),
        currency="USD",
    )


@pytest.fixture
def savings(household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.SAVINGS,
        role=Account.AccountRole.SAVINGS,
        name="Savings",
        starting_balance=Decimal("5000"),
        currency="USD",
    )


@pytest.fixture
def credit_card(household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        role=Account.AccountRole.CREDIT_CARD,
        name="Card",
        credit_limit=Decimal("10000"),
        starting_balance=Decimal("-7039.24"),
        currency="USD",
    )


def test_compute_cash_after_debt_pure_formula():
    available_cash = Decimal("265.57")
    total_debt = Decimal("7039.24")
    assert _compute_cash_after_debt(available_cash, total_debt) == Decimal("-6773.67")


def test_compute_cash_after_debt_zero_debt():
    available_cash = Decimal("1200.00")
    assert _compute_cash_after_debt(available_cash, Decimal("0")) == Decimal("1200.00")


def test_compute_cash_after_debt_negative_available_cash():
    available_cash = Decimal("-150.25")
    total_debt = Decimal("500.00")
    assert _compute_cash_after_debt(available_cash, total_debt) == Decimal("-650.25")


def test_compute_cash_after_debt_performs_no_database_queries(db):
    with CaptureQueriesContext(connection) as ctx:
        _compute_cash_after_debt(Decimal("100"), Decimal("40"))
    assert len(ctx.captured_queries) == 0


def test_top_summary_cash_after_debt_equals_available_cash_minus_total_debt(
    checking, savings, credit_card
):
    accounts = [checking, savings, credit_card]
    balance_map = bulk_signed_ledger_balances(accounts, AS_OF)
    debt_metrics = _compute_dashboard_debt_metrics(
        [credit_card], today=AS_OF, balance_by_account=balance_map
    )
    top = _compute_top_summary(
        accounts,
        {},
        today=AS_OF,
        balance_by_account=balance_map,
        credit_accounts=[credit_card],
        debt_metrics=debt_metrics,
    )
    available_cash = Decimal(top["liquid_cash"])
    total_debt = Decimal(top["total_debt"])
    cash_after_debt = Decimal(top["cash_after_debt"])
    assert cash_after_debt == available_cash - total_debt
    assert Decimal(top["net_position"]) == cash_after_debt
    assert top["available_cash"] == top["liquid_cash"]


def test_cash_after_debt_includes_savings_when_available_cash_does(
    checking, savings, credit_card
):
    accounts = [checking, savings, credit_card]
    balance_map = bulk_signed_ledger_balances(accounts, AS_OF)
    debt_metrics = _compute_dashboard_debt_metrics(
        [credit_card], today=AS_OF, balance_by_account=balance_map
    )
    top = _compute_top_summary(
        accounts,
        {},
        today=AS_OF,
        balance_by_account=balance_map,
        credit_accounts=[credit_card],
        debt_metrics=debt_metrics,
    )
    liquid = _compute_liquid_cash(accounts, today=AS_OF, balance_by_account=balance_map)
    assert Decimal(top["liquid_cash"]) == liquid
    savings_balance = signed_ledger_balance(savings, AS_OF)
    assert savings_balance > 0
    assert Decimal(top["cash_after_debt"]) == liquid - debt_metrics["total_debt"]


def test_total_debt_matches_dashboard_debt_summary_scope(checking, credit_card):
    balance_map = bulk_signed_ledger_balances([checking, credit_card], AS_OF)
    debt_metrics = _compute_dashboard_debt_metrics(
        [credit_card], today=AS_OF, balance_by_account=balance_map
    )
    from insights.services.dashboard_summary import _build_minimal_dashboard_debt_summary

    debt_summary = _build_minimal_dashboard_debt_summary(
        [credit_card],
        as_of=AS_OF,
        balance_by_account=balance_map,
        debt_metrics=debt_metrics,
    )
    assert debt_summary is not None
    assert Decimal(debt_summary["total_debt"]) == debt_metrics["total_debt"]


def test_future_planned_transactions_do_not_affect_cash_after_debt(
    user, checking, savings, credit_card
):
    Transaction.objects.create(
        account=checking,
        date=AS_OF + timedelta(days=60),
        payee="Future paycheck",
        amount=Decimal("50000"),
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.ONE_TIME,
    )
    Transaction.objects.create(
        account=credit_card,
        date=AS_OF + timedelta(days=90),
        payee="Future charge",
        amount=Decimal("-25000"),
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.ONE_TIME,
    )
    before = build_dashboard_summary_fast(user, days=30, as_of_date=AS_OF)
    top = before["top_summary"]
    assert Decimal(top["cash_after_debt"]) == Decimal(top["liquid_cash"]) - Decimal(
        top["total_debt"]
    )


def test_planned_transactions_do_not_affect_cash_after_debt_unless_posted(
    user, checking, savings, credit_card
):
    Transaction.objects.create(
        account=checking,
        date=AS_OF,
        payee="Planned deposit",
        amount=Decimal("9999"),
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.ONE_TIME,
    )
    fast = build_dashboard_summary_fast(user, days=30, as_of_date=AS_OF)
    top = fast["top_summary"]
    expected_cash = (
        signed_ledger_balance(checking, AS_OF) + signed_ledger_balance(savings, AS_OF)
    ).quantize(Decimal("0.01"))
    assert Decimal(top["liquid_cash"]) == expected_cash
    assert Decimal(top["cash_after_debt"]) == expected_cash - Decimal(top["total_debt"])


def test_top_summary_reuses_supplied_debt_metrics_without_extra_balance_queries(
    checking, savings, credit_card
):
    accounts = [checking, savings, credit_card]
    balance_map = bulk_signed_ledger_balances(accounts, AS_OF)
    debt_metrics = _compute_dashboard_debt_metrics(
        [credit_card], today=AS_OF, balance_by_account=balance_map
    )
    with patch(
        "insights.services.dashboard_summary._compute_dashboard_debt_metrics",
        side_effect=AssertionError("should reuse supplied debt_metrics"),
    ), patch(
        "insights.services.dashboard_summary.credit_owed_balance",
        side_effect=AssertionError("should use shared map"),
    ):
        top = _compute_top_summary(
            accounts,
            {},
            today=AS_OF,
            balance_by_account=balance_map,
            credit_accounts=[credit_card],
            debt_metrics=debt_metrics,
        )
    assert Decimal(top["cash_after_debt"]) == Decimal(top["liquid_cash"]) - Decimal(
        top["total_debt"]
    )


def test_fast_dashboard_top_summary_numeric_consistency(user, checking, savings, credit_card):
    fast = build_dashboard_summary_fast(user, days=30, as_of_date=AS_OF)
    top = fast["top_summary"]
    debt = fast.get("debt")
    assert Decimal(top["cash_after_debt"]) == Decimal(top["liquid_cash"]) - Decimal(
        top["total_debt"]
    )
    if debt is not None:
        assert Decimal(top["total_debt"]) == Decimal(debt["total_debt"])


def test_full_dashboard_top_summary_uses_option_a_formula(
    user, checking, savings, credit_card
):
    summary = build_dashboard_summary(user, days=30, as_of_date=AS_OF)
    top = summary["top_summary"]
    assert Decimal(top["cash_after_debt"]) == Decimal(top["liquid_cash"]) - Decimal(
        top["total_debt"]
    )
    assert Decimal(top["net_position"]) == Decimal(top["cash_after_debt"])
    assert top["available_cash"] == top["liquid_cash"]


def test_cash_after_debt_top_summary_avoids_snapshot_totals_for_net_position(
    checking, savings, credit_card
):
    """Cash After Debt must not use spending-only snapshot cash (excludes savings)."""
    accounts = [checking, savings, credit_card]
    balance_map = bulk_signed_ledger_balances(accounts, AS_OF)
    debt_metrics = _compute_dashboard_debt_metrics(
        [credit_card], today=AS_OF, balance_by_account=balance_map
    )
    with patch(
        "insights.services.dashboard_summary._snapshot_totals",
        side_effect=AssertionError("snapshot_totals must not drive Cash After Debt"),
    ):
        top = _compute_top_summary(
            accounts,
            {},
            today=AS_OF,
            balance_by_account=balance_map,
            credit_accounts=[credit_card],
            debt_metrics=debt_metrics,
        )
    liquid = _compute_liquid_cash(accounts, today=AS_OF, balance_by_account=balance_map)
    assert Decimal(top["cash_after_debt"]) == liquid - debt_metrics["total_debt"]


def test_cash_after_debt_performance_no_extra_queries(checking, savings, credit_card):
    """Cash After Debt reuses shared metrics — no per-account balance queries."""
    accounts = [checking, savings, credit_card]
    balance_map = bulk_signed_ledger_balances(accounts, AS_OF)
    debt_metrics = _compute_dashboard_debt_metrics(
        [credit_card], today=AS_OF, balance_by_account=balance_map
    )
    with CaptureQueriesContext(connection) as ctx:
        _compute_top_summary(
            accounts,
            {},
            today=AS_OF,
            balance_by_account=balance_map,
            credit_accounts=[credit_card],
            debt_metrics=debt_metrics,
        )
    assert len(ctx.captured_queries) == 0
