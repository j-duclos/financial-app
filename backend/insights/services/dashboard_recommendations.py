"""
Deterministic dashboard recommendations — rule-based, not AI.
Merges high-priority attention items with insight cards into a single ranked list.
"""
from __future__ import annotations

from decimal import Decimal
from typing import Any

from accounts.services.account_health_constants import (
    HEALTH_STATUS_CRITICAL,
    HEALTH_STATUS_RISK,
)
from accounts.services.available_to_spend import _decimal

RECOMMENDATION_LIMIT = 5

SEVERITY_RANK = {
    "critical": 0,
    "warning": 1,
    "info": 2,
    "positive": 3,
}


def _rec(
    rec_id: str,
    severity: str,
    title: str,
    why: str,
    *,
    recommended_action: str | None = None,
    impact_label: str | None = None,
    impact_value: str | None = None,
    primary_action_label: str | None = None,
    primary_action_url: str | None = None,
    primary_action_type: str | None = None,
    secondary_action_label: str | None = None,
    secondary_action_url: str | None = None,
    secondary_action_type: str | None = None,
) -> dict[str, Any]:
    return {
        "id": rec_id,
        "severity": severity,
        "title": title,
        "why": why,
        "recommended_action": recommended_action,
        "impact_label": impact_label,
        "impact_value": impact_value,
        "primary_action_label": primary_action_label,
        "primary_action_url": primary_action_url,
        "primary_action_type": primary_action_type,
        "secondary_action_label": secondary_action_label,
        "secondary_action_url": secondary_action_url,
        "secondary_action_type": secondary_action_type,
    }


def _attention_severity(status: str) -> str:
    if status == HEALTH_STATUS_CRITICAL:
        return "critical"
    if status == HEALTH_STATUS_RISK:
        return "warning"
    return "info"


def _recommendations_from_attention(
    attention: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for att in attention:
        status = att.get("status", "watch")
        if status == "healthy":
            continue
        aid = att.get("account_id")
        if aid is None:
            continue
        why = (att.get("reason") or "").strip()
        action = (att.get("recommended_action") or "").strip()
        if not why and not action:
            continue
        amount = att.get("amount")
        impact_label = "Amount" if amount else None
        impact_value = f"${amount}" if amount else None
        secondary = att.get("secondary_action") or {}
        primary = att.get("primary_action") or {}
        out.append(
            _rec(
                f"attention-{aid}",
                _attention_severity(status),
                att.get("account_name") or "Account",
                why or action,
                recommended_action=action or None,
                impact_label=impact_label,
                impact_value=impact_value,
                primary_action_label=primary.get("label") or "Open ledger",
                primary_action_url=primary.get("url") or "/transactions",
                primary_action_type=primary.get("type") or "open_ledger",
                secondary_action_label=secondary.get("label"),
                secondary_action_url=secondary.get("url"),
                secondary_action_type=secondary.get("type"),
            )
        )
    return out


def _recommendations_from_insights(
    insights: list[dict[str, Any]],
    *,
    skip_ids: set[str],
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for ins in insights:
        rid = ins.get("id")
        if not rid or rid in skip_ids:
            continue
        out.append(
            _rec(
                str(rid),
                ins.get("severity", "info"),
                ins.get("title") or "Recommendation",
                ins.get("message") or "",
                recommended_action=ins.get("recommended_action") or ins.get("action_label"),
                impact_label=ins.get("metric_label"),
                impact_value=ins.get("metric_value"),
                primary_action_label=ins.get("action_label"),
                primary_action_url=ins.get("action_url"),
                primary_action_type="navigate",
                secondary_action_label=ins.get("secondary_action_label"),
                secondary_action_url=ins.get("secondary_action_url"),
                secondary_action_type="navigate",
            )
        )
    return out


def build_dashboard_recommendations(
    attention: list[dict[str, Any]],
    insights: list[dict[str, Any]],
    *,
    user=None,
    limit: int = RECOMMENDATION_LIMIT,
) -> list[dict[str, Any]]:
    from_attention = _recommendations_from_attention(attention)
    seen = {r["id"] for r in from_attention}
    from_insights = _recommendations_from_insights(insights, skip_ids=seen)
    combined = from_attention + from_insights
    seen.update(r["id"] for r in combined)
    if user is not None:
        from budgets.services.spending_targets import recommendations_from_spending_targets

        for rec in recommendations_from_spending_targets(user, limit=3):
            if rec["id"] not in seen:
                combined.append(rec)
                seen.add(rec["id"])
    combined.sort(
        key=lambda r: (
            SEVERITY_RANK.get(r.get("severity", "info"), 9),
            r.get("title") or "",
        )
    )
    return combined[:limit]
