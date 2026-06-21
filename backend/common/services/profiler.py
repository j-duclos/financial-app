"""
Performance instrumentation for forecast and dashboard paths.

Enabled when settings.DEBUG or settings.ENABLE_PERF_LOGS is True.
Set ENABLE_PERF_LOGS=true on Render to emit [PERF] logs without DEBUG=True.

[PERF] lines are written to stdout (not Django logging) so Render captures them reliably.

SQL query stats use django.db.connection.queries (populated only when DEBUG=True).
"""
from __future__ import annotations

import time
from contextlib import contextmanager, nullcontext
from contextvars import ContextVar
from typing import Any, Iterator

from django.conf import settings
from django.db import connection


def perf_enabled() -> bool:
    return bool(getattr(settings, "DEBUG", False)) or bool(
        getattr(settings, "ENABLE_PERF_LOGS", False)
    )


def perf_print(message: str) -> None:
    """Emit a [PERF] line to stdout for Render log visibility."""
    if not perf_enabled():
        return
    print(message, flush=True)

_build_timeline_call_count: ContextVar[int] = ContextVar("build_timeline_call_count", default=0)
_build_timeline_callers: ContextVar[list[str]] = ContextVar("build_timeline_callers", default=[])
_projection_only_build: ContextVar[bool] = ContextVar("projection_only_build", default=False)
_materialized_transaction_count: ContextVar[int] = ContextVar("materialized_transaction_count", default=0)


def enter_build_timeline_context(*, projection_only: bool) -> None:
    """Track projection-only mode and materialized-transaction count for one build_timeline() call."""
    _projection_only_build.set(projection_only)
    _materialized_transaction_count.set(0)


def exit_build_timeline_context() -> None:
    """Reset build_timeline context vars."""
    _projection_only_build.set(False)
    _materialized_transaction_count.set(0)


def projection_only_build_active() -> bool:
    return _projection_only_build.get()


def record_materialized_transaction() -> None:
    count = _materialized_transaction_count.get() + 1
    _materialized_transaction_count.set(count)


def get_materialized_transaction_count() -> int:
    return _materialized_transaction_count.get()


_perf_caller: ContextVar[str | None] = ContextVar("perf_caller", default=None)


@contextmanager
def perf_caller_context(caller: str) -> Iterator[None]:
    """Tag build_timeline() calls for dashboard vs ledger vs other paths in [PERF] logs."""
    token = _perf_caller.set(caller)
    try:
        yield
    finally:
        _perf_caller.reset(token)


def get_perf_caller() -> str | None:
    return _perf_caller.get()


_materialization_active: ContextVar[bool] = ContextVar("materialization_active", default=False)
_materialization_rule_filter: ContextVar[frozenset[int] | None] = ContextVar(
    "materialization_rule_filter", default=None
)
_materialization_stats: ContextVar[dict[str, int]] = ContextVar(
    "materialization_stats",
    default={
        "rules_processed": 0,
        "occurrences_generated": 0,
        "transactions_created": 0,
        "transactions_updated": 0,
        "transactions_skipped": 0,
        "existing_loaded": 0,
    },
)


def enter_materialization_context(
    *,
    rules_processed: int,
    rule_ids: frozenset[int] | None = None,
) -> None:
    """Begin dedicated materialization run; track create/update/skip counts."""
    _materialization_active.set(True)
    _materialization_rule_filter.set(rule_ids)
    _materialization_stats.set(
        {
            "rules_processed": rules_processed,
            "occurrences_generated": 0,
            "transactions_created": 0,
            "transactions_updated": 0,
            "transactions_skipped": 0,
            "existing_loaded": 0,
        }
    )


def exit_materialization_context() -> dict[str, int]:
    """End materialization run and return summary counters."""
    summary = dict(_materialization_stats.get())
    _materialization_active.set(False)
    _materialization_rule_filter.set(None)
    _materialization_stats.set(
        {
            "rules_processed": 0,
            "occurrences_generated": 0,
            "transactions_created": 0,
            "transactions_updated": 0,
            "transactions_skipped": 0,
            "existing_loaded": 0,
        }
    )
    return summary


def materialization_active() -> bool:
    return _materialization_active.get()


def materialization_rule_filter() -> frozenset[int] | None:
    """When set, only these rule ids may create/update materialized rows."""
    return _materialization_rule_filter.get()


def should_materialize_rule(rule_id: int) -> bool:
    filt = materialization_rule_filter()
    return filt is None or rule_id in filt


def _bump_materialization_stat(key: str, delta: int = 1) -> None:
    if not materialization_active():
        return
    stats = dict(_materialization_stats.get())
    stats[key] = stats.get(key, 0) + delta
    _materialization_stats.set(stats)


def set_materialization_occurrences_generated(count: int) -> None:
    if not materialization_active():
        return
    stats = dict(_materialization_stats.get())
    stats["occurrences_generated"] = count
    _materialization_stats.set(stats)


def record_materialization_created() -> None:
    _bump_materialization_stat("transactions_created")


def record_materialization_updated() -> None:
    _bump_materialization_stat("transactions_updated")


def record_materialization_skipped() -> None:
    _bump_materialization_stat("transactions_skipped")


def set_materialization_existing_loaded(count: int) -> None:
    if not materialization_active():
        return
    stats = dict(_materialization_stats.get())
    stats["existing_loaded"] = count
    _materialization_stats.set(stats)


def reset_build_timeline_count() -> None:
    """Reset per-request build_timeline() counter (DEBUG instrumentation)."""
    _build_timeline_call_count.set(0)
    _build_timeline_callers.set([])


def increment_build_timeline_count(*, caller: str = "unknown") -> int:
    """Record one build_timeline() invocation; returns new count."""
    count = _build_timeline_call_count.get() + 1
    _build_timeline_call_count.set(count)
    callers = list(_build_timeline_callers.get())
    callers.append(caller)
    _build_timeline_callers.set(callers)
    return count


def get_build_timeline_count() -> int:
    """How many times build_timeline() ran in the current context."""
    return _build_timeline_call_count.get()


def get_build_timeline_callers() -> list[str]:
    """Ordered caller tags for each build_timeline() in the current context."""
    return list(_build_timeline_callers.get())

PhaseToken = tuple[str, float] | None


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
    parts = [f"[PERF] {label}"]
    for key, value in fields.items():
        parts.append(f"{key}={value}")
    if query_profiler is not None:
        parts.append(f"query_count={query_profiler.query_count}")
        parts.append(f"query_time_ms={query_profiler.query_time_ms:.0f}")
    if timer is not None:
        summary = timer.phase_summary()
        if summary:
            parts.append(summary)
    perf_print(" ".join(parts))


def log_elapsed(label: str, started_at: float, **fields: Any) -> None:
    if not perf_enabled():
        return
    elapsed_ms = (time.perf_counter() - started_at) * 1000
    log_perf(label, elapsed_ms=f"{elapsed_ms:.0f}", **fields)
