"""
Recommendation engine — forecast-driven, rule-based financial co-pilot (not AI).
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from accounts.models import Account
from accounts.services.account_health import (
    build_account_health_context,
    calculate_account_health_for_accounts,
)
from accounts.services.available_to_spend import (
    calculate_forecast_summaries_for_accounts,
    dashboard_safe_to_spend_aggregate,
    normalize_forecast_days,
)
from accounts.services.balances import bulk_signed_ledger_balances
from insights.services.dashboard_context import (
    build_dashboard_request_context,
    dashboard_shared_context_scope,
    load_dashboard_shared_context,
)
from recommendations.services.context import (
    RecommendationContext,
    index_timeline_rows,
    owed_balances_from_signed,
)
from recommendations.services.detectors import run_all_detectors
from recommendations.services.generators import generate_from_detection
from recommendations.services.serializers import to_dashboard_recommendation
from timeline.models import RecurringRule
from timeline.services.ledger import build_timeline

RECOMMENDATION_LIMIT = 8
DASHBOARD_RECOMMENDATION_LIMIT = 5


def _load_active_recurring_rules(household_ids: list[int]) -> tuple[list, dict[int, Any]]:
    if not household_ids:
        return [], {}
    rules = list(
        RecurringRule.objects.filter(household_id__in=household_ids, active=True).select_related(
            "account", "transfer_to_account", "category"
        )
    )
    return rules, {rule.id: rule for rule in rules}


def _load_goals_payload(
    user,
    *,
    households,
    household_ids: list[int],
    today: date,
    signed_balances: dict,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    from goals.bucket_services import (
        PRIORITY_ORDER,
        calculate_aggregate_bucket_summary_from_results,
        calculate_goal_bucket_results,
    )
    from goals.models import GoalBucket

    active_buckets = list(
        GoalBucket.objects.filter(
            household_id__in=household_ids,
            status__in=(GoalBucket.Status.ACTIVE, GoalBucket.Status.PAUSED),
        )
        .select_related("linked_account")
        .prefetch_related("rule_allocations__rule")
    )
    goal_results = calculate_goal_bucket_results(
        active_buckets,
        user=user,
        today=today,
        signed_balances=signed_balances,
    )
    goals_aggregate = calculate_aggregate_bucket_summary_from_results(goal_results)
    sorted_buckets = sorted(
        active_buckets,
        key=lambda bucket: (PRIORITY_ORDER.get(bucket.priority, 9), -bucket.created_at.timestamp()),
    )
    results_by_id = {row["id"]: row for row in goal_results}
    dashboard_goals = [
        results_by_id[bucket.id] for bucket in sorted_buckets[:3] if bucket.id in results_by_id
    ]
    return goals_aggregate, dashboard_goals


def _load_debt_summary(
    user,
    accounts: list[Account],
    *,
    today: date,
    signed_balances: dict,
    household_ids: list[int],
) -> dict[str, Any] | None:
    from credit_cards.services.debt_engine import build_dashboard_debt_summary
    from insights.services.dashboard_summary import calculate_dashboard_debt_metrics

    credit_cards = [account for account in accounts if account.is_credit_card()]
    debt_accounts = [
        account
        for account in accounts
        if account.status == Account.Status.ACTIVE
        and (
            account.account_type == Account.AccountType.CREDIT
            or account.role in (Account.AccountRole.CREDIT_CARD, Account.AccountRole.LOAN)
        )
    ]
    if not credit_cards and not debt_accounts:
        return None
    debt_metrics = calculate_dashboard_debt_metrics(
        debt_accounts, signed_balances, today=today
    )
    return build_dashboard_debt_summary(
        credit_cards,
        as_of=today,
        balance_by_account=signed_balances,
        user_id=user.pk,
        household_ids=household_ids,
        debt_metrics=debt_metrics,
    )


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
    signed_balances: dict | None = None,
    households=None,
    household_ids: list[int] | None = None,
    spending_targets_summary: dict | None = None,
    recurring_rules: list | None = None,
    rules_by_id: dict | None = None,
) -> RecommendationContext:
    days = normalize_forecast_days(days)
    today = as_of_date or date.today()
    window_end = today + timedelta(days=days)

    if accounts is None:
        request_ctx = build_dashboard_request_context(
            user,
            today=today,
            days=days,
            households=households,
            household_ids=household_ids,
            include_health_support=False,
        )
        households = request_ctx.households
        household_ids = request_ctx.household_ids
        accounts = request_ctx.accounts
        accounts_by_id = request_ctx.accounts_by_id
    else:
        accounts_by_id = {account.id: account for account in accounts}
        if household_ids is None:
            household_ids = sorted(
                {account.household_id for account in accounts if account.household_id}
            )
        if households is None:
            households = list(
                {account.household for account in accounts if getattr(account, "household", None)}
            )

    household_ids = list(household_ids or [])

    shared = None
    if (
        scenario_id is None
        and timeline_rows is None
        and forecasts is None
        and health_by_id is None
    ):
        shared = load_dashboard_shared_context(
            dashboard_shared_context_scope(
                user, days=days, as_of_date=today, household_ids=household_ids
            )
        )
        if shared:
            cached_timeline = shared.get("timeline_rows")
            cached_forecasts = shared.get("forecasts")
            cached_health = shared.get("health_by_id")
            if cached_timeline is not None:
                timeline_rows = cached_timeline
            if cached_forecasts is not None:
                forecasts = cached_forecasts
            if cached_health is not None:
                health_by_id = cached_health

    if signed_balances is None:
        signed_balances = bulk_signed_ledger_balances(accounts, today)
    owed_balances = owed_balances_from_signed(signed_balances)

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

    if forecasts is None:
        forecasts = calculate_forecast_summaries_for_accounts(
            user,
            accounts,
            as_of_date=today,
            days=days,
            timeline_rows=timeline_rows,
        )

    if st_aggregate is None:
        st_aggregate = dashboard_safe_to_spend_aggregate(
            accounts_by_id,
            user=user,
            forecast_summaries=forecasts,
            timeline_rows=timeline_rows,
            as_of_date=today,
            days=days,
        )

    if health_by_id is None:
        health_context = build_account_health_context(
            accounts, today=today, signed_balances=signed_balances
        )
        health_by_id = calculate_account_health_for_accounts(
            user,
            accounts,
            as_of_date=today,
            days=days,
            timeline_rows=timeline_rows,
            forecast_summaries=forecasts,
            context=health_context,
        )

    if recurring_rules is None or rules_by_id is None:
        recurring_rules, rules_by_id = _load_active_recurring_rules(household_ids)

    if goals_aggregate is None or dashboard_goals is None:
        loaded_aggregate, loaded_goals = _load_goals_payload(
            user,
            households=households,
            household_ids=household_ids,
            today=today,
            signed_balances=signed_balances,
        )
        if goals_aggregate is None:
            goals_aggregate = loaded_aggregate
        if dashboard_goals is None:
            dashboard_goals = loaded_goals

    if debt_summary is None:
        debt_summary = _load_debt_summary(
            user,
            accounts,
            today=today,
            signed_balances=signed_balances,
            household_ids=household_ids,
        )

    if spending_targets_summary is None:
        from budgets.services.spending_targets import spending_targets_summary as load_spending_targets

        spending_targets_summary = load_spending_targets(
            user, anchor=today, household_ids=household_ids
        )

    timeline_by_account, inflows_by_account_date = index_timeline_rows(timeline_rows)

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
        signed_balances=signed_balances,
        owed_balances=owed_balances,
        timeline_by_account=timeline_by_account,
        inflows_by_account_date=inflows_by_account_date,
        spending_targets_summary=spending_targets_summary,
        household_ids=household_ids,
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

        for legacy in recommendations_from_spending_targets(
            ctx.user,
            anchor=ctx.today,
            limit=3,
            summary=ctx.spending_targets_summary,
        ):
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
    comparison_context=None,
) -> list[dict[str, Any]]:
    if comparison_context is not None:
        ctx = build_recommendation_context(
            user,
            days=days,
            as_of_date=as_of_date or comparison_context.as_of_date,
            scenario_id=scenario_id,
            timeline_rows=comparison_context.scenario_rows,
            forecasts=comparison_context.scenario_forecasts_by_account,
            health_by_id=comparison_context.scenario_health_by_account,
            accounts=comparison_context.accounts,
            signed_balances=comparison_context.signed_balances,
            st_aggregate=comparison_context.scenario_sts,
            households=comparison_context.households,
            household_ids=comparison_context.household_ids,
            recurring_rules=comparison_context.recurring_rules,
            rules_by_id=comparison_context.rules_by_id,
        )
    else:
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
