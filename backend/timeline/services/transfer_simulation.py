"""
Deterministic what-if transfer simulation for the financial calendar.

Injects hypothetical transfer legs into the projection engine (never persisted),
rebuilds the calendar, and compares risk metrics vs the base forecast.

Designed for extension: payment delays, debt payoff, and scenario sandbox can reuse
``build_timeline_calendar(..., ephemeral_events=...)``.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from typing import Any, Optional

from django.utils import timezone

from accounts.models import Account
from accounts.services.available_to_spend import (
    calculate_account_forecast_summary,
    dashboard_safe_to_spend_aggregate,
)
from core.utils import get_households_for_user
from timeline.models import ScenarioOneTimeEvent
from timeline.services.calendar import build_timeline_calendar
from timeline.services.ledger import build_timeline
from timeline.services.scenario_comparison import _horizon_to_end

logger = logging.getLogger(__name__)


def _decimal(val) -> Decimal:
    if val is None:
        return Decimal("0")
    if isinstance(val, Decimal):
        return val
    return Decimal(str(val))


@dataclass
class TransferSimulationContext:
    """Reusable base data for multiple transfer what-if scenarios."""

    user: Any
    accounts: list[Account]
    accounts_by_id: dict[int, Account]
    today: date
    end_date: date
    horizon: str
    household_id: int
    scenario_id: int | None
    base_calendar: dict[str, Any]
    base_timeline_rows: list[dict]
    base_forecasts: dict[int, dict[str, Any]]
    base_sts: dict[str, Any]
    horizon_days: int


def _transfer_category_name(to_account: Account) -> str:
    if getattr(to_account, "account_type", None) == Account.AccountType.CREDIT:
        return "Credit Card Payment"
    return "Bank Transfer"


def transfer_ephemeral_events(
    *,
    from_account: Account,
    to_account: Account,
    amount: Decimal,
    transfer_date: date,
) -> list[SimpleNamespace]:
    """Two ledger legs for a hypothetical transfer (outflow + inflow)."""
    amt = abs(_decimal(amount)).quantize(Decimal("0.01"))
    cat_name = _transfer_category_name(to_account)
    cat = SimpleNamespace(name=cat_name)
    label = f"What-if transfer → {to_account.effective_display_name}"
    return [
        SimpleNamespace(
            direction=ScenarioOneTimeEvent.Direction.EXPENSE,
            date=transfer_date,
            account_id=from_account.id,
            account=from_account,
            category=cat,
            category_id=None,
            description=label,
            amount=amt,
            id=-1,
        ),
        SimpleNamespace(
            direction=ScenarioOneTimeEvent.Direction.INCOME,
            date=transfer_date,
            account_id=to_account.id,
            account=to_account,
            category=cat,
            category_id=None,
            description=label,
            amount=amt,
            id=-2,
        ),
    ]


def prepare_transfer_simulation_context(
    user,
    *,
    horizon: str = "6m",
    as_of_date: Optional[date] = None,
    household_id: Optional[int] = None,
    scenario_id: Optional[int] = None,
    accounts: Optional[list[Account]] = None,
    accounts_by_id: Optional[dict[int, Account]] = None,
    base_forecasts: Optional[dict[int, dict[str, Any]]] = None,
    base_sts: Optional[dict[str, Any]] = None,
    timeline_rows: Optional[list[dict]] = None,
) -> TransferSimulationContext:
    """Build expensive immutable base state once for batch transfer simulations."""
    today = as_of_date or timezone.localdate()
    end_date = _horizon_to_end(today, horizon)
    horizon_days = max((end_date - today).days, 7)

    if accounts is None or accounts_by_id is None:
        households = get_households_for_user(user)
        accounts = list(Account.objects.filter(household__in=households).order_by("name"))
        accounts_by_id = {a.id: a for a in accounts}

    resolved_household = household_id
    if resolved_household is None and accounts:
        resolved_household = accounts[0].household_id

    if timeline_rows is None:
        timeline_rows = build_timeline(
            user,
            start_date=today,
            end_date=end_date,
            scenario_id=scenario_id,
            household_id=resolved_household,
            as_of_date=today,
            projection_only=True,
            caller="transfer_simulation_base",
        )

    base_calendar = build_timeline_calendar(
        user,
        start_date=today,
        end_date=end_date,
        scenario_id=scenario_id,
        household_id=resolved_household,
        as_of_date=today,
        timeline_rows=timeline_rows,
    )

    forecast_days = min(horizon_days, 90)
    if base_forecasts is None:
        forecast_accounts = [a for a in accounts if a.participates_in_forecast()]
        base_forecasts = {
            account.id: calculate_account_forecast_summary(
                user,
                account,
                as_of_date=today,
                days=forecast_days,
                timeline_rows=timeline_rows,
            )
            for account in forecast_accounts
        }

    if base_sts is None:
        base_sts = dashboard_safe_to_spend_aggregate(
            accounts_by_id,
            user=user,
            forecast_summaries=base_forecasts,
        )

    return TransferSimulationContext(
        user=user,
        accounts=accounts,
        accounts_by_id=accounts_by_id,
        today=today,
        end_date=end_date,
        horizon=horizon,
        household_id=int(resolved_household),
        scenario_id=scenario_id,
        base_calendar=base_calendar,
        base_timeline_rows=timeline_rows,
        base_forecasts=base_forecasts,
        base_sts=base_sts,
        horizon_days=horizon_days,
    )


def _account_balance_on_day(day: dict[str, Any], account_id: int) -> Decimal | None:
    balances = day.get("account_balances") or {}
    raw = balances.get(str(account_id)) or balances.get(account_id)
    if raw is not None:
        return _decimal(raw)
    if day.get("lowest_projected_balance_account_id") == account_id:
        return _decimal(day.get("lowest_projected_balance"))
    return None


def _lowest_balance_for_account(
    calendar: dict[str, Any],
    account_id: int,
    *,
    on_or_after: Optional[date] = None,
) -> tuple[Optional[Decimal], Optional[str]]:
    lowest: Optional[Decimal] = None
    lowest_date: Optional[str] = None
    for day in calendar.get("days") or []:
        d_iso = day.get("date")
        if not d_iso:
            continue
        if on_or_after is not None and date.fromisoformat(d_iso[:10]) < on_or_after:
            continue
        bal = _account_balance_on_day(day, account_id)
        if bal is None:
            continue
        if lowest is None or bal < lowest:
            lowest = bal
            lowest_date = d_iso
    return lowest, lowest_date


def _focus_day(calendar: dict[str, Any], focus_date: str) -> Optional[dict[str, Any]]:
    for day in calendar.get("days") or []:
        if day.get("date") == focus_date:
            return day
    return None


def _focus_date_balance(day: Optional[dict[str, Any]], account_id: int) -> Optional[Decimal]:
    if not day:
        return None
    if day.get("lowest_projected_balance_account_id") == account_id:
        return _decimal(day.get("lowest_projected_balance"))
    return _account_balance_on_day(day, account_id)


def _source_account_safe_after_transfer(
    source_lowest: Optional[Decimal],
    source_buffer: Decimal,
) -> bool:
    if source_lowest is None:
        return True
    if source_lowest < Decimal("0"):
        return False
    if source_buffer > 0 and source_lowest < source_buffer:
        return False
    return True


def _evaluate_transfer_result(
    *,
    base_horizon_lowest: Optional[Decimal],
    sim_horizon_lowest: Optional[Decimal],
    to_account: Account,
    source_lowest: Optional[Decimal],
    source_buffer: Decimal,
) -> tuple[str, bool]:
    """Return (result_status, risk_resolved) using horizon-wide destination metrics."""
    if not _source_account_safe_after_transfer(source_lowest, source_buffer):
        return "failed", False

    dest_buffer = _decimal(to_account.minimum_buffer or 0)
    threshold = dest_buffer if dest_buffer > 0 else Decimal("0")

    if sim_horizon_lowest is not None and sim_horizon_lowest >= threshold:
        return "resolved", True

    if (
        base_horizon_lowest is not None
        and sim_horizon_lowest is not None
        and sim_horizon_lowest > base_horizon_lowest
    ):
        return "partial", False

    return "failed", False


def _recovery_insight(
    *,
    base_day: Optional[dict[str, Any]],
    sim_day: Optional[dict[str, Any]],
    result_status: str,
    to_account_id: int,
) -> str:
    if result_status == "resolved":
        if sim_day and sim_day.get("recovery_date"):
            desc = (sim_day.get("recovery_description") or "").strip()
            if sim_day.get("recovery_is_payroll") and desc:
                return f"{desc} on {sim_day['recovery_date']} restores balance."
            if desc:
                return f"{desc} on {sim_day['recovery_date']} supports recovery."
            return "This transfer avoids overdraft on the stressed day."
        return "This transfer avoids overdraft completely."

    if sim_day and sim_day.get("recovery_date"):
        days = sim_day.get("recovery_days_until")
        desc = (sim_day.get("recovery_description") or "").strip()
        if desc and days is not None:
            return f"{desc} on {sim_day['recovery_date']} ({days} day{'s' if days != 1 else ''})."
        if days is not None:
            return f"Account recovers by {sim_day['recovery_date']} ({days} days)."

    if base_day and base_day.get("recovery_date") and result_status != "resolved":
        days = base_day.get("recovery_days_until")
        if days is not None and days > 0:
            return f"Without a transfer, balance stays stressed for about {days} more day{'s' if days != 1 else ''}."

    lowest = _decimal(sim_day.get("lowest_projected_balance")) if sim_day else None
    if lowest is not None and lowest < 0:
        return "Account remains projected negative after this transfer."
    return "Transfer helps but the day may still run tight."


def _merged_sim_forecasts(
    prepared: TransferSimulationContext,
    *,
    from_account_id: int,
    to_account_id: int,
    sim_timeline_rows: list[dict],
) -> dict[int, dict[str, Any]]:
    """Recalculate only affected accounts; reuse unchanged base forecasts."""
    merged = dict(prepared.base_forecasts)
    forecast_days = min(prepared.horizon_days, 90)
    for account_id in (from_account_id, to_account_id):
        account = prepared.accounts_by_id.get(account_id)
        if not account or not account.participates_in_forecast():
            continue
        merged[account_id] = calculate_account_forecast_summary(
            prepared.user,
            account,
            as_of_date=prepared.today,
            days=forecast_days,
            timeline_rows=sim_timeline_rows,
        )
    return merged


def simulate_transfer_impact(
    user,
    *,
    from_account_id: int,
    to_account_id: int,
    amount: Decimal,
    transfer_date: date,
    focus_date: Optional[date] = None,
    household_id: Optional[int] = None,
    scenario_id: Optional[int] = None,
    horizon: str = "6m",
    as_of_date: Optional[date] = None,
    prepared_context: TransferSimulationContext | None = None,
) -> dict[str, Any]:
    """
    Compare base forecast vs forecast with one hypothetical transfer.

    Pure / deterministic — no DB writes.
    """
    amt = abs(_decimal(amount)).quantize(Decimal("0.01"))

    if prepared_context is not None:
        prepared = prepared_context
        accounts_by_id = prepared.accounts_by_id
        today = prepared.today
        end_date = prepared.end_date
        resolved_household = prepared.household_id
        scenario_id = prepared.scenario_id
        base_calendar = prepared.base_calendar
    else:
        today = as_of_date or timezone.localdate()
        end_date = _horizon_to_end(today, horizon)
        households = get_households_for_user(user)
        accounts = list(Account.objects.filter(household__in=households).order_by("name"))
        accounts_by_id = {a.id: a for a in accounts}
        from_acc = accounts_by_id.get(from_account_id)
        if not from_acc:
            raise ValueError("Account not found")
        resolved_household = household_id or from_acc.household_id
        prepared = prepare_transfer_simulation_context(
            user,
            horizon=horizon,
            as_of_date=today,
            household_id=resolved_household,
            scenario_id=scenario_id,
            accounts=accounts,
            accounts_by_id=accounts_by_id,
        )
        base_calendar = prepared.base_calendar

    from_acc = accounts_by_id.get(from_account_id)
    to_acc = accounts_by_id.get(to_account_id)
    if not from_acc or not to_acc:
        raise ValueError("Account not found")
    if from_acc.household_id != to_acc.household_id:
        raise ValueError("Accounts must belong to the same household")
    if from_account_id == to_account_id:
        raise ValueError("From and to accounts must differ")
    if transfer_date < today:
        raise ValueError("Transfer date cannot be before today")
    if amt <= 0:
        raise ValueError("Amount must be positive")

    focus_iso = (focus_date or transfer_date).isoformat()

    ephemeral = transfer_ephemeral_events(
        from_account=from_acc,
        to_account=to_acc,
        amount=amt,
        transfer_date=transfer_date,
    )
    sim_timeline_rows = build_timeline(
        user,
        start_date=today,
        end_date=end_date,
        scenario_id=scenario_id,
        household_id=resolved_household,
        as_of_date=today,
        ephemeral_events=ephemeral,
        projection_only=True,
        caller="transfer_simulation_scenario",
    )
    sim_calendar = build_timeline_calendar(
        user,
        start_date=today,
        end_date=end_date,
        scenario_id=scenario_id,
        household_id=resolved_household,
        as_of_date=today,
        timeline_rows=sim_timeline_rows,
    )

    base_day = _focus_day(base_calendar, focus_iso)
    sim_day = _focus_day(sim_calendar, focus_iso)

    base_horizon_lowest, base_horizon_lowest_date = _lowest_balance_for_account(
        base_calendar, to_account_id, on_or_after=today
    )
    sim_horizon_lowest, sim_horizon_lowest_date = _lowest_balance_for_account(
        sim_calendar, to_account_id, on_or_after=today
    )

    base_focus_balance = _focus_date_balance(base_day, to_account_id)
    sim_focus_balance = _focus_date_balance(sim_day, to_account_id)

    source_horizon_lowest, _ = _lowest_balance_for_account(
        sim_calendar, from_account_id, on_or_after=today
    )
    source_buffer = _decimal(from_acc.minimum_buffer or 0)
    source_warning = not _source_account_safe_after_transfer(source_horizon_lowest, source_buffer)

    status, risk_resolved = _evaluate_transfer_result(
        base_horizon_lowest=base_horizon_lowest,
        sim_horizon_lowest=sim_horizon_lowest,
        to_account=to_acc,
        source_lowest=source_horizon_lowest,
        source_buffer=source_buffer,
    )

    if prepared_context is not None:
        sim_forecasts = _merged_sim_forecasts(
            prepared,
            from_account_id=from_account_id,
            to_account_id=to_account_id,
            sim_timeline_rows=sim_timeline_rows,
        )
        sts_after = dashboard_safe_to_spend_aggregate(
            accounts_by_id,
            user=user,
            forecast_summaries=sim_forecasts,
        ).get("total_safe_to_spend")
        base_sts = prepared.base_sts.get("total_safe_to_spend")
    else:
        sts_after = prepared.base_sts.get("total_safe_to_spend")
        base_sts = prepared.base_sts.get("total_safe_to_spend")

    def _fmt(val: Optional[Decimal]) -> Optional[str]:
        return str(val.quantize(Decimal("0.01"))) if val is not None else None

    return {
        "from_account_id": from_account_id,
        "to_account_id": to_account_id,
        "amount": str(amt),
        "transfer_date": transfer_date.isoformat(),
        "focus_date": focus_iso,
        "result_status": status,
        "risk_resolved": risk_resolved,
        "base_focus_date_balance": _fmt(base_focus_balance),
        "simulated_focus_date_balance": _fmt(sim_focus_balance),
        "base_horizon_lowest_projected_balance": _fmt(base_horizon_lowest),
        "base_horizon_lowest_date": base_horizon_lowest_date,
        "simulated_horizon_lowest_projected_balance": _fmt(sim_horizon_lowest),
        "simulated_horizon_lowest_date": sim_horizon_lowest_date,
        # Legacy fields — mapped to horizon-wide destination metrics for consistency.
        "base_lowest_projected_balance": _fmt(base_horizon_lowest),
        "simulated_lowest_projected_balance": _fmt(sim_horizon_lowest),
        "horizon_lowest_projected_balance": _fmt(sim_horizon_lowest),
        "horizon_lowest_date": sim_horizon_lowest_date,
        "base_next_risk_date": (base_calendar.get("summary") or {}).get("next_risk_date"),
        "simulated_next_risk_date": (sim_calendar.get("summary") or {}).get("next_risk_date"),
        "safe_to_spend_after": sts_after,
        "base_safe_to_spend": base_sts,
        "recovery_date": sim_day.get("recovery_date") if sim_day else None,
        "recovery_days_until": sim_day.get("recovery_days_until") if sim_day else None,
        "recovery_description": sim_day.get("recovery_description") if sim_day else None,
        "recovery_is_payroll": bool(sim_day.get("recovery_is_payroll")) if sim_day else False,
        "recovery_insight": _recovery_insight(
            base_day=base_day,
            sim_day=sim_day,
            result_status=status,
            to_account_id=to_account_id,
        ),
        "source_account_id": from_account_id,
        "source_account_name": from_acc.effective_display_name,
        "source_lowest_projected_balance": _fmt(source_horizon_lowest),
        "source_minimum_buffer": str(source_buffer.quantize(Decimal("0.01"))),
        "source_buffer_warning": source_warning,
        "to_account_name": to_acc.effective_display_name,
    }
