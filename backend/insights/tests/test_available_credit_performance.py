"""Tests for dashboard Available Credit bulk balance optimization."""
from datetime import date
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from django.db import connection
from django.test.utils import CaptureQueriesContext

from accounts.models import Account
from accounts.services.balances import (
    bulk_signed_ledger_balances,
    calculate_credit_metrics,
    credit_owed_balance,
    signed_ledger_balance,
)
from common.services.cache import invalidate_user_dashboard_cache
from core.models import Household, HouseholdMembership
from insights.services.dashboard_summary import (
    _active_credit_accounts_for_available_credit,
    _compute_available_credit,
    _compute_top_summary,
    _dashboard_credit_cards,
    _load_dashboard_balance_maps,
    build_dashboard_summary,
    build_dashboard_summary_fast,
)
from transactions.models import Transaction

User = get_user_model()
AS_OF = date(2025, 5, 1)


@pytest.fixture
def user(db):
    return User.objects.create_user(username="creditperf", password="testpass123")


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="Credit Perf HH")
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
        credit_limit=Decimal("5000"),
        starting_balance=Decimal("-500"),
        currency="USD",
    )


def test_available_credit_includes_only_active_revolving_cards(household, credit_card):
    loan = Account.objects.create(
        household=household,
        account_type=Account.AccountType.OTHER,
        role=Account.AccountRole.LOAN,
        name="Car Loan",
        starting_balance=Decimal("-3000"),
        currency="USD",
    )
    closed = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        role=Account.AccountRole.CREDIT_CARD,
        name="Closed",
        credit_limit=Decimal("2000"),
        status=Account.Status.CLOSED,
        currency="USD",
    )
    cards = _dashboard_credit_cards([credit_card, loan, closed])
    eligible = _active_credit_accounts_for_available_credit(cards)
    assert credit_card in eligible
    assert loan not in eligible
    assert closed not in eligible


def test_available_credit_excludes_opt_out_and_zero_limit_cards(household):
    excluded = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        role=Account.AccountRole.CREDIT_CARD,
        name="Care",
        credit_limit=Decimal("4800"),
        include_in_available_credit=False,
        currency="USD",
    )
    zero_limit = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        role=Account.AccountRole.CREDIT_CARD,
        name="No Limit",
        credit_limit=Decimal("0"),
        currency="USD",
    )
    daily = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        role=Account.AccountRole.CREDIT_CARD,
        name="Daily",
        credit_limit=Decimal("1000"),
        include_in_available_credit=True,
        currency="USD",
    )
    balance_map = bulk_signed_ledger_balances([daily], AS_OF)
    totals = _compute_available_credit(
        [excluded, zero_limit, daily],
        today=AS_OF,
        balance_by_account=balance_map,
    )
    assert totals["available_credit"] == Decimal("1000")
    assert totals["total_credit_limit"] == Decimal("1000")


def test_available_credit_uses_balance_map_without_extra_sql(credit_card):
    balance_map = bulk_signed_ledger_balances([credit_card], AS_OF)
    with patch(
        "insights.services.dashboard_summary.credit_owed_balance",
        side_effect=AssertionError("should use shared map"),
    ):
        totals = _compute_available_credit(
            [credit_card],
            today=AS_OF,
            balance_by_account=balance_map,
        )
    signed = balance_map[credit_card.pk]
    expected = calculate_credit_metrics(credit_card, signed)["available"]
    assert totals["available_credit"] == expected


def test_available_credit_sign_convention_and_over_limit(household):
    over_limit = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        role=Account.AccountRole.CREDIT_CARD,
        name="Maxed",
        credit_limit=Decimal("1000"),
        starting_balance=Decimal("-1500"),
        currency="USD",
    )
    balance_map = bulk_signed_ledger_balances([over_limit], AS_OF)
    totals = _compute_available_credit(
        [over_limit],
        today=AS_OF,
        balance_by_account=balance_map,
    )
    assert totals["available_credit"] == Decimal("0")
    assert totals["total_credit_owed"] == Decimal("1500")
    assert totals["weighted_utilization"] == Decimal("150.00")


def test_positive_ledger_balance_does_not_create_debt(credit_card):
    metrics = calculate_credit_metrics(credit_card, Decimal("250"))
    assert metrics["owed"] == Decimal("0")
    assert metrics["available"] == Decimal("5000")


def test_top_summary_shares_credit_accounts_and_balance_map(checking, credit_card):
    accounts = [checking, credit_card]
    credit_cards = _dashboard_credit_cards(accounts)
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
            credit_accounts=credit_cards,
        )
    direct = _compute_available_credit(
        credit_cards,
        today=AS_OF,
        balance_by_account=balance_map,
    )
    assert Decimal(top["available_credit"]) == direct["available_credit"]
    assert top["credit_utilization"] == str(direct["weighted_utilization"])


def test_dashboard_metrics_share_one_balance_snapshot(user, checking, credit_card):
    summary = build_dashboard_summary(user, days=30, as_of_date=AS_OF)
    balance_map = bulk_signed_ledger_balances([checking, credit_card], AS_OF)
    credit_cards = _dashboard_credit_cards([checking, credit_card])
    expected = _compute_available_credit(
        credit_cards,
        today=AS_OF,
        balance_by_account=balance_map,
    )
    top = summary["top_summary"]
    assert Decimal(top["available_credit"]) == expected["available_credit"]
    assert Decimal(top["liquid_cash"]) == signed_ledger_balance(checking, AS_OF)


def test_cache_invalidation_refreshes_available_credit(user, credit_card, household):
    Transaction.objects.create(
        account=credit_card,
        date=AS_OF,
        payee="Purchase",
        amount=Decimal("-200"),
        status=Transaction.Status.CLEARED,
        source=Transaction.Source.ONE_TIME,
    )
    first = build_dashboard_summary_fast(user, days=30, as_of_date=AS_OF)
    before = Decimal(first["top_summary"]["available_credit"])

    Transaction.objects.create(
        account=credit_card,
        date=AS_OF,
        payee="More",
        amount=Decimal("-300"),
        status=Transaction.Status.CLEARED,
        source=Transaction.Source.ONE_TIME,
    )
    invalidate_user_dashboard_cache(user.pk)
    second = build_dashboard_summary_fast(user, days=30, as_of_date=AS_OF)
    after = Decimal(second["top_summary"]["available_credit"])
    assert after == before - Decimal("300")


def test_performance_old_vs_new_available_credit_queries(household, credit_card):
    card_two = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        role=Account.AccountRole.CREDIT_CARD,
        name="Card 2",
        credit_limit=Decimal("3000"),
        starting_balance=Decimal("-400"),
        currency="USD",
    )
    cards = [credit_card, card_two]

    with CaptureQueriesContext(connection) as old_ctx:
        _compute_available_credit(cards, today=AS_OF)

    with CaptureQueriesContext(connection) as new_ctx:
        balance_map = bulk_signed_ledger_balances(cards, AS_OF)
        _compute_available_credit(cards, today=AS_OF, balance_by_account=balance_map)

    old_queries = len(old_ctx.captured_queries)
    new_queries = len(new_ctx.captured_queries)
    assert old_queries >= len(cards)
    assert new_queries == 1
    assert old_queries > new_queries


def test_available_credit_numeric_results_unchanged_with_shared_map(credit_card):
    without_map = _compute_available_credit([credit_card], today=AS_OF)
    balance_map = bulk_signed_ledger_balances([credit_card], AS_OF)
    with_map = _compute_available_credit(
        [credit_card], today=AS_OF, balance_by_account=balance_map
    )
    assert with_map["available_credit"] == without_map["available_credit"]
    assert with_map["total_credit_limit"] == without_map["total_credit_limit"]
    assert with_map["weighted_utilization"] == without_map["weighted_utilization"]


def test_load_dashboard_balance_maps_single_query_for_credit_cards(credit_card):
    with CaptureQueriesContext(connection) as ctx:
        today_map, prior_map = _load_dashboard_balance_maps(
            [credit_card], today=AS_OF, include_prior=False
        )
    assert prior_map is None
    assert len(ctx.captured_queries) == 1
    assert today_map[credit_card.pk] == signed_ledger_balance(credit_card, AS_OF)
