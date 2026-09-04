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


_SEED_FORECAST_DAYS = 30


def _ending_balances_from_seed_rows(
    rows: list[dict[str, Any]],
    accounts: list,
    *,
    today: date,
    window_end: date,
) -> dict[int, Any]:
    from decimal import Decimal

    from accounts.services.extended_cash_risk import ending_balances_from_detailed_forecast

    if not accounts:
        return {}
    try:
        return ending_balances_from_detailed_forecast(
            rows,
            accounts,
            today=today,
            window_end=window_end,
        )
    except ValueError:
        ending: dict[int, Decimal] = {}
        for row in reversed(rows):
            aid = row.get("account_id")
            if aid is None or int(aid) in ending:
                continue
            raw = row.get("balance_after")
            if raw is None:
                raw = row.get("running_balance")
            if raw is None:
                continue
            ending[int(aid)] = raw if isinstance(raw, Decimal) else Decimal(str(raw))
        return ending


def _extend_canonical_seed(
    user,
    seed: list[dict[str, Any]],
    *,
    today: date,
    forecast_days: int,
    household_id: int | None,
    scenario_id: int | None,
    caller: str,
) -> list[dict[str, Any]]:
    from accounts.models import Account
    from timeline.services.ledger import build_forecast_projection_timeline

    window_end = today + timedelta(days=_SEED_FORECAST_DAYS)
    start_date = window_end + timedelta(days=1)
    end_date = today + timedelta(days=forecast_days)
    if start_date > end_date:
        return list(seed)

    household_ids = _resolved_household_ids(user, household_id=household_id)
    accounts = list(
        Account.objects.filter(household_id__in=household_ids, is_hidden=False)
    )
    openings = _ending_balances_from_seed_rows(
        seed, accounts, today=today, window_end=window_end
    )
    continuation = build_forecast_projection_timeline(
        user,
        today=today,
        start_date=start_date,
        end_date=end_date,
        household_id=household_id,
        scenario_id=scenario_id,
        opening_balances=openings,
        caller=f"{caller}_extend",
    )
    return list(seed) + list(continuation)


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

        if forecast_days > _SEED_FORECAST_DAYS and scenario_id is None:
            seed, _ = get_or_build_canonical_forecast_timeline(
                user,
                today=today,
                forecast_days=_SEED_FORECAST_DAYS,
                household_id=household_id,
                scenario_id=None,
                caller=caller,
            )
            if seed:
                build_start = time.perf_counter()
                rows = _extend_canonical_seed(
                    user,
                    seed,
                    today=today,
                    forecast_days=forecast_days,
                    household_id=household_id,
                    scenario_id=scenario_id,
                    caller=caller,
                )
                if rows:
                    cache.set(key, rows, CANONICAL_TIMELINE_CACHE_SECONDS)
                    if perf_enabled():
                        elapsed_ms = (time.perf_counter() - build_start) * 1000
                        perf_print(
                            f"[PERF] canonical_timeline cache=EXTEND seed_days={_SEED_FORECAST_DAYS} "
                            f"days={forecast_days} caller={caller} rows={len(rows)} "
                            f"extend_elapsed_ms={elapsed_ms:.0f}"
                        )
                    return rows, False

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
