"""Canonical Calendar forecast cache.

One full-range ``build_timeline_calendar`` result is stored per filter set and
financial revision. Summary and month-chunk endpoints slice that payload so the
forecast period is not recalculated for every month request.
"""
from __future__ import annotations

import time
from datetime import date
from typing import Any, Optional

from django.core.cache import cache

from common.services.cache import _household_revision_token
from common.services.profiler import perf_enabled, perf_print
from timeline.services.calendar import build_timeline_calendar
from timeline.services.calendar_chunks import SHORT_RANGE_DAYS, calendar_chunk_windows

CALENDAR_CACHE_VERSION = "v3"
CALENDAR_CACHE_SECONDS = 300
# Wait for an in-progress full-range build instead of starting a second one.
_LOCK_TIMEOUT_SECONDS = 60
_LOCK_WAIT_SECONDS = 60.0
_LOCK_POLL_SECONDS = 0.05


def calendar_canonical_cache_key(
    *,
    user_id: int,
    household_id: int | None,
    account_id: int | None,
    scenario_id: int | None,
    start_date: date,
    end_date: date,
    as_of_date: date,
    projection_only: bool,
    forecast_days: int | None = None,
) -> str:
    rev = _household_revision_token([household_id] if household_id is not None else [])
    fd = forecast_days if forecast_days is not None else 0
    return (
        f"timeline_calendar:{CALENDAR_CACHE_VERSION}:user:{user_id}"
        f":hh:{household_id or 0}:acct:{account_id or 0}:sc:{scenario_id or 0}"
        f":start:{start_date.isoformat()}:end:{end_date.isoformat()}"
        f":fd:{fd}:asof:{as_of_date.isoformat()}:proj:{int(projection_only)}:frev:{rev}"
    )


def get_or_build_canonical_calendar(
    user,
    *,
    start_date: date,
    end_date: date,
    scenario_id: Optional[int] = None,
    account_id: Optional[int] = None,
    household_id: Optional[int] = None,
    as_of_date: Optional[date] = None,
    projection_only: bool = True,
    forecast_days: Optional[int] = None,
) -> dict[str, Any]:
    today = as_of_date or date.today()
    key = calendar_canonical_cache_key(
        user_id=user.pk,
        household_id=household_id,
        account_id=account_id,
        scenario_id=scenario_id,
        start_date=start_date,
        end_date=end_date,
        as_of_date=today,
        projection_only=projection_only,
        forecast_days=forecast_days,
    )
    cached = cache.get(key)
    if isinstance(cached, dict) and cached.get("days") is not None:
        if perf_enabled():
            perf_print(
                f"[PERF] calendar_canonical cache=HIT "
                f"start={start_date.isoformat()} end={end_date.isoformat()} "
                f"days={len(cached.get('days') or [])}"
            )
        return cached

    lock_key = f"{key}:lock"
    got_lock = cache.add(lock_key, "1", timeout=_LOCK_TIMEOUT_SECONDS)
    if not got_lock:
        deadline = time.monotonic() + _LOCK_WAIT_SECONDS
        while time.monotonic() < deadline:
            time.sleep(_LOCK_POLL_SECONDS)
            cached = cache.get(key)
            if isinstance(cached, dict) and cached.get("days") is not None:
                return cached

    try:
        cached = cache.get(key)
        if isinstance(cached, dict) and cached.get("days") is not None:
            return cached
        build_start = time.perf_counter()
        result = build_timeline_calendar(
            user,
            start_date=start_date,
            end_date=end_date,
            scenario_id=scenario_id,
            account_id=account_id,
            household_id=household_id,
            as_of_date=today,
            projection_only=projection_only,
            forecast_days=forecast_days,
        )
        cache.set(key, result, CALENDAR_CACHE_SECONDS)
        if perf_enabled():
            elapsed_ms = (time.perf_counter() - build_start) * 1000
            perf_print(
                f"[PERF] calendar_canonical cache=MISS "
                f"start={start_date.isoformat()} end={end_date.isoformat()} "
                f"forecast_days={forecast_days} days={len(result.get('days') or [])} "
                f"calendar_grouping_elapsed_ms={elapsed_ms:.0f}"
            )
        return result
    finally:
        cache.delete(lock_key)


def peek_canonical_calendar(
    user,
    *,
    start_date: date,
    end_date: date,
    scenario_id: Optional[int] = None,
    account_id: Optional[int] = None,
    household_id: Optional[int] = None,
    as_of_date: Optional[date] = None,
    projection_only: bool = True,
    forecast_days: Optional[int] = None,
) -> dict[str, Any] | None:
    today = as_of_date or date.today()
    key = calendar_canonical_cache_key(
        user_id=user.pk,
        household_id=household_id,
        account_id=account_id,
        scenario_id=scenario_id,
        start_date=start_date,
        end_date=end_date,
        as_of_date=today,
        projection_only=projection_only,
        forecast_days=forecast_days,
    )
    cached = cache.get(key)
    if isinstance(cached, dict) and cached.get("days") is not None:
        return cached
    return None


def get_or_build_calendar_for_chunk(
    user,
    *,
    range_start: date,
    range_end: date,
    chunk_start: date,
    chunk_end: date,
    scenario_id: Optional[int] = None,
    account_id: Optional[int] = None,
    household_id: Optional[int] = None,
    as_of_date: Optional[date] = None,
    projection_only: bool = True,
    forecast_days: Optional[int] = None,
) -> dict[str, Any]:
    """Prefer a cached full-range forecast; otherwise build only the near-term first chunk."""
    today = as_of_date or date.today()
    full = peek_canonical_calendar(
        user,
        start_date=range_start,
        end_date=range_end,
        scenario_id=scenario_id,
        account_id=account_id,
        household_id=household_id,
        as_of_date=today,
        projection_only=projection_only,
        forecast_days=forecast_days,
    )
    if full is not None:
        if perf_enabled():
            perf_print(
                "[PERF] calendar_chunk source=full_range_cache "
                f"chunk={chunk_start.isoformat()}..{chunk_end.isoformat()}"
            )
        return full

    span_days = (range_end - range_start).days + 1
    windows = calendar_chunk_windows(range_start, range_end, today)
    is_first = bool(windows) and chunk_start == windows[0][0] and chunk_end == windows[0][1]
    if is_first and span_days > SHORT_RANGE_DAYS:
        if perf_enabled():
            perf_print(
                "[PERF] calendar_chunk source=near_term_build "
                f"end={chunk_end.isoformat()} span_days={span_days}"
            )
        return get_or_build_canonical_calendar(
            user,
            start_date=range_start,
            end_date=chunk_end,
            scenario_id=scenario_id,
            account_id=account_id,
            household_id=household_id,
            as_of_date=today,
            projection_only=projection_only,
            forecast_days=forecast_days,
        )
    if perf_enabled():
        perf_print(
            "[PERF] calendar_chunk source=full_range_build "
            f"end={range_end.isoformat()} span_days={span_days}"
        )
    return get_or_build_canonical_calendar(
        user,
        start_date=range_start,
        end_date=range_end,
        scenario_id=scenario_id,
        account_id=account_id,
        household_id=household_id,
        as_of_date=today,
        projection_only=projection_only,
        forecast_days=forecast_days,
    )
