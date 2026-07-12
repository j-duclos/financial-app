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
    get_dashboard_shared_context_cache_key,
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
from accounts.services.balances import (
    bulk_signed_ledger_balances,
    calculate_credit_metrics,
    compute_net_worth,
    credit_owed_balance,
    credit_owed_from_signed_balance,
    signed_ledger_balance,
)
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
    cash_account_risk_shortfall,
    normalize_forecast_days,
)
from accounts.services.lowest_projected_cash import (
    get_lowest_projected_cash,
    get_lowest_projected_cash_from_forecasts,
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
from timeline.services.ledger import build_timeline
from transactions.models import Transaction

DEBUG_LOG_PATH = "/Users/capone/Dev_work/.cursor/debug-bd00da.log"


def _agent_debug_log(
    location: str,
    message: str,
    data: dict[str, Any],
    *,
    hypothesis_id: str,
    run_id: str = "pre-fix",
) -> None:
    # #region agent log
    import json

    try:
        with open(DEBUG_LOG_PATH, "a", encoding="utf-8") as _f:
            _f.write(
                json.dumps(
                    {
                        "sessionId": "bd00da",
                        "runId": run_id,
                        "hypothesisId": hypothesis_id,
                        "location": location,
                        "message": message,
                        "data": data,
                        "timestamp": int(time.time() * 1000),
                    }
                )
                + "\n"
            )
    except OSError:
        pass
    # #endregion


ATTENTION_TOP_LIMIT = 3
FAST_RECOMMENDATION_PREVIEW_LIMIT = 3

_GENERIC_DASHBOARD_ACTIONS = frozenset(
    {
        "Review upcoming activity.",
        "Review upcoming activity on this account.",
        "Review payment and utilization.",
    }
)

SAVINGS_ACCOUNT_ROLES = SAVINGS_ROLES

SNAPSHOT_SAVINGS_ROLES = SAVINGS_ROLES | frozenset({Account.AccountRole.INVESTMENT})

# Roles included in Available Cash when account type is not checking/savings/cash.
AVAILABLE_CASH_ACCOUNT_ROLES = frozenset(
    {
        Account.AccountRole.SPENDING,
        Account.AccountRole.SAVINGS,
        Account.AccountRole.EMERGENCY_FUND,
    }
)
AVAILABLE_CASH_ACCOUNT_TYPES = frozenset(
    {
        Account.AccountType.CHECKING,
        Account.AccountType.SAVINGS,
        Account.AccountType.CASH,
    }
)
EXCLUDED_AVAILABLE_CASH_ROLES = frozenset(
    {
        Account.AccountRole.BILLS,
        Account.AccountRole.INVESTMENT,
        Account.AccountRole.CREDIT_CARD,
        Account.AccountRole.LOAN,
    }
)
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

    date_label = _format_short_date(risk_date)

    if details.get("actual_balance_negative"):
        return (
            f"Projected negative {date_label}"
            if date_label
            else "Projected negative balance"
        )
    if details.get("shortfall_type") == "buffer":
        return f"Below buffer {date_label}" if date_label else "Below safety buffer"
    if details.get("spending_cushion_negative"):
        return "Spending cushion short"

    if not reason:
        if status == HEALTH_STATUS_CRITICAL:
            return (
                f"Projected negative {date_label}"
                if date_label
                else "Projected negative balance"
            )
        return "Needs attention"
    text = reason.strip().rstrip(".")
    lower = text.lower()
    if "cushion is short" in lower or "reserved savings" in lower:
        return "Spending cushion short"
    if "safe-to-spend" in lower or "safe to spend" in lower:
        return "Spending cushion short"
    if "below zero" in lower or "drops below zero" in lower:
        return (
            f"Projected negative {date_label}"
            if date_label
            else "Projected negative balance"
        )
    if "below buffer" in lower or "projected below buffer" in lower:
        return f"Below buffer {date_label}" if date_label else "Below safety buffer"
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
        shortfall_type = details.get("shortfall_type")
        if shortfall_type == "actual_balance":
            shortfall = cash_account_risk_shortfall(forecast)
            if shortfall is not None and shortfall > 0:
                return shortfall
        elif shortfall_type == "buffer":
            lowest = _decimal(forecast.get("lowest_projected_balance") or 0)
            buffer = _decimal(forecast.get("minimum_buffer") or 0)
            if lowest < buffer:
                return (buffer - lowest).quantize(Decimal("0.01"))
        elif details.get("spending_cushion_negative"):
            available = _decimal(forecast.get("available_to_spend") or 0)
            if available < 0:
                return abs(available).quantize(Decimal("0.01"))
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

    shortfall_type = details.get("shortfall_type")
    if shortfall_type == "actual_balance" and amt_str:
        if date_label:
            return f"Add ${amt_str} before {date_label}."
        return f"Add ${amt_str} to avoid negative balance."
    if shortfall_type == "buffer" and amt_str:
        if date_label:
            return f"Add ${amt_str} to restore buffer before {date_label}."
        return f"Add ${amt_str} to restore buffer."
    if details.get("spending_cushion_negative") and amt_str:
        if date_label:
            return f"Short by ${amt_str} after buffers/reserved savings before {date_label}."
        return f"Short by ${amt_str} after buffers/reserved savings."

    if "safe-to-spend" in reason or "safe to spend" in reason or "cushion" in reason:
        if amt_str:
            return f"Short by ${amt_str} after buffers/reserved savings."
        return "Review reserved goals and upcoming bills on this account."

    if amt_str:
        if "buffer" in reason or shortfall_type == "buffer":
            if date_label:
                return f"Add ${amt_str} to restore buffer before {date_label}."
            return f"Add ${amt_str} to restore buffer."
        if date_label:
            return f"Add ${amt_str} before {date_label}."
        return f"Add ${amt_str} to avoid negative balance."

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
        if isinstance(risk_date, date):
            risk_date = risk_date.isoformat()
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


def _counts_toward_liquid_cash(acc: Account) -> bool:
    """Checking, savings, and cash accounts — excludes bills pools and investments."""
    if _is_snapshot_debt_account(acc):
        return False
    if acc.role in EXCLUDED_AVAILABLE_CASH_ROLES:
        return False
    if acc.account_type in AVAILABLE_CASH_ACCOUNT_TYPES:
        return True
    return acc.role in AVAILABLE_CASH_ACCOUNT_ROLES


def _compute_liquid_cash(
    accounts: list[Account],
    *,
    today: date,
    balance_by_account: dict[int, Decimal] | None = None,
) -> Decimal:
    start = time.perf_counter() if perf_enabled() else None
    considered = 0
    total = Decimal("0")
    for acc in accounts:
        if acc.status == Account.Status.DELETED:
            continue
        if not _counts_toward_liquid_cash(acc):
            continue
        considered += 1
        if balance_by_account is not None:
            total += balance_by_account.get(acc.pk, Decimal("0"))
        else:
            total += _non_debt_balance_at(acc, today, today=today)

    if perf_enabled() and start is not None:
        elapsed_ms = (time.perf_counter() - start) * 1000
        perf_print(
            "[PERF] available_cash "
            f"accounts_considered={considered} "
            f"balance_source={'shared_map' if balance_by_account is not None else 'per_account'} "
            f"additional_queries=0 "
            f"elapsed_ms={elapsed_ms:.1f}"
        )
    return total


def _non_debt_balance_at(acc: Account, as_of: date, *, today: date) -> Decimal:
    return signed_ledger_balance(acc, as_of)


def _debt_owed_at(acc: Account, as_of: date, *, today: date) -> Decimal:
    return credit_owed_balance(acc, as_of)


def _snapshot_totals(
    accounts: list[Account],
    as_of: date,
    *,
    today: date,
    balance_by_account: dict[int, Decimal] | None = None,
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
            if balance_by_account is not None:
                signed = balance_by_account.get(acc.pk, Decimal("0"))
                owed = credit_owed_from_signed_balance(signed)
            else:
                owed = _debt_owed_at(acc, as_of, today=today)
                signed = -owed if owed > 0 else Decimal("0")
            credit_debt += owed
            if acc.is_credit_card():
                if balance_by_account is not None and as_of >= today:
                    util = calculate_credit_metrics(acc, signed)["utilization_percent"]
                elif as_of >= today:
                    util = acc.utilization_percent
                else:
                    limit = _decimal(acc.credit_limit or 0)
                    util = (owed / limit * Decimal("100")) if limit > 0 else None
            else:
                limit = _decimal(acc.credit_limit or 0)
                util = (owed / limit * Decimal("100")) if limit > 0 else None
            if util is not None:
                util_sum += _decimal(util)
                util_count += 1
        elif _is_snapshot_savings_bucket(acc):
            if balance_by_account is not None:
                savings += balance_by_account.get(acc.pk, Decimal("0"))
            else:
                savings += _non_debt_balance_at(acc, as_of, today=today)
        else:
            if balance_by_account is not None:
                cash += balance_by_account.get(acc.pk, Decimal("0"))
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
    balance_by_account: dict[int, Decimal] | None = None,
    prior_balance_by_account: dict[int, Decimal] | None = None,
    include_comparisons: bool = True,
) -> dict[str, Any]:
    today = today or date.today()
    prior_end = today.replace(day=1) - timedelta(days=1)

    cash, credit_debt, savings, util = _snapshot_totals(
        accounts, today, today=today, balance_by_account=balance_by_account
    )
    # Resource breakdown net_position (historical): spending accounts minus owed balances.
    # Cash After Debt on the Financial Health row uses _compute_cash_after_debt instead.
    net_position = cash - credit_debt

    prev_cash = prev_debt = prev_savings = Decimal("0")
    prev_net = Decimal("0")
    cash_change_pct: str | None = None
    savings_change_pct: str | None = None
    net_position_change_pct: str | None = None

    if include_comparisons:
        if prior_balance_by_account is not None:
            prev_cash, prev_debt, prev_savings, _ = _snapshot_totals(
                accounts,
                prior_end,
                today=today,
                balance_by_account=prior_balance_by_account,
            )
        else:
            prev_cash, prev_debt, prev_savings, _ = _snapshot_totals(
                accounts, prior_end, today=today
            )
        prev_net = prev_cash - prev_debt
        cash_change_pct = _pct_change(cash, prev_cash)
        savings_change_pct = _pct_change(savings, prev_savings)
        net_position_change_pct = _pct_change(net_position, prev_net)

    goal_progress = _avg_goal_progress_pct(goals)
    snapshot: dict[str, Any] = {
        "cash": str(cash.quantize(Decimal("0.01"))),
        "cash_change_pct": cash_change_pct,
        "credit_debt": str(credit_debt.quantize(Decimal("0.01"))),
        "utilization": str(util) if util is not None else None,
        "savings": str(savings.quantize(Decimal("0.01"))),
        "savings_change_pct": savings_change_pct,
        "net_position": str(net_position.quantize(Decimal("0.01"))),
        "net_position_change_pct": net_position_change_pct,
    }
    if goal_progress is not None:
        snapshot["savings_goal_progress_pct"] = goal_progress
    if mtd_net is not None:
        snapshot["net_position_mtd_positive"] = mtd_net >= 0
    return snapshot


def _compute_net_worth(
    accounts: list[Account],
    *,
    today: date | None = None,
    balance_by_account: dict[int, Decimal] | None = None,
) -> str:
    today = today or date.today()
    total = compute_net_worth(accounts, today, balance_by_account=balance_by_account)
    return str(total.quantize(Decimal("0.01")))


def _active_credit_accounts_for_available_credit(
    accounts: list[Account],
) -> list[Account]:
    return [a for a in accounts if a.counts_toward_available_credit()]


def _dashboard_credit_cards(accounts: list[Account]) -> list[Account]:
    """Revolving credit accounts for debt tiles — derived from the dashboard account list."""
    return [a for a in accounts if a.is_credit_card()]


def _dashboard_debt_accounts(accounts: list[Account]) -> list[Account]:
    """Active liability accounts included in dashboard total debt (credit cards + loans)."""
    return [
        a
        for a in accounts
        if a.status == Account.Status.ACTIVE and _is_snapshot_debt_account(a)
    ]


def _signed_balance_for_credit(
    acc: Account,
    *,
    today: date,
    balance_by_account: dict[int, Decimal] | None,
) -> tuple[Decimal, bool]:
    """Return signed ledger balance and whether a per-account ledger query was used."""
    if balance_by_account is not None:
        return balance_by_account.get(acc.pk, Decimal("0")), False
    owed = credit_owed_balance(acc, today)
    return (-owed if owed > 0 else Decimal("0")), True


def _compute_available_credit(
    credit_accounts: list[Account],
    *,
    today: date | None = None,
    balance_by_account: dict[int, Decimal] | None = None,
) -> dict[str, Decimal | None]:
    """
    Aggregate available credit, limits, owed, and weighted utilization.

    Only active revolving cards with ``counts_toward_available_credit()`` and a
    positive credit limit contribute to the dashboard Available Credit total.
    """
    today = today or date.today()
    start = time.perf_counter() if perf_enabled() else None
    eligible = _active_credit_accounts_for_available_credit(credit_accounts)

    available_credit = Decimal("0")
    total_credit_limit = Decimal("0")
    total_credit_owed = Decimal("0")
    fallback_queries = 0

    for acc in eligible:
        limit = _decimal(acc.credit_limit or 0)
        if limit <= 0:
            continue
        signed, used_fallback = _signed_balance_for_credit(
            acc, today=today, balance_by_account=balance_by_account
        )
        if used_fallback:
            fallback_queries += 1
        metrics = calculate_credit_metrics(acc, signed)
        owed = metrics["owed"]
        total_credit_limit += limit
        total_credit_owed += owed
        available_credit += metrics["available"]

    weighted_util: Decimal | None = None
    if total_credit_limit > 0:
        weighted_util = (
            total_credit_owed / total_credit_limit * Decimal("100")
        ).quantize(Decimal("0.01"))

    if perf_enabled() and start is not None:
        elapsed_ms = (time.perf_counter() - start) * 1000
        perf_print(
            "[PERF] available_credit "
            f"credit_accounts={len(eligible)} "
            f"balance_source={'shared_map' if balance_by_account is not None else 'per_account'} "
            f"additional_queries={fallback_queries} "
            f"elapsed_ms={elapsed_ms:.1f}"
        )

    return {
        "available_credit": available_credit,
        "total_credit_limit": total_credit_limit,
        "total_credit_owed": total_credit_owed,
        "weighted_utilization": weighted_util,
    }


def _compute_cash_after_debt(
    available_cash: Decimal,
    total_debt: Decimal,
) -> Decimal:
    """Cash After Debt = Available Cash − Total Debt (pure; no database access)."""
    start = time.perf_counter() if perf_enabled() else None
    result = (available_cash - total_debt).quantize(Decimal("0.01"))
    if perf_enabled() and start is not None:
        elapsed_ms = (time.perf_counter() - start) * 1000
        perf_print(
            "[PERF] cash_after_debt "
            "available_cash_source=shared_metric "
            "total_debt_source=shared_metric "
            "additional_queries=0 "
            f"elapsed_ms={elapsed_ms:.1f}"
        )
    return result


def calculate_dashboard_debt_metrics(
    debt_accounts: list[Account],
    balance_by_account: dict[int, Decimal] | None = None,
    *,
    today: date | None = None,
) -> dict[str, Any]:
    """
    Current owed balances and estimated monthly interest for dashboard debt tiles.

    Uses the shared balance map when provided — no per-account ledger queries.
    Scope matches Cash After Debt and snapshot debt totals (credit cards + loans).
    """
    from credit_cards.services.payoff import _effective_apr

    today = today or date.today()
    start = time.perf_counter() if perf_enabled() else None
    fallback_queries = 0

    total_debt = Decimal("0")
    credit_card_debt = Decimal("0")
    loan_debt = Decimal("0")
    monthly_burn = Decimal("0")
    apr_weighted_sum = Decimal("0")
    apr_weight_sum = Decimal("0")
    debt_account_count = 0

    for acc in debt_accounts:
        if acc.status != Account.Status.ACTIVE:
            continue
        if not _is_snapshot_debt_account(acc):
            continue

        if balance_by_account is not None:
            signed = balance_by_account.get(acc.pk, Decimal("0"))
            if acc.is_credit_card():
                owed = calculate_credit_metrics(acc, signed)["owed"]
            else:
                owed = credit_owed_from_signed_balance(signed)
        else:
            fallback_queries += 1
            owed = _debt_owed_at(acc, today, today=today)

        if owed <= 0:
            continue

        debt_account_count += 1
        total_debt += owed
        if acc.is_credit_card():
            credit_card_debt += owed
        else:
            loan_debt += owed

        apr = _effective_apr(acc)
        if apr > 0:
            monthly_burn += owed * apr / Decimal("1200")
            apr_weighted_sum += owed * apr
            apr_weight_sum += owed

    weighted_average_apr: Decimal | None = None
    if apr_weight_sum > 0:
        weighted_average_apr = (apr_weighted_sum / apr_weight_sum).quantize(Decimal("0.01"))

    if perf_enabled() and start is not None:
        elapsed_ms = (time.perf_counter() - start) * 1000
        perf_print(
            "[PERF] dashboard_debt_payoff "
            f"debt_accounts={debt_account_count} "
            f"balance_source={'shared_map' if balance_by_account is not None else 'per_account'} "
            f"full_simulation=false "
            f"additional_queries={fallback_queries} "
            f"elapsed_ms={elapsed_ms:.1f}"
        )

    return {
        "total_debt": total_debt.quantize(Decimal("0.01")),
        "credit_card_debt": credit_card_debt.quantize(Decimal("0.01")),
        "loan_debt": loan_debt.quantize(Decimal("0.01")),
        "estimated_monthly_interest": monthly_burn.quantize(Decimal("0.01")),
        "weighted_average_apr": weighted_average_apr,
        "debt_account_count": debt_account_count,
    }


def _compute_dashboard_debt_metrics(
    debt_accounts: list[Account],
    *,
    today: date,
    balance_by_account: dict[int, Decimal] | None = None,
) -> dict[str, Any]:
    """Backward-compatible alias for calculate_dashboard_debt_metrics."""
    return calculate_dashboard_debt_metrics(
        debt_accounts,
        balance_by_account,
        today=today,
    )


def _compute_top_summary(
    accounts: list[Account],
    snapshot: dict[str, Any],
    *,
    today: date | None = None,
    balance_by_account: dict[int, Decimal] | None = None,
    credit_accounts: list[Account] | None = None,
    debt_metrics: dict[str, Decimal] | None = None,
) -> dict[str, Any]:
    """Available cash, available credit, and cash-after-debt for the Financial Health row."""
    today = today or date.today()
    liquid_cash = _compute_liquid_cash(
        accounts, today=today, balance_by_account=balance_by_account
    )

    cards = credit_accounts if credit_accounts is not None else _dashboard_credit_cards(accounts)
    credit_totals = _compute_available_credit(
        cards,
        today=today,
        balance_by_account=balance_by_account,
    )
    available_credit = credit_totals["available_credit"]
    total_credit_limit = credit_totals["total_credit_limit"]
    weighted_util = credit_totals["weighted_utilization"]

    if debt_metrics is not None:
        total_debt = debt_metrics["total_debt"]
    else:
        total_debt = calculate_dashboard_debt_metrics(
            _dashboard_debt_accounts(accounts),
            balance_by_account,
            today=today,
        )["total_debt"]

    cash_after_debt = _compute_cash_after_debt(liquid_cash, total_debt)
    net_position = str(cash_after_debt)

    return {
        "liquid_cash": str(liquid_cash.quantize(Decimal("0.01"))),
        "available_cash": str(liquid_cash.quantize(Decimal("0.01"))),
        "available_credit": str(available_credit.quantize(Decimal("0.01"))),
        "total_credit_limit": (
            str(total_credit_limit.quantize(Decimal("0.01")))
            if total_credit_limit > 0
            else None
        ),
        "credit_utilization": (
            str(weighted_util) if weighted_util is not None else None
        ),
        "total_debt": str(total_debt),
        "cash_after_debt": net_position,
        "net_position": net_position,
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


def _projected_balance_from_timeline_row(row: dict[str, Any]) -> str | None:
    """Use precomputed running_balance from build_timeline — same as calendar events."""
    raw = row.get("running_balance")
    if raw is None:
        return None
    return str(_decimal(raw).quantize(Decimal("0.01")))


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
        projected = _projected_balance_from_timeline_row(row)
        txn_id = row.get("transaction_id")
        rule_id = row.get("rule_id")
        event_id = f"{rd.isoformat()}-{account_id}-{txn_id or 'r'}-{rule_id or 'x'}-{len(events)}"
        account = accounts_by_id.get(account_id) if account_id else None
        account_name = (
            account.effective_display_name
            if account
            else (row.get("account_name") or "")
        )
        events.append(
            {
                "id": event_id,
                "date": rd.isoformat(),
                "account_id": account_id,
                "account_name": account_name,
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

    # #region agent log
    _sample_rows = [
        {
            "date": r.get("date"),
            "account_id": r.get("account_id"),
            "account_name": r.get("account_name"),
            "description": (r.get("description") or "")[:60],
            "amount": str(r.get("amount")),
            "running_balance": str(r.get("running_balance")),
        }
        for r in timeline_rows
        if r.get("account_id")
        and (
            "henry" in (r.get("description") or "").lower()
            or "meds" in (r.get("description") or "").lower()
        )
    ][:3]
    _sample_events = [
        {
            "date": e.get("date"),
            "account_name": e.get("account_name"),
            "description": (e.get("description") or "")[:60],
            "amount": e.get("amount"),
            "projected_balance": e.get("projected_balance"),
        }
        for e in events
        if "henry" in (e.get("description") or "").lower()
        or "meds" in (e.get("description") or "").lower()
    ][:3]
    _agent_debug_log(
        "dashboard_summary.py:build_upcoming_events",
        "upcoming events built from timeline rows",
        {
            "today": today.isoformat(),
            "window_end": window_end.isoformat(),
            "timeline_row_count": len(timeline_rows),
            "event_count": len(events),
            "henry_timeline_rows": _sample_rows,
            "henry_events": _sample_events,
            "shared_timeline": timeline_rows is not None,
        },
        hypothesis_id="B,C",
    )
    # #endregion

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


def _forecast_risk_from_lowest_projected_cash(
    lowest_projected_cash: dict[str, Any] | None,
) -> dict[str, Any]:
    if not lowest_projected_cash:
        return {
            "next_risk_date": None,
            "lowest_projected_balance": None,
            "lowest_projected_balance_account_id": None,
            "lowest_projected_balance_account_name": None,
        }
    return {
        "next_risk_date": lowest_projected_cash.get("date"),
        "lowest_projected_balance": lowest_projected_cash.get("amount"),
        "lowest_projected_balance_account_id": lowest_projected_cash.get("account_id"),
        "lowest_projected_balance_account_name": lowest_projected_cash.get("account_name"),
    }


def _legacy_safe_to_spend_from_lowest_projected_cash(
    lowest_projected_cash: dict[str, Any] | None,
    *,
    days: int,
) -> dict[str, Any]:
    """Backward-compatible safe_to_spend shape for non-top-bar consumers."""
    if not lowest_projected_cash:
        return {
            "window_days": days,
            "amount": "0.00",
            "status": "healthy",
            "next_issue": None,
        }
    is_negative = bool(lowest_projected_cash.get("is_negative"))
    next_issue = None
    if lowest_projected_cash.get("account_id") and lowest_projected_cash.get("date"):
        next_issue = {
            "account_id": lowest_projected_cash["account_id"],
            "account_name": lowest_projected_cash.get("account_name") or "",
            "risk_date": lowest_projected_cash.get("date"),
            "reason": (
                "Projected balance drops below zero"
                if is_negative
                else "Lowest projected balance in forecast window"
            ),
            "recommended_action": None,
        }
    return {
        "window_days": days,
        "amount": lowest_projected_cash["amount"],
        "status": "critical" if is_negative else "healthy",
        "next_issue": next_issue,
    }


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
    return _forecast_risk_from_lowest_projected_cash(payload.get("lowest_projected_cash"))


def _extract_dashboard_fast(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "lowest_projected_cash": payload.get("lowest_projected_cash"),
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
        "recommendations": payload.get("recommendations", []),
        "net_worth": payload.get("net_worth", "0"),
        "month_to_date": payload.get("month_to_date"),
    }


def _empty_dashboard_details_stubs() -> dict[str, Any]:
    """Placeholder fields for lazy details — not computed on the lightweight path."""
    return {
        "snapshot": {},
        "bills": None,
        "recommendation_hints": [],
        "recommendations": [],
        "net_worth": "0",
        "month_to_date": None,
    }


def _build_dashboard_upcoming_payload(
    user,
    core: dict[str, Any],
    *,
    today: date,
    upcoming_horizon: int,
    timer: PerfTimer | None,
    phases: list[str],
) -> dict[str, Any]:
    """Grouped upcoming transactions — shared by details and full dashboard builds."""
    accounts = core["accounts"]
    accounts_by_id = core["accounts_by_id"]
    timeline_rows = core["timeline_rows"]
    health_by_id = core["health_by_id"]

    _phase_upcoming = phase_start(timer, "upcoming")
    phases.append("upcoming")
    upcoming_events = build_upcoming_events(
        user,
        accounts,
        health_by_id,
        today=today,
        timeline_rows=timeline_rows,
        upcoming_days=upcoming_horizon,
    )

    transfer_rule_ids, transfer_rule_targets, transfer_rule_sources = load_transfer_rule_context(
        core["households"]
    )
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

    return {
        "upcoming": upcoming_events[:UPCOMING_MAX_TRANSACTIONS],
        "upcoming_groups": upcoming_grouped["groups"],
        "upcoming_truncated": upcoming_grouped["truncated"],
        "upcoming_total_count": upcoming_grouped["total_event_count"],
        "upcoming_days": upcoming_horizon,
    }


def _build_dashboard_goals_payload(
    user,
    core: dict[str, Any],
    *,
    today: date,
    timer: PerfTimer | None,
    phases: list[str],
) -> dict[str, Any]:
    """Goals preview tiles — lightweight lazy section for the dashboard."""
    from goals.bucket_services import (
        calculate_aggregate_bucket_summary,
        dashboard_buckets_for_user,
    )
    from goals.models import GoalBucket

    _phase_goals = phase_start(timer, "goals")
    phases.append("goals")
    dashboard_goals = dashboard_buckets_for_user(user, limit=3, today=today)
    active_buckets = list(
        GoalBucket.objects.filter(
            household__in=core["households"],
            status__in=(GoalBucket.Status.ACTIVE, GoalBucket.Status.PAUSED),
        ).select_related("linked_account")
    )
    goals_aggregate = calculate_aggregate_bucket_summary(active_buckets, today=today)
    phase_end(timer, _phase_goals)

    return {
        "goals": dashboard_goals,
        "goal_warnings": goals_aggregate.get("warnings", []),
        "goals_summary": goals_aggregate,
    }


def _dashboard_scope_cache_params(user, *, days: int, as_of_date: date) -> tuple[list[int], dict[str, Any]]:
    households = get_households_for_user(user)
    household_ids = list(households.values_list("id", flat=True))
    params = {
        "user_id": user.pk,
        "household_ids": household_ids,
        "forecast_days": days,
        "as_of_date": as_of_date,
    }
    return household_ids, params


def _store_dashboard_shared_context(scope: dict[str, Any], context: dict[str, Any]) -> None:
    cache_key = get_dashboard_shared_context_cache_key(**scope)
    cache.set(cache_key, context, timeout=DASHBOARD_SUMMARY_CACHE_SECONDS)


def _load_dashboard_shared_context(scope: dict[str, Any]) -> dict[str, Any] | None:
    cache_key = get_dashboard_shared_context_cache_key(**scope)
    cached = cache.get(cache_key)
    return cached if isinstance(cached, dict) else None


def _build_minimal_dashboard_debt_summary(
    debt_accounts: list[Account],
    *,
    as_of: date | None = None,
    balance_by_account: dict[int, Decimal] | None = None,
    debt_metrics: dict[str, Any] | None = None,
    payoff_projection: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """Lightweight debt tile — balances and APR burn only, no payoff simulation."""
    today = as_of or date.today()
    metrics = debt_metrics or calculate_dashboard_debt_metrics(
        debt_accounts, balance_by_account, today=today
    )
    total_debt = metrics["total_debt"]
    if total_debt <= 0:
        return None

    debt_free_date = (payoff_projection or {}).get("debt_free_date")
    if debt_free_date:
        try:
            d = date.fromisoformat(str(debt_free_date)[:10])
            label = f"Debt-free by {d.strftime('%b %Y')}"
        except ValueError:
            label = "Open planner for payoff date"
    else:
        label = "Open planner for payoff date"

    saved = (payoff_projection or {}).get("interest_saved_vs_minimums")
    msg = None
    if saved and Decimal(str(saved)) > 0:
        msg = f"Your plan saves ${saved} interest vs minimums only"

    return {
        "label": label,
        "debt_free_date": debt_free_date,
        "total_debt": str(total_debt),
        "monthly_interest_burn": str(metrics["estimated_monthly_interest"]),
        "interest_saved_vs_minimums": saved,
        "message": msg,
        "planner_url": "/credit-cards",
        "plan": None,
    }


def _accounts_for_dashboard_balances(
    *,
    snapshot_accounts: list[Account],
    net_worth_accounts: list[Account] | None = None,
    debt_cards: list[Account] | None = None,
) -> list[Account]:
    by_id: dict[int, Account] = {a.pk: a for a in snapshot_accounts}
    for acc in net_worth_accounts or []:
        by_id.setdefault(acc.pk, acc)
    for acc in debt_cards or []:
        by_id.setdefault(acc.pk, acc)
    return list(by_id.values())


def _load_dashboard_balance_maps(
    accounts: list[Account],
    *,
    today: date,
    include_prior: bool = False,
) -> tuple[dict[int, Decimal], dict[int, Decimal] | None]:
    """Bulk-load signed ledger balances once (optional prior month-end for comparisons)."""
    from django.conf import settings
    from django.db import connection

    account_list = list(accounts)
    query_count_before = len(connection.queries) if getattr(settings, "DEBUG", False) else None
    map_start = time.perf_counter() if perf_enabled() else None

    today_map = bulk_signed_ledger_balances(account_list, today)

    prior_map: dict[int, Decimal] | None = None
    if include_prior:
        prior_end = today.replace(day=1) - timedelta(days=1)
        prior_map = bulk_signed_ledger_balances(account_list, prior_end)

    if perf_enabled() and map_start is not None:
        balance_queries = 0
        if query_count_before is not None:
            balance_queries = len(connection.queries) - query_count_before
        elapsed_ms = (time.perf_counter() - map_start) * 1000
        perf_print(
            "[PERF] dashboard_balance_map "
            f"accounts={len(account_list)} "
            f"include_prior={include_prior} "
            f"balance_queries={balance_queries} "
            f"elapsed_ms={elapsed_ms:.1f}"
        )

    return today_map, prior_map


def _build_fast_recommendation_preview(
    attention_all: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Attention-derived preview only — no engine context or insights."""
    from insights.services.dashboard_recommendations import (
        SEVERITY_RANK,
        _recommendations_from_attention,
    )

    preview = _recommendations_from_attention(attention_all)
    preview.sort(
        key=lambda r: (
            SEVERITY_RANK.get(r.get("severity", "info"), 9),
            -(int(r.get("priority_score") or 0)),
            r.get("title") or "",
        )
    )
    return preview[:FAST_RECOMMENDATION_PREVIEW_LIMIT], []


def _log_dashboard_build_perf(
    *,
    label: str,
    wall_start: float | None,
    query_profiler: QueryProfiler | None,
    phases: list[str] | None = None,
) -> None:
    if not perf_enabled() or wall_start is None:
        return
    if query_profiler is not None:
        query_profiler.stop()
    bt_count = get_build_timeline_count()
    total_ms = (time.perf_counter() - wall_start) * 1000
    callers = get_build_timeline_callers()
    perf_print(
        f"[PERF] {label} build_timeline_count={bt_count} elapsed_ms={total_ms:.0f}"
    )
    perf_print(f"[PERF] dashboard_request total_timeline_builds={bt_count}")
    if phases:
        perf_print(f"[PERF] {label} phases={','.join(phases)}")
    if bt_count > 1 and callers:
        perf_print(f"[PERF] {label} build_timeline_callers={','.join(callers)}")
    if query_profiler is not None:
        perf_print(f"[PERF] query_count={query_profiler.query_count}")


def _compute_dashboard_core(
    user,
    *,
    days: int,
    today: date,
    timer: PerfTimer | None,
    shared_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Timeline, forecast, health, safe-to-spend, and attention — shared by fast and full."""
    forecast_end = today + timedelta(days=days)
    phases: list[str] = []

    households = get_households_for_user(user)
    accounts = list(
        Account.objects.non_deleted()
        .filter(household__in=households, is_hidden=False)
        .select_related("household")
    )
    accounts_by_id = {a.id: a for a in accounts}
    forecast_accounts = [a for a in accounts if a.participates_in_forecast()]

    if shared_context is not None:
        phases.append("shared_context")
        timeline_rows = shared_context["timeline_rows"]
        forecasts = shared_context["forecasts"]
        health_by_id = shared_context["health_by_id"]
        lowest_projected_cash = shared_context["lowest_projected_cash"]
        attention_all = shared_context["attention_all"]
    else:
        _phase_timeline = phase_start(timer, "timeline_build")
        phases.append("timeline_build")
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
        phases.append("forecast")
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
        phases.append("account_health")
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

        _phase_lpc = phase_start(timer, "lowest_projected_cash")
        phases.append("lowest_projected_cash")
        lpc_start = time.perf_counter() if perf_enabled() else None
        lowest_projected_cash = get_lowest_projected_cash_from_forecasts(
            accounts_by_id,
            forecasts,
        )
        attention_all = build_attention_items(
            health_by_id, accounts_by_id, forecasts, limit=999, today=today
        )
        phase_end(timer, _phase_lpc)
        if perf_enabled() and lpc_start is not None:
            perf_print(
                f"[PERF] lowest_projected_cash elapsed_ms="
                f"{(time.perf_counter() - lpc_start) * 1000:.0f}"
            )

    attention = attention_all[:ATTENTION_TOP_LIMIT]
    legacy_safe_to_spend = _legacy_safe_to_spend_from_lowest_projected_cash(
        lowest_projected_cash, days=days
    )
    forecast_risk = _forecast_risk_from_lowest_projected_cash(lowest_projected_cash)

    return {
        "phases": phases,
        "households": households,
        "accounts": accounts,
        "accounts_by_id": accounts_by_id,
        "forecast_accounts": forecast_accounts,
        "timeline_rows": timeline_rows,
        "forecasts": forecasts,
        "health_by_id": health_by_id,
        "lowest_projected_cash": lowest_projected_cash,
        "legacy_safe_to_spend": legacy_safe_to_spend,
        "attention_all": attention_all,
        "attention": attention,
        "forecast_risk": forecast_risk,
        "shared_context": {
            "timeline_rows": timeline_rows,
            "forecasts": forecasts,
            "health_by_id": health_by_id,
            "lowest_projected_cash": lowest_projected_cash,
            "attention_all": attention_all,
        },
    }


def _build_dashboard_summary(
    user,
    *,
    days: int = 30,
    as_of_date: date | None = None,
    mode: str = "full",
    shared_context: dict[str, Any] | None = None,
    cache_scope: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Uncached dashboard aggregation (forecast, health, upcoming, bills, recommendations)."""
    timer = PerfTimer() if perf_enabled() else None
    query_profiler = QueryProfiler() if perf_enabled() else None
    wall_start = time.perf_counter() if perf_enabled() else None
    if query_profiler is not None:
        query_profiler.start()

    days = normalize_forecast_days(days)
    today = as_of_date or date.today()
    upcoming_horizon = min(days, UPCOMING_DAYS)

    if perf_enabled():
        reset_build_timeline_count()
        perf_print(f"[PERF] dashboard forecast_days_selected={days}")
        perf_print(
            f"[PERF] dashboard start_date={today.isoformat()} "
            f"end_date={(today + timedelta(days=days)).isoformat()}"
        )
        perf_print(f"[PERF] dashboard request start user={user.pk} days={days} mode={mode}")

    core = _compute_dashboard_core(
        user,
        days=days,
        today=today,
        timer=timer,
        shared_context=shared_context,
    )
    phases = list(core["phases"])
    accounts = core["accounts"]
    accounts_by_id = core["accounts_by_id"]
    timeline_rows = core["timeline_rows"]
    forecasts = core["forecasts"]
    health_by_id = core["health_by_id"]
    lowest_projected_cash = core["lowest_projected_cash"]
    legacy_safe_to_spend = core["legacy_safe_to_spend"]
    attention_all = core["attention_all"]
    attention = core["attention"]
    forecast_risk = core["forecast_risk"]
    st_aggregate = {
        "total_safe_to_spend": legacy_safe_to_spend.get("amount", "0"),
        "accounts_at_risk_count": 0,
        "accounts_at_risk": [],
        "next_risk_date": (lowest_projected_cash or {}).get("date"),
        "worst_projected_account": (
            {
                "account_id": lowest_projected_cash.get("account_id"),
                "account_name": lowest_projected_cash.get("account_name"),
                "lowest_projected_balance": lowest_projected_cash.get("amount"),
                "risk_date": lowest_projected_cash.get("date"),
            }
            if lowest_projected_cash
            else None
        ),
    }

    if mode == "fast":
        _phase_snapshot = phase_start(timer, "snapshot_top_summary")
        phases.append("snapshot_top_summary")
        snapshot_accounts = [a for a in accounts if a.status == Account.Status.ACTIVE]
        credit_cards = _dashboard_credit_cards(accounts)
        debt_accounts = _dashboard_debt_accounts(accounts)
        balance_accounts = _accounts_for_dashboard_balances(
            snapshot_accounts=snapshot_accounts,
            debt_cards=debt_accounts,
        )
        balance_by_account, _ = _load_dashboard_balance_maps(
            balance_accounts,
            today=today,
            include_prior=False,
        )
        debt_metrics = calculate_dashboard_debt_metrics(
            debt_accounts,
            balance_by_account,
            today=today,
        )
        top_summary = _compute_top_summary(
            snapshot_accounts,
            {},
            today=today,
            balance_by_account=balance_by_account,
            credit_accounts=credit_cards,
            debt_metrics=debt_metrics,
        )
        phase_end(timer, _phase_snapshot)

        _phase_debt = phase_start(timer, "debt_minimal")
        phases.append("debt_minimal")
        from credit_cards.services.debt_engine import get_cached_debt_payoff_projection

        payoff_projection = get_cached_debt_payoff_projection(
            user.pk,
            list(core["households"].values_list("id", flat=True)),
            credit_cards,
            balance_by_account=balance_by_account,
            as_of=today,
        )
        debt_summary = _build_minimal_dashboard_debt_summary(
            debt_accounts,
            as_of=today,
            balance_by_account=balance_by_account,
            debt_metrics=debt_metrics,
            payoff_projection=payoff_projection,
        )
        phase_end(timer, _phase_debt)

        _phase_recommendations = phase_start(timer, "recommendations_preview")
        phases.append("recommendations_preview")
        recommendations, insights = _build_fast_recommendation_preview(attention_all)
        phase_end(timer, _phase_recommendations)

        _log_dashboard_build_perf(
            label="dashboard_summary_fast",
            wall_start=wall_start,
            query_profiler=query_profiler,
            phases=phases,
        )

        payload: dict[str, Any] = {
            "lowest_projected_cash": lowest_projected_cash,
            "safe_to_spend": legacy_safe_to_spend,
            "top_summary": top_summary,
            "attention": attention,
            "attention_total_count": len(attention_all),
            "insights": insights,
            "recommendations": recommendations,
            "forecast_risk": forecast_risk,
        }
        if debt_summary is not None:
            payload["debt"] = debt_summary
        if cache_scope is not None:
            _store_dashboard_shared_context(cache_scope, core["shared_context"])
        return payload

    if mode == "details":
        upcoming_payload = _build_dashboard_upcoming_payload(
            user,
            core,
            today=today,
            upcoming_horizon=upcoming_horizon,
            timer=timer,
            phases=phases,
        )
        goals_payload = _build_dashboard_goals_payload(
            user,
            core,
            today=today,
            timer=timer,
            phases=phases,
        )

        _log_dashboard_build_perf(
            label="dashboard_summary_details",
            wall_start=wall_start,
            query_profiler=query_profiler,
            phases=phases,
        )

        return {
            **upcoming_payload,
            **goals_payload,
            **_empty_dashboard_details_stubs(),
        }

    upcoming_payload = _build_dashboard_upcoming_payload(
        user,
        core,
        today=today,
        upcoming_horizon=upcoming_horizon,
        timer=timer,
        phases=phases,
    )
    upcoming_events = upcoming_payload["upcoming"]
    upcoming_grouped_groups = upcoming_payload["upcoming_groups"]

    _phase_widgets = phase_start(timer, "widgets")
    phases.append("widgets")
    net_worth_accounts = list(
        Account.objects.for_net_worth()
        .filter(household__in=core["households"], is_hidden=False)
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
            household__in=core["households"],
            status__in=(GoalBucket.Status.ACTIVE, GoalBucket.Status.PAUSED),
        ).select_related("linked_account")
    )
    goals_aggregate = calculate_aggregate_bucket_summary(active_buckets, today=today)
    goals_active_count = goals_aggregate.get("goals_active_count", 0)
    goal_warnings = goals_aggregate.get("warnings", [])

    from bills.services import build_dashboard_bill_summary

    bills_summary = build_dashboard_bill_summary(user, as_of_date=today)

    from credit_cards.services.debt_engine import build_dashboard_debt_summary

    credit_cards = _dashboard_credit_cards(accounts)
    debt_accounts = _dashboard_debt_accounts(accounts)
    balance_accounts = _accounts_for_dashboard_balances(
        snapshot_accounts=snapshot_accounts,
        net_worth_accounts=net_worth_accounts,
        debt_cards=debt_accounts,
    )
    balance_by_account, prior_balance_by_account = _load_dashboard_balance_maps(
        balance_accounts,
        today=today,
        include_prior=True,
    )
    debt_metrics = calculate_dashboard_debt_metrics(
        debt_accounts,
        balance_by_account,
        today=today,
    )
    debt_summary = build_dashboard_debt_summary(
        credit_cards,
        as_of=today,
        balance_by_account=balance_by_account,
        user_id=user.pk,
        household_ids=list(core["households"].values_list("id", flat=True)),
        debt_metrics=debt_metrics,
    )
    phase_end(timer, _phase_widgets)

    from insights.services.dashboard_insights import build_dashboard_insights
    from recommendations.services.engine import (
        build_dashboard_recommendation_list,
        build_recommendation_context,
        recommendation_timeline_hints,
    )

    transfer_rule_ids, transfer_rule_targets, transfer_rule_sources = load_transfer_rule_context(
        core["households"]
    )

    _phase_insights = phase_start(timer, "insights")
    phases.append("insights")
    insights = build_dashboard_insights(
        user=user,
        attention=attention,
        health_by_id=health_by_id,
        accounts_by_id=accounts_by_id,
        accounts=accounts,
        forecasts=forecasts,
        st_aggregate=st_aggregate,
        upcoming_events=upcoming_events,
        upcoming_groups=upcoming_grouped_groups,
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
    phases.append("recommendations")
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

    _phase_snapshot = phase_start(timer, "snapshot")
    phases.append("snapshot")
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
        balance_by_account=balance_by_account,
        prior_balance_by_account=prior_balance_by_account,
    )

    top_summary = _compute_top_summary(
        snapshot_accounts,
        snapshot,
        today=today,
        balance_by_account=balance_by_account,
        credit_accounts=credit_cards,
        debt_metrics=debt_metrics,
    )
    phase_end(timer, _phase_snapshot)

    _log_dashboard_build_perf(
        label="dashboard_summary_full",
        wall_start=wall_start,
        query_profiler=query_profiler,
        phases=phases,
    )

    return {
        "lowest_projected_cash": lowest_projected_cash,
        "safe_to_spend": legacy_safe_to_spend,
        "top_summary": top_summary,
        "net_worth": _compute_net_worth(
            net_worth_accounts,
            today=today,
            balance_by_account=balance_by_account,
        ),
        "month_to_date": mtd,
        "attention": attention,
        "attention_total_count": len(attention_all),
        "upcoming": upcoming_payload["upcoming"],
        "upcoming_groups": upcoming_payload["upcoming_groups"],
        "upcoming_truncated": upcoming_payload["upcoming_truncated"],
        "upcoming_total_count": upcoming_payload["upcoming_total_count"],
        "upcoming_days": upcoming_payload["upcoming_days"],
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
    _, scope = _dashboard_scope_cache_params(user, days=days, as_of_date=today)
    result = _build_dashboard_summary(
        user,
        days=days,
        as_of_date=today,
        mode="fast",
        cache_scope=scope,
    )
    log_perf(
        "dashboard_summary_fast",
        cache="MISS",
        user=user.pk,
        days=days,
        households=len(household_ids),
        elapsed_ms=f"{(time.perf_counter() - wall_start) * 1000:.0f}",
        build_timeline_count=get_build_timeline_count(),
    )
    cache.set(cache_key, result, timeout=DASHBOARD_SUMMARY_CACHE_SECONDS)
    # #region agent log
    _agent_debug_log(
        "dashboard_summary.py:build_dashboard_summary_fast",
        "fast summary built",
        {
            "cache": "MISS",
            "lowest_projected_cash": result.get("lowest_projected_cash"),
        },
        hypothesis_id="D",
    )
    # #endregion
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
        # #region agent log
        _groups = full_cached.get("upcoming_groups") or []
        _agent_debug_log(
            "dashboard_summary.py:build_dashboard_summary_details",
            "details cache HIT_FULL",
            {
                "cache": "HIT_FULL",
                "group_count": len(_groups),
                "first_groups": [
                    {
                        "date": g.get("date"),
                        "lowest_projected_balance": g.get("lowest_projected_balance"),
                        "txn_balance_after": (g.get("transactions") or [{}])[0].get("balance_after"),
                    }
                    for g in _groups[:3]
                ],
            },
            hypothesis_id="A",
        )
        # #endregion
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
        # #region agent log
        _groups = cached.get("upcoming_groups") or []
        _agent_debug_log(
            "dashboard_summary.py:build_dashboard_summary_details",
            "details cache HIT",
            {
                "cache": "HIT",
                "group_count": len(_groups),
                "first_groups": [
                    {
                        "date": g.get("date"),
                        "lowest_projected_balance": g.get("lowest_projected_balance"),
                        "txn_balance_after": (g.get("transactions") or [{}])[0].get("balance_after"),
                    }
                    for g in _groups[:3]
                ],
            },
            hypothesis_id="A",
        )
        # #endregion
        return cached

    wall_start = time.perf_counter()
    _, scope = _dashboard_scope_cache_params(user, days=days, as_of_date=today)
    shared_context = _load_dashboard_shared_context(scope)
    details_result = _build_dashboard_summary(
        user,
        days=days,
        as_of_date=today,
        mode="details",
        shared_context=shared_context,
    )
    log_perf(
        "dashboard_summary_details",
        cache="MISS",
        user=user.pk,
        days=days,
        households=len(household_ids),
        elapsed_ms=f"{(time.perf_counter() - wall_start) * 1000:.0f}",
        build_timeline_count=get_build_timeline_count(),
        shared_context="HIT" if shared_context is not None else "MISS",
    )
    details = _extract_dashboard_details(details_result)
    # #region agent log
    _groups = details.get("upcoming_groups") or []
    _agent_debug_log(
        "dashboard_summary.py:build_dashboard_summary_details",
        "details cache MISS — fresh build",
        {
            "cache": "MISS",
            "shared_context": "HIT" if shared_context is not None else "MISS",
            "group_count": len(_groups),
            "first_groups": [
                {
                    "date": g.get("date"),
                    "lowest_projected_balance": g.get("lowest_projected_balance"),
                    "lowest_account": g.get("lowest_projected_balance_account_name"),
                    "txn_balance_after": (g.get("transactions") or [{}])[0].get("balance_after"),
                }
                for g in _groups[:3]
            ],
        },
        hypothesis_id="A,B,C",
    )
    # #endregion
    cache.set(cache_key, details, timeout=DASHBOARD_SUMMARY_CACHE_SECONDS)
    return details
