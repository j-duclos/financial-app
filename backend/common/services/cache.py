"""
Financial cache helpers (forecast summaries + dashboard summary).

Forecast summaries and dashboard aggregation call build_timeline() and related
services repeatedly on page loads. Cached payloads are for performance only — not
permanent storage. TTLs are intentionally short; direct mutations bump per-user
version counters so stale financial data is not shown after edits, Plaid sync, or
reconciliation.
"""
from __future__ import annotations

from datetime import date
from typing import Iterable

from django.core.cache import cache

FORECAST_SUMMARY_CACHE_VERSION = "v1"
# Short TTL: balances and rules change often; invalidation covers writes but TTL is a safety net.
FORECAST_SUMMARY_CACHE_SECONDS = 300

DASHBOARD_SUMMARY_CACHE_VERSION = "v1"
# Dashboard cache is shorter than forecast cache — widgets combine live balances, bills, and goals.
DASHBOARD_SUMMARY_CACHE_SECONDS = 90


def _user_forecast_version_key(user_id: int) -> str:
    return f"forecast_summary:ver:user:{user_id}"


def _user_dashboard_version_key(user_id: int) -> str:
    return f"dashboard_summary:ver:user:{user_id}"


def _sorted_scope_ids(values: Iterable[int | None]) -> str:
    ids = sorted({v for v in values if v is not None})
    if not ids:
        return "none"
    return "-".join(str(i) for i in ids)


def get_user_forecast_cache_version(user_id: int) -> int:
    return int(cache.get(_user_forecast_version_key(user_id)) or 0)


def get_forecast_summary_cache_key(
    *,
    user_id: int,
    household_ids: Iterable[int | None],
    account_ids: Iterable[int],
    forecast_days: int,
    as_of_date: date,
) -> str:
    """
    Stable cache key scoped to one user and one account/household batch.

    Sorted household and account ids prevent cross-user or cross-scope cache bleed.
    """
    ver = get_user_forecast_cache_version(user_id)
    return (
        f"forecast_summary:{FORECAST_SUMMARY_CACHE_VERSION}:user:{user_id}"
        f":households:{_sorted_scope_ids(household_ids)}"
        f":accounts:{_sorted_scope_ids(account_ids)}"
        f":days:{forecast_days}:asof:{as_of_date.isoformat()}:ver:{ver}"
    )


def get_user_dashboard_cache_version(user_id: int) -> int:
    return int(cache.get(_user_dashboard_version_key(user_id)) or 0)


def get_dashboard_summary_cache_key(
    *,
    user_id: int,
    household_ids: Iterable[int | None],
    forecast_days: int,
    as_of_date: date,
) -> str:
    """
    Stable cache key for the full dashboard summary response.

    Sorted household ids scope the payload to the user's membership set.
    """
    ver = get_user_dashboard_cache_version(user_id)
    return (
        f"dashboard_summary:{DASHBOARD_SUMMARY_CACHE_VERSION}:user:{user_id}"
        f":households:{_sorted_scope_ids(household_ids)}"
        f":days:{forecast_days}:asof:{as_of_date.isoformat()}:ver:{ver}"
    )


def get_dashboard_summary_fast_cache_key(
    *,
    user_id: int,
    household_ids: Iterable[int | None],
    forecast_days: int,
    as_of_date: date,
) -> str:
    """Cache key for above-the-fold dashboard summary (fast paint)."""
    ver = get_user_dashboard_cache_version(user_id)
    return (
        f"dashboard_summary_fast:{DASHBOARD_SUMMARY_CACHE_VERSION}:user:{user_id}"
        f":households:{_sorted_scope_ids(household_ids)}"
        f":days:{forecast_days}:asof:{as_of_date.isoformat()}:ver:{ver}"
    )


def get_dashboard_summary_details_cache_key(
    *,
    user_id: int,
    household_ids: Iterable[int | None],
    forecast_days: int,
    as_of_date: date,
) -> str:
    """Cache key for lazy-loaded dashboard sections."""
    ver = get_user_dashboard_cache_version(user_id)
    return (
        f"dashboard_summary_details:{DASHBOARD_SUMMARY_CACHE_VERSION}:user:{user_id}"
        f":households:{_sorted_scope_ids(household_ids)}"
        f":days:{forecast_days}:asof:{as_of_date.isoformat()}:ver:{ver}"
    )


def get_dashboard_shared_context_cache_key(
    *,
    user_id: int,
    household_ids: Iterable[int | None],
    forecast_days: int,
    as_of_date: date,
) -> str:
    """Cache key for timeline-derived dashboard core (shared by fast + details)."""
    ver = get_user_dashboard_cache_version(user_id)
    return (
        f"dashboard_shared_ctx:{DASHBOARD_SUMMARY_CACHE_VERSION}:user:{user_id}"
        f":households:{_sorted_scope_ids(household_ids)}"
        f":days:{forecast_days}:asof:{as_of_date.isoformat()}:ver:{ver}"
    )


def invalidate_user_forecast_cache(user_id: int) -> None:
    """Bump per-user version so all forecast summary keys for this user are stale."""
    key = _user_forecast_version_key(user_id)
    try:
        cache.incr(key)
    except ValueError:
        cache.set(key, 1, timeout=None)


def invalidate_user_dashboard_cache(user_id: int) -> None:
    """Bump per-user version so all dashboard summary keys for this user are stale."""
    key = _user_dashboard_version_key(user_id)
    try:
        cache.incr(key)
    except ValueError:
        cache.set(key, 1, timeout=None)


def invalidate_user_financial_cache(user_id: int) -> None:
    """Invalidate both forecast summary and dashboard summary caches for one user."""
    invalidate_user_forecast_cache(user_id)
    invalidate_user_dashboard_cache(user_id)


def invalidate_financial_cache_for_household(household_id: int | None) -> None:
    """Invalidate forecast + dashboard cache for every member of a household."""
    if household_id is None:
        return
    from core.models import HouseholdMembership
    from core.timeline_cache import bump_timeline_cache_for_household

    bump_timeline_cache_for_household(household_id)

    user_ids = (
        HouseholdMembership.objects.filter(household_id=household_id)
        .values_list("user_id", flat=True)
        .distinct()
    )
    for user_id in user_ids:
        invalidate_user_financial_cache(user_id)


def invalidate_forecast_cache_for_household(household_id: int | None) -> None:
    """Backward-compatible alias — invalidates all financial caches for the household."""
    invalidate_financial_cache_for_household(household_id)
