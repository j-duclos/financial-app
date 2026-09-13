"""Exclusive cache-miss forecast-build stage timings.

Counts and milliseconds only — never payees, amounts, descriptions,
account names, or other personally identifying financial data.
"""
from __future__ import annotations

import time
from contextvars import ContextVar
from typing import Any

from common.services.profiler import PerfTimer, QueryProfiler, perf_enabled, perf_print, phase_end, phase_start

_CURRENT: ContextVar["ForecastBuildPerf | None"] = ContextVar("forecast_build_perf", default=None)
_LAST: dict[str, Any] | None = None

# Exclusive stages that previously lived under the coarse ``setup`` timer.
SETUP_STAGE_NAMES = (
    "accounts",
    "other_setup",
    "balance_preload",
    "scenario_lookup",
    "window_transactions",
    "matching_inputs",
    "skips_load",
    "transfer_maps",
    "account_metadata",
    "opening_balances",
)


def last_forecast_build_perf() -> dict[str, Any] | None:
    return _LAST


def current_forecast_build_perf() -> ForecastBuildPerf | None:
    return _CURRENT.get()


def reset_forecast_build_perf() -> None:
    global _LAST
    _LAST = None
    _CURRENT.set(None)


class ForecastBuildPerf:
    def __init__(self, query_profiler: QueryProfiler | None) -> None:
        self.qp = query_profiler
        self.stages: dict[str, dict[str, Any]] = {}
        self.sorts: list[dict[str, Any]] = []
        self.counts: dict[str, Any] = {}
        self.walk: dict[str, Any] = {}
        self.cache_write: dict[str, Any] = {}
        self.wall_start = time.perf_counter()
        self._open: dict[str, dict[str, Any]] = {}
        self._token = _CURRENT.set(self)

    def close(self) -> None:
        try:
            _CURRENT.reset(self._token)
        except (ValueError, RuntimeError):
            _CURRENT.set(None)

    def begin_stage(self, name: str, timer: PerfTimer | None) -> None:
        self._open[name] = {
            "t0": time.perf_counter(),
            "q0": self.qp.query_count if self.qp is not None else 0,
            "s0": self.qp.query_time_ms if self.qp is not None else 0.0,
            "token": phase_start(timer, name),
            "timer": timer,
        }

    def end_stage(self, name: str, extra: dict[str, Any] | None = None) -> None:
        opened = self._open.pop(name, None)
        if opened is None:
            return
        phase_end(opened["timer"], opened["token"])
        total_ms = (time.perf_counter() - opened["t0"]) * 1000
        sql_ms = (
            ((self.qp.query_time_ms if self.qp is not None else 0.0) - opened["s0"])
        )
        queries = (self.qp.query_count if self.qp is not None else 0) - opened["q0"]
        rec: dict[str, Any] = {
            "total_ms": total_ms,
            "sql_ms": sql_ms,
            "python_ms": max(0.0, total_ms - sql_ms),
            "queries": queries,
        }
        if extra:
            rec.update(extra)
            for key, value in extra.items():
                if isinstance(value, (int, float)):
                    self.counts[key] = value
        self.stages[name] = rec

    def record_sort(self, *, sort_key: str, n_rows: int, elapsed_ms: float) -> None:
        self.sorts.append(
            {
                "sort_key": sort_key,
                "rows_per_sort": n_rows,
                "sort_ms": elapsed_ms,
            }
        )

    def record_walk(
        self,
        *,
        total_ms: float,
        anchor_ms: float,
        python_walk_ms: float,
        sql_ms: float,
        queries: int,
        accounts: int,
        rows: int,
    ) -> None:
        self.walk = {
            "total_ms": total_ms,
            "anchor_ms": anchor_ms,
            "python_walk_ms": python_walk_ms,
            "sql_ms": sql_ms,
            "queries": queries,
            "accounts": accounts,
            "rows": rows,
        }

    def record_cache_write(
        self,
        *,
        cache_serialize_ms: float,
        cache_write_ms: float,
        cached_rows: int,
        cached_bytes: int,
    ) -> None:
        self.cache_write = {
            "cache_serialize_ms": cache_serialize_ms,
            "cache_write_ms": cache_write_ms,
            "cached_rows": cached_rows,
            "cached_bytes": cached_bytes,
        }

    def setup_ms(self) -> float:
        return sum(self.stages.get(name, {}).get("total_ms", 0.0) for name in SETUP_STAGE_NAMES)

    def stages_total_ms(self) -> float:
        return sum(rec.get("total_ms", 0.0) for rec in self.stages.values())

    def snapshot(self, *, rows: int, total_ms: float | None = None) -> dict[str, Any]:
        elapsed = total_ms if total_ms is not None else (time.perf_counter() - self.wall_start) * 1000
        setup_ms = self.setup_ms()
        explained = self.stages_total_ms()
        walk_ms = float(self.walk.get("total_ms", 0.0) or 0.0)
        cache_ms = float(self.cache_write.get("cache_write_ms", 0.0) or 0.0) + float(
            self.cache_write.get("cache_serialize_ms", 0.0) or 0.0
        )
        explained_with_post = explained + walk_ms + cache_ms
        data = {
            "rows": rows,
            "total_ms": elapsed,
            "setup_ms": setup_ms,
            "stages": {name: dict(rec) for name, rec in self.stages.items()},
            "sorts": list(self.sorts),
            "sort_count": len(self.sorts),
            "counts": dict(self.counts),
            "walk": dict(self.walk),
            "cache_write": dict(self.cache_write),
            "explained_build_ms": explained,
            "explained_miss_ms": explained_with_post,
            "unexplained_build_ms": max(0.0, elapsed - explained_with_post),
        }
        return data

    def emit(self, *, rows: int, total_ms: float | None = None, label: str = "forecast-build-perf") -> dict[str, Any]:
        global _LAST
        data = self.snapshot(rows=rows, total_ms=total_ms)
        _LAST = data
        if not perf_enabled():
            return data
        setup_ms = data["setup_ms"]
        parts = [
            f"[{label}]",
            f"rows={data['rows']}",
            f"total_ms={data['total_ms']:.0f}",
            f"setup_ms={setup_ms:.0f}",
        ]
        for name in SETUP_STAGE_NAMES:
            rec = data["stages"].get(name)
            if rec is None:
                continue
            parts.append(f"{name}={rec['total_ms']:.0f}")
        for name, rec in data["stages"].items():
            if name in SETUP_STAGE_NAMES:
                continue
            parts.append(f"{name}={rec['total_ms']:.0f}")
        if data["walk"]:
            parts.append(f"canonical_balance_after={data['walk'].get('total_ms', 0):.0f}")
            parts.append(f"walk_anchor={data['walk'].get('anchor_ms', 0):.0f}")
            parts.append(f"walk_python={data['walk'].get('python_walk_ms', 0):.0f}")
        if data["cache_write"]:
            parts.append(f"cache_serialize={data['cache_write'].get('cache_serialize_ms', 0):.0f}")
            parts.append(f"cache_write={data['cache_write'].get('cache_write_ms', 0):.0f}")
            parts.append(f"cached_rows={data['cache_write'].get('cached_rows', 0)}")
            parts.append(f"cached_bytes={data['cache_write'].get('cached_bytes', 0)}")
        counts = data["counts"]
        for key in (
            "accounts",
            "preload_ledger_rows",
            "db_transactions",
            "window_tx_loaded",
            "window_tx_retained",
            "load_tx_appended",
            "recurring_rules",
            "generated_occurrences",
            "existing_occurrences",
            "retained_occurrences",
            "interest_rows",
            "interest_accounts",
            "interest_days",
            "transfer_rows",
            "manual_rows",
            "final_timeline_rows",
        ):
            if key in counts:
                parts.append(f"{key}={counts[key]}")
        if data["sorts"]:
            parts.append(f"sort_count={data['sort_count']}")
            parts.append(
                "sorts="
                + ",".join(
                    f"{s['sort_key']}:{s['rows_per_sort']}@{s['sort_ms']:.1f}"
                    for s in data["sorts"]
                )
            )
        perf_print(" ".join(str(p) for p in parts))
        for name, rec in data["stages"].items():
            extra = []
            for key, value in rec.items():
                if key in {"total_ms", "sql_ms", "python_ms", "queries"}:
                    continue
                extra.append(f"{key}={value}")
            extras = (" " + " ".join(extra)) if extra else ""
            perf_print(
                f"[{label}] stage={name} total_ms={rec['total_ms']:.1f} "
                f"sql_ms={rec['sql_ms']:.1f} python_ms={rec['python_ms']:.1f} "
                f"queries={rec['queries']}{extras}"
            )
        return data


def begin_forecast_stage(fbp: ForecastBuildPerf | None, timer: PerfTimer | None, name: str):
    if fbp is not None:
        fbp.begin_stage(name, timer)
        return None
    return phase_start(timer, name)


def end_forecast_stage(
    fbp: ForecastBuildPerf | None,
    timer: PerfTimer | None,
    token,
    name: str,
    extra: dict[str, Any] | None = None,
) -> None:
    if fbp is not None:
        fbp.end_stage(name, extra)
        return
    phase_end(timer, token)


def timed_timeline_sort(rows: list, key, *, sort_key: str) -> None:
    fbp = current_forecast_build_perf()
    started = time.perf_counter()
    rows.sort(key=key)
    if fbp is not None:
        fbp.record_sort(
            sort_key=sort_key,
            n_rows=len(rows),
            elapsed_ms=(time.perf_counter() - started) * 1000,
        )
