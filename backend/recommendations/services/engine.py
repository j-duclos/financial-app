"""
Recommendation engine — forecast-driven, rule-based financial co-pilot (not AI).
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from accounts.models import Account
from accounts.services.available_to_spend import (
    calculate_forecast_summaries_for_accounts,
    dashboard_safe_to_spend_aggregate,
    normalize_forecast_days,
)
from accounts.services.account_health import calculate_account_health_for_accounts
from core.utils import get_households_for_user
from recommendations.services.context import RecommendationContext
from recommendations.services.detectors import run_all_detectors
from recommendations.services.generators import generate_from_detection
from recommendations.services.serializers import to_dashboard_recommendation
from timeline.models import RecurringRule
from timeline.services.ledger import build_timeline

RECOMMENDATION_LIMIT = 8
DASHBOARD_RECOMMENDATION_LIMIT = 5


def build_recommendation_context(
    user,
    *,
    days: int = 30,
    as_of_date: date | None = None,
    scenario_id: int | None = None,
    timeline_rows: list[dict] | None = None,
    forecasts: dict[int, dict] | None = None,
    health_by_id: dict | None = None,
    accounts: list[Account] | None = None,
    st_aggregate: dict | None = None,
    upcoming_events: list | None = None,
    bills_summary: dict | None = None,
    debt_summary: dict | None = None,
    goals_aggregate: dict | None = None,
    dashboard_goals: list | None = None,
) -> RecommendationContext:
    days = normalize_forecast_days(days)
    today = as_of_date or date.today()
    window_end = today + timedelta(days=days)

    if accounts is None:
        households = get_households_for_user(user)
        accounts = list(
            Account.objects.non_deleted()
            .filter(household__in=households, is_hidden=False)
            .select_related("household")
        )
    accounts_by_id = {a.id: a for a in accounts}

    if timeline_rows is None:
        timeline_rows = build_timeline(
            user,
            start_date=today,
            end_date=window_end,
            as_of_date=today,
            scenario_id=scenario_id,
            projection_only=True,
            caller="forecast_summary",
        )

    forecast_accounts = [a for a in accounts if a.participates_in_forecast()]
    if forecasts is None:
        from accounts.services.available_to_spend import calculate_account_forecast_summary

        if timeline_rows is not None:
            forecasts = {
                account.id: calculate_account_forecast_summary(
                    user,
                    account,
                    as_of_date=today,
                    days=days,
                    timeline_rows=timeline_rows,
                )
                for account in accounts
            }
        else:
            forecasts = calculate_forecast_summaries_for_accounts(
                user,
                forecast_accounts,
                as_of_date=today,
                days=days,
            )

    if st_aggregate is None:
        st_aggregate = dashboard_safe_to_spend_aggregate(forecasts, accounts_by_id)

    if health_by_id is None:
        health_by_id = calculate_account_health_for_accounts(
            user, accounts, as_of_date=today, days=days
        )

    households = get_households_for_user(user)
    recurring_rules = list(
        RecurringRule.objects.filter(household__in=households, active=True).select_related(
            "account", "transfer_to_account", "category"
        )
    )
    rules_by_id = {r.id: r for r in recurring_rules}

    return RecommendationContext(
        user=user,
        today=today,
        days=days,
        accounts=accounts,
        accounts_by_id=accounts_by_id,
        forecasts=forecasts,
        st_aggregate=st_aggregate,
        timeline_rows=timeline_rows,
        health_by_id=health_by_id,
        upcoming_events=upcoming_events or [],
        bills_summary=bills_summary,
        debt_summary=debt_summary,
        goals_aggregate=goals_aggregate,
        dashboard_goals=dashboard_goals or [],
        recurring_rules=recurring_rules,
        rules_by_id=rules_by_id,
        scenario_id=scenario_id,
    )


def build_recommendations(
    ctx: RecommendationContext,
    *,
    limit: int = RECOMMENDATION_LIMIT,
) -> list[dict[str, Any]]:
    detections = run_all_detectors(ctx)
    recs = [generate_from_detection(d, ctx) for d in detections]

    try:
        from budgets.services.spending_targets import recommendations_from_spending_targets

        for legacy in recommendations_from_spending_targets(ctx.user, anchor=ctx.today, limit=3):
            if not any(r["id"] == legacy["id"] for r in recs):
                recs.append(_legacy_to_full(legacy))
    except Exception:
        pass

    recs.sort(key=lambda r: (-int(r.get("priority_score") or 0), r.get("title") or ""))
    return recs[:limit]


def _legacy_to_full(legacy: dict[str, Any]) -> dict[str, Any]:
    from recommendations.services.serializers import make_recommendation

    return make_recommendation(
        legacy["id"],
        "reduce_spending",
        legacy.get("severity", "warning") if legacy.get("severity") != "warning" else "medium",
        legacy.get("title", "Spending"),
        legacy.get("why", ""),
        why=legacy.get("why"),
        recommended_action=legacy.get("recommended_action"),
        impact_label=legacy.get("impact_label"),
        impact_value=legacy.get("impact_value"),
        primary_action_label=legacy.get("primary_action_label"),
        primary_action_url=legacy.get("primary_action_url"),
        primary_action_type=legacy.get("primary_action_type"),
        priority_score=400,
    )


def build_dashboard_recommendation_list(
    ctx: RecommendationContext,
    *,
    attention: list[dict[str, Any]] | None = None,
    insights: list[dict[str, Any]] | None = None,
    limit: int = DASHBOARD_RECOMMENDATION_LIMIT,
) -> list[dict[str, Any]]:
    """Merge engine recommendations with legacy attention/insight cards for dashboard."""
    from insights.services.dashboard_recommendations import (
        _recommendations_from_attention,
        _recommendations_from_insights,
    )

    engine_recs = [to_dashboard_recommendation(r) for r in build_recommendations(ctx, limit=limit + 3)]
    from_attention = _recommendations_from_attention(attention or [])
    seen = {r["id"] for r in from_attention}
    combined = list(from_attention)
    for rec in engine_recs:
        if rec["id"] not in seen:
            combined.append(rec)
            seen.add(rec["id"])
    if insights:
        for rec in _recommendations_from_insights(insights, skip_ids=seen):
            combined.append(rec)
            seen.add(rec["id"])

    def sort_key(r: dict) -> tuple:
        score = int(r.get("priority_score") or 0)
        sev_rank = {
            "critical": 0,
            "warning": 1,
            "high": 1,
            "medium": 2,
            "info": 3,
            "low": 4,
            "positive": 5,
        }.get(r.get("severity", "info"), 9)
        return (-score, sev_rank, r.get("title") or "")

    combined.sort(key=sort_key)
    return combined[:limit]


def build_scenario_recommendations(
    user,
    scenario_id: int,
    *,
    days: int = 90,
    as_of_date: date | None = None,
    limit: int = RECOMMENDATION_LIMIT,
) -> list[dict[str, Any]]:
    ctx = build_recommendation_context(
        user, days=days, as_of_date=as_of_date, scenario_id=scenario_id
    )
    recs = build_recommendations(ctx, limit=limit)
    return [to_dashboard_recommendation(r) for r in recs]


def recommendation_timeline_hints(
    recs: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Lightweight markers for timeline UI."""
    hints: list[dict[str, Any]] = []
    for rec in recs:
        d = rec.get("recommended_date")
        if not d:
            continue
        hints.append(
            {
                "date": d[:10],
                "recommendation_id": rec.get("id"),
                "title": rec.get("title"),
                "severity": rec.get("severity"),
                "type": rec.get("type"),
            }
        )
    return hints
