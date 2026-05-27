"""
Turn detections into recommendation DTOs with explainable copy.
"""
from __future__ import annotations

from datetime import date

from recommendations.services.calculators import (
    format_money,
    format_short_date,
    latest_safe_transfer_date,
    priority_score,
)
from recommendations.services.context import RecommendationContext
from recommendations.services.detectors import Detection
from recommendations.services.serializers import make_recommendation


def generate_from_detection(det: Detection, ctx: RecommendationContext) -> dict:
    days_until = None
    if det.target_date:
        days_until = (det.target_date - ctx.today).days

    score = priority_score(
        severity=det.severity,
        days_until=days_until,
        amount_at_risk=det.amount,
        utilization_delta=(
            (det.utilization_current - det.utilization_target)
            if det.utilization_current and det.utilization_target
            else None
        ),
    )

    if det.kind == "move_money":
        return _gen_move_money(det, ctx, score)
    if det.kind == "reduce_utilization":
        return _gen_utilization(det, ctx, score)
    if det.kind == "delay_bill":
        return _gen_delay_bill(det, ctx, score)
    if det.kind == "reduce_spending":
        return _gen_reduce_spending(det, ctx, score)
    if det.kind == "pause_subscription":
        return _gen_pause_subscription(det, ctx, score)
    if det.kind == "increase_goal_contribution":
        return _gen_goal(det, ctx, score)
    if det.kind == "debt_payoff":
        return _gen_debt(det, ctx, score)
    if det.kind == "survival_mode":
        return _gen_survival(det, ctx, score)
    if det.kind == "restore_buffer":
        return _gen_restore_buffer(det, ctx, score)
    return _gen_generic(det, ctx, score)


def _gen_move_money(det: Detection, ctx: RecommendationContext, score: int) -> dict:
    extra = det.extra or {}
    donor = extra.get("donor_name", "Savings")
    dest = extra.get("dest_name", "Checking")
    amount = det.amount or 0
    transfer_date = latest_safe_transfer_date(det.target_date or ctx.today)
    date_label = format_short_date(transfer_date)
    title = f"Move ${format_money(amount)} from {donor} to {dest}"
    action = f"Move ${format_money(amount)} from {donor} to {dest} before {date_label}"
    return make_recommendation(
        f"move-money-{det.related_account_id}-{det.account_id}",
        "move_money",
        det.severity,
        title,
        det.reason,
        why=det.reason,
        recommended_action=action,
        recommended_amount=format_money(amount),
        recommended_date=transfer_date.isoformat(),
        account_id=det.account_id,
        related_account_id=det.related_account_id,
        impact_type="overdraft_avoidance",
        projected_improvement=det.projected_improvement,
        priority_score=score,
        impact_label="Transfer amount",
        impact_value=format_money(amount),
        primary_action_label="Execute transfer",
        primary_action_url=f"/transactions?transfer=1&from={det.related_account_id}&to={det.account_id}",
        primary_action_type="move_money",
        secondary_action_label="Open calendar",
        secondary_action_url=f"/timeline?date={transfer_date.isoformat()}",
        secondary_action_type="navigate",
    )


def _gen_utilization(det: Detection, ctx: RecommendationContext, score: int) -> dict:
    acc = ctx.accounts_by_id.get(det.account_id) if det.account_id else None
    name = acc.effective_display_name if acc else "Credit card"
    target = det.utilization_target or 70
    amount = det.amount or 0
    title = f"Pay ${format_money(amount)} toward {name}"
    action = f"Pay ${format_money(amount)} toward {name} to reduce utilization below {target:.0f}%"
    return make_recommendation(
        f"utilization-{det.account_id}-{int(target)}",
        "reduce_utilization",
        det.severity,
        title,
        det.reason,
        why=det.reason,
        recommended_action=action,
        recommended_amount=format_money(amount),
        account_id=det.account_id,
        impact_type="credit_utilization",
        projected_improvement=det.projected_improvement,
        priority_score=score,
        impact_label="Utilization",
        impact_value=f"{det.utilization_current:.0f}% → {target:.0f}%"
        if det.utilization_current
        else None,
        primary_action_label="Open payoff planner",
        primary_action_url=f"/credit-cards?account={det.account_id}",
        primary_action_type="navigate",
        secondary_action_label="Open ledger",
        secondary_action_url=f"/transactions?account={det.account_id}",
        secondary_action_type="navigate",
    )


def _gen_delay_bill(det: Detection, ctx: RecommendationContext, score: int) -> dict:
    rule_name = (det.extra or {}).get("rule_name", "Bill")
    shift = det.days_shift or 1
    date_label = format_short_date(det.target_date)
    title = f"Delay {rule_name} by {shift} day{'s' if shift != 1 else ''}"
    action = f"Delay {rule_name} payment by {shift} days to avoid overdraft"
    return make_recommendation(
        f"delay-bill-{det.rule_id}-{shift}",
        "delay_bill",
        det.severity,
        title,
        det.reason,
        why=det.reason,
        recommended_action=action,
        recommended_amount=format_money(det.amount) if det.amount else None,
        recommended_date=det.target_date.isoformat() if det.target_date else None,
        account_id=det.account_id,
        rule_id=det.rule_id,
        impact_type="cashflow_timing",
        projected_improvement=det.projected_improvement,
        priority_score=score,
        impact_label="Shift days",
        impact_value=str(shift),
        primary_action_label="View bills",
        primary_action_url="/bills",
        primary_action_type="navigate",
        secondary_action_label="Open calendar",
        secondary_action_url=f"/timeline?date={date_label}",
        secondary_action_type="navigate",
    )


def _gen_reduce_spending(det: Detection, ctx: RecommendationContext, score: int) -> dict:
    cat = det.category_name or "Discretionary"
    amount = det.amount or 0
    title = f"Reduce {cat} spending"
    action = f"Reduce {cat} spending by approximately ${format_money(amount)}/month"
    tid = (det.extra or {}).get("target_id")
    return make_recommendation(
        f"reduce-spending-{cat.lower().replace(' ', '-')}-{tid or 'general'}",
        "reduce_spending",
        det.severity,
        title,
        det.reason,
        why=det.reason,
        recommended_action=action,
        recommended_amount=format_money(amount),
        impact_type="spending_stability",
        projected_improvement=det.projected_improvement,
        priority_score=score,
        impact_label="Monthly reduction",
        impact_value=format_money(amount),
        primary_action_label="Spending targets",
        primary_action_url="/spending-targets",
        primary_action_type="navigate",
    )


def _gen_pause_subscription(det: Detection, ctx: RecommendationContext, score: int) -> dict:
    rule_name = (det.extra or {}).get("rule_name")
    if rule_name and det.target_date:
        until = format_short_date(det.target_date)
        title = f"Pause {rule_name} until {until}"
        action = title
        rec_id = f"pause-sub-{det.rule_id}"
    else:
        title = "Review subscriptions"
        action = "Review subscription-style recurring bills for unused services"
        rec_id = "pause-subscriptions-review"
    return make_recommendation(
        rec_id,
        "pause_subscription",
        det.severity,
        title,
        det.reason,
        why=det.reason,
        recommended_action=action,
        rule_id=det.rule_id,
        account_id=det.account_id,
        recommended_date=det.target_date.isoformat() if det.target_date else None,
        impact_type="cashflow",
        projected_improvement=det.projected_improvement,
        priority_score=score,
        primary_action_label="View bills",
        primary_action_url="/bills",
        primary_action_type="navigate",
    )


def _gen_goal(det: Detection, ctx: RecommendationContext, score: int) -> dict:
    name = (det.extra or {}).get("goal_name", "Goal")
    amount = det.amount or 0
    title = f"Increase {name} funding"
    action = f"Increase {name} funding by about ${format_money(amount)}/month"
    return make_recommendation(
        f"goal-contrib-{det.goal_id}",
        "increase_goal_contribution",
        det.severity,
        title,
        det.reason,
        why=det.reason,
        recommended_action=action,
        recommended_amount=format_money(amount),
        goal_id=det.goal_id,
        impact_type="goal_pace",
        projected_improvement=det.projected_improvement,
        priority_score=score,
        primary_action_label="Open goal",
        primary_action_url=f"/goals/{det.goal_id}",
        primary_action_type="navigate",
    )


def _gen_debt(det: Detection, ctx: RecommendationContext, score: int) -> dict:
    aid = det.account_id
    return make_recommendation(
        f"debt-payoff-{aid or 'household'}",
        "debt_payoff",
        det.severity,
        "Debt payoff opportunity",
        det.reason,
        why=det.reason,
        recommended_action=det.reason,
        account_id=aid,
        impact_type="interest_savings",
        projected_improvement=det.projected_improvement,
        priority_score=score,
        primary_action_label="Open payoff planner",
        primary_action_url="/credit-cards",
        primary_action_type="navigate",
    )


def _gen_survival(det: Detection, ctx: RecommendationContext, score: int) -> dict:
    return make_recommendation(
        "survival-mode",
        "survival_mode",
        "critical",
        "Survival mode recommended",
        det.reason,
        why=det.reason,
        recommended_action="Minimum debt payments, pause discretionary spend, delay flexible bills",
        impact_type="cashflow_stability",
        projected_improvement=det.projected_improvement,
        priority_score=score + 200,
        primary_action_label="Open payoff planner",
        primary_action_url="/credit-cards?mode=survival",
        primary_action_type="navigate",
        secondary_action_label="Open calendar",
        secondary_action_url="/timeline",
        secondary_action_type="navigate",
    )


def _gen_restore_buffer(det: Detection, ctx: RecommendationContext, score: int) -> dict:
    acc = ctx.accounts_by_id.get(det.account_id) if det.account_id else None
    name = acc.effective_display_name if acc else "Account"
    amount = det.amount or 0
    return make_recommendation(
        f"restore-buffer-{det.account_id}",
        "restore_buffer",
        det.severity,
        f"Restore buffer on {name}",
        det.reason,
        why=det.reason,
        recommended_action=f"Add ${format_money(amount)} to {name} before buffer is breached",
        recommended_amount=format_money(amount),
        recommended_date=det.target_date.isoformat() if det.target_date else None,
        account_id=det.account_id,
        impact_type="buffer",
        projected_improvement=det.projected_improvement,
        priority_score=score,
        impact_label="Buffer gap",
        impact_value=format_money(amount),
        primary_action_label="Open accounts",
        primary_action_url=f"/accounts?account={det.account_id}",
        primary_action_type="navigate",
    )


def _gen_generic(det: Detection, ctx: RecommendationContext, score: int) -> dict:
    return make_recommendation(
        f"rec-{det.kind}",
        det.kind,
        det.severity,
        det.kind.replace("_", " ").title(),
        det.reason,
        why=det.reason,
        projected_improvement=det.projected_improvement,
        priority_score=score,
    )
