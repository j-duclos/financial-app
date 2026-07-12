"""Tests for lightweight dashboard Debt Payoff metrics and projection cache."""
from datetime import date
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db import connection
from django.test.utils import CaptureQueriesContext

from accounts.models import Account
from accounts.services.balances import bulk_signed_ledger_balances
from common.services.cache import invalidate_user_dashboard_cache
from core.models import Household, HouseholdMembership
from credit_cards.services.debt_engine import (
    _cache_debt_payoff_projection,
    build_dashboard_debt_summary,
    get_cached_debt_payoff_projection,
)
from insights.services.dashboard_summary import (
    _build_minimal_dashboard_debt_summary,
    _dashboard_debt_accounts,
    build_dashboard_summary_fast,
    calculate_dashboard_debt_metrics,
)

User = get_user_model()
AS_OF = date(2025, 5, 1)


@pytest.fixture
def user(db):
    return User.objects.create_user(username="debtpayoff", password="testpass123")


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="Debt Payoff HH")
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
        starting_balance=Decimal("1000"),
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
        apr=Decimal("24.99"),
        starting_balance=Decimal("-1200"),
        currency="USD",
    )


@pytest.fixture
def zero_apr_card(household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        role=Account.AccountRole.CREDIT_CARD,
        name="Promo Card",
        credit_limit=Decimal("5000"),
        apr=Decimal("0"),
        starting_balance=Decimal("-500"),
        currency="USD",
    )


@pytest.fixture
def loan(household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.OTHER,
        role=Account.AccountRole.LOAN,
        name="Car Loan",
        apr=Decimal("6.5"),
        starting_balance=Decimal("-8000"),
        currency="USD",
    )


@pytest.fixture
def closed_card(household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        role=Account.AccountRole.CREDIT_CARD,
        name="Closed Card",
        credit_limit=Decimal("3000"),
        apr=Decimal("20"),
        starting_balance=Decimal("-400"),
        status=Account.Status.CLOSED,
        currency="USD",
    )


def test_total_debt_uses_shared_balance_map(credit_card, loan):
    accounts = [credit_card, loan]
    balance_map = bulk_signed_ledger_balances(accounts, AS_OF)
    metrics = calculate_dashboard_debt_metrics(accounts, balance_map, today=AS_OF)
    assert metrics["total_debt"] == Decimal("9200.00")
    assert metrics["credit_card_debt"] == Decimal("1200.00")
    assert metrics["loan_debt"] == Decimal("8000.00")


def test_debt_payoff_performs_no_per_account_balance_queries(credit_card, loan):
    accounts = [credit_card, loan]
    balance_map = bulk_signed_ledger_balances(accounts, AS_OF)
    with patch(
        "insights.services.dashboard_summary.credit_owed_balance",
        side_effect=AssertionError("should use shared map"),
    ), patch(
        "insights.services.dashboard_summary.signed_ledger_balance",
        side_effect=AssertionError("should use shared map"),
    ):
        metrics = calculate_dashboard_debt_metrics(accounts, balance_map, today=AS_OF)
    assert metrics["total_debt"] > 0


def test_estimated_monthly_interest_from_balances_and_aprs(credit_card):
    balance_map = bulk_signed_ledger_balances([credit_card], AS_OF)
    metrics = calculate_dashboard_debt_metrics([credit_card], balance_map, today=AS_OF)
    expected = (Decimal("1200") * Decimal("24.99") / Decimal("1200")).quantize(Decimal("0.01"))
    assert metrics["estimated_monthly_interest"] == expected


def test_zero_apr_accounts_contribute_zero_interest(zero_apr_card):
    balance_map = bulk_signed_ledger_balances([zero_apr_card], AS_OF)
    metrics = calculate_dashboard_debt_metrics([zero_apr_card], balance_map, today=AS_OF)
    assert metrics["total_debt"] == Decimal("500.00")
    assert metrics["estimated_monthly_interest"] == Decimal("0.00")


def test_missing_apr_handled_safely(household):
    card = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        role=Account.AccountRole.CREDIT_CARD,
        name="No APR",
        credit_limit=Decimal("2000"),
        starting_balance=Decimal("-300"),
        currency="USD",
    )
    balance_map = bulk_signed_ledger_balances([card], AS_OF)
    metrics = calculate_dashboard_debt_metrics([card], balance_map, today=AS_OF)
    assert metrics["total_debt"] == Decimal("300.00")
    assert metrics["estimated_monthly_interest"] == Decimal("0.00")


def test_inactive_closed_debt_accounts_excluded(credit_card, closed_card):
    active = _dashboard_debt_accounts([credit_card, closed_card])
    assert credit_card in active
    assert closed_card not in active


def test_cash_after_debt_and_debt_payoff_share_total_debt(user, checking, credit_card, loan):
    fast = build_dashboard_summary_fast(user, days=30, as_of_date=AS_OF)
    top = fast["top_summary"]
    debt = fast.get("debt")
    assert debt is not None
    assert Decimal(top["total_debt"]) == Decimal(debt["total_debt"])
    assert Decimal(top["cash_after_debt"]) == Decimal(top["liquid_cash"]) - Decimal(
        top["total_debt"]
    )


def test_fast_dashboard_does_not_run_full_payoff_simulation(user, checking, credit_card):
    with patch(
        "credit_cards.services.debt_engine.simulate_household_debt",
        side_effect=AssertionError("fast endpoint must not simulate payoff"),
    ):
        fast = build_dashboard_summary_fast(user, days=30, as_of_date=AS_OF)
    assert fast.get("debt") is not None
    assert fast["debt"]["plan"] is None


def test_minimal_debt_summary_without_cached_projection(credit_card):
    balance_map = bulk_signed_ledger_balances([credit_card], AS_OF)
    metrics = calculate_dashboard_debt_metrics([credit_card], balance_map, today=AS_OF)
    summary = _build_minimal_dashboard_debt_summary(
        [credit_card],
        as_of=AS_OF,
        balance_by_account=balance_map,
        debt_metrics=metrics,
        payoff_projection=None,
    )
    assert summary is not None
    assert summary["label"] == "Open planner for payoff date"
    assert summary["debt_free_date"] is None
    assert Decimal(summary["total_debt"]) == metrics["total_debt"]


def test_cached_debt_free_date_displayed_without_recalculation(credit_card):
    balance_map = bulk_signed_ledger_balances([credit_card], AS_OF)
    metrics = calculate_dashboard_debt_metrics([credit_card], balance_map, today=AS_OF)
    projection = {"debt_free_date": "2028-03-01", "interest_saved_vs_minimums": "150.00"}
    summary = _build_minimal_dashboard_debt_summary(
        [credit_card],
        as_of=AS_OF,
        balance_by_account=balance_map,
        debt_metrics=metrics,
        payoff_projection=projection,
    )
    assert summary["debt_free_date"] == "2028-03-01"
    assert "Mar 2028" in summary["label"]


def test_payoff_projection_cache_hit_and_miss(user, household, credit_card):
    cache.clear()
    household_ids = [household.pk]
    balance_map = bulk_signed_ledger_balances([credit_card], AS_OF)
    projection = {
        "debt_free_date": "2027-06-01",
        "interest_saved_vs_minimums": "42.00",
        "plan": {"total_debt": "1200.00"},
    }
    _cache_debt_payoff_projection(
        user.pk,
        household_ids,
        [credit_card],
        projection,
        balance_by_account=balance_map,
        as_of=AS_OF,
    )
    hit = get_cached_debt_payoff_projection(
        user.pk,
        household_ids,
        [credit_card],
        balance_by_account=balance_map,
        as_of=AS_OF,
    )
    assert hit is not None
    assert hit["debt_free_date"] == "2027-06-01"

    invalidate_user_dashboard_cache(user.pk)
    miss = get_cached_debt_payoff_projection(
        user.pk,
        household_ids,
        [credit_card],
        balance_by_account=balance_map,
        as_of=AS_OF,
    )
    assert miss is None


def test_cache_invalidates_when_debt_balance_changes(user, household, credit_card):
    cache.clear()
    household_ids = [household.pk]
    balance_map = bulk_signed_ledger_balances([credit_card], AS_OF)
    projection = {"debt_free_date": "2027-01-01", "plan": {}}
    _cache_debt_payoff_projection(
        user.pk,
        household_ids,
        [credit_card],
        projection,
        balance_by_account=balance_map,
        as_of=AS_OF,
    )
    changed_map = dict(balance_map)
    changed_map[credit_card.pk] = Decimal("-2000")
    assert (
        get_cached_debt_payoff_projection(
            user.pk,
            household_ids,
            [credit_card],
            balance_by_account=changed_map,
            as_of=AS_OF,
        )
        is None
    )


def test_full_dashboard_debt_summary_uses_shared_metrics(credit_card, loan):
    accounts = [credit_card, loan]
    balance_map = bulk_signed_ledger_balances(accounts, AS_OF)
    debt_metrics = calculate_dashboard_debt_metrics(accounts, balance_map, today=AS_OF)
    with patch(
        "credit_cards.services.debt_engine.simulate_household_debt",
        return_value={
            "total_debt": "1200.00",
            "monthly_interest_burn": "24.99",
            "debt_free_date": "2028-01-01",
            "debt_free_possible": True,
            "interest_saved_vs_minimums": "10.00",
            "cards": [],
            "timeline": [],
        },
    ) as simulate:
        summary = build_dashboard_debt_summary(
            [credit_card],
            as_of=AS_OF,
            balance_by_account=balance_map,
            debt_metrics=debt_metrics,
        )
    simulate.assert_called_once()
    assert Decimal(summary["total_debt"]) == debt_metrics["total_debt"]
    assert Decimal(summary["monthly_interest_burn"]) == debt_metrics["estimated_monthly_interest"]


def test_full_dashboard_reuses_cached_projection_without_simulation(
    user, household, credit_card
):
    cache.clear()
    household_ids = [household.pk]
    balance_map = bulk_signed_ledger_balances([credit_card], AS_OF)
    debt_metrics = calculate_dashboard_debt_metrics([credit_card], balance_map, today=AS_OF)
    _cache_debt_payoff_projection(
        user.pk,
        household_ids,
        [credit_card],
        {
            "debt_free_date": "2028-05-01",
            "interest_saved_vs_minimums": "25.00",
            "debt_free_possible": True,
            "plan": {"cards": [], "timeline": []},
        },
        balance_by_account=balance_map,
        as_of=AS_OF,
    )
    with patch(
        "credit_cards.services.debt_engine.simulate_household_debt",
        side_effect=AssertionError("should use cache"),
    ):
        summary = build_dashboard_debt_summary(
            [credit_card],
            as_of=AS_OF,
            balance_by_account=balance_map,
            user_id=user.pk,
            household_ids=household_ids,
            debt_metrics=debt_metrics,
        )
    assert summary["debt_free_date"] == "2028-05-01"


def test_numeric_consistency_before_after_optimization(user, checking, credit_card, loan):
    balance_map = bulk_signed_ledger_balances([checking, credit_card, loan], AS_OF)
    debt_accounts = [credit_card, loan]
    metrics = calculate_dashboard_debt_metrics(debt_accounts, balance_map, today=AS_OF)
    fast = build_dashboard_summary_fast(user, days=30, as_of_date=AS_OF)
    top = fast["top_summary"]
    debt = fast["debt"]
    assert Decimal(top["total_debt"]) == metrics["total_debt"]
    assert Decimal(debt["monthly_interest_burn"]) == metrics["estimated_monthly_interest"]


def test_debt_metrics_query_count_with_shared_map(credit_card, loan):
    balance_map = bulk_signed_ledger_balances([credit_card, loan], AS_OF)
    with CaptureQueriesContext(connection) as ctx:
        calculate_dashboard_debt_metrics([credit_card, loan], balance_map, today=AS_OF)
    assert len(ctx.captured_queries) == 0
