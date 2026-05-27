"""
Recommendation DTOs — deterministic, explainable, not AI.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from recommendations.services.calculators import map_severity_to_dashboard

RECOMMENDATION_TYPES = frozenset(
    {
        "move_money",
        "pay_credit_card",
        "reduce_utilization",
        "delay_bill",
        "reduce_spending",
        "pause_subscription",
        "increase_goal_contribution",
        "decrease_goal_contribution",
        "avoid_purchase",
        "survival_mode",
        "debt_payoff",
        "restore_buffer",
        "reconcile_account",
    }
)


def make_recommendation(
    rec_id: str,
    rec_type: str,
    severity: str,
    title: str,
    description: str,
    *,
    recommended_action: str | None = None,
    recommended_amount: str | None = None,
    recommended_date: str | None = None,
    account_id: int | None = None,
    related_account_id: int | None = None,
    transaction_id: int | None = None,
    rule_id: int | None = None,
    goal_id: int | None = None,
    impact_type: str | None = None,
    projected_improvement: str | None = None,
    priority_score: int = 0,
    why: str | None = None,
    impact_label: str | None = None,
    impact_value: str | None = None,
    primary_action_label: str | None = None,
    primary_action_url: str | None = None,
    primary_action_type: str | None = None,
    secondary_action_label: str | None = None,
    secondary_action_url: str | None = None,
    secondary_action_type: str | None = None,
) -> dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    message = description
    if why and why not in description:
        message = f"{description}\n\nReason: {why}"
    return {
        "id": rec_id,
        "type": rec_type,
        "severity": severity,
        "severity_dashboard": map_severity_to_dashboard(severity),
        "title": title,
        "description": description,
        "why": why or description,
        "recommended_action": recommended_action,
        "recommended_amount": recommended_amount,
        "recommended_date": recommended_date,
        "account_id": account_id,
        "related_account_id": related_account_id,
        "transaction_id": transaction_id,
        "rule_id": rule_id,
        "goal_id": goal_id,
        "impact_type": impact_type,
        "projected_improvement": projected_improvement,
        "priority_score": priority_score,
        "impact_label": impact_label,
        "impact_value": impact_value,
        "primary_action_label": primary_action_label,
        "primary_action_url": primary_action_url,
        "primary_action_type": primary_action_type,
        "secondary_action_label": secondary_action_label,
        "secondary_action_url": secondary_action_url,
        "secondary_action_type": secondary_action_type,
        "dismissed": False,
        "created_at": now,
        "updated_at": now,
    }


def to_dashboard_recommendation(rec: dict[str, Any]) -> dict[str, Any]:
    """Strip to dashboard wire format while preserving extended fields for clients that read them."""
    severity = rec.get("severity_dashboard") or rec.get("severity", "info")
    out = {
        "id": rec["id"],
        "severity": severity,
        "title": rec["title"],
        "why": rec.get("why") or rec.get("description", ""),
        "recommended_action": rec.get("recommended_action"),
        "impact_label": rec.get("impact_label"),
        "impact_value": rec.get("impact_value"),
        "primary_action_label": rec.get("primary_action_label"),
        "primary_action_url": rec.get("primary_action_url"),
        "primary_action_type": rec.get("primary_action_type"),
        "secondary_action_label": rec.get("secondary_action_label"),
        "secondary_action_url": rec.get("secondary_action_url"),
        "secondary_action_type": rec.get("secondary_action_type"),
        "type": rec.get("type"),
        "priority_score": rec.get("priority_score", 0),
        "recommended_amount": rec.get("recommended_amount"),
        "recommended_date": rec.get("recommended_date"),
        "account_id": rec.get("account_id"),
        "related_account_id": rec.get("related_account_id"),
        "rule_id": rec.get("rule_id"),
        "goal_id": rec.get("goal_id"),
        "impact_type": rec.get("impact_type"),
        "projected_improvement": rec.get("projected_improvement"),
    }
    return out
