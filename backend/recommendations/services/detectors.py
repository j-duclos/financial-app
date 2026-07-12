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
from accounts.services.available_to_spend import (
    RISK_STATUS_CRITICAL,
    RISK_STATUS_RISK,
    _decimal,
    _project_balances,
)
from accounts.services.credit_card import ledger_owed_balance
from recommendations.services.calculators import (
    UTILIZATION_TARGETS,
    is_category_discretionary,
    payment_to_reach_utilization,
    rule_allows_payment_delay,
    transfer_amount_to_restore,
    utilization_percent,
)
from recommendations.services.context import RecommendationContext
from timeline.services.ledger import _balance_at_end_of_date


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
        from recommendations.services.calculators import account_available_for_transfer

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
        amount = transfer_amount_to_restore(lowest, buffer)
        if amount <= 0:
            continue
        risk_date_str = forecast.get("risk_date")
        risk_date = date.fromisoformat(risk_date_str[:10]) if risk_date_str else ctx.today + timedelta(days=7)
        donor = next((d for d, avail in donors if d.id != acc.id and avail >= amount), None)
        if not donor and donors:
            donor, _ = donors[0]
            amount = min(amount, donors[0][1])
        if not donor:
            continue
        reason = forecast.get("risk_reason") or f"{acc.effective_display_name} projected below safety buffer."
        out.append(
            Detection(
                kind="move_money",
                severity="critical" if status == RISK_STATUS_CRITICAL else "high",
                account_id=acc.id,
                related_account_id=donor.id,
                amount=amount,
                target_date=risk_date,
                reason=reason,
                projected_improvement="Avoids overdraft and restores buffer.",
                extra={"donor_name": donor.effective_display_name, "dest_name": acc.effective_display_name},
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
            owed = ledger_owed_balance(acc, ctx.today)
            limit = _decimal(acc.credit_limit or 0)
            util_pct = utilization_percent(owed, limit)
            util = float(util_pct) if util_pct is not None else None
        if util is None:
            continue
        util_dec = _decimal(util)
        if util_dec < Decimal("70"):
            continue
        owed = ledger_owed_balance(acc, ctx.today)
        limit = _decimal(acc.credit_limit or 0)
        target = Decimal("70")
        for t in UTILIZATION_TARGETS:
            if util_dec > t:
                target = t
                break
        payment = payment_to_reach_utilization(owed, limit, target)
        if payment <= 0:
            continue
        out.append(
            Detection(
                kind="reduce_utilization",
                severity="high" if util_dec >= Decimal("90") else "medium",
                account_id=acc.id,
                amount=payment,
                utilization_current=util_dec,
                utilization_target=target,
                reason=f"{acc.effective_display_name} utilization is {util_dec:.0f}%.",
                projected_improvement=f"Brings utilization toward {target:.0f}% (score improvement placeholder).",
            )
        )
    return out


def _daily_balances_for_account(
    account_id: int,
    timeline_rows: list[dict],
    today: date,
    window_end: date,
) -> dict[date, Decimal]:
    current = _balance_at_end_of_date(account_id, today)
    by_date: dict[date, list[Decimal]] = defaultdict(list)
    for row in timeline_rows:
        if row.get("account_id") != account_id:
            continue
        row_date = row["date"]
        if not isinstance(row_date, date):
            row_date = date.fromisoformat(str(row_date)[:10])
        if row_date <= today or row_date > window_end:
            continue
        by_date[row_date].append(_decimal(row["amount"]))
    lowest, _, lowest_date, _, _, _, _, _ = _project_balances(
        current,
        by_date,
        today,
        window_end,
        Decimal("0"),
    )
    return {"lowest": lowest, "lowest_date": lowest_date, "by_date": by_date}


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
        balances = _daily_balances_for_account(acc.id, ctx.timeline_rows, ctx.today, window_end)
        if balances["lowest"] >= Decimal("0"):
            continue

        expenses_on_risk: list[dict] = []
        for row in ctx.timeline_rows:
            if row.get("account_id") != acc.id:
                continue
            row_date = row["date"]
            if not isinstance(row_date, date):
                row_date = date.fromisoformat(str(row_date)[:10])
            if row_date != risk_date:
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

        for row in expenses_on_risk:
            rule = ctx.rules_by_id.get(int(row["rule_id"]))
            if not rule:
                continue
            flex = int(rule.payment_flexibility_days or 0)
            expense_amt = abs(_decimal(row.get("amount") or 0))
            row_date = row["date"]
            if not isinstance(row_date, date):
                row_date = date.fromisoformat(str(row_date)[:10])

            for shift in range(1, flex + 1):
                new_date = row_date + timedelta(days=shift)
                if new_date > window_end:
                    break
                inflow_after = Decimal("0")
                for other in ctx.timeline_rows:
                    if other.get("account_id") != acc.id:
                        continue
                    od = other["date"]
                    if not isinstance(od, date):
                        od = date.fromisoformat(str(od)[:10])
                    if row_date < od <= new_date:
                        amt = _decimal(other.get("amount") or 0)
                        if amt > 0:
                            inflow_after += amt
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
        from budgets.services.spending_targets import spending_targets_summary

        summary = spending_targets_summary(ctx.user, anchor=ctx.today)
        for row in summary.get("targets", []):
            if row["status"] not in ("above_target", "risky", "approaching"):
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
    warnings = (ctx.goals_aggregate or {}).get("warnings") or []
    for w in warnings:
        gap = _decimal(w.get("gap") or 0)
        if gap <= 0:
            continue
        out.append(
            Detection(
                kind="increase_goal_contribution",
                severity="medium",
                goal_id=w.get("bucket_id"),
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
            out.append(
                Detection(
                    kind="increase_goal_contribution",
                    severity="low",
                    goal_id=goal.get("id"),
                    amount=gap,
                    reason=f"{goal.get('name')} is behind pace.",
                    projected_improvement=f"Increase contributions by about ${gap}/month.",
                    extra={"goal_name": goal.get("name")},
                )
            )
    return out[:3]


def detect_debt_payoff(ctx: RecommendationContext) -> list[Detection]:
    out: list[Detection] = []
    plan = (ctx.debt_summary or {}).get("plan") or {}
    for raw in plan.get("recommendations") or []:
        msg = raw.get("message") or ""
        if not msg:
            continue
        priority = raw.get("priority") or "medium"
        sev = "high" if priority == "high" else "medium"
        out.append(
            Detection(
                kind="debt_payoff",
                severity=sev,
                account_id=raw.get("account_id"),
                reason=msg,
                projected_improvement=raw.get("impact") or "Reduces interest and speeds payoff.",
                extra=raw,
            )
        )
    if not out and ctx.debt_summary:
        saved = ctx.debt_summary.get("interest_saved_vs_minimums")
        if saved and _decimal(saved) > 0:
            out.append(
                Detection(
                    kind="debt_payoff",
                    severity="info",
                    reason=ctx.debt_summary.get("message") or "Extra payments save interest.",
                    projected_improvement=f"Save ${saved} vs minimum payments only.",
                )
            )
    return out[:2]


def detect_survival_recommendations(ctx: RecommendationContext) -> list[Detection]:
    if not ctx.survival_mode:
        return []
    return [
        Detection(
            kind="survival_mode",
            severity="critical",
            reason="Multiple accounts project negative balances in the forecast window.",
            projected_improvement="Use minimum debt payments, pause discretionary spend, delay flexible bills.",
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
