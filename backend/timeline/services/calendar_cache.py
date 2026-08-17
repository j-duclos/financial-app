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
from timeline.services.calendar import build_timeline_calendar

CALENDAR_CACHE_VERSION = "v1"
CALENDAR_CACHE_SECONDS = 300
_LOCK_WAIT_SECONDS = 2.0
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
) -> str:
    rev = _household_revision_token([household_id] if household_id is not None else [])
    return (
        f"timeline_calendar:{CALENDAR_CACHE_VERSION}:user:{user_id}"
        f":hh:{household_id or 0}:acct:{account_id or 0}:sc:{scenario_id or 0}"
        f":start:{start_date.isoformat()}:end:{end_date.isoformat()}"
        f":asof:{as_of_date.isoformat()}:proj:{int(projection_only)}:frev:{rev}"
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
    )
    cached = cache.get(key)
    if isinstance(cached, dict) and cached.get("days") is not None:
        return cached

    lock_key = f"{key}:lock"
    got_lock = cache.add(lock_key, "1", timeout=60)
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
        result = build_timeline_calendar(
            user,
            start_date=start_date,
            end_date=end_date,
            scenario_id=scenario_id,
            account_id=account_id,
            household_id=household_id,
            as_of_date=today,
            projection_only=projection_only,
        )
        cache.set(key, result, CALENDAR_CACHE_SECONDS)
        return result
    finally:
        cache.delete(lock_key)
