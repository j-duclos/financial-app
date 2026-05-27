"""
Shared inputs for the recommendation engine.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Any

from accounts.models import Account


@dataclass
class RecommendationContext:
    user: Any
    today: date
    days: int
    accounts: list[Account]
    accounts_by_id: dict[int, Account]
    forecasts: dict[int, dict[str, Any]]
    st_aggregate: dict[str, Any]
    timeline_rows: list[dict[str, Any]]
    health_by_id: dict[int, dict[str, Any]]
    upcoming_events: list[dict[str, Any]] = field(default_factory=list)
    bills_summary: dict[str, Any] | None = None
    debt_summary: dict[str, Any] | None = None
    goals_aggregate: dict[str, Any] | None = None
    dashboard_goals: list[dict[str, Any]] = field(default_factory=list)
    recurring_rules: list[Any] = field(default_factory=list)
    rules_by_id: dict[int, Any] = field(default_factory=dict)
    scenario_id: int | None = None
    survival_mode: bool = False
