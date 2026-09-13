"""Cheap counters for canonical-identity / participation profiling.

Increments are integers only — never payees, amounts, or account names.
"""
from __future__ import annotations

from typing import Any

_STATS: dict[str, Any] = {
    "participation_calls": 0,
    "participation_fallback_calls": 0,
    "sibling_scan_calls": 0,
    "matched_rule_lookup_calls": 0,
    "resolve_work_calls": 0,
    "participation_ms": 0.0,
}


def reset_identity_stats() -> None:
    _STATS["participation_calls"] = 0
    _STATS["participation_fallback_calls"] = 0
    _STATS["sibling_scan_calls"] = 0
    _STATS["matched_rule_lookup_calls"] = 0
    _STATS["resolve_work_calls"] = 0
    _STATS["participation_ms"] = 0.0


def identity_stats() -> dict[str, Any]:
    return dict(_STATS)


def incr(key: str, n: int = 1) -> None:
    _STATS[key] = _STATS.get(key, 0) + n


def add_ms(key: str, ms: float) -> None:
    _STATS[key] = float(_STATS.get(key, 0.0)) + ms
