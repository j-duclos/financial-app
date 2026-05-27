"""
Rule-based dashboard insights. Explainable, deterministic — no AI.
Avoid duplicating exact wording from Attention Required cards.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any

from accounts.models import Account
from accounts.services.account_health_constants import (
    HEALTH_STATUS_CRITICAL,
    HEALTH_STATUS_RISK,
    PAYMENT_DUE_RISK_DAYS,
)
from accounts.services.available_to_spend import _decimal
from insights.services.dashboard_upcoming import is_expense_for_dashboard_totals

INSIGHT_LIMIT = 5

SEVERITY_RANK = {
    "critical": 0,
    "warning": 1,
    "info": 2,
    "positive": 3,
}


def _timeline_url(focus_date: str | date | None = None) -> str:
    if not focus_date:
        return "/timeline"
    if isinstance(focus_date, date):
        focus_date = focus_date.isoformat()
    return f"/timeline?date={focus_date}"


def _insight(
    insight_id: str,
    severity: str,
    title: str,
    message: str,
    *,
    metric_label: str | None = None,
    metric_value: str | None = None,
    action_label: str | None = None,
    action_url: str | None = None,
    secondary_action_label: str | None = None,
    secondary_action_url: str | None = None,
) -> dict[str, Any]:
    return {
        "id": insight_id,
        "severity": severity,
        "title": title,
        "message": message,
        "metric_label": metric_label,
        "metric_value": metric_value,
        "action_label": action_label,
        "action_url": action_url,
        "secondary_action_label": secondary_action_label,
        "secondary_action_url": secondary_action_url,
    }


def _format_short_date(iso_date: str | None) -> str | None:
    if not iso_date:
        return None
    try:
        d = date.fromisoformat(iso_date[:10])
    except ValueError:
        return None
    return d.strftime("%b %d").replace(" 0", " ")


def _attention_account_ids(attention: list[dict[str, Any]]) -> set[int]:
    return {int(a["account_id"]) for a in attention if a.get("account_id") is not None}


def _ledger_url(account_id: int) -> str:
    return "/transactions"


def _account_url(account_id: int) -> str:
    return f"/accounts?account={account_id}"


def _insights_safe_to_spend_negative(
    st_aggregate: dict[str, Any],
    attention_ids: set[int],
) -> dict[str, Any] | None:
    total = _decimal(st_aggregate.get("total_safe_to_spend") or 0)
    if total >= 0:
        return None
    return _insight(
        "safe_to_spend_negative",
        "critical",
        "Safe-to-spend is negative",
        f"Household safe-to-spend is {total.quantize(Decimal('0.01'))} across spending accounts. Review upcoming bills and transfers.",
        metric_label="Safe to spend",
        metric_value=str(abs(total).quantize(Decimal("0.01"))),
        action_label="View accounts",
        action_url="/accounts?attention=1",
    )


def _insights_credit_risk(
    health_by_id: dict[int, dict[str, Any]],
    accounts_by_id: dict[int, Account],
    attention_ids: set[int],
    today: date,
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for aid, health in health_by_id.items():
        if aid in attention_ids:
            continue
        account = accounts_by_id.get(aid)
        if not account or not account.is_credit_card():
            continue
        status = health.get("status", "healthy")
        if status not in (HEALTH_STATUS_CRITICAL, HEALTH_STATUS_RISK):
            continue
        reason = (health.get("reason") or "").lower()
        details = health.get("details") or {}
        util = details.get("utilization_percent")
        days = details.get("days_until_due")

        if util and _decimal(util) >= Decimal("90"):
            target = details.get("target_utilization_percent") or "30"
            out.append(
                _insight(
                    f"credit_util_{aid}",
                    "warning",
                    f"{account.effective_display_name} utilization high",
                    f"Utilization is {_decimal(util):.0f}%. Paying down balance helps reach your {target}% target.",
                    metric_label="Utilization",
                    metric_value=f"{_decimal(util):.0f}%",
                    action_label="Open ledger",
                    action_url=_ledger_url(aid),
                    secondary_action_label="Make payment",
                    secondary_action_url=_account_url(aid),
                )
            )
        elif days is not None and 0 <= int(days) <= PAYMENT_DUE_RISK_DAYS:
            due_label = _format_short_date(health.get("risk_date"))
            out.append(
                _insight(
                    f"credit_due_{aid}",
                    "warning",
                    f"Payment due on {account.effective_display_name}",
                    f"Confirm a payment before {due_label or 'the due date'}.",
                    action_label="Open ledger",
                    action_url=_ledger_url(aid),
                )
            )
    return out


def _insights_upcoming_cashflow(
    upcoming_events: list[dict[str, Any]],
    upcoming_groups: list[dict[str, Any]],
    transfer_rule_ids: set[int],
    transfer_rule_targets: dict[int, int],
    accounts_by_id: dict[int, Account],
    today: date,
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    expenses: list[dict[str, Any]] = []

    for ev in upcoming_events:
        if is_expense_for_dashboard_totals(
            ev,
            transfer_rule_ids=transfer_rule_ids,
            transfer_rule_targets=transfer_rule_targets,
            accounts_by_id=accounts_by_id,
        ):
            expenses.append(ev)

    if expenses:
        largest = min(expenses, key=lambda e: _decimal(e.get("amount") or 0))
        amt = abs(_decimal(largest.get("amount") or 0))
        if amt >= Decimal("100"):
            date_label = _format_short_date(largest.get("date")) or largest.get("date", "")
            desc = largest.get("description") or "Expense"
            out.append(
                _insight(
                    f"largest_expense_{largest.get('date')}_{largest.get('account_id')}",
                    "info",
                    "Largest upcoming expense",
                    f"{desc}: ${amt.quantize(Decimal('0.01'))} on {date_label}.",
                    metric_label="Amount",
                    metric_value=str(amt.quantize(Decimal("0.01"))),
                    action_label="Open calendar",
                    action_url=_timeline_url(largest.get("date")),
                )
            )

        total_exp = sum(
            (abs(_decimal(e.get("amount") or 0)) for e in expenses),
            Decimal("0"),
        )
        if total_exp > 0 and len(expenses) >= 2:
            out.append(
                _insight(
                    "upcoming_expenses_total",
                    "info",
                    "Upcoming bills in the next 14 days",
                    f"You have ${total_exp.quantize(Decimal('0.01'))} in projected expenses across {len(expenses)} items (transfers excluded).",
                    metric_label="Total expenses",
                    metric_value=str(total_exp.quantize(Decimal("0.01"))),
                    action_label="Open calendar",
                    action_url="/timeline",
                )
            )

    worst_day = None
    worst_net = Decimal("0")
    for group in upcoming_groups:
        net = _decimal(group.get("net_total") or 0)
        if net < worst_net:
            worst_net = net
            worst_day = group

    if worst_day and worst_net < Decimal("-100"):
        date_label = worst_day.get("label") or worst_day.get("date", "")
        out.append(
            _insight(
                f"worst_day_{worst_day.get('date')}",
                "warning",
                "Heaviest cash outflow day",
                f"{date_label} has net {worst_net.quantize(Decimal('0.01'))} after excluding internal transfers.",
                metric_label="Net",
                metric_value=str(worst_net.quantize(Decimal("0.01"))),
                action_label="Open calendar",
                action_url=_timeline_url(worst_day.get("date")),
            )
        )

    has_transfers = any(g.get("transfers_excluded") for g in upcoming_groups)
    if has_transfers and not any(i["id"] == "transfers_excluded_note" for i in out):
        out.append(
            _insight(
                "transfers_excluded_note",
                "info",
                "Transfers in upcoming view",
                "Internal transfers are shown in the daily list but excluded from income, expense, and net subtotals.",
                action_label="Open calendar",
                action_url="/timeline",
            )
        )

    return out


def _insights_import_hygiene(
    health_by_id: dict[int, dict[str, Any]],
    accounts_by_id: dict[int, Account],
    attention_ids: set[int],
) -> list[dict[str, Any]]:
    rows: list[tuple[int, int, str]] = []
    for aid, health in health_by_id.items():
        if aid in attention_ids:
            continue
        count = int((health.get("details") or {}).get("unmatched_import_count") or 0)
        if count <= 0:
            continue
        account = accounts_by_id.get(aid)
        if account:
            rows.append((aid, count, account.effective_display_name))
    if not rows:
        return []
    total = sum(c for _, c, _ in rows)
    if len(rows) == 1:
        aid, count, name = rows[0]
        plural = "s" if count != 1 else ""
        return [
            _insight(
                f"imports_unmatched_{aid}",
                "info",
                "Imported transactions need matching",
                f"{name} has {count} unmatched import{plural}. Review and match them to keep balances accurate.",
                metric_label="Unmatched",
                metric_value=str(count),
                action_label="Review transactions",
                action_url=_ledger_url(aid),
            )
        ]
    return [
        _insight(
            "imports_unmatched_total",
            "info",
            "Imported transactions need matching",
            f"You have {total} unmatched imports across {len(rows)} accounts.",
            metric_label="Unmatched",
            metric_value=str(total),
            action_label="Review transactions",
            action_url="/transactions",
        )
    ]


def _insights_unreconciled_hygiene(
    accounts: list[Account],
    attention_ids: set[int],
    today: date,
) -> list[dict[str, Any]]:
    from transactions.services.reconciliation import unreconciled_transactions_qs

    rows: list[tuple[Account, int]] = []
    for acc in accounts:
        if acc.status != Account.Status.ACTIVE or acc.is_hidden or acc.id in attention_ids:
            continue
        count = unreconciled_transactions_qs(acc, today).count()
        if count > 0:
            rows.append((acc, count))
    if not rows:
        return []
    total = sum(c for _, c in rows)
    acc, count = max(rows, key=lambda x: x[1])
    if len(rows) == 1:
        plural = "s" if count != 1 else ""
        return [
            _insight(
                f"unreconciled_{acc.id}",
                "info",
                "Unreconciled transactions",
                f"{acc.effective_display_name} has {count} unreconciled transaction{plural}.",
                metric_label="Unreconciled",
                metric_value=str(count),
                action_label="Reconcile",
                action_url=f"/reconcile?account={acc.id}",
            )
        ]
    return [
        _insight(
            "unreconciled_total",
            "info",
            "Unreconciled transactions",
            f"You have {total} unreconciled transactions across {len(rows)} accounts.",
            metric_label="Unreconciled",
            metric_value=str(total),
            action_label="Reconcile",
            action_url="/reconcile",
        )
    ]


def _insights_reconciliation_hygiene(
    accounts: list[Account],
    attention_ids: set[int],
    today: date,
) -> list[dict[str, Any]]:
    from transactions.services.reconciliation import last_completed_reconciliation

    out: list[dict[str, Any]] = []
    stale_accounts: list[tuple[Account, date]] = []

    for acc in accounts:
        if acc.status != Account.Status.ACTIVE or acc.is_hidden:
            continue
        last_rec = last_completed_reconciliation(acc)
        if last_rec and last_rec.completed_at:
            completed = last_rec.completed_at.date()
            if (today - completed).days > 45:
                stale_accounts.append((acc, completed))

    if stale_accounts:
        acc, completed = min(stale_accounts, key=lambda x: x[1])
        if acc.id not in attention_ids:
            out.append(
                _insight(
                    f"reconcile_stale_{acc.id}",
                    "info",
                    "Reconciliation overdue",
                    f"{acc.effective_display_name} was last reconciled {completed.isoformat()}. Consider reconciling to confirm your balance.",
                    action_label="Reconcile",
                    action_url=f"/reconcile?account={acc.id}",
                )
            )

    return out


def _insights_goals(
    dashboard_goals: list[dict[str, Any]],
    all_goals_count: int,
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for g in dashboard_goals:
        if g.get("on_track_status") == "behind" and g.get("recommended_monthly_contribution"):
            monthly = g["recommended_monthly_contribution"]
            out.append(
                _insight(
                    f"goal_behind_{g['id']}",
                    "info",
                    f"{g['name']} behind pace",
                    f"Increase contributions to about ${monthly}/month to reach your target date.",
                    metric_label="Suggested monthly",
                    metric_value=str(monthly),
                    action_label="View goals",
                    action_url="/goals",
                )
            )
        elif g.get("on_track_status") == "ahead":
            pct = g.get("progress_percent")
            out.append(
                _insight(
                    f"goal_ahead_{g['id']}",
                    "positive",
                    f"{g['name']} ahead of plan",
                    f"You are ahead of schedule at {pct}% progress.",
                    action_label="View goals",
                    action_url="/goals",
                )
            )
    if all_goals_count == 0:
        return out
    return out


def _insights_bills(bills_summary: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not bills_summary:
        return []
    out: list[dict[str, Any]] = []
    url = bills_summary.get("checklist_url") or "/bills"
    for w in (bills_summary.get("warnings") or [])[:3]:
        sev = w.get("severity", "info")
        insight_sev = "warning" if sev == "warning" else "critical" if sev == "critical" else "info"
        out.append(
            _insight(
                f"bill_{w.get('id', 'warn')}",
                insight_sev,
                "Bill alert",
                w.get("message", ""),
                action_label="View bill checklist",
                action_url=url if url.startswith("/") else f"/bills",
            )
        )
    late = bills_summary.get("late_count") or bills_summary.get("missed_count") or 0
    if late and not any(i.get("id", "").startswith("bill_late") for i in out):
        out.append(
            _insight(
                "bills_overdue",
                "critical",
                f"{late} overdue bill{'s' if late != 1 else ''}",
                bills_summary.get("missed_message") or "Review your monthly bill checklist.",
                action_label="View bill checklist",
                action_url=url if url.startswith("/") else "/bills",
            )
        )
    return out


def _insights_debt(debt_summary: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not debt_summary:
        return []
    out: list[dict[str, Any]] = []
    total = debt_summary.get("total_debt")
    if total and Decimal(str(total)) > 0:
        if debt_summary.get("message"):
            out.append(
                _insight(
                    "debt_interest_saved",
                    "info",
                    "Debt payoff opportunity",
                    debt_summary["message"],
                    action_label="Open payoff planner",
                    action_url=debt_summary.get("planner_url", "/credit-cards"),
                )
            )
        if debt_summary.get("label"):
            out.append(
                _insight(
                    "debt_free_projection",
                    "info",
                    debt_summary["label"],
                    f"Monthly interest burn: ${debt_summary.get('monthly_interest_burn', '0')}",
                    action_label="Plan payoff",
                    action_url="/credit-cards",
                )
            )
    return out


def build_dashboard_insights(
    *,
    user,
    attention: list[dict[str, Any]],
    health_by_id: dict[int, dict[str, Any]],
    accounts_by_id: dict[int, Account],
    accounts: list[Account],
    forecasts: dict[int, dict[str, Any]],
    st_aggregate: dict[str, Any],
    upcoming_events: list[dict[str, Any]],
    upcoming_groups: list[dict[str, Any]],
    transfer_rule_ids: set[int],
    transfer_rule_targets: dict[int, int],
    dashboard_goals: list[dict[str, Any]],
    goals_total_active: int = 0,
    bills_summary: dict[str, Any] | None = None,
    debt_summary: dict[str, Any] | None = None,
    today: date | None = None,
) -> list[dict[str, Any]]:
    today = today or date.today()
    attention_ids = _attention_account_ids(attention)
    candidates: list[dict[str, Any]] = []

    sts = _insights_safe_to_spend_negative(st_aggregate, attention_ids)
    if sts:
        candidates.append(sts)

    candidates.extend(_insights_credit_risk(health_by_id, accounts_by_id, attention_ids, today))
    candidates.extend(
        _insights_upcoming_cashflow(
            upcoming_events,
            upcoming_groups,
            transfer_rule_ids,
            transfer_rule_targets,
            accounts_by_id,
            today,
        )
    )
    candidates.extend(_insights_import_hygiene(health_by_id, accounts_by_id, attention_ids))
    candidates.extend(_insights_unreconciled_hygiene(accounts, attention_ids, today))
    candidates.extend(
        _insights_reconciliation_hygiene(accounts, attention_ids, today)
    )
    candidates.extend(_insights_goals(dashboard_goals, goals_total_active))
    candidates.extend(_insights_bills(bills_summary))
    candidates.extend(_insights_debt(debt_summary))

    # Projected negative for accounts NOT already in attention (broader narrative)
    for aid, health in health_by_id.items():
        if aid in attention_ids:
            continue
        if health.get("status") != HEALTH_STATUS_CRITICAL:
            continue
        account = accounts_by_id.get(aid)
        if not account or account.is_credit_card():
            continue
        forecast = forecasts.get(aid)
        if forecast and _decimal(forecast.get("available_to_spend") or 0) < 0:
            date_label = _format_short_date(health.get("risk_date"))
            amt = abs(_decimal(forecast.get("available_to_spend") or 0))
            candidates.append(
                _insight(
                    f"cash_risk_{aid}",
                    "critical",
                    f"{account.effective_display_name} cash pressure",
                    f"Available-to-spend goes negative{f' by {date_label}' if date_label else ''}. Review upcoming activity.",
                    metric_label="Shortfall",
                    metric_value=str(amt.quantize(Decimal("0.01"))),
                    action_label="Open ledger",
                    action_url=_ledger_url(aid),
                )
            )

    candidates.sort(key=lambda i: (SEVERITY_RANK.get(i["severity"], 9), i["title"]))
    return candidates[:INSIGHT_LIMIT]
