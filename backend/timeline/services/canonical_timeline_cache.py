"""Shared canonical forecast timeline cache.

One ``build_forecast_projection_timeline`` result per user/household scope,
forecast window, scenario, and financial revision. Dashboard, Calendar forecast
grouping, and account enrichment reuse this instead of independent builds.
"""
from __future__ import annotations

import time
from datetime import date, timedelta
from typing import Any

from django.core.cache import cache

from common.services.cache import _household_revision_token
from common.services.profiler import perf_enabled, perf_print
from core.utils import get_households_for_user
from timeline.services.ledger import build_forecast_projection_timeline

CANONICAL_TIMELINE_CACHE_VERSION = "v7"
CANONICAL_TIMELINE_CACHE_SECONDS = 300
# Must outlive a cold 12m build (local Docker 30-day timeline is already 20–40s).
_LOCK_TIMEOUT_SECONDS = 240
_LOCK_WAIT_SECONDS = 240.0
_LOCK_POLL_SECONDS = 0.05


def _resolved_household_ids(user, *, household_id: int | None) -> list[int]:
    household_ids = [h.id for h in get_households_for_user(user)]
    if household_id is None:
        return household_ids
    return [household_id] if household_id in household_ids else []


def canonical_timeline_cache_key(
    *,
    user_id: int,
    household_ids: list[int],
    forecast_days: int,
    as_of_date: date,
    scenario_id: int | None,
) -> str:
    rev = _household_revision_token(household_ids)
    hh = "-".join(str(h) for h in sorted(household_ids)) or "0"
    return (
        f"canonical_timeline:{CANONICAL_TIMELINE_CACHE_VERSION}:user:{user_id}"
        f":hh:{hh}:days:{forecast_days}:asof:{as_of_date.isoformat()}"
        f":sc:{scenario_id or 0}:frev:{rev}"
    )


def peek_canonical_forecast_timeline(
    user,
    *,
    today: date,
    forecast_days: int,
    household_id: int | None = None,
    scenario_id: int | None = None,
) -> list[dict[str, Any]] | None:
    household_ids = _resolved_household_ids(user, household_id=household_id)
    key = canonical_timeline_cache_key(
        user_id=user.pk,
        household_ids=household_ids,
        forecast_days=forecast_days,
        as_of_date=today,
        scenario_id=scenario_id,
    )
    cached = cache.get(key)
    return cached if isinstance(cached, list) else None


def get_or_build_canonical_forecast_timeline(
    user,
    *,
    today: date,
    forecast_days: int,
    household_id: int | None = None,
    scenario_id: int | None = None,
    caller: str = "canonical_timeline",
) -> tuple[list[dict[str, Any]], bool]:
    """
    Return (timeline_rows, cache_hit).

    Always builds the full household timeline (``account_id=None``) so transfer
    legs materialize; consumers slice per account when needed.
    """
    household_ids = _resolved_household_ids(user, household_id=household_id)
    key = canonical_timeline_cache_key(
        user_id=user.pk,
        household_ids=household_ids,
        forecast_days=forecast_days,
        as_of_date=today,
        scenario_id=scenario_id,
    )
    cached = cache.get(key)
    if isinstance(cached, list):
        if perf_enabled():
            perf_print(
                f"[PERF] canonical_timeline cache=HIT days={forecast_days} "
                f"caller={caller} rows={len(cached)}"
            )
        return cached, True

    lock_key = f"{key}:lock"
    got_lock = cache.add(lock_key, "1", timeout=_LOCK_TIMEOUT_SECONDS)
    if not got_lock:
        deadline = time.monotonic() + _LOCK_WAIT_SECONDS
        while time.monotonic() < deadline:
            time.sleep(_LOCK_POLL_SECONDS)
            cached = cache.get(key)
            if isinstance(cached, list):
                if perf_enabled():
                    perf_print(
                        f"[PERF] canonical_timeline cache=HIT days={forecast_days} "
                        f"caller={caller} rows={len(cached)}"
                    )
                return cached, True

    try:
        cached = cache.get(key)
        if isinstance(cached, list):
            return cached, True

        build_start = time.perf_counter()
        end_date = today + timedelta(days=forecast_days)
        rows = build_forecast_projection_timeline(
            user,
            today=today,
            end_date=end_date,
            scenario_id=scenario_id,
            household_id=household_id,
            caller=caller,
        )
        cache.set(key, rows, CANONICAL_TIMELINE_CACHE_SECONDS)
        if perf_enabled():
            elapsed_ms = (time.perf_counter() - build_start) * 1000
            perf_print(
                f"[PERF] canonical_timeline cache=MISS days={forecast_days} "
                f"caller={caller} rows={len(rows)} build_timeline_elapsed_ms={elapsed_ms:.0f}"
            )
        return rows, False
    finally:
        cache.delete(lock_key)
