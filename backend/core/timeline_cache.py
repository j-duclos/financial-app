"""Optional Redis-backed cache for expensive timeline API responses (production)."""
from __future__ import annotations

import hashlib
import json
import logging
from datetime import date
from typing import Any, Optional

from django.conf import settings
from django.core.cache import cache

logger = logging.getLogger(__name__)


def timeline_cache_enabled() -> bool:
    return bool(getattr(settings, "TIMELINE_CACHE_ENABLED", False))


def _household_version_key(household_id: int) -> str:
    return f"budget:tl_h_ver:{household_id}"


def bump_timeline_cache_for_household(household_id: int | None) -> None:
    if not timeline_cache_enabled() or household_id is None:
        return
    key = _household_version_key(household_id)
    try:
        try:
            cache.incr(key)
        except ValueError:
            cache.set(key, 1, timeout=None)
    except Exception:
        # Never fail Plaid sync / writes because Redis is down or misconfigured.
        logger.exception("bump_timeline_cache_for_household failed for household_id=%s", household_id)


def timeline_response_cache_key(
    *,
    household_id: int | None,
    user_id: int,
    start: date,
    end: date,
    account_id: int | None,
    scenario_id: int | None,
    as_of_date: date | None,
) -> str:
    version = 0
    if household_id is not None:
        version = cache.get(_household_version_key(household_id)) or 0
    raw = json.dumps(
        {
            "h": household_id,
            "u": user_id,
            "v": version,
            "s": start.isoformat(),
            "e": end.isoformat(),
            "a": account_id,
            "sc": scenario_id,
            "o": as_of_date.isoformat() if as_of_date else None,
        },
        sort_keys=True,
    )
    return f"budget:tl_resp:{hashlib.sha256(raw.encode()).hexdigest()}"


def get_cached_timeline_response(cache_key: str) -> Optional[dict[str, Any]]:
    if not timeline_cache_enabled():
        return None
    payload = cache.get(cache_key)
    return payload if isinstance(payload, dict) else None


def set_cached_timeline_response(cache_key: str, payload: dict[str, Any]) -> None:
    if not timeline_cache_enabled():
        return
    timeout = getattr(settings, "TIMELINE_CACHE_SECONDS", 120)
    cache.set(cache_key, payload, timeout=timeout)
