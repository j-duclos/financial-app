"""Tests for dashboard Available Cash bulk balance optimization."""
from datetime import date, timedelta
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from django.db import connection
from django.test.utils import CaptureQueriesContext

from accounts.models import Account
from accounts.services.balances import (
    bulk_signed_ledger_balances,
    signed_ledger_balance,
)
from common.services.cache import invalidate_user_dashboard_cache
from core.models import Household, HouseholdMembership
from insights.services.dashboard_summary import (
    AVAILABLE_CASH_ACCOUNT_ROLES,
    EXCLUDED_AVAILABLE_CASH_ROLES,
    _compute_liquid_cash,
    _compute_top_summary,
    _counts_toward_liquid_cash,
    _load_dashboard_balance_maps,
    build_dashboard_summary,
    build_dashboard_summary_fast,
)
from transactions.models import Transaction

User = get_user_model()
AS_OF = date(2025, 5, 1)


@pytest.fixture
def user(db):
    return User.objects.create_user(username="cashperf", password="testpass123")


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="Cash Perf HH")
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
        credit_limit=Decimal("5000"),
        starting_balance=Decimal("-500"),
        currency="USD",
    )


def test_counts_toward_liquid_cash_includes_spending_roles(checking, savings):
    assert _counts_toward_liquid_cash(checking)
    assert _counts_toward_liquid_cash(savings)
    assert checking.role in AVAILABLE_CASH_ACCOUNT_ROLES
    assert savings.role in AVAILABLE_CASH_ACCOUNT_ROLES


def test_counts_toward_liquid_cash_excludes_credit_and_bills(household, credit_card):
    bills = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.BILLS,
        name="Bills",
        starting_balance=Decimal("2000"),
        currency="USD",
    )
    assert not _counts_toward_liquid_cash(credit_card)
    assert not _counts_toward_liquid_cash(bills)
    assert Account.AccountRole.BILLS in EXCLUDED_AVAILABLE_CASH_ROLES
    assert Account.AccountRole.CREDIT_CARD in EXCLUDED_AVAILABLE_CASH_ROLES


def test_liquid_cash_includes_negative_checking_balance(household):
    overdraft = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        name="Overdraft",
        starting_balance=Decimal("100"),
        currency="USD",
    )
    Transaction.objects.create(
        account=overdraft,
        date=AS_OF,
        payee="Rent",
        amount=Decimal("-250"),
        status=Transaction.Status.CLEARED,
        source=Transaction.Source.ONE_TIME,
    )
    balance_map = bulk_signed_ledger_balances([overdraft], AS_OF)
    liquid = _compute_liquid_cash([overdraft], today=AS_OF, balance_by_account=balance_map)
    assert liquid == Decimal("-150")
    assert liquid == signed_ledger_balance(overdraft, AS_OF)


def test_liquid_cash_uses_balance_map_without_signed_ledger_calls(checking, savings):
    accounts = [checking, savings]
    balance_map = bulk_signed_ledger_balances(accounts, AS_OF)
    with patch(
        "insights.services.dashboard_summary.signed_ledger_balance",
        side_effect=AssertionError("should not query per account"),
    ):
        liquid = _compute_liquid_cash(
            accounts, today=AS_OF, balance_by_account=balance_map
        )
    expected = (
        signed_ledger_balance(checking, AS_OF) + signed_ledger_balance(savings, AS_OF)
    )
    assert liquid == expected


def test_top_summary_shares_one_balance_snapshot(checking, savings, credit_card):
    accounts = [checking, savings, credit_card]
    balance_map = bulk_signed_ledger_balances(accounts, AS_OF)
    with patch(
        "insights.services.dashboard_summary.credit_owed_balance",
        side_effect=AssertionError("should use shared map"),
    ):
        top = _compute_top_summary(
            accounts,
            {},
            today=AS_OF,
            balance_by_account=balance_map,
        )
    assert Decimal(top["liquid_cash"]) == _compute_liquid_cash(
        accounts, today=AS_OF, balance_by_account=balance_map
    )
    assert Decimal(top["available_credit"]) > Decimal("0")
    assert Decimal(top["cash_after_debt"]) == Decimal(top["liquid_cash"]) - Decimal(
        top["total_debt"]
    )


def test_bulk_balance_map_uses_one_transaction_query_per_date(checking, savings):
    accounts = [checking, savings]
    with CaptureQueriesContext(connection) as ctx:
        bulk_signed_ledger_balances(accounts, AS_OF)
    assert len(ctx.captured_queries) == 1


def test_dashboard_fast_top_summary_matches_ledger_formula(
    user, checking, savings, credit_card, household
):
    bills = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.BILLS,
        name="Bills",
        starting_balance=Decimal("-500"),
        currency="USD",
    )
    inactive = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        name="Closed",
        starting_balance=Decimal("999"),
        status=Account.Status.CLOSED,
        currency="USD",
    )
    expected = (
        signed_ledger_balance(checking, AS_OF) + signed_ledger_balance(savings, AS_OF)
    ).quantize(Decimal("0.01"))

    with patch(
        "insights.services.dashboard_summary._compute_dashboard_core",
    ) as mock_core:
        mock_core.return_value = {
            "phases": [],
            "households": Household.objects.filter(pk=household.pk),
            "accounts": [checking, savings, credit_card, bills, inactive],
            "accounts_by_id": {
                a.pk: a
                for a in [checking, savings, credit_card, bills, inactive]
            },
            "forecast_accounts": [],
            "timeline_rows": [],
            "forecasts": {},
            "health_by_id": {},
            "lowest_projected_cash": None,
            "legacy_safe_to_spend": {"amount": "0", "date": AS_OF.isoformat()},
            "attention_all": [],
            "attention": [],
            "forecast_risk": None,
            "shared_context": {},
        }
        fast = build_dashboard_summary_fast(user, days=30, as_of_date=AS_OF)

    assert Decimal(fast["top_summary"]["liquid_cash"]) == expected
    assert bills.pk not in {
        a.pk for a in [checking, savings] if _counts_toward_liquid_cash(a)
    }


def test_cache_invalidation_refreshes_available_cash(user, checking, household):
    first = build_dashboard_summary_fast(user, days=30, as_of_date=AS_OF)
    before = Decimal(first["top_summary"]["liquid_cash"])

    Transaction.objects.create(
        account=checking,
        date=AS_OF,
        payee="Deposit",
        amount=Decimal("500"),
        status=Transaction.Status.CLEARED,
        source=Transaction.Source.ONE_TIME,
    )
    invalidate_user_dashboard_cache(user.pk)
    second = build_dashboard_summary_fast(user, days=30, as_of_date=AS_OF)
    after = Decimal(second["top_summary"]["liquid_cash"])
    assert after == before + Decimal("500")


def test_load_dashboard_balance_maps_skips_prior_when_not_requested(checking, savings):
    accounts = [checking, savings]
    with CaptureQueriesContext(connection) as ctx:
        today_map, prior_map = _load_dashboard_balance_maps(
            accounts, today=AS_OF, include_prior=False
        )
    assert prior_map is None
    assert len(ctx.captured_queries) == 1
    assert today_map[checking.pk] == signed_ledger_balance(checking, AS_OF)


def test_performance_old_vs_new_top_summary_queries(user, household, checking, savings):
    """Document query reduction: per-account balances vs one shared map."""
    from insights.services.dashboard_summary import _compute_snapshot

    bills = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.BILLS,
        name="Bills",
        starting_balance=Decimal("2000"),
        currency="USD",
    )
    investment = Account.objects.create(
        household=household,
        account_type=Account.AccountType.INVESTMENT,
        role=Account.AccountRole.INVESTMENT,
        name="Brokerage",
        starting_balance=Decimal("15000"),
        currency="USD",
    )
    active = [checking, savings, bills, investment]

    with CaptureQueriesContext(connection) as old_ctx:
        snap = _compute_snapshot(active, today=AS_OF)
        _compute_top_summary(active, snap, today=AS_OF)

    with CaptureQueriesContext(connection) as new_ctx:
        balance_map = bulk_signed_ledger_balances(active, AS_OF)
        _compute_top_summary(active, {}, today=AS_OF, balance_by_account=balance_map)

    old_queries = len(old_ctx.captured_queries)
    new_queries = len(new_ctx.captured_queries)
    eligible = sum(1 for a in active if _counts_toward_liquid_cash(a))
    # Old path hits ledger per account for snapshot (today + prior) plus liquid cash.
    assert old_queries >= eligible
    assert new_queries == 1
    assert old_queries > new_queries


def test_full_dashboard_liquid_cash_unchanged(user, checking, savings):
    summary = build_dashboard_summary(user, days=30, as_of_date=AS_OF)
    expected = (
        signed_ledger_balance(checking, AS_OF) + signed_ledger_balance(savings, AS_OF)
    ).quantize(Decimal("0.01"))
    assert Decimal(summary["top_summary"]["liquid_cash"]) == expected

    summary = build_dashboard_summary(user, days=30, as_of_date=AS_OF)
    expected = (
        signed_ledger_balance(checking, AS_OF) + signed_ledger_balance(savings, AS_OF)
    ).quantize(Decimal("0.01"))
    assert Decimal(summary["top_summary"]["liquid_cash"]) == expected
