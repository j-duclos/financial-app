"""Assemble the unified monthly Reports payload from shared services."""
from __future__ import annotations

from typing import Any

from budgets.services.spending_targets import spending_targets_summary
from credit_cards.services.reports import build_credit_card_interest_report
from goals.bucket_services import build_goals_report
from insights.services.report_context import ReportContext, build_report_context
from insights.services.reporting import (
    _decimal,
    build_category_breakdown,
    comparison_payload,
    monthly_totals_by_month,
    serialize_month_totals,
    _empty_month_totals,
)
from insights.services.report_dates import month_key


def _top_expense_categories(breakdown: list[dict[str, Any]], *, limit: int = 5) -> list[dict[str, Any]]:
    expenses = [row for row in breakdown if _decimal(row["total"]) < 0]
    expenses.sort(key=lambda row: _decimal(row["total"]))
    return expenses[:limit]


def build_monthly_reports(
    user,
    month: str,
    *,
    history_months: int = 12,
    household_id: int | None = None,
    include_history: bool = False,
    context: ReportContext | None = None,
) -> dict[str, Any]:
    ctx = context or build_report_context(
        user, month, history_months=history_months, household_id=household_id
    )
    by_month = monthly_totals_by_month(ctx)
    current = by_month.get(ctx.period.month, _empty_month_totals())
    previous = by_month.get(month_key(ctx.period.previous_start), _empty_month_totals())
    overview_summary = serialize_month_totals(current, month=ctx.period.month)
    overview_summary["previous_month"] = month_key(ctx.period.previous_start)
    overview_summary["comparison"] = comparison_payload(current, previous)

    from insights.services.report_dates import add_months, month_start

    cursor = month_start(ctx.period.history_start.year, ctx.period.history_start.month)
    trend: list[dict[str, Any]] = []
    while cursor <= ctx.period.start:
        key = month_key(cursor)
        trend.append(serialize_month_totals(by_month.get(key, _empty_month_totals()), month=key))
        cursor = add_months(cursor, 1)

    categories = build_category_breakdown(ctx, include_previous=True)
    goals = build_goals_report(
        ctx.households,
        months=ctx.period.history_months,
        month=ctx.period.month,
        user=user,
        include_history=include_history,
    )
    spending_limits = spending_targets_summary(
        user,
        anchor=ctx.period.anchor,
        households=ctx.households,
        household_ids=ctx.household_ids,
    )
    debt = build_credit_card_interest_report(user, month=ctx.period.month, context=ctx)

    goals_summary = goals.get("summary") or {}
    return {
        "month": ctx.period.month,
        "period": {
            "start": ctx.period.start.isoformat(),
            "end": ctx.period.end.isoformat(),
            "previous_start": ctx.period.previous_start.isoformat(),
            "previous_end": ctx.period.previous_end.isoformat(),
            "history_start": ctx.period.history_start.isoformat(),
            "history_end": ctx.period.history_end.isoformat(),
        },
        "overview": {
            **overview_summary,
            "trend": trend,
            "top_expense_categories": _top_expense_categories(categories["breakdown"]),
            "goals_snapshot": {
                "total_saved": goals_summary.get("total_saved"),
                "total_target": goals_summary.get("total_target"),
                "monthly_needed_total": goals_summary.get("monthly_needed_total"),
                "goals_on_track": goals_summary.get("goals_on_track"),
                "goals_active_count": goals_summary.get("goals_active_count"),
            },
            "debt_snapshot": {
                "total_interest_paid": debt.get("total_interest_paid"),
                "total_projected_interest_remaining": debt.get(
                    "total_projected_interest_remaining"
                ),
                "highest_apr_card": debt.get("highest_apr_card"),
                "highest_utilization_card": debt.get("highest_utilization_card"),
            },
        },
        "category_breakdown": categories,
        "goals": goals,
        "spending_limits": spending_limits,
        "debt": debt,
    }


__all__ = ["build_monthly_reports"]
