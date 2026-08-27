"""Single-flight protection for dashboard shared context (timeline/forecast core).

When summary-fast and details arrive concurrently on a cold cache, only one request
should build the expensive core; others wait briefly and reuse the stored context.
"""
from __future__ import annotations

import time
from contextlib import contextmanager
from typing import Any, Callable, Iterator

from django.core.cache import cache

from common.services.cache import get_dashboard_shared_context_cache_key
from common.services.profiler import perf_enabled, perf_print
from insights.services.dashboard_context import (
    load_dashboard_shared_context,
    store_dashboard_shared_context,
)

# Short lock TTL avoids deadlocks if a worker dies mid-build.
_SHARED_CONTEXT_LOCK_TIMEOUT_SECONDS = 60
# Bounded wait — do not block requests indefinitely.
_SHARED_CONTEXT_LOCK_WAIT_SECONDS = 15.0
_SHARED_CONTEXT_LOCK_POLL_SECONDS = 0.05
# Brief grace window so a racing summary-fast can acquire the build lock first.
_SHARED_CONTEXT_RACE_GRACE_SECONDS = 0.5


def get_dashboard_shared_context_lock_key(scope: dict[str, Any]) -> str:
    return f"{get_dashboard_shared_context_cache_key(**scope)}:lock"


def wait_for_dashboard_shared_context(
    scope: dict[str, Any],
    *,
    max_wait: float = _SHARED_CONTEXT_LOCK_WAIT_SECONDS,
) -> dict[str, Any] | None:
    """Poll shared-context cache while another request may be building it."""
    lock_key = get_dashboard_shared_context_lock_key(scope)
    deadline = time.monotonic() + max_wait
    grace_until = time.monotonic() + min(_SHARED_CONTEXT_RACE_GRACE_SECONDS, max_wait)
    while time.monotonic() < deadline:
        shared = load_dashboard_shared_context(scope)
        if shared is not None:
            if perf_enabled():
                perf_print("[PERF] dashboard_shared_context wait=HIT")
            return shared
        lock_held = cache.get(lock_key) is not None
        if not lock_held and time.monotonic() >= grace_until:
            break
        time.sleep(_SHARED_CONTEXT_LOCK_POLL_SECONDS)
    shared = load_dashboard_shared_context(scope)
    if shared is not None and perf_enabled():
        perf_print("[PERF] dashboard_shared_context wait=HIT")
    return shared


def resolve_dashboard_shared_context(
    scope: dict[str, Any],
    *,
    build: Callable[[], dict[str, Any]],
) -> tuple[dict[str, Any], bool]:
    """
    Return cached shared context, waiting on an in-flight build when possible.

    When no cached context exists and this caller acquires the build lock, ``build``
    is invoked to produce the context payload. Returns (context, reused_cache).
    """
    shared = load_dashboard_shared_context(scope)
    if shared is not None:
        return shared, True

    with dashboard_shared_context_build_lock(scope) as got_lock:
        shared = load_dashboard_shared_context(scope)
        if shared is not None:
            return shared, True
        if not got_lock:
            shared = wait_for_dashboard_shared_context(scope)
            if shared is not None:
                return shared, True
        built = build()
        store_dashboard_shared_context(scope, built)
        return built, False


@contextmanager
def dashboard_shared_context_build_lock(scope: dict[str, Any]) -> Iterator[bool]:
    """
    Distributed build lock keyed on user/household/window/as-of/dashboard version.

    Yields True when this caller acquired the lock and should build; False when
    another worker is already building (caller should wait/recheck cache).
    """
    lock_key = get_dashboard_shared_context_lock_key(scope)
    got_lock = cache.add(lock_key, "1", timeout=_SHARED_CONTEXT_LOCK_TIMEOUT_SECONDS)
    try:
        yield got_lock
    finally:
        if got_lock:
            cache.delete(lock_key)
