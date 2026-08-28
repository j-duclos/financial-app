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
from django.db.models import F
from django.utils import timezone

FORECAST_SUMMARY_CACHE_VERSION = "v1"
# Short TTL: balances and rules change often; invalidation covers writes but TTL is a safety net.
FORECAST_SUMMARY_CACHE_SECONDS = 300

DASHBOARD_SUMMARY_CACHE_VERSION = "v3"
# Dashboard cache is shorter than forecast cache — widgets combine live balances, bills, and goals.
DASHBOARD_SUMMARY_CACHE_SECONDS = 90

DEBT_PAYOFF_PROJECTION_CACHE_VERSION = "v1"
# Payoff simulation is expensive; cache keyed on balances/APRs/min payments + user version.
DEBT_PAYOFF_PROJECTION_CACHE_SECONDS = 300


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


def _household_revision_token(household_ids: Iterable[int | None]) -> str:
    ids = sorted({int(v) for v in household_ids if v is not None})
    if not ids:
        return "none"
    from core.models import Household

    rows = dict(
        Household.objects.filter(pk__in=ids).values_list("pk", "financial_revision")
    )
    return "-".join(f"{hid}:{int(rows.get(hid, 0))}" for hid in ids)


def bump_household_financial_revision(household_id: int | None) -> None:
    """Increment the household financial revision so forecast cache keys miss."""
    if household_id is None:
        return
    from core.models import Household

    Household.objects.filter(pk=household_id).update(
        financial_revision=F("financial_revision") + 1,
        updated_at=timezone.now(),
    )


def get_forecast_summary_cache_key(
    *,
    user_id: int,
    household_ids: Iterable[int | None],
    account_ids: Iterable[int],
    forecast_days: int,
    as_of_date: date,
    revision_token: str | None = None,
) -> str:
    """
    Stable cache key scoped to one user and one account/household batch.

    Sorted household and account ids prevent cross-user or cross-scope cache bleed.
    Household financial_revision makes prior payloads unreachable after mutations.
    """
    ver = get_user_forecast_cache_version(user_id)
    rev = revision_token if revision_token is not None else _household_revision_token(household_ids)
    return (
        f"forecast_summary:{FORECAST_SUMMARY_CACHE_VERSION}:user:{user_id}"
        f":households:{_sorted_scope_ids(household_ids)}"
        f":accounts:{_sorted_scope_ids(account_ids)}"
        f":days:{forecast_days}:asof:{as_of_date.isoformat()}:ver:{ver}:frev:{rev}"
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
    rev = _household_revision_token(household_ids)
    return (
        f"dashboard_summary:{DASHBOARD_SUMMARY_CACHE_VERSION}:user:{user_id}"
        f":households:{_sorted_scope_ids(household_ids)}"
        f":days:{forecast_days}:asof:{as_of_date.isoformat()}:ver:{ver}:frev:{rev}"
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
    rev = _household_revision_token(household_ids)
    return (
        f"dashboard_summary_fast:{DASHBOARD_SUMMARY_CACHE_VERSION}:user:{user_id}"
        f":households:{_sorted_scope_ids(household_ids)}"
        f":days:{forecast_days}:asof:{as_of_date.isoformat()}:ver:{ver}:frev:{rev}"
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
    rev = _household_revision_token(household_ids)
    return (
        f"dashboard_summary_details:{DASHBOARD_SUMMARY_CACHE_VERSION}:user:{user_id}"
        f":households:{_sorted_scope_ids(household_ids)}"
        f":days:{forecast_days}:asof:{as_of_date.isoformat()}:ver:{ver}:frev:{rev}"
    )


def get_debt_payoff_projection_cache_key(
    *,
    user_id: int,
    household_ids: Iterable[int | None],
    fingerprint: str,
    as_of_date: date,
) -> str:
    """Cache key for household credit-card payoff projection (debt-free date, interest saved)."""
    ver = get_user_dashboard_cache_version(user_id)
    rev = _household_revision_token(household_ids)
    return (
        f"debt_payoff_projection:{DEBT_PAYOFF_PROJECTION_CACHE_VERSION}:user:{user_id}"
        f":households:{_sorted_scope_ids(household_ids)}"
        f":fp:{fingerprint}:asof:{as_of_date.isoformat()}:ver:{ver}:frev:{rev}"
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
    rev = _household_revision_token(household_ids)
    return (
        f"dashboard_shared_ctx:{DASHBOARD_SUMMARY_CACHE_VERSION}:user:{user_id}"
        f":households:{_sorted_scope_ids(household_ids)}"
        f":days:{forecast_days}:asof:{as_of_date.isoformat()}:ver:{ver}:frev:{rev}"
    )


EXTENDED_CASH_RISK_CACHE_VERSION = "v1"
EXTENDED_CASH_RISK_CACHE_SECONDS = 300
EXTENDED_CASH_RISK_SEED_WAIT_SECONDS = 10.0
EXTENDED_CASH_RISK_SEED_POLL_SECONDS = 0.05
EXTENDED_CASH_RISK_BUILD_LOCK_SECONDS = 60


def get_extended_cash_risk_cache_key(
    *,
    user_id: int,
    household_ids: Iterable[int | None],
    as_of_date: date,
) -> str:
    """
    Cache key for the 6-month first-cash-negative scan.

    Intentionally omits the selected Forecast Window so 30 → 60 → 90 does not rescan.
    """
    ver = get_user_dashboard_cache_version(user_id)
    rev = _household_revision_token(household_ids)
    return (
        f"extended_cash_risk:{EXTENDED_CASH_RISK_CACHE_VERSION}:user:{user_id}"
        f":households:{_sorted_scope_ids(household_ids)}"
        f":asof:{as_of_date.isoformat()}:ver:{ver}:frev:{rev}"
    )


def get_extended_cash_risk_seed_cache_key(
    *,
    user_id: int,
    household_ids: Iterable[int | None],
    as_of_date: date,
) -> str:
    """Cache key for detailed-forecast ending balances used to continue the scan."""
    ver = get_user_dashboard_cache_version(user_id)
    rev = _household_revision_token(household_ids)
    return (
        f"extended_cash_risk_seed:{EXTENDED_CASH_RISK_CACHE_VERSION}:user:{user_id}"
        f":households:{_sorted_scope_ids(household_ids)}"
        f":asof:{as_of_date.isoformat()}:ver:{ver}:frev:{rev}"
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


def invalidate_financial_cache_for_household(
    household_id: int | None,
    *,
    bump_revision: bool = True,
) -> None:
    """Invalidate forecast + dashboard cache for every member of a household."""
    if household_id is None:
        return
    from core.models import HouseholdMembership
    from core.timeline_cache import bump_timeline_cache_for_household

    if bump_revision:
        bump_household_financial_revision(household_id)
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
