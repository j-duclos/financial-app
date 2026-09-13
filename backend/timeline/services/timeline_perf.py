"""Stage timing and query classification for GET /api/timeline/.

Logs contain counts and milliseconds only — never payees, amounts, tokens,
or account names.
"""
from __future__ import annotations

import time
from contextlib import contextmanager
from typing import Any, Iterator

from django.db import connection

from common.services.profiler import perf_enabled, perf_print

_LAST: dict[str, Any] | None = None

STAGE_KEYS = (
    "cache_lookup_ms",
    "cache_copy_ms",
    "identity_ms",
    "filter_ms",
    "slice_ms",
    "running_balances_ms",
    "anchor_ms",
    "past_opening_ms",
    "balance_walk_ms",
    "account_summary_ms",
    "serialization_ms",
    "forecast_build_ms",
)


def last_timeline_perf() -> dict[str, Any] | None:
    return _LAST


def classify_sql(sql: str) -> str:
    s = sql.lower().replace('"', "").replace("`", "")
    if "timeline_recurring" in s or "recurringrule" in s:
        return "rules"
    if "transactions_transactionmatch" in s or "transaction_match" in s:
        return "matching"
    if "transactions_transaction" in s or "transactions_transfer" in s:
        return "transactions"
    if "accounts_account" in s:
        return "accounts"
    if "core_householdmembership" in s or "core_household" in s:
        return "household"
    if "userprofile" in s or "core_userprofile" in s:
        return "preferences"
    if "posted" in s and "pending" in s:
        return "anchors"
    return "other"


class TimelineRequestPerf:
    """Exclusive stage timer + SQL capture for one /api/timeline/ request."""

    def __init__(self) -> None:
        self.t0 = time.perf_counter()
        self.stages: dict[str, float] = {k: 0.0 for k in STAGE_KEYS}
        self.meta: dict[str, Any] = {}
        self.sql: list[str] = []
        self._wrapper = None

    def start_queries(self) -> None:
        def _wrap(execute, sql, params, many, context):
            self.sql.append(str(sql))
            return execute(sql, params, many, context)

        self._wrapper = _wrap
        connection.execute_wrappers.append(self._wrapper)

    def stop_queries(self) -> None:
        if self._wrapper is None:
            return
        try:
            connection.execute_wrappers.remove(self._wrapper)
        except ValueError:
            pass
        self._wrapper = None

    @contextmanager
    def stage(self, key: str) -> Iterator[None]:
        started = time.perf_counter()
        try:
            yield
        finally:
            self.stages[key] = self.stages.get(key, 0.0) + (time.perf_counter() - started) * 1000

    def query_groups(self) -> dict[str, int]:
        groups = {
            "anchors": 0,
            "accounts": 0,
            "household": 0,
            "preferences": 0,
            "rules": 0,
            "transactions": 0,
            "matching": 0,
            "other": 0,
        }
        for sql in self.sql:
            bucket = classify_sql(sql)
            if bucket == "accounts" and "balance" in sql.lower():
                groups["anchors"] += 1
            else:
                groups[bucket] = groups.get(bucket, 0) + 1
        return groups

    def finish(self) -> dict[str, Any]:
        self.stop_queries()
        total = (time.perf_counter() - self.t0) * 1000
        accounted = sum(self.stages.values())
        other_ms = max(0.0, total - accounted)
        groups = self.query_groups()
        payload = {
            "total_ms": round(total, 1),
            "other_ms": round(other_ms, 1),
            "db_queries": len(self.sql),
            "query_groups": groups,
            **{k: round(v, 1) for k, v in self.stages.items()},
            **self.meta,
        }
        global _LAST
        _LAST = payload
        if perf_enabled():
            self._emit(payload)
        return payload

    def _emit(self, payload: dict[str, Any]) -> None:
        g = payload.get("query_groups") or {}
        perf_print(
            "[timeline-perf] "
            f"total={payload['total_ms']:.0f}ms "
            f"cache_hit={str(payload.get('cache_hit', '')).lower()} "
            f"copy={payload.get('cache_copy_ms', 0):.0f}ms "
            f"identity={payload.get('identity_ms', 0):.0f}ms "
            f"filter={payload.get('filter_ms', 0):.0f}ms "
            f"slice={payload.get('slice_ms', 0):.0f}ms "
            f"anchors={payload.get('anchor_ms', 0):.0f}ms "
            f"past_opening={payload.get('past_opening_ms', 0):.0f}ms "
            f"walk={payload.get('balance_walk_ms', 0):.0f}ms "
            f"summary={payload.get('account_summary_ms', 0):.0f}ms "
            f"serialization={payload.get('serialization_ms', 0):.0f}ms "
            f"forecast_build={payload.get('forecast_build_ms', 0):.0f}ms "
            f"running_balances={payload.get('running_balances_ms', 0):.0f}ms "
            f"other={payload['other_ms']:.0f}ms "
            f"rows_source={payload.get('source_rows', 0)} "
            f"rows_returned={payload.get('returned_rows', 0)} "
            f"requested_accounts={payload.get('requested_accounts', 0)} "
            f"household_accounts={payload.get('household_accounts', 0)} "
            f"date_span_days={payload.get('date_span_days', 0)} "
            f"queries={payload['db_queries']} "
            f"q_anchors={g.get('anchors', 0)} "
            f"q_accounts={g.get('accounts', 0)} "
            f"q_household={g.get('household', 0)} "
            f"q_preferences={g.get('preferences', 0)} "
            f"q_rules={g.get('rules', 0)} "
            f"q_transactions={g.get('transactions', 0)} "
            f"q_matching={g.get('matching', 0)} "
            f"q_other={g.get('other', 0)}"
        )
