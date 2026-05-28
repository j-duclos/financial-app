"""
Deterministic what-if transfer simulation for the financial calendar.

Injects hypothetical transfer legs into the projection engine (never persisted),
rebuilds the calendar, and compares risk metrics vs the base forecast.

Designed for extension: payment delays, debt payoff, and scenario sandbox can reuse
``build_timeline_calendar(..., ephemeral_events=...)``.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from typing import Any, Optional

from django.utils import timezone

from accounts.models import Account
from accounts.services.available_to_spend import (
    calculate_forecast_summaries_for_accounts,
    dashboard_safe_to_spend_aggregate,
)
from core.utils import get_households_for_user
from insights.services.forecast_severity import (
    SEVERITY_DANGEROUS,
    SEVERITY_TIGHT,
    recovery_threshold_for_severity,
)
from timeline.models import ScenarioOneTimeEvent
from timeline.services.calendar import build_timeline_calendar
from timeline.services.scenario_comparison import _horizon_to_end


def _decimal(val) -> Decimal:
    if val is None:
        return Decimal("0")
    if isinstance(val, Decimal):
        return val
    return Decimal(str(val))


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


def _severity_for_day(day: dict[str, Any]) -> Optional[str]:
    level = day.get("heat_level")
    if level in (SEVERITY_DANGEROUS, SEVERITY_TIGHT):
        return level
    if day.get("is_negative"):
        return SEVERITY_DANGEROUS
    if day.get("has_risk"):
        return SEVERITY_TIGHT
    return None


def _risk_resolved_for_account(
    day: dict[str, Any],
    account_id: int,
    accounts_by_id: dict[int, Account],
) -> bool:
    severity = _severity_for_day(day)
    if not severity:
        return True
    acc = accounts_by_id.get(account_id)
    buffer = _decimal(acc.minimum_buffer or 0) if acc else Decimal("0")
    threshold = recovery_threshold_for_severity(severity, buffer)
    bal = _account_balance_on_day(day, account_id)
    if bal is None:
        bal = _decimal(day.get("lowest_projected_balance"))
    return bal is not None and bal >= threshold


def _result_status(
    *,
    base_day: Optional[dict[str, Any]],
    sim_day: Optional[dict[str, Any]],
    to_account_id: int,
    accounts_by_id: dict[int, Account],
) -> str:
    """resolved | partial | failed"""
    if not sim_day:
        return "failed"
    if _risk_resolved_for_account(sim_day, to_account_id, accounts_by_id):
        return "resolved"
    if base_day:
        base_bal = _account_balance_on_day(base_day, to_account_id)
        sim_bal = _account_balance_on_day(sim_day, to_account_id)
        if base_bal is not None and sim_bal is not None and sim_bal > base_bal:
            return "partial"
    return "failed"


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
) -> dict[str, Any]:
    """
    Compare base forecast vs forecast with one hypothetical transfer.

    Pure / deterministic — no DB writes.
    """
    today = as_of_date or timezone.localdate()
    end_date = _horizon_to_end(today, horizon)
    amt = abs(_decimal(amount)).quantize(Decimal("0.01"))

    households = get_households_for_user(user)
    accounts = list(Account.objects.filter(household__in=households).order_by("name"))
    accounts_by_id = {a.id: a for a in accounts}

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

    resolved_household = household_id or from_acc.household_id
    focus_iso = (focus_date or transfer_date).isoformat()

    base_calendar = build_timeline_calendar(
        user,
        start_date=today,
        end_date=end_date,
        scenario_id=scenario_id,
        household_id=resolved_household,
        as_of_date=today,
    )

    ephemeral = transfer_ephemeral_events(
        from_account=from_acc,
        to_account=to_acc,
        amount=amt,
        transfer_date=transfer_date,
    )
    sim_calendar = build_timeline_calendar(
        user,
        start_date=today,
        end_date=end_date,
        scenario_id=scenario_id,
        household_id=resolved_household,
        as_of_date=today,
        ephemeral_events=ephemeral,
    )

    base_day = _focus_day(base_calendar, focus_iso)
    sim_day = _focus_day(sim_calendar, focus_iso)

    base_lowest, base_lowest_date = _lowest_balance_for_account(
        base_calendar, to_account_id, on_or_after=today
    )
    sim_lowest, sim_lowest_date = _lowest_balance_for_account(
        sim_calendar, to_account_id, on_or_after=today
    )

    source_lowest, _ = _lowest_balance_for_account(sim_calendar, from_account_id, on_or_after=today)
    source_buffer = _decimal(from_acc.minimum_buffer or 0)
    source_warning = (
        source_lowest is not None
        and source_buffer > 0
        and source_lowest < source_buffer
    ) or (source_lowest is not None and source_lowest < 0)

    status = _result_status(
        base_day=base_day,
        sim_day=sim_day,
        to_account_id=to_account_id,
        accounts_by_id=accounts_by_id,
    )

    forecast_accounts = [a for a in accounts if a.participates_in_forecast()]
    horizon_days = max((end_date - today).days, 7)
    base_forecasts = calculate_forecast_summaries_for_accounts(
        user, forecast_accounts, as_of_date=today, days=min(horizon_days, 90)
    )
    base_sts = dashboard_safe_to_spend_aggregate(base_forecasts, accounts_by_id)

    # Safe-to-spend uses current forecast engine (transfer not persisted); surface base value.
    sts_after = base_sts.get("total_safe_to_spend")

    focus_lowest_base = None
    focus_lowest_sim = None
    if base_day:
        focus_lowest_base = _decimal(
            base_day.get("lowest_projected_balance")
            if base_day.get("lowest_projected_balance_account_id") == to_account_id
            else _account_balance_on_day(base_day, to_account_id)
        )
    if sim_day:
        focus_lowest_sim = _decimal(
            sim_day.get("lowest_projected_balance")
            if sim_day.get("lowest_projected_balance_account_id") == to_account_id
            else _account_balance_on_day(sim_day, to_account_id)
        )

    return {
        "from_account_id": from_account_id,
        "to_account_id": to_account_id,
        "amount": str(amt),
        "transfer_date": transfer_date.isoformat(),
        "focus_date": focus_iso,
        "result_status": status,
        "risk_resolved": status == "resolved",
        "base_lowest_projected_balance": (
            str(focus_lowest_base.quantize(Decimal("0.01")))
            if focus_lowest_base is not None
            else (str(base_lowest.quantize(Decimal("0.01"))) if base_lowest is not None else None)
        ),
        "simulated_lowest_projected_balance": (
            str(focus_lowest_sim.quantize(Decimal("0.01")))
            if focus_lowest_sim is not None
            else (str(sim_lowest.quantize(Decimal("0.01"))) if sim_lowest is not None else None)
        ),
        "horizon_lowest_projected_balance": (
            str(sim_lowest.quantize(Decimal("0.01"))) if sim_lowest is not None else None
        ),
        "horizon_lowest_date": sim_lowest_date,
        "base_horizon_lowest_date": base_lowest_date,
        "base_next_risk_date": (base_calendar.get("summary") or {}).get("next_risk_date"),
        "simulated_next_risk_date": (sim_calendar.get("summary") or {}).get("next_risk_date"),
        "safe_to_spend_after": sts_after,
        "base_safe_to_spend": base_sts.get("total_safe_to_spend"),
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
        "source_lowest_projected_balance": (
            str(source_lowest.quantize(Decimal("0.01"))) if source_lowest is not None else None
        ),
        "source_minimum_buffer": str(source_buffer.quantize(Decimal("0.01"))),
        "source_buffer_warning": source_warning,
        "to_account_name": to_acc.effective_display_name,
    }
