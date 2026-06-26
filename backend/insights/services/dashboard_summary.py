"""
Aggregated dashboard summary for the financial decision center.
Reuses account forecast, health, and timeline services.
"""
from __future__ import annotations

import time
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from django.core.cache import cache
from django.db.models import Sum
from django.db.models.functions import Coalesce

from common.services.cache import (
    DASHBOARD_SUMMARY_CACHE_SECONDS,
    get_dashboard_summary_cache_key,
    get_dashboard_summary_details_cache_key,
    get_dashboard_summary_fast_cache_key,
)
from common.services.profiler import (
    PerfTimer,
    QueryProfiler,
    get_build_timeline_callers,
    get_build_timeline_count,
    log_perf,
    perf_enabled,
    perf_print,
    phase_end,
    phase_start,
    reset_build_timeline_count,
)

from accounts.models import Account
from accounts.services.balances import compute_net_worth, credit_owed_balance, signed_ledger_balance
from accounts.services.account_health import (
    SAVINGS_ROLES,
    _target_utilization_percent,
    calculate_account_health_for_accounts,
)
from accounts.services.account_health_constants import (
    HEALTH_STATUS_CRITICAL,
    HEALTH_STATUS_HEALTHY,
    HEALTH_STATUS_RISK,
    HEALTH_STATUS_WATCH,
    PAYMENT_DUE_RISK_DAYS,
    STATUS_SEVERITY,
)
from accounts.services.credit_card import ledger_owed_balance
from accounts.services.available_to_spend import (
    RISK_STATUS_CRITICAL,
    _decimal,
    calculate_forecast_summaries_for_accounts,
    dashboard_safe_to_spend_aggregate,
    normalize_forecast_days,
)
from core.utils import get_households_for_user
from insights.services.dashboard_upcoming import (
    CREDIT_CARD_PAYMENT_CATEGORY,
    UPCOMING_DAYS,
    UPCOMING_MAX_TRANSACTIONS,
    build_upcoming_groups,
    load_transfer_rule_context,
)
from timeline.models import RecurringRule
from timeline.services.ledger import _balance_at_end_of_date, build_timeline
from transactions.models import Transaction

ATTENTION_TOP_LIMIT = 3

_GENERIC_DASHBOARD_ACTIONS = frozenset(
    {
        "Review upcoming activity.",
        "Review upcoming activity on this account.",
        "Review payment and utilization.",
    }
)

SAVINGS_ACCOUNT_ROLES = SAVINGS_ROLES

SNAPSHOT_SAVINGS_ROLES = SAVINGS_ROLES | frozenset({Account.AccountRole.INVESTMENT})
SNAPSHOT_SAVINGS_TYPES = frozenset(
    {
        Account.AccountType.SAVINGS,
        Account.AccountType.INVESTMENT,
        Account.AccountType.RETIREMENT_401K,
    }
)


def _format_short_date(iso_date: str | None) -> str | None:
    if not iso_date:
        return None
    try:
        d = date.fromisoformat(iso_date[:10])
    except ValueError:
        return None
    return d.strftime("%b %d").replace(" 0", " ")


def _short_attention_reason(
    reason: str | None,
    risk_date: str | None,
    status: str,
    *,
    details: dict[str, Any] | None = None,
) -> str:
    details = details or {}
    util = details.get("utilization_percent")
    if util is not None:
        return f"Utilization is {_decimal(util):.0f}%"

    if not reason:
        if status == HEALTH_STATUS_CRITICAL:
            date_label = _format_short_date(risk_date)
            return f"Projected negative {date_label}" if date_label else "Projected negative balance"
        return "Needs attention"
    text = reason.strip().rstrip(".")
    date_label = _format_short_date(risk_date)
    lower = text.lower()
    if "below zero" in lower or "negative" in lower or "drops below zero" in lower:
        return f"Projected negative {date_label}" if date_label else "Projected negative balance"
    if "utilization" in lower:
        if "(target" in lower:
            pct = lower.split("utilization is", 1)[-1].split("%", 1)[0].strip()
            if pct.replace(".", "").isdigit():
                return f"Utilization is {pct}%"
        return text
    if "trending down" in lower:
        return "Balance trending down"
    if "buffer" in lower:
        return "Below safety buffer"
    if "payment due" in lower or "past due" in lower:
        return text
    if "too low" in lower:
        return "Minimum payment too low to pay off"
    if len(text) > 60:
        return text[:57] + "..."
    return text


def _credit_pay_to_target(account: Account, details: dict[str, Any], today: date) -> Decimal | None:
    owed = ledger_owed_balance(account, today)
    limit = _decimal(account.credit_limit or 0)
    if limit <= 0 or owed <= 0:
        return None
    if owed > limit:
        return (owed - limit).quantize(Decimal("0.01"))
    target_raw = details.get("target_utilization_percent")
    target = _decimal(target_raw) if target_raw is not None else _target_utilization_percent(account)
    target_balance = (limit * target / Decimal("100")).quantize(Decimal("0.01"))
    if owed > target_balance:
        return (owed - target_balance).quantize(Decimal("0.01"))
    return None


def _attention_amount(
    health: dict[str, Any],
    forecast: dict[str, Any] | None,
    account: Account | None = None,
    *,
    today: date | None = None,
) -> Decimal | None:
    details = health.get("details") or {}
    util = details.get("utilization_percent")
    if util is not None and account is not None:
        pay = _credit_pay_to_target(account, details, today or date.today())
        if pay and pay > 0:
            return pay
        past_due = details.get("past_due_amount")
        if past_due is not None:
            amt = _decimal(past_due)
            if amt > 0:
                return amt
        payoff = account.payoff_to_avoid_interest
        if payoff > 0:
            return payoff
        return None
    if forecast and forecast.get("supports_available_to_spend"):
        available = _decimal(forecast.get("available_to_spend") or 0)
        if available < 0:
            return abs(available)
        lowest = _decimal(forecast.get("lowest_projected_balance") or 0)
        buffer = _decimal(forecast.get("minimum_buffer") or 0)
        if lowest < Decimal("0"):
            return abs(lowest)
        if lowest < buffer:
            return buffer - lowest
    past_due = details.get("past_due_amount")
    if past_due is not None:
        amt = _decimal(past_due)
        if amt > 0:
            return amt
    return None


def _format_action_amount(amount: Decimal | None) -> str | None:
    if amount is None or amount <= 0:
        return None
    return str(amount.quantize(Decimal("0.01")))


def _dashboard_recommended_action(
    account: Account,
    health: dict[str, Any],
    forecast: dict[str, Any] | None,
    amount: Decimal | None,
    risk_date: str | None,
) -> str:
    existing = (health.get("recommended_action") or "").strip()
    reason = (health.get("reason") or "").lower()
    details = health.get("details") or {}
    status = health.get("status", HEALTH_STATUS_HEALTHY)
    amt_str = _format_action_amount(amount)
    date_label = _format_short_date(risk_date)

    if account.is_credit_card() or account.role == Account.AccountRole.CREDIT_CARD:
        if "limit" in reason and amt_str:
            return f"Pay ${amt_str} to get below limit."
        if details.get("utilization_percent") and amt_str:
            return f"Pay ${amt_str} toward utilization target."
        days = details.get("days_until_due")
        if days is not None and 0 <= int(days) <= PAYMENT_DUE_RISK_DAYS:
            if date_label:
                return f"Confirm payment before {date_label}."
            return "Confirm payment before the due date."
        if details.get("past_due_amount") and amt_str:
            return f"Pay ${amt_str} to clear past due."
        if existing:
            return existing
        if amt_str:
            return f"Pay ${amt_str} toward utilization target."
        return "Review payment and utilization."

    is_savings = (
        account.role in SAVINGS_ACCOUNT_ROLES
        or account.account_type == Account.AccountType.SAVINGS
    )
    if is_savings:
        if amt_str and "buffer" in reason:
            if date_label:
                return f"Add ${amt_str} before {date_label}."
            return f"Add ${amt_str} to restore buffer."
        if existing:
            return existing
        return "Review upcoming activity."

    if amt_str:
        if "buffer" in reason or (
            forecast
            and _decimal(forecast.get("lowest_projected_balance") or 0)
            < _decimal(forecast.get("minimum_buffer") or 0)
        ):
            if date_label:
                return f"Add ${amt_str} before {date_label}."
            return f"Add ${amt_str} to restore buffer."
        if date_label:
            return f"Move ${amt_str} before {date_label}."
        return f"Move ${amt_str}."

    if status == HEALTH_STATUS_RISK and "buffer" in reason:
        return "Increase minimum buffer or adjust upcoming bills."
    if existing:
        return existing
    return "Review upcoming activity."


def _attention_action(
    label: str,
    action_type: str,
    *,
    url: str | None = None,
) -> dict[str, str]:
    return {"label": label, "type": action_type, "url": url or ""}


def _attention_actions(
    account: Account,
    amount: Decimal | None,
) -> tuple[dict[str, str], dict[str, str] | None]:
    account_url = f"/accounts?account={account.pk}"
    ledger_url = f"/transactions"
    primary = _attention_action("Open ledger", "open_ledger", url=ledger_url)

    if account.is_credit_card() or account.role == Account.AccountRole.CREDIT_CARD:
        secondary = _attention_action(
            "Make payment",
            "make_payment",
            url=f"/credit-cards?account={account.pk}",
        )
        return primary, secondary

    is_savings = (
        account.role in SAVINGS_ACCOUNT_ROLES
        or account.account_type == Account.AccountType.SAVINGS
    )
    if is_savings or amount is None:
        return primary, None

    secondary = _attention_action("Move money", "move_money", url=account_url)
    return primary, secondary


def _attention_is_actionable(
    status: str,
    reason: str | None,
    recommended: str | None,
    amount: Decimal | None,
) -> bool:
    if status == HEALTH_STATUS_HEALTHY:
        return False
    has_reason = bool((reason or "").strip())
    has_rec = bool((recommended or "").strip())
    if not has_reason and not has_rec:
        return False
    if amount is not None and amount > 0:
        return True
    if status in (HEALTH_STATUS_CRITICAL, HEALTH_STATUS_RISK):
        return True
    rec_norm = (recommended or "").strip()
    if rec_norm in _GENERIC_DASHBOARD_ACTIONS:
        return False
    if status == HEALTH_STATUS_WATCH and not has_rec:
        return False
    return True


def _attention_within_severity_metric(
    details: dict[str, Any],
    amount: Decimal | None,
) -> Decimal:
    util = details.get("utilization_percent")
    if util is not None:
        return _decimal(util)
    lowest = details.get("lowest_projected_balance")
    if lowest is not None:
        return -_decimal(lowest)
    if amount is not None and amount > 0:
        return amount
    return Decimal("0")


def _attention_sort_key(
    entry: dict[str, Any],
    *,
    details: dict[str, Any],
    amount: Decimal | None,
) -> tuple:
    return (
        -STATUS_SEVERITY.get(entry["status"], 0),
        -_attention_within_severity_metric(details, amount),
        entry.get("risk_date") or "9999-12-31",
    )


def build_attention_items(
    health_by_id: dict[int, dict[str, Any]],
    accounts_by_id: dict[int, Account],
    forecasts: dict[int, dict[str, Any]],
    *,
    limit: int = ATTENTION_TOP_LIMIT,
    today: date | None = None,
) -> list[dict[str, Any]]:
    today = today or date.today()
    ranked: list[tuple[tuple, dict[str, Any]]] = []
    for aid, health in health_by_id.items():
        account = accounts_by_id.get(aid)
        if not account:
            continue
        status = health.get("status", HEALTH_STATUS_HEALTHY)
        if status == HEALTH_STATUS_HEALTHY:
            continue
        forecast = forecasts.get(aid)
        details = health.get("details") or {}
        amount = _attention_amount(health, forecast, account, today=today)
        risk_date = health.get("risk_date")
        reason = _short_attention_reason(
            health.get("reason"),
            risk_date,
            status,
            details=details,
        )
        recommended = _dashboard_recommended_action(
            account, health, forecast, amount, risk_date
        )
        if not _attention_is_actionable(status, reason, recommended, amount):
            continue
        primary_action, secondary_action = _attention_actions(account, amount)
        entry: dict[str, Any] = {
            "account_id": aid,
            "account_name": account.effective_display_name,
            "account_role": account.role,
            "account_type": account.account_type,
            "status": status,
            "reason": reason,
            "recommended_action": recommended,
            "amount": _format_action_amount(amount),
            "risk_date": risk_date,
            "primary_action": primary_action,
            "secondary_action": secondary_action,
            "url": f"/accounts?account={aid}",
        }
        if details.get("utilization_percent") is not None and (
            account.is_credit_card() or account.role == Account.AccountRole.CREDIT_CARD
        ):
            target_raw = details.get("target_utilization_percent")
            target = (
                _decimal(target_raw)
                if target_raw is not None
                else _target_utilization_percent(account)
            )
            entry["target_utilization_percent"] = str(
                target.quantize(Decimal("0.1"))
            )
        sort_key = _attention_sort_key(entry, details=details, amount=amount)
        ranked.append((sort_key, entry))
    ranked.sort(key=lambda pair: pair[0])
    return [entry for _, entry in ranked[:limit]]


def _safe_to_spend_status(total: Decimal, aggregate: dict[str, Any]) -> str:
    if total < 0:
        return "critical"
    critical = aggregate.get("accounts_at_risk") or []
    if any(a.get("risk_status") == RISK_STATUS_CRITICAL for a in critical):
        return "critical"
    if aggregate.get("accounts_at_risk_count", 0) > 0:
        return "watch"
    return "healthy"


def _next_safe_to_spend_issue(
    aggregate: dict[str, Any],
    forecasts: dict[int, dict[str, Any]],
) -> dict[str, Any] | None:
    """Next cash safe-to-spend issue — not credit-card utilization from attention."""

    def _risk_date_sort_key(entry: dict[str, Any]) -> tuple[date, int]:
        rd = entry.get("risk_date")
        if not rd:
            return (date.max, int(entry.get("account_id") or 0))
        try:
            return (date.fromisoformat(str(rd)), int(entry.get("account_id") or 0))
        except ValueError:
            return (date.max, int(entry.get("account_id") or 0))

    at_risk = aggregate.get("accounts_at_risk") or []
    if at_risk:
        top = min(at_risk, key=_risk_date_sort_key)
        forecast = forecasts.get(top["account_id"]) or {}
        reason = top.get("risk_reason") or forecast.get("risk_reason") or (
            "Projected balance drops below buffer"
        )
        return {
            "account_id": top["account_id"],
            "account_name": top["account_name"],
            "risk_date": top.get("risk_date"),
            "reason": str(reason).rstrip("."),
            "recommended_action": None,
        }

    worst = aggregate.get("worst_projected_account")
    if worst:
        forecast = forecasts.get(worst["account_id"]) or {}
        reason = forecast.get("risk_reason") or "Projected balance drops below buffer"
        return {
            "account_id": worst["account_id"],
            "account_name": worst["account_name"],
            "risk_date": worst.get("risk_date"),
            "reason": str(reason).rstrip("."),
            "recommended_action": None,
        }
    return None


def _is_snapshot_debt_account(acc: Account) -> bool:
    return acc.account_type == Account.AccountType.CREDIT or acc.role in (
        Account.AccountRole.CREDIT_CARD,
        Account.AccountRole.LOAN,
    )


def _is_snapshot_savings_bucket(acc: Account) -> bool:
    if _is_snapshot_debt_account(acc):
        return False
    return (
        acc.role in SNAPSHOT_SAVINGS_ROLES
        or acc.account_type in SNAPSHOT_SAVINGS_TYPES
    )


def _non_debt_balance_at(acc: Account, as_of: date, *, today: date) -> Decimal:
    return signed_ledger_balance(acc, as_of)


def _debt_owed_at(acc: Account, as_of: date, *, today: date) -> Decimal:
    return credit_owed_balance(acc, as_of)


def _snapshot_totals(
    accounts: list[Account],
    as_of: date,
    *,
    today: date,
) -> tuple[Decimal, Decimal, Decimal, Decimal | None]:
    """
    Return spending_accounts (cash), credit_debt, savings, avg_utilization at as_of.

    UI labels: Spending Accounts, Debt Owed, Savings & Investments.
    """
    cash = Decimal("0")
    credit_debt = Decimal("0")
    savings = Decimal("0")
    util_sum = Decimal("0")
    util_count = 0

    for acc in accounts:
        if acc.status == Account.Status.DELETED:
            continue
        if _is_snapshot_debt_account(acc):
            owed = _debt_owed_at(acc, as_of, today=today)
            credit_debt += owed
            if as_of >= today:
                util = acc.utilization_percent
            else:
                limit = _decimal(acc.credit_limit or 0)
                util = (owed / limit * Decimal("100")) if limit > 0 else None
            if util is not None:
                util_sum += _decimal(util)
                util_count += 1
        elif _is_snapshot_savings_bucket(acc):
            savings += _non_debt_balance_at(acc, as_of, today=today)
        else:
            cash += _non_debt_balance_at(acc, as_of, today=today)

    avg_util: Decimal | None = None
    if util_count > 0:
        avg_util = (util_sum / util_count).quantize(Decimal("0.01"))
    return cash, credit_debt, savings, avg_util


def _pct_change(current: Decimal, previous: Decimal) -> str | None:
    if previous == 0:
        if current == 0:
            return None
        return "100.0"
    change = (current - previous) / abs(previous) * Decimal("100")
    return str(change.quantize(Decimal("0.1")))


def _avg_goal_progress_pct(goals: list[dict[str, Any]] | None) -> str | None:
    if not goals:
        return None
    values = []
    for g in goals:
        try:
            values.append(_decimal(g.get("progress_percent") or 0))
        except Exception:
            continue
    if not values:
        return None
    avg = sum(values, Decimal("0")) / len(values)
    return str(avg.quantize(Decimal("0.01")))


def _compute_snapshot(
    accounts: list[Account],
    *,
    today: date | None = None,
    goals: list[dict[str, Any]] | None = None,
    mtd_net: Decimal | None = None,
) -> dict[str, Any]:
    today = today or date.today()
    prior_end = today.replace(day=1) - timedelta(days=1)

    cash, credit_debt, savings, util = _snapshot_totals(accounts, today, today=today)
    # Cash After Debt (top row): spending accounts minus owed balances; excludes savings.
    net_position = cash - credit_debt

    prev_cash, prev_debt, prev_savings, _ = _snapshot_totals(accounts, prior_end, today=today)
    prev_net = prev_cash - prev_debt

    goal_progress = _avg_goal_progress_pct(goals)
    snapshot: dict[str, Any] = {
        "cash": str(cash.quantize(Decimal("0.01"))),
        "cash_change_pct": _pct_change(cash, prev_cash),
        "credit_debt": str(credit_debt.quantize(Decimal("0.01"))),
        "utilization": str(util) if util is not None else None,
        "savings": str(savings.quantize(Decimal("0.01"))),
        "savings_change_pct": _pct_change(savings, prev_savings),
        "net_position": str(net_position.quantize(Decimal("0.01"))),
        "net_position_change_pct": _pct_change(net_position, prev_net),
    }
    if goal_progress is not None:
        snapshot["savings_goal_progress_pct"] = goal_progress
    if mtd_net is not None:
        snapshot["net_position_mtd_positive"] = mtd_net >= 0
    return snapshot


def _compute_net_worth(accounts: list[Account], *, today: date | None = None) -> str:
    today = today or date.today()
    total = compute_net_worth(accounts, today)
    return str(total.quantize(Decimal("0.01")))


def _active_credit_accounts_for_available_credit(
    accounts: list[Account],
) -> list[Account]:
    return [a for a in accounts if a.counts_toward_available_credit()]


def _compute_top_summary(
    accounts: list[Account],
    snapshot: dict[str, Any],
    *,
    today: date | None = None,
) -> dict[str, Any]:
    """Available cash, available credit, and cash-after-debt for the Financial Health row."""
    today = today or date.today()
    cash = _decimal(snapshot.get("cash") or 0)
    savings = _decimal(snapshot.get("savings") or 0)
    liquid_cash = cash + savings

    available_credit = Decimal("0")
    total_credit_limit = Decimal("0")
    total_credit_owed = Decimal("0")
    for acc in _active_credit_accounts_for_available_credit(accounts):
        limit = _decimal(acc.credit_limit or 0)
        if limit <= 0:
            continue
        owed = credit_owed_balance(acc, today)
        total_credit_limit += limit
        total_credit_owed += owed
        available_credit += max(Decimal("0"), limit - owed)

    weighted_util: str | None = None
    if total_credit_limit > 0:
        weighted_util = str(
            (total_credit_owed / total_credit_limit * Decimal("100")).quantize(Decimal("0.01"))
        )

    return {
        "liquid_cash": str(liquid_cash.quantize(Decimal("0.01"))),
        "available_credit": str(available_credit.quantize(Decimal("0.01"))),
        "total_credit_limit": (
            str(total_credit_limit.quantize(Decimal("0.01")))
            if total_credit_limit > 0
            else None
        ),
        "credit_utilization": weighted_util,
        "net_position": snapshot.get("net_position") or "0",
    }


def _compute_month_to_date(user, today: date) -> dict[str, str]:
    month = today.strftime("%Y-%m")
    year, month_int = today.year, today.month
    households = get_households_for_user(user)
    account_ids = Account.objects.for_historical_reporting().filter(
        household__in=households,
    ).values_list("id", flat=True)
    qs = Transaction.objects.filter(
        account_id__in=account_ids,
        date__year=year,
        date__month=month_int,
        date__lte=today,
    )
    total_income = qs.filter(amount__gt=0).aggregate(
        s=Coalesce(Sum("amount"), Decimal("0"))
    )["s"] or Decimal("0")
    total_expenses = qs.filter(amount__lt=0).aggregate(
        s=Coalesce(Sum("amount"), Decimal("0"))
    )["s"] or Decimal("0")
    net = total_income + total_expenses
    return {
        "month": month,
        "income": str(total_income.quantize(Decimal("0.01"))),
        "expenses": str(abs(total_expenses).quantize(Decimal("0.01"))),
        "net": str(net.quantize(Decimal("0.01"))),
    }


def _classify_timeline_kind(
    row: dict[str, Any],
    accounts_by_id: dict[int, Account],
    transfer_rule_ids: set[int],
    transfer_rule_targets: dict[int, int],
) -> str:
    from insights.services.dashboard_upcoming import is_transfer_category

    account_id = row.get("account_id")
    account = accounts_by_id.get(account_id) if account_id else None
    amount = _decimal(row.get("amount") or 0)
    rule_id = row.get("rule_id")
    category = (row.get("category_name") or "").strip()
    txn_type = (row.get("transaction_type") or "").strip().lower()

    if row.get("transfer_group_id") or txn_type == "transfer":
        return "transfer"

    if is_transfer_category(category):
        return "transfer"

    if account and not account.is_credit_card() and amount < 0:
        if category == CREDIT_CARD_PAYMENT_CATEGORY:
            return "bill"
        if rule_id and rule_id in transfer_rule_targets:
            dest = accounts_by_id.get(transfer_rule_targets[rule_id])
            if dest and dest.is_credit_card():
                return "bill"

    if rule_id and rule_id in transfer_rule_ids:
        return "transfer"

    if account and account.is_credit_card():
        if amount > 0:
            return "credit_card"
        return "bill"

    if amount > 0:
        return "income"
    return "bill"


def _projected_balance_after(
    account_id: int,
    event_date: date,
    timeline_rows: list[dict],
    today: date,
) -> str | None:
    try:
        balance = _balance_at_end_of_date(account_id, today)
    except Exception:
        return None
    by_date: dict[date, Decimal] = defaultdict(lambda: Decimal("0"))
    for r in timeline_rows:
        if r.get("account_id") != account_id:
            continue
        rd = r.get("date")
        if isinstance(rd, str):
            rd = date.fromisoformat(rd[:10])
        if rd is None or rd <= today or rd > event_date:
            continue
        by_date[rd] += _decimal(r.get("amount") or 0)
    d = today + timedelta(days=1)
    while d <= event_date:
        balance += by_date.get(d, Decimal("0"))
        d += timedelta(days=1)
    return str(balance.quantize(Decimal("0.01")))


def build_upcoming_events(
    user,
    accounts: list[Account],
    health_by_id: dict[int, dict[str, Any]],
    *,
    today: date | None = None,
    timeline_rows: list[dict] | None = None,
    upcoming_days: int | None = None,
) -> list[dict[str, Any]]:
    today = today or date.today()
    horizon = upcoming_days if upcoming_days is not None else UPCOMING_DAYS
    horizon = max(horizon, 1)
    window_end = today + timedelta(days=horizon)
    accounts_by_id = {a.id: a for a in accounts}

    if timeline_rows is None:
        timeline_rows = build_timeline(
            user,
            start_date=today,
            end_date=window_end,
            as_of_date=today,
            projection_only=True,
            caller="dashboard_upcoming",
        )

    households = get_households_for_user(user)
    transfer_rule_ids, transfer_rule_targets, transfer_rule_sources = load_transfer_rule_context(households)

    events: list[dict[str, Any]] = []
    seen_keys: set[tuple] = set()

    for row in timeline_rows:
        rd = row.get("date")
        if isinstance(rd, str):
            rd = date.fromisoformat(rd[:10])
        if rd is None or rd <= today or rd > window_end:
            continue
        if row.get("source") == "interest":
            continue
        account_id = row.get("account_id")
        amount = row.get("amount")
        if amount is None:
            continue
        dedupe_key = (rd.isoformat(), account_id, row.get("transaction_id"), row.get("rule_id"))
        if dedupe_key in seen_keys:
            continue
        seen_keys.add(dedupe_key)

        kind = _classify_timeline_kind(
            row, accounts_by_id, transfer_rule_ids, transfer_rule_targets
        )
        projected = _projected_balance_after(account_id, rd, timeline_rows, today)
        txn_id = row.get("transaction_id")
        rule_id = row.get("rule_id")
        event_id = f"{rd.isoformat()}-{account_id}-{txn_id or 'r'}-{rule_id or 'x'}-{len(events)}"
        events.append(
            {
                "id": event_id,
                "date": rd.isoformat(),
                "account_id": account_id,
                "account_name": row.get("account_name") or "",
                "description": row.get("description") or "—",
                "amount": str(_decimal(amount).quantize(Decimal("0.01"))),
                "kind": kind,
                "category": row.get("category_name"),
                "rule_id": rule_id,
                "transaction_id": txn_id,
                "status": row.get("status"),
                "source": row.get("source") or row.get("txn_source"),
                "projected_balance": projected,
                "is_risk": False,
                "transaction_type": row.get("transaction_type"),
                "transfer_group_id": row.get("transfer_group_id"),
            }
        )

    for aid, health in health_by_id.items():
        status = health.get("status", HEALTH_STATUS_HEALTHY)
        if status == HEALTH_STATUS_HEALTHY:
            continue
        risk_date_str = health.get("risk_date")
        if not risk_date_str:
            continue
        try:
            risk_date = date.fromisoformat(risk_date_str[:10])
        except ValueError:
            continue
        if risk_date <= today or risk_date > window_end:
            continue
        account = accounts_by_id.get(aid)
        if not account:
            continue
        if any(
            e["account_id"] == aid
            and e["date"] == risk_date.isoformat()
            and e["kind"] in ("bill", "transfer", "credit_card")
            for e in events
        ):
            for e in events:
                if e["account_id"] == aid and e["date"] == risk_date.isoformat():
                    e["is_risk"] = True
            continue
        events.append(
            {
                "id": f"risk-{aid}-{risk_date.isoformat()}",
                "date": risk_date.isoformat(),
                "account_id": aid,
                "account_name": account.effective_display_name,
                "description": _short_attention_reason(
                    health.get("reason"),
                    risk_date_str,
                    status,
                    details=health.get("details"),
                ),
                "amount": None,
                "kind": "risk",
                "category": None,
                "rule_id": None,
                "transaction_id": None,
                "status": None,
                "source": "risk",
                "projected_balance": None,
                "is_risk": True,
            }
        )

    for acc in accounts:
        if not acc.is_credit_card():
            continue
        due = acc.next_payment_due_date
        if due is None or due <= today or due > window_end:
            continue
        if any(
            e["account_id"] == acc.id
            and e["date"] == due.isoformat()
            and e["kind"] == "credit_card"
            for e in events
        ):
            continue
        min_pay = acc.minimum_payment_amount or acc.payoff_to_avoid_interest
        events.append(
            {
                "id": f"due-{acc.id}-{due.isoformat()}",
                "date": due.isoformat(),
                "account_id": acc.id,
                "account_name": acc.effective_display_name,
                "description": "Payment due",
                "amount": str(_decimal(min_pay).quantize(Decimal("0.01"))) if min_pay else None,
                "kind": "credit_card",
                "category": "Credit Card Payment",
                "rule_id": None,
                "transaction_id": None,
                "status": None,
                "source": "due",
                "projected_balance": None,
                "is_risk": False,
            }
        )

    events.sort(
        key=lambda e: (
            e["date"],
            0 if e.get("is_risk") else 1,
            e.get("account_id") or 0,
            e.get("id") or "",
        )
    )
    return events


def _forecast_risk_from_aggregate(st_aggregate: dict[str, Any]) -> dict[str, Any]:
    worst = st_aggregate.get("worst_projected_account") or {}
    return {
        "next_risk_date": st_aggregate.get("next_risk_date"),
        "lowest_projected_balance": worst.get("lowest_projected_balance"),
        "lowest_projected_balance_account_id": worst.get("account_id"),
        "lowest_projected_balance_account_name": worst.get("account_name"),
    }


def _forecast_risk_from_full_payload(payload: dict[str, Any]) -> dict[str, Any]:
    if payload.get("forecast_risk"):
        return payload["forecast_risk"]
    next_issue = (payload.get("safe_to_spend") or {}).get("next_issue") or {}
    return {
        "next_risk_date": next_issue.get("risk_date"),
        "lowest_projected_balance": None,
        "lowest_projected_balance_account_id": next_issue.get("account_id"),
        "lowest_projected_balance_account_name": next_issue.get("account_name"),
    }


def _extract_dashboard_fast(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "safe_to_spend": payload["safe_to_spend"],
        "top_summary": payload.get("top_summary"),
        "attention": payload.get("attention", []),
        "attention_total_count": payload.get("attention_total_count", 0),
        "debt": payload.get("debt"),
        "insights": payload.get("insights", []),
        "recommendations": payload.get("recommendations", []),
        "forecast_risk": _forecast_risk_from_full_payload(payload),
    }


def _extract_dashboard_details(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "upcoming": payload.get("upcoming", []),
        "upcoming_groups": payload.get("upcoming_groups", []),
        "upcoming_truncated": payload.get("upcoming_truncated", False),
        "upcoming_total_count": payload.get("upcoming_total_count", 0),
        "upcoming_days": payload.get("upcoming_days", UPCOMING_DAYS),
        "snapshot": payload.get("snapshot", {}),
        "goals": payload.get("goals", []),
        "goal_warnings": payload.get("goal_warnings", []),
        "goals_summary": payload.get("goals_summary"),
        "bills": payload.get("bills"),
        "recommendation_hints": payload.get("recommendation_hints", []),
        "net_worth": payload.get("net_worth", "0"),
        "month_to_date": payload.get("month_to_date"),
    }


def _build_dashboard_summary(
    user,
    *,
    days: int = 30,
    as_of_date: date | None = None,
    mode: str = "full",
) -> dict[str, Any]:
    """Uncached dashboard aggregation (forecast, health, upcoming, bills, recommendations)."""
    timer = PerfTimer() if perf_enabled() else None
    query_profiler = QueryProfiler() if perf_enabled() else None
    wall_start = time.perf_counter() if perf_enabled() else None
    if query_profiler is not None:
        query_profiler.start()

    days = normalize_forecast_days(days)
    today = as_of_date or date.today()
    forecast_end = today + timedelta(days=days)
    upcoming_horizon = min(days, UPCOMING_DAYS)

    if perf_enabled():
        reset_build_timeline_count()
        perf_print(f"[PERF] dashboard forecast_days_selected={days}")
        perf_print(
            f"[PERF] dashboard start_date={today.isoformat()} "
            f"end_date={forecast_end.isoformat()}"
        )
        perf_print(f"[PERF] dashboard request start user={user.pk} days={days}")

    households = get_households_for_user(user)
    accounts = list(
        Account.objects.non_deleted()
        .filter(household__in=households, is_hidden=False)
        .select_related("household")
    )
    accounts_by_id = {a.id: a for a in accounts}
    forecast_accounts = [a for a in accounts if a.participates_in_forecast()]

    _phase_timeline = phase_start(timer, "timeline_build")
    timeline_rows = build_timeline(
        user,
        start_date=today,
        end_date=forecast_end,
        as_of_date=today,
        projection_only=True,
        caller="dashboard_summary",
    )
    phase_end(timer, _phase_timeline)

    _phase_forecast = phase_start(timer, "forecast")
    forecast_start = time.perf_counter() if perf_enabled() else None
    forecasts = calculate_forecast_summaries_for_accounts(
        user,
        forecast_accounts,
        as_of_date=today,
        days=days,
        timeline_rows=timeline_rows,
    )
    phase_end(timer, _phase_forecast)
    if perf_enabled() and forecast_start is not None:
        perf_print(
            f"[PERF] forecast_summary elapsed_ms="
            f"{(time.perf_counter() - forecast_start) * 1000:.0f}"
        )

    _phase_health = phase_start(timer, "account_health")
    health_start = time.perf_counter() if perf_enabled() else None
    health_by_id = calculate_account_health_for_accounts(
        user,
        accounts,
        as_of_date=today,
        days=days,
        timeline_rows=timeline_rows,
    )
    phase_end(timer, _phase_health)
    if perf_enabled() and health_start is not None:
        perf_print(
            f"[PERF] account_health elapsed_ms="
            f"{(time.perf_counter() - health_start) * 1000:.0f}"
        )

    _phase_sts = phase_start(timer, "safe_to_spend")
    sts_start = time.perf_counter() if perf_enabled() else None
    st_aggregate = dashboard_safe_to_spend_aggregate(forecasts, accounts_by_id)
    attention_all = build_attention_items(
        health_by_id, accounts_by_id, forecasts, limit=999, today=today
    )
    attention = attention_all[:ATTENTION_TOP_LIMIT]

    total_sts = _decimal(st_aggregate.get("total_safe_to_spend") or 0)
    sts_status = _safe_to_spend_status(total_sts, st_aggregate)
    next_issue = _next_safe_to_spend_issue(st_aggregate, forecasts)
    phase_end(timer, _phase_sts)
    if perf_enabled() and sts_start is not None:
        perf_print(
            f"[PERF] safe_to_spend elapsed_ms="
            f"{(time.perf_counter() - sts_start) * 1000:.0f}"
        )

    _phase_upcoming = phase_start(timer, "upcoming")
    upcoming_events = build_upcoming_events(
        user,
        accounts,
        health_by_id,
        today=today,
        timeline_rows=timeline_rows,
        upcoming_days=upcoming_horizon,
    )

    transfer_rule_ids, transfer_rule_targets, transfer_rule_sources = load_transfer_rule_context(households)
    upcoming_grouped: dict[str, Any] | None = None
    if mode != "fast":
        upcoming_grouped = build_upcoming_groups(
            upcoming_events,
            transfer_rule_ids=transfer_rule_ids,
            transfer_rule_targets=transfer_rule_targets,
            transfer_rule_sources=transfer_rule_sources,
            accounts_by_id=accounts_by_id,
            health_by_id=health_by_id,
            today=today,
            max_transactions=UPCOMING_MAX_TRANSACTIONS,
        )
    phase_end(timer, _phase_upcoming)

    _phase_widgets = phase_start(timer, "widgets")
    net_worth_accounts = list(
        Account.objects.for_net_worth()
        .filter(household__in=households, is_hidden=False)
    )
    snapshot_accounts = [a for a in accounts if a.status == Account.Status.ACTIVE]
    mtd = _compute_month_to_date(user, today)

    from goals.bucket_services import (
        calculate_aggregate_bucket_summary,
        calculate_bucket_progress,
        dashboard_buckets_for_user,
        enrich_bucket,
    )
    from goals.models import GoalBucket

    dashboard_goals = dashboard_buckets_for_user(user, limit=3, today=today)
    active_buckets = list(
        GoalBucket.objects.filter(
            household__in=households,
            status__in=(GoalBucket.Status.ACTIVE, GoalBucket.Status.PAUSED),
        ).select_related("linked_account")
    )
    goals_aggregate = calculate_aggregate_bucket_summary(active_buckets, today=today)
    goals_active_count = goals_aggregate.get("goals_active_count", 0)
    goal_warnings = goals_aggregate.get("warnings", [])

    from bills.services import build_dashboard_bill_summary

    bills_summary = build_dashboard_bill_summary(user, as_of_date=today)

    from accounts.models import Account as AccountModel
    from credit_cards.services.debt_engine import build_dashboard_debt_summary

    debt_cards = list(
        AccountModel.objects.non_deleted().filter(
            household__in=households,
            account_type=AccountModel.AccountType.CREDIT,
            is_hidden=False,
        )
    )
    debt_summary = build_dashboard_debt_summary(debt_cards, as_of=today)
    phase_end(timer, _phase_widgets)

    from insights.services.dashboard_insights import build_dashboard_insights
    from recommendations.services.engine import (
        build_dashboard_recommendation_list,
        build_recommendation_context,
        recommendation_timeline_hints,
    )

    _phase_insights = phase_start(timer, "insights")
    insights = build_dashboard_insights(
        user=user,
        attention=attention,
        health_by_id=health_by_id,
        accounts_by_id=accounts_by_id,
        accounts=accounts,
        forecasts=forecasts,
        st_aggregate=st_aggregate,
        upcoming_events=upcoming_events,
        upcoming_groups=(upcoming_grouped or {}).get("groups", []),
        transfer_rule_ids=transfer_rule_ids,
        transfer_rule_targets=transfer_rule_targets,
        dashboard_goals=dashboard_goals,
        goals_total_active=goals_active_count,
        bills_summary=bills_summary,
        debt_summary=debt_summary,
        today=today,
    )
    phase_end(timer, _phase_insights)

    _phase_recommendations = phase_start(timer, "recommendations")
    rec_ctx = build_recommendation_context(
        user,
        days=days,
        as_of_date=today,
        accounts=accounts,
        forecasts=forecasts,
        st_aggregate=st_aggregate,
        timeline_rows=timeline_rows,
        health_by_id=health_by_id,
        upcoming_events=upcoming_events,
        bills_summary=bills_summary,
        debt_summary=debt_summary,
        goals_aggregate=goals_aggregate,
        dashboard_goals=dashboard_goals,
    )
    recommendations = build_dashboard_recommendation_list(
        rec_ctx,
        attention=attention_all,
        insights=insights,
    )
    recommendation_hints = recommendation_timeline_hints(recommendations)
    phase_end(timer, _phase_recommendations)

    forecast_risk = _forecast_risk_from_aggregate(st_aggregate)

    if mode == "fast":
        _phase_snapshot = phase_start(timer, "snapshot_top_summary")
        snapshot_accounts = [a for a in accounts if a.status == Account.Status.ACTIVE]
        snapshot_light = _compute_snapshot(snapshot_accounts, today=today, goals=[], mtd_net=None)
        top_summary = _compute_top_summary(snapshot_accounts, snapshot_light, today=today)
        phase_end(timer, _phase_snapshot)

        if perf_enabled() and wall_start is not None:
            if query_profiler is not None:
                query_profiler.stop()
            bt_count = get_build_timeline_count()
            total_ms = (time.perf_counter() - wall_start) * 1000
            callers = get_build_timeline_callers()
            perf_print(
                f"[PERF] dashboard_fast_total build_timeline_count={bt_count} total_ms={total_ms:.0f}"
            )
            if bt_count > 1 and callers:
                perf_print(f"[PERF] dashboard_fast build_timeline_callers={','.join(callers)}")
            if query_profiler is not None:
                perf_print(f"[PERF] query_count={query_profiler.query_count}")

        return {
            "safe_to_spend": {
                "window_days": days,
                "amount": str(total_sts.quantize(Decimal("0.01"))),
                "status": sts_status,
                "next_issue": next_issue,
            },
            "top_summary": top_summary,
            "attention": attention,
            "attention_total_count": len(attention_all),
            "debt": debt_summary,
            "insights": insights,
            "recommendations": recommendations,
            "forecast_risk": forecast_risk,
        }

    assert upcoming_grouped is not None

    _phase_snapshot = phase_start(timer, "snapshot")
    snapshot_goal_rows = [
        {
            "id": b.id,
            "name": b.name,
            "goal_type": b.type,
            "progress_percent": enrich_bucket(
                b, calculate_bucket_progress(b, today=today), today=today
            )["progress_percent"],
        }
        for b in active_buckets
    ]
    snapshot = _compute_snapshot(
        snapshot_accounts,
        today=today,
        goals=snapshot_goal_rows,
        mtd_net=None,
    )

    top_summary = _compute_top_summary(snapshot_accounts, snapshot, today=today)
    phase_end(timer, _phase_snapshot)

    if perf_enabled() and wall_start is not None:
        if query_profiler is not None:
            query_profiler.stop()
        bt_count = get_build_timeline_count()
        total_ms = (time.perf_counter() - wall_start) * 1000
        callers = get_build_timeline_callers()
        perf_print(
            f"[PERF] dashboard_total build_timeline_count={bt_count} total_ms={total_ms:.0f}"
        )
        if bt_count > 1 and callers:
            perf_print(f"[PERF] dashboard build_timeline_callers={','.join(callers)}")
        if query_profiler is not None:
            perf_print(f"[PERF] query_count={query_profiler.query_count}")

    return {
        "safe_to_spend": {
            "window_days": days,
            "amount": str(total_sts.quantize(Decimal("0.01"))),
            "status": sts_status,
            "next_issue": next_issue,
        },
        "top_summary": top_summary,
        "net_worth": _compute_net_worth(net_worth_accounts, today=today),
        "month_to_date": mtd,
        "attention": attention,
        "attention_total_count": len(attention_all),
        "upcoming": upcoming_events[:UPCOMING_MAX_TRANSACTIONS],
        "upcoming_groups": upcoming_grouped["groups"],
        "upcoming_truncated": upcoming_grouped["truncated"],
        "upcoming_total_count": upcoming_grouped["total_event_count"],
        "upcoming_days": upcoming_horizon,
        "snapshot": snapshot,
        "goals": dashboard_goals,
        "goal_warnings": goal_warnings,
        "goals_summary": goals_aggregate,
        "bills": bills_summary,
        "debt": debt_summary,
        "insights": insights,
        "recommendations": recommendations,
        "recommendation_hints": recommendation_hints,
        "forecast_risk": forecast_risk,
    }


def build_dashboard_summary(
    user,
    *,
    days: int = 30,
    as_of_date: date | None = None,
) -> dict[str, Any]:
    """
    Full dashboard summary with Django cache (90-second TTL).

    Cached for repeat dashboard loads; invalidated on financial mutations and Plaid sync.
    Response shape is identical to the uncached path.
    """
    days = normalize_forecast_days(days)
    today = as_of_date or date.today()
    households = get_households_for_user(user)
    household_ids = list(households.values_list("id", flat=True))
    cache_key = get_dashboard_summary_cache_key(
        user_id=user.pk,
        household_ids=household_ids,
        forecast_days=days,
        as_of_date=today,
    )
    cached = cache.get(cache_key)
    if cached is not None:
        log_perf(
            "dashboard_summary",
            cache="HIT",
            user=user.pk,
            days=days,
            households=len(household_ids),
        )
        return cached

    wall_start = time.perf_counter()
    result = _build_dashboard_summary(user, days=days, as_of_date=today)
    log_perf(
        "dashboard_summary",
        cache="MISS",
        user=user.pk,
        days=days,
        households=len(household_ids),
        elapsed_ms=f"{(time.perf_counter() - wall_start) * 1000:.0f}",
    )
    cache.set(cache_key, result, timeout=DASHBOARD_SUMMARY_CACHE_SECONDS)
    return result


def build_dashboard_summary_fast(
    user,
    *,
    days: int = 30,
    as_of_date: date | None = None,
) -> dict[str, Any]:
    """Above-the-fold dashboard payload for fast first paint."""
    days = normalize_forecast_days(days)
    today = as_of_date or date.today()
    households = get_households_for_user(user)
    household_ids = list(households.values_list("id", flat=True))

    full_key = get_dashboard_summary_cache_key(
        user_id=user.pk,
        household_ids=household_ids,
        forecast_days=days,
        as_of_date=today,
    )
    full_cached = cache.get(full_key)
    if full_cached is not None:
        log_perf(
            "dashboard_summary_fast",
            cache="HIT_FULL",
            user=user.pk,
            days=days,
            households=len(household_ids),
        )
        return _extract_dashboard_fast(full_cached)

    cache_key = get_dashboard_summary_fast_cache_key(
        user_id=user.pk,
        household_ids=household_ids,
        forecast_days=days,
        as_of_date=today,
    )
    cached = cache.get(cache_key)
    if cached is not None:
        log_perf(
            "dashboard_summary_fast",
            cache="HIT",
            user=user.pk,
            days=days,
            households=len(household_ids),
        )
        return cached

    wall_start = time.perf_counter()
    result = _build_dashboard_summary(user, days=days, as_of_date=today, mode="fast")
    log_perf(
        "dashboard_summary_fast",
        cache="MISS",
        user=user.pk,
        days=days,
        households=len(household_ids),
        elapsed_ms=f"{(time.perf_counter() - wall_start) * 1000:.0f}",
    )
    cache.set(cache_key, result, timeout=DASHBOARD_SUMMARY_CACHE_SECONDS)
    return result


def build_dashboard_summary_details(
    user,
    *,
    days: int = 30,
    as_of_date: date | None = None,
) -> dict[str, Any]:
    """Lazy-loaded dashboard sections (upcoming, snapshot, goals, bills)."""
    days = normalize_forecast_days(days)
    today = as_of_date or date.today()
    households = get_households_for_user(user)
    household_ids = list(households.values_list("id", flat=True))

    full_key = get_dashboard_summary_cache_key(
        user_id=user.pk,
        household_ids=household_ids,
        forecast_days=days,
        as_of_date=today,
    )
    full_cached = cache.get(full_key)
    if full_cached is not None:
        log_perf(
            "dashboard_summary_details",
            cache="HIT_FULL",
            user=user.pk,
            days=days,
            households=len(household_ids),
        )
        return _extract_dashboard_details(full_cached)

    cache_key = get_dashboard_summary_details_cache_key(
        user_id=user.pk,
        household_ids=household_ids,
        forecast_days=days,
        as_of_date=today,
    )
    cached = cache.get(cache_key)
    if cached is not None:
        log_perf(
            "dashboard_summary_details",
            cache="HIT",
            user=user.pk,
            days=days,
            households=len(household_ids),
        )
        return cached

    wall_start = time.perf_counter()
    full_result = _build_dashboard_summary(user, days=days, as_of_date=today, mode="full")
    log_perf(
        "dashboard_summary_details",
        cache="MISS",
        user=user.pk,
        days=days,
        households=len(household_ids),
        elapsed_ms=f"{(time.perf_counter() - wall_start) * 1000:.0f}",
    )
    cache.set(full_key, full_result, timeout=DASHBOARD_SUMMARY_CACHE_SECONDS)
    details = _extract_dashboard_details(full_result)
    cache.set(cache_key, details, timeout=DASHBOARD_SUMMARY_CACHE_SECONDS)
    return details
