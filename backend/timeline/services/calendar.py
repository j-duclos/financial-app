"""
Financial calendar: daily cash-flow summaries and risk heatmap from timeline rows.

Reuses transfer classification from dashboard_upcoming so net totals exclude internal
transfers while transfers still appear in day detail lists.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal
from typing import Any, Optional

from accounts.models import Account
from accounts.services.available_to_spend import (
    RISK_STATUS_CRITICAL,
    RISK_STATUS_RISK,
    _decimal,
    account_supports_available_to_spend,
)
from core.utils import get_households_for_user
from insights.services.dashboard_summary import _classify_timeline_kind
from insights.services.dashboard_upcoming import (
    _day_risk_reason,
    _health_alert_names_for_date,
    _serialize_transaction,
    is_expense_for_dashboard_totals,
    is_income_for_dashboard_totals,
    is_internal_money_movement,
    load_transfer_rule_context,
)
from insights.services.day_heat import (
    AccountDayBalance,
    account_balances_from_txn_lows,
    calculate_day_heat,
    heat_to_risk_level,
)
from insights.services.day_credit_warnings import scan_credit_day_warnings
from insights.services.day_biggest_drivers import compute_biggest_drivers
from insights.services.day_lowest_balance import (
    account_balance_rows_from_transactions,
    calculate_day_lowest_marker,
    calculate_day_lowest_marker_from_snapshots,
    carry_forward_lowest_markers,
)
from insights.services.day_recovery import attach_recovery_to_days
from timeline.services.ledger import (
    _balance_at_end_of_date,
    build_timeline,
    is_superseded_planned_row,
)


def _parse_date(val) -> date | None:
    if val is None:
        return None
    if isinstance(val, date):
        return val
    try:
        return date.fromisoformat(str(val)[:10])
    except ValueError:
        return None


def _risk_level_for_balance(balance: Decimal, buffer: Decimal) -> str:
    if balance < Decimal("0"):
        return "critical"
    if buffer > 0 and balance < buffer:
        return "watch"
    return "none"


def _risk_reason_for_level(level: str, balance: Decimal, buffer: Decimal, day: date) -> str | None:
    if level == "none":
        return None
    ds = day.isoformat()
    if level == "critical":
        return f"Projected balance drops below zero on {ds}."
    if level == "watch":
        return f"Projected balance falls below your {buffer} buffer on {ds}."
    return None


def _timeline_row_to_event(
    row: dict[str, Any],
    accounts_by_id: dict[int, Account],
    transfer_rule_ids: set[int],
    transfer_rule_targets: dict[int, int],
) -> dict[str, Any]:
    kind = _classify_timeline_kind(
        row, accounts_by_id, transfer_rule_ids, transfer_rule_targets
    )
    amount = row.get("amount")
    return {
        "id": row.get("transaction_id") or f"r-{row.get('rule_id')}-{row.get('date')}",
        "date": row["date"] if isinstance(row["date"], str) else row["date"].isoformat(),
        "account_id": row.get("account_id"),
        "account_name": row.get("account_name") or "",
        "description": row.get("description") or "—",
        "amount": str(_decimal(amount).quantize(Decimal("0.01"))) if amount is not None else None,
        "kind": kind,
        "category": row.get("category_name"),
        "rule_id": row.get("rule_id"),
        "transaction_id": row.get("transaction_id"),
        "status": row.get("status"),
        "source": row.get("source") or row.get("txn_source"),
        "projected_balance": row.get("running_balance"),
        "balance_after": row.get("running_balance"),
        "is_risk": False,
        "transaction_type": row.get("transaction_type"),
        "transfer_group_id": row.get("transfer_group_id"),
    }


def _rows_for_account(rows: list[dict], account_id: int) -> list[dict]:
    return [r for r in rows if r.get("account_id") == account_id]


def _effective_buffer(account_id: int | None, accounts_by_id: dict[int, Account], cash_ids: list[int]) -> Decimal:
    if account_id is not None:
        acc = accounts_by_id.get(account_id)
        return _decimal(acc.minimum_buffer or 0) if acc else Decimal("0")
    total = Decimal("0")
    for aid in cash_ids:
        acc = accounts_by_id.get(aid)
        if acc:
            total += _decimal(acc.minimum_buffer or 0)
    return total


def _cash_account_ids(accounts: list[Account]) -> list[int]:
    return [
        a.id
        for a in accounts
        if a.participates_in_forecast() and account_supports_available_to_spend(a)
    ]


def build_timeline_calendar(
    user,
    *,
    start_date: date,
    end_date: date,
    scenario_id: Optional[int] = None,
    account_id: Optional[int] = None,
    household_id: Optional[int] = None,
    as_of_date: Optional[date] = None,
    ephemeral_events: Optional[list] = None,
) -> dict[str, Any]:
    today = as_of_date or date.today()
    # Full household timeline so transfer legs materialize; scope per account below.
    rows = build_timeline(
        user,
        start_date=start_date,
        end_date=end_date,
        scenario_id=scenario_id,
        account_id=None,
        household_id=household_id,
        as_of_date=as_of_date,
        ephemeral_events=ephemeral_events,
    )
    if account_id is not None:
        rows = [r for r in rows if r.get("account_id") == account_id]

    households = get_households_for_user(user)
    if household_id:
        accounts = list(
            Account.objects.filter(household_id=household_id).order_by("name")
        )
    else:
        accounts = list(Account.objects.filter(household__in=households).order_by("name"))
    accounts_by_id = {a.id: a for a in accounts}
    cash_ids = _cash_account_ids(accounts)
    if account_id is not None:
        scope_ids = [account_id]
    else:
        scope_ids = cash_ids

    transfer_rule_ids, transfer_rule_targets, transfer_rule_sources = load_transfer_rule_context(
        households
    )

    # Normalize row dates and filter superseded planned rows per account
    by_date_account_rows: dict[tuple[str, int], list[dict]] = defaultdict(list)
    by_date_all: dict[str, list[dict]] = defaultdict(list)

    for row in rows:
        rd = _parse_date(row.get("date"))
        if rd is None or rd < start_date or rd > end_date:
            continue
        date_iso = rd.isoformat()
        row = dict(row)
        row["date"] = date_iso
        aid = row.get("account_id")
        account_rows = _rows_for_account(rows, aid) if aid else []
        if aid and is_superseded_planned_row(row, account_rows):
            continue
        by_date_all[date_iso].append(row)
        if aid:
            by_date_account_rows[(date_iso, aid)].append(row)

    # Opening balances at start of range (day before start for carry-forward)
    opening: dict[int, Decimal] = {}
    for aid in scope_ids:
        try:
            opening[aid] = _balance_at_end_of_date(aid, start_date - timedelta(days=1))
        except Exception:
            opening[aid] = _decimal(
                accounts_by_id[aid].starting_balance if aid in accounts_by_id else 0
            )

    buffer = _effective_buffer(account_id, accounts_by_id, cash_ids)

    days_out: list[dict[str, Any]] = []
    global_lowest = None
    global_lowest_date = None
    next_risk_date = None
    total_income = Decimal("0")
    total_expenses = Decimal("0")
    best_balance = None
    best_date = None

    running: dict[int, Decimal] = dict(opening)
    d = start_date
    while d <= end_date:
        date_iso = d.isoformat()
        day_rows = by_date_all.get(date_iso, [])

        income = Decimal("0")
        expense = Decimal("0")
        transfer = Decimal("0")
        events: list[dict[str, Any]] = []
        marker_txns: list[dict[str, Any]] = []
        day_lowest = None

        for row in sorted(
            day_rows,
            key=lambda r: (
                r.get("account_id") or 0,
                r.get("transaction_id") or 0,
                r.get("rule_id") or 0,
            ),
        ):
            ev = _timeline_row_to_event(
                row, accounts_by_id, transfer_rule_ids, transfer_rule_targets
            )
            txn = _serialize_transaction(
                ev,
                transfer_rule_ids=transfer_rule_ids,
                transfer_rule_targets=transfer_rule_targets,
                transfer_rule_sources=transfer_rule_sources,
                accounts_by_id=accounts_by_id,
            )
            amt = _decimal(row.get("amount") or 0)
            aid = row.get("account_id")

            if aid in scope_ids:
                running[aid] = running.get(aid, opening.get(aid, Decimal("0"))) + amt
                acct_bal = running[aid]
                if day_lowest is None or acct_bal < day_lowest:
                    day_lowest = acct_bal
                txn["balance_after"] = str(acct_bal.quantize(Decimal("0.01")))
                marker_txns.append(txn)

            events.append(
                {
                    "id": txn.get("id"),
                    "account_id": aid,
                    "description": txn.get("description"),
                    "account_name": txn.get("account_name"),
                    "amount": txn.get("amount"),
                    "category": txn.get("category"),
                    "kind": txn.get("kind"),
                    "source": txn.get("source"),
                    "balance_after": txn.get("balance_after"),
                    "is_transfer": txn.get("is_transfer", False),
                }
            )

            if is_income_for_dashboard_totals(
                ev,
                transfer_rule_ids=transfer_rule_ids,
                transfer_rule_targets=transfer_rule_targets,
                accounts_by_id=accounts_by_id,
            ):
                income += amt
            elif is_expense_for_dashboard_totals(
                ev,
                transfer_rule_ids=transfer_rule_ids,
                transfer_rule_targets=transfer_rule_targets,
                accounts_by_id=accounts_by_id,
            ):
                expense += abs(amt)
            elif (
                txn.get("is_transfer")
                and amt < 0
            ):
                transfer += abs(amt)

        net = income - expense

        if account_id is not None:
            ending = running.get(account_id, opening.get(account_id, Decimal("0")))
            lowest = day_lowest if day_lowest is not None else ending
        else:
            ending = sum(running.get(aid, opening.get(aid, Decimal("0"))) for aid in scope_ids)
            lowest = ending
            for aid in scope_ids:
                bal = running.get(aid, opening.get(aid, Decimal("0")))
                if lowest is None or bal < lowest:
                    lowest = bal

        if day_rows:
            total_income += income
            total_expenses += expense

        account_snapshots: list[AccountDayBalance] = []
        for aid in scope_ids:
            acc = accounts_by_id.get(aid)
            if not acc:
                continue
            bal = running.get(aid, opening.get(aid, Decimal("0")))
            account_snapshots.append(
                AccountDayBalance(
                    account_name=acc.effective_display_name,
                    balance=bal,
                    minimum_buffer=_decimal(acc.minimum_buffer or 0),
                )
            )

        health_names = _health_alert_names_for_date(date_iso, {}, accounts_by_id)
        if day_rows:
            txn_risk = _day_risk_reason(date_iso, events, {}, accounts_by_id)
            if txn_risk:
                for part in txn_risk.replace(" projected below buffer", "").split(" and "):
                    name = part.strip()
                    if name and name not in health_names:
                        health_names.append(name)

        if marker_txns:
            balance_rows = account_balance_rows_from_transactions(marker_txns)
            heat_balances = account_balances_from_txn_lows(
                balance_rows, accounts_by_id
            )
        else:
            heat_balances = account_snapshots

        heat = calculate_day_heat(
            has_activity=bool(day_rows),
            account_balances=heat_balances,
            health_alert_names=health_names,
        )
        credit_balance_warnings = scan_credit_day_warnings(
            marker_txns, accounts_by_id
        )
        lowest_marker = calculate_day_lowest_marker(
            marker_txns,
            accounts_by_id,
            date_iso=date_iso,
            heat_level=heat["heat_level"],
            scope_account_id=account_id,
        )
        if not lowest_marker["show_lowest_balance_marker"] and heat["heat_level"] in (
            "tight",
            "dangerous",
        ):
            snapshot_marker = calculate_day_lowest_marker_from_snapshots(
                account_snapshots,
                accounts_by_id,
                date_iso=date_iso,
                heat_level=heat["heat_level"],
                scope_account_id=account_id,
            )
            if snapshot_marker["show_lowest_balance_marker"]:
                lowest_marker = snapshot_marker
        risk_level = heat_to_risk_level(heat["heat_level"])
        risk_reason = heat.get("heat_reason")
        if not risk_reason and day_rows:
            risk_reason = _risk_reason_for_level(
                risk_level, ending, buffer, d
            ) or _day_risk_reason(date_iso, events, {}, accounts_by_id)

        has_risk = heat["heat_level"] in ("tight", "dangerous")

        if global_lowest is None or lowest < global_lowest:
            global_lowest = lowest
            global_lowest_date = date_iso

        if has_risk and next_risk_date is None and d >= today:
            next_risk_date = date_iso

        if best_balance is None or ending > best_balance:
            best_balance = ending
            best_date = date_iso

        account_balance_map = {
            str(aid): str(
                running.get(aid, opening.get(aid, Decimal("0"))).quantize(Decimal("0.01"))
            )
            for aid in scope_ids
        }

        days_out.append(
            {
                "date": date_iso,
                "income_total": str(income.quantize(Decimal("0.01"))),
                "expense_total": str(expense.quantize(Decimal("0.01"))),
                "transfer_total": str(transfer.quantize(Decimal("0.01"))),
                "net_total": str(net.quantize(Decimal("0.01"))),
                "ending_balance": str(ending.quantize(Decimal("0.01"))),
                "account_balances": account_balance_map,
                "lowest_balance": str((lowest if lowest is not None else ending).quantize(Decimal("0.01"))),
                "risk_level": risk_level,
                "risk_reason": risk_reason,
                "has_risk": has_risk,
                "heat_level": heat["heat_level"],
                "heat_label": heat["heat_label"],
                "heat_reason": heat["heat_reason"],
                "affected_account_name": heat["affected_account_name"],
                "lowest_projected_balance": lowest_marker["lowest_projected_balance"]
                or heat["lowest_projected_balance"],
                "below_buffer_amount": lowest_marker["below_buffer_amount"]
                or heat["below_buffer_amount"],
                "is_negative": heat["is_negative"],
                "lowest_projected_balance_account_id": lowest_marker[
                    "lowest_projected_balance_account_id"
                ],
                "lowest_projected_balance_account_name": lowest_marker[
                    "lowest_projected_balance_account_name"
                ],
                "lowest_projected_balance_transaction_id": lowest_marker[
                    "lowest_projected_balance_transaction_id"
                ],
                "lowest_projected_balance_after_description": lowest_marker[
                    "lowest_projected_balance_after_description"
                ],
                "lowest_projected_balance_date": lowest_marker[
                    "lowest_projected_balance_date"
                ],
                "amount_needed_to_zero": lowest_marker["amount_needed_to_zero"],
                "amount_needed_to_buffer": lowest_marker["amount_needed_to_buffer"],
                "show_lowest_balance_marker": lowest_marker["show_lowest_balance_marker"],
                "credit_balance_warnings": credit_balance_warnings,
                "biggest_drivers": compute_biggest_drivers(events),
                "transactions": events,
            }
        )
        d += timedelta(days=1)

    carry_forward_lowest_markers(days_out)
    attach_recovery_to_days(days_out, accounts_by_id=accounts_by_id)
    for day_payload in days_out:
        day_payload.pop("account_balances", None)

    scenario_name = None
    if scenario_id:
        from timeline.models import Scenario

        sc = Scenario.objects.filter(pk=scenario_id).first()
        scenario_name = sc.name if sc else None

    risky_accounts: list[dict[str, Any]] = []
    if account_id is None and cash_ids:
        from accounts.services.available_to_spend import calculate_account_forecast_summary

        horizon_days = (end_date - today).days
        for aid in cash_ids:
            acc = accounts_by_id.get(aid)
            if not acc:
                continue
            try:
                summary = calculate_account_forecast_summary(
                    user,
                    acc,
                    as_of_date=today,
                    days=min(max(horizon_days, 7), 90),
                    timeline_rows=rows,
                )
            except Exception:
                continue
            status = summary.get("risk_status")
            if status in (RISK_STATUS_CRITICAL, RISK_STATUS_RISK):
                risky_accounts.append(
                    {
                        "account_id": aid,
                        "account_name": acc.effective_display_name,
                        "lowest_projected_balance": summary.get("lowest_projected_balance"),
                        "risk_date": summary.get("risk_date"),
                        "risk_status": status,
                    }
                )
        risky_accounts.sort(
            key=lambda x: (
                0 if x.get("risk_status") == RISK_STATUS_CRITICAL else 1,
                x.get("risk_date") or "9999-12-31",
            )
        )
        risky_accounts = risky_accounts[:3]

    return {
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "scenario_id": scenario_id,
        "scenario_name": scenario_name,
        "account_id": account_id,
        "summary": {
            "lowest_balance": str(global_lowest.quantize(Decimal("0.01"))) if global_lowest is not None else None,
            "lowest_balance_date": global_lowest_date,
            "next_risk_date": next_risk_date,
            "best_balance": str(best_balance.quantize(Decimal("0.01"))) if best_balance is not None else None,
            "best_balance_date": best_date,
            "total_income": str(total_income.quantize(Decimal("0.01"))),
            "total_expenses": str(total_expenses.quantize(Decimal("0.01"))),
            "total_net": str((total_income - total_expenses).quantize(Decimal("0.01"))),
            "risky_accounts": risky_accounts,
        },
        "days": days_out,
    }
