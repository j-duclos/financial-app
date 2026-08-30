"""
Detect financial situations that warrant recommendations.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from accounts.models import Account
from accounts.services.account_health import _target_utilization_percent
from accounts.services.account_health_constants import CREDIT_UTILIZATION_CRITICAL
from accounts.services.available_to_spend import (
    RISK_STATUS_CRITICAL,
    RISK_STATUS_RISK,
    _decimal,
    _project_balances,
)
from recommendations.services.calculators import (
    account_available_for_transfer,
    format_money,
    format_short_date,
    is_category_discretionary,
    parse_forecast_date,
    payment_to_reach_utilization,
    rule_allows_payment_delay,
    transfer_amount_to_restore,
    utilization_percent,
)
from recommendations.services.context import RecommendationContext, timeline_row_date


@dataclass
class Detection:
    kind: str
    severity: str
    account_id: int | None = None
    related_account_id: int | None = None
    rule_id: int | None = None
    goal_id: int | None = None
    amount: Decimal | None = None
    target_date: date | None = None
    days_shift: int | None = None
    category_name: str | None = None
    utilization_current: Decimal | None = None
    utilization_target: Decimal | None = None
    reason: str = ""
    projected_improvement: str = ""
    extra: dict[str, Any] | None = None


def detect_survival_mode(ctx: RecommendationContext) -> bool:
    critical_count = 0
    for forecast in ctx.forecasts.values():
        if forecast.get("risk_status") == RISK_STATUS_CRITICAL:
            critical_count += 1
    total_sts = _decimal(ctx.st_aggregate.get("total_safe_to_spend") or 0)
    return critical_count >= 2 or (total_sts < 0 and critical_count >= 1)


def detect_move_money_opportunities(
    ctx: RecommendationContext,
    *,
    account_id: int | None = None,
) -> list[Detection]:
    out: list[Detection] = []
    donors: list[tuple[Account, Decimal]] = []
    for acc in ctx.accounts:
        if not acc.participates_in_forecast() or acc.is_credit_card():
            continue
        forecast = ctx.forecasts.get(acc.id)
        if not forecast or not forecast.get("supports_available_to_spend"):
            continue
        avail = account_available_for_transfer(acc, forecast)
        if avail >= Decimal("100"):
            donors.append((acc, avail))
    donors.sort(key=lambda x: x[1], reverse=True)

    for acc in ctx.accounts:
        if account_id is not None and acc.id != account_id:
            continue
        forecast = ctx.forecasts.get(acc.id)
        if not forecast or not forecast.get("supports_available_to_spend"):
            continue
        lowest = _decimal(forecast.get("lowest_projected_balance") or 0)
        buffer = _decimal(forecast.get("minimum_buffer") or acc.minimum_buffer or 0)
        status = forecast.get("risk_status")
        if status not in (RISK_STATUS_CRITICAL, RISK_STATUS_RISK):
            continue
        needed = transfer_amount_to_restore(lowest, buffer)
        if needed <= 0:
            continue
        first_negative = parse_forecast_date(forecast.get("first_negative_date"))
        lowest_date = parse_forecast_date(forecast.get("lowest_projected_balance_date"))
        risk_date = parse_forecast_date(forecast.get("risk_date")) or (
            ctx.today + timedelta(days=7)
        )
        # CRITICAL: first day projected balance goes below $0 (same field as Dashboard).
        # RISK: first buffer breach / risk_date. Transfer-by is derived from this date.
        shortfall_date = (
            (first_negative or risk_date) if status == RISK_STATUS_CRITICAL else risk_date
        )
        eligible = [(d, avail) for d, avail in donors if d.id != acc.id]
        if not eligible:
            continue
        full_donor = next((d for d, avail in eligible if avail >= needed), None)
        if full_donor is not None:
            donor = full_donor
            amount = needed
            remaining = Decimal("0")
            partial = False
        else:
            donor, avail = eligible[0]
            if avail <= 0:
                continue
            amount = avail
            remaining = needed - amount
            partial = True
        dest_name = acc.effective_display_name
        donor_name = donor.effective_display_name
        if status == RISK_STATUS_CRITICAL:
            reason = (
                f"{dest_name} is projected to fall below $0 on "
                f"{format_short_date(shortfall_date)}."
            )
        else:
            reason = (
                f"{dest_name} is projected to fall below your buffer on "
                f"{format_short_date(risk_date)}."
            )
        if partial:
            improvement = (
                f"Covers part of the shortfall. Remaining after transfer: "
                f"${format_money(remaining)}."
            )
        elif buffer > 0:
            improvement = (
                "Covers the lowest projected balance in the forecast window "
                "and restores the safety buffer."
            )
        else:
            improvement = "Covers the lowest projected balance in the forecast window."
        out.append(
            Detection(
                kind="move_money",
                severity="critical" if status == RISK_STATUS_CRITICAL else "high",
                account_id=acc.id,
                related_account_id=donor.id,
                amount=amount,
                target_date=shortfall_date,
                reason=reason,
                projected_improvement=improvement,
                extra={
                    "donor_name": donor_name,
                    "dest_name": dest_name,
                    "first_negative_date": (
                        first_negative.isoformat() if first_negative else None
                    ),
                    "lowest_projected_balance": str(lowest),
                    "lowest_projected_balance_date": (
                        lowest_date.isoformat() if lowest_date else None
                    ),
                    "needed_amount": str(needed),
                    "remaining_shortfall": str(remaining) if partial else "0",
                    "partial": partial,
                    "forecast_days": ctx.days,
                    "minimum_buffer": str(buffer),
                    "first_negative_transaction_id": forecast.get("first_negative_transaction_id"),
                },
            )
        )
    return out


def detect_utilization(ctx: RecommendationContext) -> list[Detection]:
    out: list[Detection] = []
    for acc in ctx.accounts:
        if not acc.is_credit_card():
            continue
        health = ctx.health_by_id.get(acc.id) or {}
        details = health.get("details") or {}
        util = details.get("utilization_percent")
        if util is None:
            owed = ctx.owed_for(acc.id)
            limit = _decimal(acc.credit_limit or 0)
            util_pct = utilization_percent(owed, limit)
            util = float(util_pct) if util_pct is not None else None
        if util is None:
            continue
        util_dec = _decimal(util)
        target_raw = details.get("target_utilization_percent")
        target = (
            _decimal(target_raw)
            if target_raw is not None
            else _target_utilization_percent(acc)
        )
        if util_dec <= target:
            continue
        owed = ctx.owed_for(acc.id)
        limit = _decimal(acc.credit_limit or 0)
        payment = payment_to_reach_utilization(owed, limit, target)
        if payment <= 0:
            continue
        out.append(
            Detection(
                kind="reduce_utilization",
                severity="high" if util_dec >= CREDIT_UTILIZATION_CRITICAL else "medium",
                account_id=acc.id,
                amount=payment,
                utilization_current=util_dec,
                utilization_target=target,
                reason=f"{acc.effective_display_name} is at {util_dec:.0f}% utilization.",
                projected_improvement=(
                    f"Pay ${format_money(payment)} to reach your {target:.0f}% target."
                ),
            )
        )
    return out


def _daily_balances_for_account(
    account_rows: list[dict],
    today: date,
    window_end: date,
    current_balance: Decimal,
) -> dict[date, Decimal]:
    by_date: dict[date, list[Decimal]] = defaultdict(list)
    for row in account_rows:
        row_date = timeline_row_date(row)
        if row_date <= today or row_date > window_end:
            continue
        by_date[row_date].append(_decimal(row["amount"]))
    lowest, _, lowest_date, _, _, _, _, _ = _project_balances(
        current_balance,
        by_date,
        today,
        window_end,
        Decimal("0"),
    )
    return {"lowest": lowest, "lowest_date": lowest_date, "by_date": by_date}


def _inflow_between(
    daily_inflow: dict[date, Decimal],
    start_exclusive: date,
    end_inclusive: date,
) -> Decimal:
    total = Decimal("0")
    day = start_exclusive + timedelta(days=1)
    while day <= end_inclusive:
        total += daily_inflow.get(day, Decimal("0"))
        day += timedelta(days=1)
    return total


def detect_bill_delay_opportunities(
    ctx: RecommendationContext,
    *,
    account_id: int | None = None,
) -> list[Detection]:
    out: list[Detection] = []
    window_end = ctx.today + timedelta(days=ctx.days)
    for acc in ctx.accounts:
        if account_id is not None and acc.id != account_id:
            continue
        if not acc.participates_in_forecast():
            continue
        forecast = ctx.forecasts.get(acc.id)
        if not forecast or forecast.get("risk_status") != RISK_STATUS_CRITICAL:
            continue
        risk_date_str = forecast.get("risk_date")
        if not risk_date_str:
            continue
        risk_date = date.fromisoformat(risk_date_str[:10])
        account_rows = ctx.rows_for_account(acc.id)
        current = ctx.signed_balances.get(acc.id, Decimal("0"))
        balances = _daily_balances_for_account(account_rows, ctx.today, window_end, current)
        if balances["lowest"] >= Decimal("0"):
            continue

        expenses_on_risk: list[dict] = []
        for row in account_rows:
            if timeline_row_date(row) != risk_date:
                continue
            amt = _decimal(row.get("amount") or 0)
            if amt >= 0:
                continue
            rule_id = row.get("rule_id")
            if not rule_id:
                continue
            rule = ctx.rules_by_id.get(int(rule_id))
            if not rule or not rule_allows_payment_delay(rule):
                continue
            expenses_on_risk.append(row)

        daily_inflow = ctx.inflows_for_account(acc.id)
        for row in expenses_on_risk:
            rule = ctx.rules_by_id.get(int(row["rule_id"]))
            if not rule:
                continue
            flex = int(rule.payment_flexibility_days or 0)
            expense_amt = abs(_decimal(row.get("amount") or 0))
            row_date = timeline_row_date(row)

            for shift in range(1, flex + 1):
                new_date = row_date + timedelta(days=shift)
                if new_date > window_end:
                    break
                inflow_after = _inflow_between(daily_inflow, row_date, new_date)
                if inflow_after >= expense_amt:
                    out.append(
                        Detection(
                            kind="delay_bill",
                            severity="high",
                            account_id=acc.id,
                            rule_id=rule.id,
                            amount=expense_amt,
                            target_date=row_date,
                            days_shift=shift,
                            reason=f"{acc.effective_display_name} projected below zero on {risk_date.isoformat()}.",
                            projected_improvement="Avoids overdraft without moving money.",
                            extra={"rule_name": rule.name},
                        )
                    )
                    break
    return out


def detect_spending_reduction(ctx: RecommendationContext) -> list[Detection]:
    out: list[Detection] = []
    total_sts = _decimal(ctx.st_aggregate.get("total_safe_to_spend") or 0)
    if total_sts >= 0 and not ctx.survival_mode:
        return out
    shortfall = abs(total_sts) if total_sts < 0 else Decimal("200")
    try:
        summary = ctx.spending_targets_summary or {}
        for row in summary.get("targets", []):
            if row["status"] not in ("above_target", "risky", "approaching_target"):
                continue
            cat = row.get("category_name") or "Spending"
            if not is_category_discretionary(cat):
                continue
            total = _decimal(row.get("period_total") or row.get("spent_so_far") or 0)
            target_amt = _decimal(row.get("target_amount") or 0)
            over = total - target_amt
            reduction = over if over > 0 else shortfall / Decimal("3")
            reduction = reduction.quantize(Decimal("0.01"))
            if reduction < Decimal("25"):
                continue
            out.append(
                Detection(
                    kind="reduce_spending",
                    severity="medium" if total_sts < 0 else "low",
                    category_name=cat,
                    amount=reduction,
                    reason="Spending limits show pressure on safe-to-spend."
                    if total_sts < 0
                    else f"{cat} is over your spending limit.",
                    projected_improvement="Helps restore spending stability.",
                    extra={"target_id": row.get("target_id")},
                )
            )
    except Exception:
        pass
    if not out and total_sts < 0:
        out.append(
            Detection(
                kind="reduce_spending",
                severity="medium",
                category_name="Discretionary",
                amount=shortfall.quantize(Decimal("0.01")),
                reason="Household safe-to-spend is negative across spending accounts.",
                projected_improvement="Reducing discretionary spend restores forecast stability.",
            )
        )
    return out[:3]


def detect_subscription_issues(ctx: RecommendationContext) -> list[Detection]:
    out: list[Detection] = []
    sub_rules = [
        r
        for r in ctx.recurring_rules
        if r.active
        and r.direction == "EXPENSE"
        and (r.is_bill or "subscription" in (r.name or "").lower() or "hulu" in (r.name or "").lower())
    ]
    if len(sub_rules) >= 4:
        total = sum(abs(_decimal(r.amount)) for r in sub_rules)
        out.append(
            Detection(
                kind="pause_subscription",
                severity="low",
                amount=total,
                reason=f"You have {len(sub_rules)} active subscription-style bills.",
                projected_improvement="Reviewing unused subscriptions frees monthly cash flow.",
                extra={"rule_count": len(sub_rules)},
            )
        )
    for rule in sub_rules:
        if rule_allows_payment_delay(rule) and ctx.survival_mode:
            pause_until = (ctx.today + timedelta(days=60)).replace(day=1)
            out.append(
                Detection(
                    kind="pause_subscription",
                    severity="medium",
                    rule_id=rule.id,
                    account_id=rule.account_id,
                    target_date=pause_until,
                    reason="Cashflow survival mode — flexible subscriptions can be paused.",
                    projected_improvement=f"Pause {rule.name} until {pause_until.strftime('%b %d')}.",
                    extra={"rule_name": rule.name},
                )
            )
    return out[:2]


def detect_goal_gaps(ctx: RecommendationContext) -> list[Detection]:
    out: list[Detection] = []
    seen_goal_ids: set[int] = set()
    warnings = (ctx.goals_aggregate or {}).get("warnings") or []
    for w in warnings:
        gap = _decimal(w.get("gap") or 0)
        if gap <= 0:
            continue
        goal_id = w.get("bucket_id")
        if goal_id is not None:
            if goal_id in seen_goal_ids:
                continue
            seen_goal_ids.add(goal_id)
        out.append(
            Detection(
                kind="increase_goal_contribution",
                severity="medium",
                goal_id=goal_id,
                amount=gap,
                reason=w.get("message") or "Goal is behind target pace.",
                projected_improvement=f"Increase funding by about ${gap}/month to get back on track.",
                extra={"goal_name": w.get("name")},
            )
        )
    for goal in ctx.dashboard_goals[:3]:
        monthly = goal.get("monthly_target") or goal.get("monthly_contribution")
        health = goal.get("goal_health") or goal.get("pace_status")
        if health in ("behind", "stalled") and monthly:
            gap = _decimal(goal.get("forecast_gap") or monthly)
            if gap <= 0:
                continue
            goal_id = goal.get("id")
            if goal_id is not None:
                if goal_id in seen_goal_ids:
                    continue
                seen_goal_ids.add(goal_id)
            out.append(
                Detection(
                    kind="increase_goal_contribution",
                    severity="low",
                    goal_id=goal_id,
                    amount=gap,
                    reason=f"{goal.get('name')} is behind pace.",
                    projected_improvement=f"Increase contributions by about ${gap}/month.",
                    extra={"goal_name": goal.get("name")},
                )
            )
    return out[:3]


def _focus_debt_account(
    ctx: RecommendationContext, plan: dict[str, Any]
) -> tuple[int | None, str | None, Decimal | None]:
    """Resolve the household payoff-plan focus card (highest-APR / first in order)."""
    account_id = None
    payoff_order = plan.get("payoff_order") or []
    if payoff_order:
        account_id = int(payoff_order[0])
    elif plan.get("cards"):
        ranked = sorted(
            plan["cards"],
            key=lambda card: card.get("payoff_order") or 999,
        )
        if ranked:
            raw_id = ranked[0].get("account_id")
            account_id = int(raw_id) if raw_id is not None else None
    account = ctx.accounts_by_id.get(account_id) if account_id else None
    name = account.effective_display_name if account else None
    apr = _decimal(account.apr) if account and account.apr is not None else None
    if name is None and plan.get("cards"):
        for card in plan["cards"]:
            if account_id is not None and int(card.get("account_id") or 0) == account_id:
                name = card.get("name")
                if card.get("apr") is not None:
                    apr = _decimal(card["apr"])
                break
    return account_id, name, apr


def detect_debt_payoff(ctx: RecommendationContext) -> list[Detection]:
    """One Action Center rec per household payoff strategy — not one per planner tip."""
    plan = (ctx.debt_summary or {}).get("plan") or {}
    raw_recs = [row for row in (plan.get("recommendations") or []) if row.get("message")]
    by_id = {row.get("id"): row for row in raw_recs}

    focus = by_id.get("focus_high_apr")
    saved_row = by_id.get("interest_saved")
    saved_amount = None
    if ctx.debt_summary:
        saved_amount = ctx.debt_summary.get("interest_saved_vs_minimums")

    if not focus and not saved_row and not (saved_amount and _decimal(saved_amount) > 0):
        return []

    account_id, account_name, apr = _focus_debt_account(ctx, plan)
    if account_name is None and focus:
        message = focus.get("message") or ""
        if message.lower().startswith("pay "):
            account_name = message[4:].split(" first", 1)[0].strip() or None

    if account_name and apr is not None and apr > 0:
        reason = f"{account_name} has the highest APR at {format_money(apr)}%."
    elif focus:
        reason = focus.get("message") or "Prioritize the highest-APR balance."
    else:
        reason = "Following the recommended payoff plan reduces interest versus minimum payments."

    if saved_amount and _decimal(saved_amount) > 0:
        improvement = (
            "Following the recommended payoff plan could save approximately "
            f"${format_money(_decimal(saved_amount))} in interest versus minimum payments."
        )
    else:
        improvement = "Prioritizing this balance reduces interest and speeds payoff."
    severity = "high" if focus else "medium"

    # Skip plan "utilization" tips — detect_utilization already emits per-card payment actions.
    return [
        Detection(
            kind="debt_payoff",
            severity=severity,
            account_id=account_id,
            reason=reason,
            projected_improvement=improvement,
            extra={
                "strategy_id": "household_payoff",
                "focus_account_name": account_name,
                "source_ids": [row.get("id") for row in raw_recs if row.get("id")],
            },
        )
    ]


def detect_survival_recommendations(ctx: RecommendationContext) -> list[Detection]:
    if not ctx.survival_mode:
        return []
    return [
        Detection(
            kind="survival_mode",
            severity="critical",
            reason=(
                "Multiple accounts are projected to fall below zero. "
                "Prioritize required bills and minimum debt payments until cash flow stabilizes."
            ),
            projected_improvement=(
                "Prioritize required bills and minimum debt payments until cash flow stabilizes."
            ),
        )
    ]


def detect_restore_buffer(
    ctx: RecommendationContext,
    *,
    account_id: int | None = None,
) -> list[Detection]:
    out: list[Detection] = []
    for acc in ctx.accounts:
        if account_id is not None and acc.id != account_id:
            continue
        forecast = ctx.forecasts.get(acc.id)
        if not forecast or not forecast.get("supports_available_to_spend"):
            continue
        lowest = _decimal(forecast.get("lowest_projected_balance") or 0)
        buffer = _decimal(forecast.get("minimum_buffer") or 0)
        if lowest >= buffer or lowest < Decimal("0"):
            continue
        amount = transfer_amount_to_restore(lowest, buffer, restore_to_buffer=True)
        if amount <= 0:
            continue
        out.append(
            Detection(
                kind="restore_buffer",
                severity="medium",
                account_id=acc.id,
                amount=amount,
                target_date=date.fromisoformat(forecast["risk_date"][:10])
                if forecast.get("risk_date")
                else None,
                reason=f"{acc.effective_display_name} will dip below your ${buffer} buffer.",
                projected_improvement="Keeps a cash cushion for unexpected expenses.",
            )
        )
    return out[:2]


def run_all_detectors(ctx: RecommendationContext) -> list[Detection]:
    """
    Run every detector.

    Forecast-window dependent (use ctx.days / projected timeline):
      survival_mode, move_money, delay_bill, restore_buffer, reduce_spending

    Current-state (not hidden merely because the Forecast Window changed):
      reduce_utilization, pause_subscription, increase_goal_contribution, debt_payoff
    """
    ctx.survival_mode = detect_survival_mode(ctx)
    detections: list[Detection] = []
    detections.extend(detect_survival_recommendations(ctx))
    detections.extend(detect_move_money_opportunities(ctx))
    detections.extend(detect_bill_delay_opportunities(ctx))
    detections.extend(detect_utilization(ctx))
    detections.extend(detect_restore_buffer(ctx))
    detections.extend(detect_spending_reduction(ctx))
    detections.extend(detect_subscription_issues(ctx))
    detections.extend(detect_goal_gaps(ctx))
    detections.extend(detect_debt_payoff(ctx))
    return detections


def run_detectors_for_account(ctx: RecommendationContext, account_id: int) -> list[Detection]:
    """Run only detectors that can produce actions for a single cash account."""
    ctx.survival_mode = detect_survival_mode(ctx)
    detections: list[Detection] = []
    detections.extend(detect_move_money_opportunities(ctx, account_id=account_id))
    detections.extend(detect_bill_delay_opportunities(ctx, account_id=account_id))
    detections.extend(detect_restore_buffer(ctx, account_id=account_id))
    return detections
