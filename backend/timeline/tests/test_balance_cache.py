"""Timeline balance preload cache reduces repeated balance queries."""
from datetime import date
from decimal import Decimal

import pytest
from django.db import connection

from accounts.models import Account
from core.models import Household, HouseholdMembership
from timeline.services.balance_cache import (
    TimelineBalanceCache,
    activate_balance_cache,
    deactivate_balance_cache,
    timeline_balance_cache_scope,
)
from timeline.services.ledger import _balance_at_end_of_date, build_timeline


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="Balance Cache HH")
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
    )


@pytest.mark.django_db
def test_balance_at_end_of_date_uses_memoization(checking):
    cache = TimelineBalanceCache()
    cache.preload_accounts([checking])
    cache.preload_transactions([checking.id], date(2026, 12, 31))

    with timeline_balance_cache_scope() as active:
        active.accounts_by_id.update(cache.accounts_by_id)
        active._ledger_rows_by_account = dict(cache._ledger_rows_by_account)
        active._posting_dates_by_account = dict(cache._posting_dates_by_account)
        first = _balance_at_end_of_date(checking.id, date(2026, 6, 1))
        second = _balance_at_end_of_date(checking.id, date(2026, 6, 1))

    assert first == second
    assert (checking.id, date(2026, 6, 2)) in active._opening_balance_cache


@pytest.mark.django_db
def test_opening_balance_matches_uncached_path(checking):
    """Cached opening balance must match the legacy uncached computation."""
    from timeline.services.ledger import _opening_balance

    cache = TimelineBalanceCache()
    cache.preload_accounts([checking])
    cache.preload_transactions([checking.id], date(2026, 12, 31))
    as_of = date(2026, 6, 2)

    expected = _opening_balance(checking.id, as_of)
    with timeline_balance_cache_scope() as active:
        active.accounts_by_id.update(cache.accounts_by_id)
        active._ledger_rows_by_account = dict(cache._ledger_rows_by_account)
        active._posting_dates_by_account = dict(cache._posting_dates_by_account)
        cached = _balance_at_end_of_date(checking.id, date(2026, 6, 1))

    assert cached == _opening_balance(checking.id, as_of)
    assert cached == expected
