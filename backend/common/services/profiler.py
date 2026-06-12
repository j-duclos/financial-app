"""
Performance instrumentation for forecast and dashboard paths.

Enabled when settings.DEBUG or settings.ENABLE_PERF_LOGS is True.
Set ENABLE_PERF_LOGS=true on Render to emit [PERF] logs without DEBUG=True.

SQL query stats use django.db.connection.queries (populated only when DEBUG=True).
"""
from __future__ import annotations

import logging
import time
from contextlib import contextmanager, nullcontext
from contextvars import ContextVar
from typing import Any, Iterator

from django.conf import settings
from django.db import connection

logger = logging.getLogger(__name__)

_build_timeline_call_count: ContextVar[int] = ContextVar("build_timeline_call_count", default=0)


def reset_build_timeline_count() -> None:
    """Reset per-request build_timeline() counter (DEBUG instrumentation)."""
    _build_timeline_call_count.set(0)


def increment_build_timeline_count() -> int:
    """Record one build_timeline() invocation; returns new count."""
    count = _build_timeline_call_count.get() + 1
    _build_timeline_call_count.set(count)
    return count


def get_build_timeline_count() -> int:
    """How many times build_timeline() ran in the current context."""
    return _build_timeline_call_count.get()

PhaseToken = tuple[str, float] | None


def perf_enabled() -> bool:
    return bool(getattr(settings, "DEBUG", False)) or bool(
        getattr(settings, "ENABLE_PERF_LOGS", False)
    )


class PerfTimer:
    """Accumulates named phase durations in milliseconds."""

    def __init__(self) -> None:
        self.phases: dict[str, float] = {}

    def add(self, name: str, elapsed_ms: float) -> None:
        self.phases[name] = self.phases.get(name, 0.0) + elapsed_ms

    def phase_summary(self) -> str:
        if not self.phases:
            return ""
        return " ".join(f"{name}={elapsed:.0f}ms" for name, elapsed in self.phases.items())


class QueryProfiler:
    """Snapshot SQL query count and cumulative DB time within a scope."""

    def __init__(self) -> None:
        self.query_count = 0
        self.query_time_ms = 0.0
        self._start_idx = 0

    def start(self) -> None:
        if perf_enabled():
            self._start_idx = len(connection.queries)

    def stop(self) -> None:
        if not perf_enabled():
            return
        queries = connection.queries[self._start_idx :]
        self.query_count = len(queries)
        self.query_time_ms = sum(float(q.get("time", 0)) for q in queries) * 1000


def phase_start(timer: PerfTimer | None, name: str) -> PhaseToken:
    if timer is None:
        return None
    return (name, time.perf_counter())


def phase_end(timer: PerfTimer | None, token: PhaseToken) -> None:
    if timer is None or token is None:
        return
    name, started = token
    timer.add(name, (time.perf_counter() - started) * 1000)


@contextmanager
def timed_block(name: str, timer: PerfTimer | None) -> Iterator[None]:
    token = phase_start(timer, name)
    try:
        yield
    finally:
        phase_end(timer, token)


def log_perf(
    label: str,
    *,
    timer: PerfTimer | None = None,
    query_profiler: QueryProfiler | None = None,
    **fields: Any,
) -> None:
    if not perf_enabled():
        return
    lines = [f"[PERF] {label}"]
    for key, value in fields.items():
        lines.append(f"{key}={value}")
    if query_profiler is not None:
        lines.append(f"query_count={query_profiler.query_count}")
        lines.append(f"query_time_ms={query_profiler.query_time_ms:.0f}")
    if timer is not None:
        summary = timer.phase_summary()
        if summary:
            lines.append(summary)
    logger.info("\n".join(lines))


def log_elapsed(label: str, started_at: float, **fields: Any) -> None:
    if not perf_enabled():
        return
    elapsed_ms = (time.perf_counter() - started_at) * 1000
    log_perf(label, elapsed_ms=f"{elapsed_ms:.0f}", **fields)
