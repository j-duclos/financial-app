"""Base vs scenario comparison metrics for the what-if sandbox."""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from typing import Any, Optional

from django.utils import timezone

from accounts.models import Account
from accounts.services.available_to_spend import (
    calculate_forecast_summaries_for_accounts,
    dashboard_safe_to_spend_aggregate,
)
from accounts.services.balances import compute_net_worth
from core.utils import get_households_for_user
from timeline.models import Scenario
from timeline.services.calendar import build_timeline_calendar
from timeline.services.ledger import build_timeline


def _horizon_to_end(today: date, horizon: str) -> date:
    if horizon == "14d":
        return today + timedelta(days=14)
    if horizon == "3m":
        return today + timedelta(days=90)
    if horizon == "6m":
        return today + timedelta(days=180)
    if horizon == "12m":
        return today + timedelta(days=365)
    if horizon == "18m":
        return today + timedelta(days=548)
    if horizon == "24m":
        return today + timedelta(days=730)
    if horizon == "36m":
        return today + timedelta(days=1095)
    return today + timedelta(days=180)


def _decimal(val) -> Decimal:
    if val is None:
        return Decimal("0")
    if isinstance(val, Decimal):
        return val
    return Decimal(str(val))


def _ending_cash(rows: list[dict], accounts: list[Account]) -> Decimal:
    cash_ids = {
        a.id
        for a in accounts
        if a.participates_in_forecast()
        and getattr(a, "account_type", None) in (
            Account.AccountType.CHECKING,
            Account.AccountType.SAVINGS,
            Account.AccountType.CASH,
        )
    }
    last_by_account: dict[int, Decimal] = {}
    for r in rows:
        aid = r.get("account_id")
        if aid in cash_ids:
            last_by_account[aid] = _decimal(r.get("running_balance"))
    return sum(last_by_account.values(), Decimal("0"))


def _account_type_balance(rows: list[dict], account_type: str) -> Decimal:
    last: dict[int, Decimal] = {}
    for r in rows:
        aid = r.get("account_id")
        acc_type = (r.get("account_type") or "").upper()
        if acc_type == account_type.upper():
            last[aid] = _decimal(r.get("running_balance"))
    return sum(last.values(), Decimal("0"))


def _enrich_rows_with_account_type(rows: list[dict], accounts_by_id: dict[int, Account]) -> list[dict]:
    out = []
    for r in rows:
        row = dict(r)
        acc = accounts_by_id.get(row.get("account_id"))
        if acc:
            row["account_type"] = acc.account_type
        out.append(row)
    return out


def _metrics_from_calendar(
    calendar: dict[str, Any],
    rows: list[dict],
    accounts: list[Account],
    user,
    today: date,
    end_date: date,
) -> dict[str, Any]:
    summary = calendar.get("summary") or {}
    accounts_by_id = {a.id: a for a in accounts}
    enriched = _enrich_rows_with_account_type(rows, accounts_by_id)

    forecast_accounts = [a for a in accounts if a.participates_in_forecast()]
    horizon_days = max((end_date - today).days, 7)
    forecasts = calculate_forecast_summaries_for_accounts(
        user, forecast_accounts, as_of_date=today, days=min(horizon_days, 90)
    )
    sts = dashboard_safe_to_spend_aggregate(forecasts, accounts_by_id)

    risk_days = sum(1 for d in calendar.get("days") or [] if d.get("has_risk"))

    credit_debt = Decimal("0")
    savings = Decimal("0")
    for a in accounts:
        bal = None
        for r in reversed(enriched):
            if r.get("account_id") == a.id:
                bal = _decimal(r.get("running_balance"))
                break
        if bal is None:
            continue
        if a.account_type == Account.AccountType.CREDIT:
            credit_debt += abs(min(bal, Decimal("0")))
        elif a.account_type == Account.AccountType.SAVINGS:
            savings += max(bal, Decimal("0"))

    net_worth_accounts = list(
        Account.objects.for_net_worth().filter(
            pk__in=[a.id for a in accounts], is_hidden=False
        )
    )
    net_worth = compute_net_worth(net_worth_accounts, end_date)

    transfer_total = _decimal(summary.get("total_transfers") if "total_transfers" in summary else None)
    if transfer_total == 0:
        transfer_total = sum(
            _decimal(d.get("transfer_total"))
            for d in calendar.get("days") or []
        )

    return {
        "ending_cash": str(_ending_cash(enriched, accounts).quantize(Decimal("0.01"))),
        "lowest_projected_balance": summary.get("lowest_balance"),
        "lowest_projected_balance_date": summary.get("lowest_balance_date"),
        "safe_to_spend": sts.get("total_safe_to_spend"),
        "total_income": summary.get("total_income"),
        "total_expenses": summary.get("total_expenses"),
        "total_transfers": str(transfer_total.quantize(Decimal("0.01"))),
        "credit_debt_after_horizon": str(credit_debt.quantize(Decimal("0.01"))),
        "savings_after_horizon": str(savings.quantize(Decimal("0.01"))),
        "net_worth_after_horizon": str(net_worth.quantize(Decimal("0.01"))),
        "risk_days": risk_days,
        "first_risk_date": summary.get("next_risk_date"),
    }


NON_NUMERIC_METRICS = frozenset({"first_risk_date", "lowest_projected_balance_date"})


def _delta(base_val, scenario_val, key: str) -> Optional[str]:
    if key in NON_NUMERIC_METRICS:
        return None
    if base_val is None and scenario_val is None:
        return None
    try:
        b = _decimal(base_val)
        s = _decimal(scenario_val)
    except Exception:
        return None
    return str((s - b).quantize(Decimal("0.01")))


def build_scenario_comparison(
    user,
    scenario_id: int,
    *,
    horizon: str = "12m",
    household_id: Optional[int] = None,
    as_of_date: Optional[date] = None,
) -> dict[str, Any]:
    today = as_of_date or timezone.localdate()
    end_date = _horizon_to_end(today, horizon)
    households = get_households_for_user(user)
    if household_id:
        households = households.filter(pk=household_id)
    scenario = Scenario.objects.filter(household__in=households, pk=scenario_id).first()
    if not scenario:
        raise ValueError("Scenario not found")

    base_calendar = build_timeline_calendar(
        user,
        start_date=today,
        end_date=end_date,
        scenario_id=None,
        household_id=household_id or scenario.household_id,
        as_of_date=today,
    )
    scenario_calendar = build_timeline_calendar(
        user,
        start_date=today,
        end_date=end_date,
        scenario_id=scenario_id,
        household_id=household_id or scenario.household_id,
        as_of_date=today,
    )

    base_rows = build_timeline(
        user,
        start_date=today,
        end_date=end_date,
        scenario_id=None,
        household_id=household_id or scenario.household_id,
        as_of_date=today,
    )
    scenario_rows = build_timeline(
        user,
        start_date=today,
        end_date=end_date,
        scenario_id=scenario_id,
        household_id=household_id or scenario.household_id,
        as_of_date=today,
    )

    accounts = list(
        Account.objects.filter(household_id=scenario.household_id, is_hidden=False).order_by("name")
    )

    base_m = _metrics_from_calendar(base_calendar, base_rows, accounts, user, today, end_date)
    scenario_m = _metrics_from_calendar(scenario_calendar, scenario_rows, accounts, user, today, end_date)

    metric_keys = list(base_m.keys())
    comparison: dict[str, Any] = {}
    for key in metric_keys:
        comparison[key] = {
            "base": base_m[key],
            "scenario": scenario_m[key],
            "delta": _delta(base_m[key], scenario_m[key], key),
        }

    verdict = _build_verdict(comparison)

    return {
        "scenario_id": scenario_id,
        "scenario_name": scenario.name,
        "horizon": horizon,
        "start_date": today.isoformat(),
        "end_date": end_date.isoformat(),
        "metrics": comparison,
        "summary": verdict,
    }


def _build_verdict(comparison: dict[str, Any]) -> dict[str, Any]:
    ending_delta = _decimal(comparison.get("ending_cash", {}).get("delta"))
    risk_delta = int(_decimal(comparison.get("risk_days", {}).get("delta") or 0))
    debt_delta = _decimal(comparison.get("credit_debt_after_horizon", {}).get("delta"))

    if ending_delta > 0 and risk_delta <= 0:
        overall = "better"
    elif ending_delta < 0 or risk_delta > 0:
        overall = "worse" if risk_delta <= 0 else "riskier"
    else:
        overall = "neutral"

    messages: list[str] = []
    if risk_delta > 0:
        messages.append(
            f"This scenario creates {risk_delta} additional risk day{'s' if risk_delta != 1 else ''}."
        )
    elif risk_delta < 0:
        messages.append(
            f"This scenario removes {abs(risk_delta)} risk day{'s' if abs(risk_delta) != 1 else ''}."
        )
    if debt_delta < 0:
        messages.append(f"This scenario improves debt by {format(abs(debt_delta), ',.2f')}.")
    elif debt_delta > 0:
        messages.append(f"This scenario increases debt by {format(debt_delta, ',.2f')}.")

    return {"overall": overall, "messages": messages}


def evaluate_affordability(
    user,
    *,
    account_id: int,
    amount: Decimal,
    event_date: date,
    description: str = "What-if purchase",
    household_id: Optional[int] = None,
    horizon: str = "6m",
    as_of_date: Optional[date] = None,
) -> dict[str, Any]:
    """
    In-memory what-if: base timeline vs base + one-time expense on event_date.
    Does not persist anything.
    """
    from types import SimpleNamespace

    from timeline.models import ScenarioOneTimeEvent

    today = as_of_date or timezone.localdate()
    end_date = _horizon_to_end(today, horizon)
    amt = abs(_decimal(amount))

    base_calendar = build_timeline_calendar(
        user,
        start_date=today,
        end_date=end_date,
        account_id=account_id,
        household_id=household_id,
        as_of_date=today,
    )
    base_summary = base_calendar.get("summary") or {}
    base_lowest = _decimal(base_summary.get("lowest_balance"))

    ephemeral = SimpleNamespace(
        direction=ScenarioOneTimeEvent.Direction.EXPENSE,
        date=event_date,
        account_id=account_id,
        account=None,
        category=None,
        category_id=None,
        description=description,
        amount=amt,
        id=0,
    )

    whatif_rows = build_timeline(
        user,
        start_date=today,
        end_date=end_date,
        account_id=account_id,
        household_id=household_id,
        as_of_date=today,
        ephemeral_events=[ephemeral],
    )

    lowest = None
    lowest_date = None
    for r in whatif_rows:
        if r.get("account_id") != account_id:
            continue
        bal = _decimal(r.get("running_balance"))
        rd = r.get("date")
        if hasattr(rd, "isoformat") and not isinstance(rd, date):
            rd = date.fromisoformat(str(rd)[:10])
        if lowest is None or bal < lowest:
            lowest = bal
            lowest_date = rd.isoformat() if hasattr(rd, "isoformat") else str(rd)

    buffer = Decimal("0")
    can_afford = lowest is not None and lowest >= buffer

    households = get_households_for_user(user)
    accounts = list(Account.objects.filter(household__in=households, pk=account_id))
    forecast_accounts = [a for a in accounts if a.participates_in_forecast()]
    forecasts = calculate_forecast_summaries_for_accounts(
        user, forecast_accounts, as_of_date=today, days=min((end_date - today).days, 90)
    )
    accounts_by_id = {a.id: a for a in accounts}
    sts_after = dashboard_safe_to_spend_aggregate(forecasts, accounts_by_id)

    return {
        "affordable": can_afford,
        "lowest_projected_balance": str(lowest.quantize(Decimal("0.01"))) if lowest is not None else None,
        "lowest_projected_balance_date": lowest_date,
        "safe_to_spend_after": sts_after.get("total_safe_to_spend"),
        "base_lowest_projected_balance": str(base_lowest.quantize(Decimal("0.01"))),
        "amount": str(amt.quantize(Decimal("0.01"))),
        "date": event_date.isoformat(),
        "account_id": account_id,
        "description": description,
    }
