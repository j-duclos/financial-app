"""
Deterministic resolve-risk workflow for cash spending accounts.

Uses forecast engine, recommendation detectors, and transfer simulation — not AI.
"""
from __future__ import annotations

import logging
import time
from datetime import date, timedelta
from decimal import Decimal
from typing import Any, Optional

from django.utils import timezone

from accounts.models import Account
from accounts.services.available_to_spend import (
    RISK_STATUS_CRITICAL,
    RISK_STATUS_RISK,
    _decimal,
    _project_balances,
    normalize_forecast_days,
)
from recommendations.services.calculators import (
    format_short_date,
    latest_safe_transfer_date,
    transfer_amount_to_restore,
)
from recommendations.services.context import RecommendationContext
from recommendations.services.detectors import Detection, run_detectors_for_account
from recommendations.services.generators import generate_from_detection
from timeline.services.transfer_simulation import (
    TransferSimulationContext,
    prepare_transfer_simulation_context,
    simulate_transfer_impact,
)

logger = logging.getLogger(__name__)

MAX_SIMULATED_TRANSFER_ACTIONS = 3
MAX_RETURNED_ACTIONS = 8


def _horizon_days_to_label(days: int) -> str:
    if days <= 14:
        return "14d"
    if days <= 90:
        return "3m"
    if days <= 180:
        return "6m"
    return "12m"


def account_eligible_for_resolve_risk(account: Account, forecast: dict[str, Any] | None) -> bool:
    """Cash accounts with projected overdraft or critical/risk forecast."""
    if not account.participates_in_forecast() or account.is_credit_card():
        return False
    if not forecast or not forecast.get("supports_available_to_spend"):
        return False
    status = forecast.get("risk_status")
    lowest = _decimal(forecast.get("lowest_projected_balance") or 0)
    buffer = _decimal(forecast.get("minimum_buffer") or account.minimum_buffer or 0)
    if status in (RISK_STATUS_CRITICAL, RISK_STATUS_RISK):
        return True
    if lowest < Decimal("0"):
        return True
    if buffer > 0 and lowest < buffer:
        return True
    return False


def _risk_summary(
    account: Account,
    forecast: dict[str, Any],
    *,
    days: int,
    today: date,
) -> dict[str, Any]:
    lowest = _decimal(forecast.get("lowest_projected_balance") or 0)
    risk_date = forecast.get("risk_date")
    buffer = _decimal(forecast.get("minimum_buffer") or account.minimum_buffer or 0)
    sts = forecast.get("available_to_spend")
    negative_date_label = None
    if risk_date:
        negative_date_label = format_short_date(date.fromisoformat(str(risk_date)[:10]))
    elif lowest < Decimal("0"):
        negative_date_label = f"within next {days} days"

    headline = f"{account.effective_display_name}"
    if lowest < Decimal("0") and negative_date_label:
        headline = f"{account.effective_display_name} projected negative on {negative_date_label}."
    elif risk_date:
        headline = f"{account.effective_display_name} at risk on {negative_date_label}."

    return {
        "account_id": account.id,
        "account_name": account.effective_display_name,
        "forecast_days": days,
        "risk_date": risk_date,
        "risk_date_label": negative_date_label,
        "lowest_projected_balance": str(lowest.quantize(Decimal("0.01"))),
        "minimum_buffer": str(buffer.quantize(Decimal("0.01"))),
        "available_to_spend": str(_decimal(sts).quantize(Decimal("0.01"))) if sts is not None else None,
        "risk_status": forecast.get("risk_status"),
        "headline": headline,
    }


def _daily_balances_for_account(
    account_id: int,
    timeline_rows: list[dict],
    today: date,
    window_end: date,
) -> dict[str, Any]:
    current = Decimal("0")
    for row in timeline_rows:
        if row.get("account_id") != account_id:
            continue
        row_date = row["date"]
        if not isinstance(row_date, date):
            row_date = date.fromisoformat(str(row_date)[:10])
        if row_date <= today:
            current += _decimal(row.get("amount") or 0)
    by_date: dict[date, list[Decimal]] = {}
    for row in timeline_rows:
        if row.get("account_id") != account_id:
            continue
        row_date = row["date"]
        if not isinstance(row_date, date):
            row_date = date.fromisoformat(str(row_date)[:10])
        if row_date <= today or row_date > window_end:
            continue
        by_date.setdefault(row_date, []).append(_decimal(row.get("amount") or 0))
    lowest, _, lowest_date, _, _, _, _, _ = _project_balances(
        current,
        by_date,
        today,
        window_end,
        Decimal("0"),
    )
    return {"lowest": lowest, "lowest_date": lowest_date, "by_date": by_date, "current": current}


def _simulate_delay_bill(
    det: Detection,
    ctx: RecommendationContext,
    account: Account,
) -> dict[str, Any]:
    window_end = ctx.today + timedelta(days=ctx.days)
    balances = _daily_balances_for_account(det.account_id, ctx.timeline_rows, ctx.today, window_end)
    base_lowest = balances["lowest"]
    buffer = _decimal(account.minimum_buffer or 0)

    row_date = det.target_date or ctx.today
    shift = det.days_shift or 1
    new_date = row_date + timedelta(days=shift)
    expense = -(det.amount or Decimal("0"))

    by_date = {d: list(amts) for d, amts in balances["by_date"].items()}
    if row_date in by_date:
        by_date[row_date] = [a for a in by_date[row_date] if a != expense]
        if not by_date[row_date]:
            del by_date[row_date]
    by_date.setdefault(new_date, []).append(expense)

    sim_lowest, _, sim_lowest_date, _, _, _, _, _ = _project_balances(
        balances["current"],
        by_date,
        ctx.today,
        window_end,
        Decimal("0"),
    )
    threshold = buffer if buffer > 0 else Decimal("0")
    resolved = sim_lowest >= threshold
    improvement = (sim_lowest - base_lowest) if base_lowest is not None and sim_lowest is not None else None

    return {
        "base_lowest_projected_balance": str(base_lowest.quantize(Decimal("0.01"))),
        "simulated_lowest_projected_balance": str(sim_lowest.quantize(Decimal("0.01"))),
        "simulated_lowest_date": (
            sim_lowest_date.isoformat()
            if isinstance(sim_lowest_date, date)
            else (str(sim_lowest_date)[:10] if sim_lowest_date else None)
        ),
        "risk_resolved": resolved,
        "improvement_amount": (
            str(improvement.quantize(Decimal("0.01"))) if improvement is not None else None
        ),
        "result_status": "resolved" if resolved else ("partial" if improvement and improvement > 0 else "failed"),
    }


def _horizon_simulation_preview(sim: dict[str, Any]) -> dict[str, Any]:
    base = _decimal(sim.get("base_horizon_lowest_projected_balance"))
    simulated = _decimal(sim.get("simulated_horizon_lowest_projected_balance"))
    improvement = simulated - base if base is not None and simulated is not None else None
    return {
        "base_lowest_projected_balance": sim.get("base_horizon_lowest_projected_balance"),
        "simulated_lowest_projected_balance": sim.get("simulated_horizon_lowest_projected_balance"),
        "simulated_lowest_date": sim.get("simulated_horizon_lowest_date"),
        "base_horizon_lowest_projected_balance": sim.get("base_horizon_lowest_projected_balance"),
        "base_horizon_lowest_date": sim.get("base_horizon_lowest_date"),
        "simulated_horizon_lowest_projected_balance": sim.get("simulated_horizon_lowest_projected_balance"),
        "simulated_horizon_lowest_date": sim.get("simulated_horizon_lowest_date"),
        "risk_resolved": sim.get("risk_resolved", False),
        "result_status": sim.get("result_status"),
        "improvement_amount": (
            str(improvement.quantize(Decimal("0.01"))) if improvement is not None else None
        ),
        "recovery_insight": sim.get("recovery_insight"),
        "transfer_date": sim.get("transfer_date"),
    }


def _simulation_preview_move(
    det: Detection,
    ctx: RecommendationContext,
    *,
    prepared: TransferSimulationContext,
) -> dict[str, Any]:
    if not det.related_account_id or not det.account_id or not det.amount:
        return {}
    transfer_date = latest_safe_transfer_date(det.target_date or ctx.today)
    focus = det.target_date or transfer_date
    try:
        sim = simulate_transfer_impact(
            ctx.user,
            from_account_id=det.related_account_id,
            to_account_id=det.account_id,
            amount=det.amount,
            transfer_date=transfer_date,
            focus_date=focus,
            horizon=prepared.horizon,
            as_of_date=ctx.today,
            prepared_context=prepared,
        )
        return _horizon_simulation_preview(sim)
    except ValueError as exc:
        logger.info(
            "resolve_risk transfer simulation skipped account=%s from=%s: %s",
            det.account_id,
            det.related_account_id,
            exc,
        )
        return {}


def _action_dto(
    det: Detection,
    rec: dict[str, Any],
    *,
    simulation: dict[str, Any],
) -> dict[str, Any]:
    kind = rec.get("type") or det.kind
    return {
        "id": rec.get("id") or f"{kind}-{det.account_id}",
        "kind": kind,
        "severity": rec.get("severity") or det.severity,
        "title": rec.get("title") or "",
        "why": rec.get("why") or det.reason,
        "recommended_action": rec.get("recommended_action") or "",
        "priority_score": rec.get("priority_score") or 0,
        "account_id": det.account_id,
        "related_account_id": det.related_account_id,
        "rule_id": det.rule_id,
        "recommended_amount": rec.get("recommended_amount"),
        "recommended_date": rec.get("recommended_date"),
        "primary_action_label": rec.get("primary_action_label"),
        "primary_action_url": rec.get("primary_action_url"),
        "primary_action_type": rec.get("primary_action_type"),
        "simulation": simulation,
    }


def _candidate_needs_transfer_simulation(det: Detection) -> bool:
    if det.kind == "move_money":
        return True
    if det.kind == "restore_buffer" and det.related_account_id:
        return True
    return False


def _restore_buffer_as_move_detection(det: Detection, forecast: dict[str, Any], account: Account) -> Detection:
    lowest = _decimal(forecast.get("lowest_projected_balance") or 0)
    buffer = _decimal(forecast.get("minimum_buffer") or account.minimum_buffer or 0)
    gap = transfer_amount_to_restore(lowest, buffer)
    est_improve = min(gap, det.amount or gap)
    return Detection(
        kind="move_money",
        severity=det.severity,
        account_id=det.account_id,
        related_account_id=det.related_account_id,
        amount=det.amount or est_improve,
        target_date=det.target_date,
        reason=det.reason,
    )


def build_resolve_risk_plan(
    user,
    account_id: int,
    *,
    days: int = 30,
    as_of_date: date | None = None,
    ctx: RecommendationContext | None = None,
) -> dict[str, Any]:
    from recommendations.services.engine import build_recommendation_context

    request_start = time.perf_counter()
    days = normalize_forecast_days(days)
    today = as_of_date or timezone.localdate()
    horizon = _horizon_days_to_label(days)

    if ctx is None:
        ctx_start = time.perf_counter()
        ctx = build_recommendation_context(user, days=days, as_of_date=today)
        logger.info(
            "resolve_risk context preparation account=%s elapsed_ms=%.0f",
            account_id,
            (time.perf_counter() - ctx_start) * 1000,
        )
    else:
        logger.info("resolve_risk reusing prebuilt context account=%s", account_id)

    account = ctx.accounts_by_id.get(account_id)
    if not account:
        raise ValueError("Account not found")

    forecast = ctx.forecasts.get(account_id) or {}
    eligible = account_eligible_for_resolve_risk(account, forecast)
    if not eligible:
        return {
            "eligible": False,
            "account_id": account_id,
            "account_name": account.effective_display_name,
            "message": "This account has no actionable cash-flow risk in the forecast window.",
        }

    summary = _risk_summary(account, forecast, days=days, today=today)

    detector_start = time.perf_counter()
    relevant = run_detectors_for_account(ctx, account_id)
    logger.info(
        "resolve_risk detector execution account=%s detections=%d elapsed_ms=%.0f",
        account_id,
        len(relevant),
        (time.perf_counter() - detector_start) * 1000,
    )

    if not any(d.kind == "move_money" for d in relevant):
        amount = transfer_amount_to_restore(
            _decimal(forecast.get("lowest_projected_balance") or 0),
            _decimal(forecast.get("minimum_buffer") or account.minimum_buffer or 0),
        )
        if amount > 0:
            from recommendations.services.detectors import detect_move_money_opportunities

            for det in detect_move_money_opportunities(ctx, account_id=account_id):
                relevant.insert(0, det)
                break

    candidates: list[tuple[Detection, dict[str, Any]]] = []
    seen_keys: set[str] = set()
    for det in relevant:
        key = f"{det.kind}-{det.rule_id}-{det.related_account_id}-{det.days_shift}"
        if key in seen_keys:
            continue
        seen_keys.add(key)
        rec = generate_from_detection(det, ctx)
        candidates.append((det, rec))

    candidates.sort(key=lambda pair: -(pair[1].get("priority_score") or 0))

    sim_prep_start = time.perf_counter()
    prepared = prepare_transfer_simulation_context(
        user,
        horizon=horizon,
        as_of_date=ctx.today,
        household_id=account.household_id,
        scenario_id=ctx.scenario_id,
        accounts=ctx.accounts,
        accounts_by_id=ctx.accounts_by_id,
        base_forecasts=ctx.forecasts,
        base_sts=ctx.st_aggregate,
        timeline_rows=ctx.timeline_rows,
    )
    logger.info(
        "resolve_risk base simulation preparation account=%s elapsed_ms=%.0f",
        account_id,
        (time.perf_counter() - sim_prep_start) * 1000,
    )

    transfer_sim_budget = MAX_SIMULATED_TRANSFER_ACTIONS
    actions: list[dict[str, Any]] = []

    for det, rec in candidates:
        simulation: dict[str, Any] = {}

        if det.kind == "delay_bill":
            simulation = _simulate_delay_bill(det, ctx, account)
        elif det.kind in ("reduce_spending", "restore_buffer"):
            lowest = _decimal(forecast.get("lowest_projected_balance") or 0)
            buffer = _decimal(forecast.get("minimum_buffer") or account.minimum_buffer or 0)
            gap = transfer_amount_to_restore(lowest, buffer)
            est_improve = min(gap, det.amount or gap)
            simulation = {
                "base_lowest_projected_balance": str(lowest.quantize(Decimal("0.01"))),
                "simulated_lowest_projected_balance": str(
                    (lowest + est_improve).quantize(Decimal("0.01"))
                ),
                "risk_resolved": lowest + est_improve >= (buffer if buffer > 0 else Decimal("0")),
                "improvement_amount": str(est_improve.quantize(Decimal("0.01"))),
                "result_status": "partial",
            }
            if det.kind == "restore_buffer" and det.related_account_id and transfer_sim_budget > 0:
                move_det = _restore_buffer_as_move_detection(det, forecast, account)
                sim_start = time.perf_counter()
                simulated = _simulation_preview_move(move_det, ctx, prepared=prepared)
                logger.info(
                    "resolve_risk scenario simulation account=%s kind=restore_buffer elapsed_ms=%.0f",
                    account_id,
                    (time.perf_counter() - sim_start) * 1000,
                )
                if simulated:
                    transfer_sim_budget -= 1
                    simulation = simulated
        elif _candidate_needs_transfer_simulation(det) and transfer_sim_budget > 0:
            sim_start = time.perf_counter()
            simulation = _simulation_preview_move(det, ctx, prepared=prepared)
            logger.info(
                "resolve_risk scenario simulation account=%s kind=%s elapsed_ms=%.0f",
                account_id,
                det.kind,
                (time.perf_counter() - sim_start) * 1000,
            )
            transfer_sim_budget -= 1

        if simulation.get("result_status") == "failed" and _candidate_needs_transfer_simulation(det):
            continue

        if not simulation and det.projected_improvement:
            simulation = {
                "risk_resolved": False,
                "result_status": "partial",
                "recovery_insight": det.projected_improvement,
            }

        actions.append(_action_dto(det, rec, simulation=simulation))

    actions.sort(
        key=lambda a: (
            0 if a.get("simulation", {}).get("risk_resolved") else 1,
            -(a.get("priority_score") or 0),
        )
    )

    logger.info(
        "resolve_risk total account=%s actions=%d elapsed_ms=%.0f",
        account_id,
        len(actions[:MAX_RETURNED_ACTIONS]),
        (time.perf_counter() - request_start) * 1000,
    )

    return {
        "eligible": True,
        "summary": summary,
        "actions": actions[:MAX_RETURNED_ACTIONS],
        "snooze_id": f"attention-{account_id}",
    }
