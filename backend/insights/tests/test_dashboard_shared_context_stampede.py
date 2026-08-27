"""Stampede protection for concurrent dashboard summary-fast + details requests."""
from __future__ import annotations

import threading
import time
from datetime import date
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db import connection

from accounts.models import Account
from common.services.cache import get_dashboard_shared_context_cache_key
from common.services.profiler import get_build_timeline_count, reset_build_timeline_count
from core.models import Household, HouseholdMembership
from insights.services.dashboard_shared_context_cache import (
    dashboard_shared_context_build_lock,
    get_dashboard_shared_context_lock_key,
    wait_for_dashboard_shared_context,
)
from insights.services.dashboard_summary import (
    build_dashboard_summary_details,
    build_dashboard_summary_fast,
)
from transactions.models import Transaction

User = get_user_model()
AS_OF = date(2025, 5, 1)


@pytest.fixture
def user(db):
    return User.objects.create_user(username="stampede", password="testpass123")


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="Stampede HH")
    HouseholdMembership.objects.create(
        household=h, user=user, role=HouseholdMembership.Role.OWNER
    )
    return h


def _scope_for_household(household_id: int, *, user_id: int = 1) -> dict:
    return {
        "user_id": user_id,
        "household_ids": [household_id],
        "forecast_days": 30,
        "as_of_date": AS_OF,
    }


def _seed_minimal_dashboard(user, household) -> None:
    checking = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        name="Main",
        starting_balance=Decimal("1000"),
        minimum_buffer=Decimal("100"),
        currency="USD",
    )
    Transaction.objects.create(
        account=checking,
        date=AS_OF,
        payee="Coffee",
        amount=Decimal("-5"),
        status=Transaction.Status.CLEARED,
        source=Transaction.Source.ONE_TIME,
    )


def _minimal_shared_context() -> dict:
    return {
        "timeline_rows": [{"id": "cached-row"}],
        "forecasts": {},
        "health_by_id": {},
        "lowest_projected_cash": None,
        "first_cash_shortfall": None,
        "attention_all": [],
    }


def test_wait_for_dashboard_shared_context_receives_builder_result(household):
    scope = _scope_for_household(household.id)
    cache_key = get_dashboard_shared_context_cache_key(**scope)
    lock_key = get_dashboard_shared_context_lock_key(scope)
    cache.set(lock_key, "1", timeout=60)

    def finish_build() -> None:
        time.sleep(0.15)
        cache.set(cache_key, _minimal_shared_context(), timeout=90)
        cache.delete(lock_key)

    threading.Thread(target=finish_build, daemon=True).start()
    shared = wait_for_dashboard_shared_context(scope, max_wait=2.0)
    assert shared is not None
    assert shared["timeline_rows"] == [{"id": "cached-row"}]


def test_build_lock_allows_only_one_holder(household):
    scope = _scope_for_household(household.id)
    cache.clear()
    with dashboard_shared_context_build_lock(scope) as first:
        assert first is True
        with dashboard_shared_context_build_lock(scope) as second:
            assert second is False


@pytest.mark.django_db(transaction=True)
def test_concurrent_fast_and_details_build_timeline_once(user, household):
    """When two cold requests race, single-flight should cap timeline builds at one."""
    _seed_minimal_dashboard(user, household)
    cache.clear()
    reset_build_timeline_count()

    timeline_builds = {"count": 0}
    from insights.services import dashboard_summary as dashboard_summary_module

    original_timeline = dashboard_summary_module._build_dashboard_timeline

    def counting_timeline(*args, **kwargs):
        timeline_builds["count"] += 1
        time.sleep(0.05)
        return original_timeline(*args, **kwargs)

    errors: list[BaseException] = []
    barrier = threading.Barrier(2)

    def run_fast() -> None:
        connection.close()
        try:
            barrier.wait(timeout=5)
            build_dashboard_summary_fast(user, days=30, as_of_date=AS_OF)
        except BaseException as exc:
            errors.append(exc)

    def run_details() -> None:
        connection.close()
        try:
            barrier.wait(timeout=5)
            build_dashboard_summary_details(user, days=30, as_of_date=AS_OF)
        except BaseException as exc:
            errors.append(exc)

    with patch.object(
        dashboard_summary_module,
        "_build_dashboard_timeline",
        side_effect=counting_timeline,
    ):
        t_fast = threading.Thread(target=run_fast)
        t_details = threading.Thread(target=run_details)
        t_fast.start()
        t_details.start()
        t_fast.join(timeout=60)
        t_details.join(timeout=60)

    assert not errors, errors
    assert timeline_builds["count"] <= 1
    assert get_build_timeline_count() <= 1


def test_sequential_details_reuses_shared_context(user, household):
    """After fast completes, details should hit shared context (no timeline rebuild)."""
    _seed_minimal_dashboard(user, household)
    cache.clear()
    reset_build_timeline_count()

    build_dashboard_summary_fast(user, days=30, as_of_date=AS_OF)
    fast_builds = get_build_timeline_count()
    assert fast_builds == 1

    reset_build_timeline_count()
    details = build_dashboard_summary_details(user, days=30, as_of_date=AS_OF)
    assert "upcoming_groups" in details
    assert get_build_timeline_count() == 0
