"""
Computed account health indicators from forecast, safe-to-spend, and credit card data.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal
from typing import Any, Optional

from accounts.models import Account
from accounts.relationship_models import AccountRelationship
from accounts.services.account_health_constants import (
    CREDIT_UTILIZATION_CRITICAL,
    CREDIT_UTILIZATION_RISK,
    CREDIT_UTILIZATION_WATCH,
    DEFAULT_TARGET_UTILIZATION_PERCENT,
    HEALTH_STATUS_CRITICAL,
    HEALTH_STATUS_HEALTHY,
    HEALTH_STATUS_RISK,
    HEALTH_STATUS_WATCH,
    HIGH_APR_THRESHOLD,
    LARGE_OUTFLOW_BALANCE_FRACTION,
    LARGE_OUTFLOW_WINDOW_DAYS,
    PAYMENT_DUE_RISK_DAYS,
    PAYMENT_DUE_WATCH_DAYS,
    SAFE_TO_SPEND_LOW_AMOUNT,
    SAFE_TO_SPEND_LOW_PERCENT,
    STATUS_SEVERITY,
)
from accounts.services.available_to_spend import (
    DEFAULT_FORECAST_DAYS,
    _decimal,
    account_supports_available_to_spend,
    calculate_forecast_summaries_for_accounts_with_timeline,
    cash_account_risk_shortfall,
    normalize_forecast_days,
)
from accounts.services.credit_card import ledger_owed_balance, sync_current_balance_from_ledger
from timeline.services.ledger import _balance_at_end_of_date, build_timeline
from transactions.models import Transaction

CASH_ROLES = frozenset(
    {
        Account.AccountRole.SPENDING,
        Account.AccountRole.BILLS,
        Account.AccountRole.CASH_RESERVE,
        Account.AccountRole.OTHER,
    }
)
SAVINGS_ROLES = frozenset(
    {
        Account.AccountRole.SAVINGS,
        Account.AccountRole.EMERGENCY_FUND,
    }
)


def _worst_status(*statuses: str) -> str:
    return max(statuses, key=lambda s: STATUS_SEVERITY.get(s, 0))


def _status_score(status: str, *, headroom_ratio: Decimal | None = None) -> int:
    if status == HEALTH_STATUS_CRITICAL:
        return max(0, min(34, int(20 + (headroom_ratio or 0) * 14)))
    if status == HEALTH_STATUS_RISK:
        return max(35, min(64, 50 + int((headroom_ratio or 0) * 14)))
    if status == HEALTH_STATUS_WATCH:
        return max(65, min(84, 72 + int((headroom_ratio or 0) * 12)))
    return max(85, min(100, 90 + int((headroom_ratio or 0) * 10)))


def _serialize_decimal(val: Decimal | None) -> str | None:
    if val is None:
        return None
    return str(val)


def _target_utilization_percent(account: Account) -> Decimal:
    raw = account.target_utilization_percent
    if raw is None:
        return DEFAULT_TARGET_UTILIZATION_PERCENT
    target = _decimal(raw)
    if target < Decimal("0"):
        return DEFAULT_TARGET_UTILIZATION_PERCENT
    return min(target, Decimal("100"))


def _credit_utilization_thresholds(target: Decimal) -> tuple[Decimal, Decimal, Decimal]:
    """
    Watch / risk / critical lower bounds from target utilization.
    Default target 10% → 50% / 70% / 90% (same as legacy fixed thresholds).
    """
    watch_at = max(target + Decimal("40"), CREDIT_UTILIZATION_WATCH)
    risk_at = max(target + Decimal("60"), CREDIT_UTILIZATION_RISK)
    critical_at = max(target + Decimal("80"), CREDIT_UTILIZATION_CRITICAL)
    return watch_at, risk_at, critical_at


def _utilization_reason(util_dec: Decimal, target: Decimal) -> str:
    return f"Utilization is {util_dec:.0f}% (target {target:.0f}%)"


def _credit_utilization_percent(owed: Decimal, limit: Decimal) -> Decimal | None:
    if limit <= 0:
        return None
    return (owed / limit * Decimal("100")).quantize(Decimal("0.01"))


def _count_unmatched_imports(account: Account) -> int:
    return Transaction.objects.filter(
        account_id=account.pk,
        source=Transaction.Source.PLAID,
        import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
    ).count()


def _has_large_outflow_soon(
    timeline_rows: list[dict] | None,
    account_id: int,
    today: date,
    current_balance: Decimal,
) -> bool:
    if not timeline_rows or current_balance <= 0:
        return False
    window_end = today + timedelta(days=LARGE_OUTFLOW_WINDOW_DAYS)
    by_date: dict[date, Decimal] = defaultdict(lambda: Decimal("0"))
    for r in timeline_rows:
        if r.get("account_id") != account_id:
            continue
        row_date = r["date"]
        if hasattr(row_date, "isoformat") and not isinstance(row_date, date):
            row_date = date.fromisoformat(str(row_date)[:10])
        if row_date <= today or row_date > window_end:
            continue
        amt = _decimal(r["amount"])
        if amt < 0:
            by_date[row_date] += abs(amt)
    threshold = max(Decimal("500"), current_balance * LARGE_OUTFLOW_BALANCE_FRACTION)
    return any(outflow >= threshold for outflow in by_date.values())


def _cash_health(
    account: Account,
    forecast: dict[str, Any] | None,
    today: date,
    timeline_rows: list[dict] | None,
) -> tuple[str, str | None, date | None, dict[str, Any]]:
    details: dict[str, Any] = {
        "lowest_projected_balance": None,
        "available_to_spend": None,
        "minimum_buffer": str(account.minimum_buffer or 0),
        "utilization_percent": None,
        "days_until_due": None,
        "past_due_amount": None,
        "unmatched_import_count": _count_unmatched_imports(account),
    }
    if not forecast or not forecast.get("supports_available_to_spend"):
        return HEALTH_STATUS_HEALTHY, None, None, details

    lowest = _decimal(forecast["lowest_projected_balance"])
    available = _decimal(forecast["available_to_spend"])
    minimum_buffer = _decimal(forecast.get("minimum_buffer") or account.minimum_buffer or 0)
    current_balance = _decimal(forecast.get("current_balance") or 0)
    risk_date_str = forecast.get("risk_date")
    risk_date = date.fromisoformat(risk_date_str) if risk_date_str else None

    details["lowest_projected_balance"] = forecast.get("lowest_projected_balance")
    details["available_to_spend"] = forecast.get("available_to_spend")
    details["first_negative_balance"] = forecast.get("first_negative_balance")
    details["first_below_buffer_balance"] = forecast.get("first_below_buffer_balance")

    statuses: list[str] = []
    reasons: list[str] = []

    if lowest < Decimal("0"):
        statuses.append(HEALTH_STATUS_CRITICAL)
        date_label = risk_date.isoformat() if risk_date else "the forecast window"
        reasons.append(f"Projected balance drops below zero on {date_label}")
    elif lowest < minimum_buffer:
        statuses.append(HEALTH_STATUS_RISK)
        date_label = risk_date.isoformat() if risk_date else "the forecast window"
        reasons.append(f"Projected below buffer on {date_label}")

    if (
        available < Decimal("0")
        and account.role in (Account.AccountRole.SPENDING, Account.AccountRole.BILLS)
        and HEALTH_STATUS_CRITICAL not in statuses
    ):
        statuses.append(HEALTH_STATUS_CRITICAL)
        reasons.append("Safe-to-spend is negative")

    if available <= SAFE_TO_SPEND_LOW_AMOUNT:
        statuses.append(HEALTH_STATUS_WATCH)
        reasons.append("Safe-to-spend is near zero")
    elif current_balance > 0 and available <= current_balance * SAFE_TO_SPEND_LOW_PERCENT:
        statuses.append(HEALTH_STATUS_WATCH)
        reasons.append("Safe-to-spend is low relative to balance")

    if _has_large_outflow_soon(timeline_rows, account.pk, today, current_balance):
        statuses.append(HEALTH_STATUS_WATCH)
        reasons.append("Large upcoming outflow within 7 days")

    if not statuses:
        return HEALTH_STATUS_HEALTHY, None, None, details

    status = _worst_status(*statuses)
    reason = reasons[0] if len(reasons) == 1 else reasons[0]
    if status == HEALTH_STATUS_CRITICAL and len(reasons) > 1:
        reason = next((r for r in reasons if "zero" in r or "negative" in r), reason)
    return status, reason, risk_date, details


def _credit_card_health(account: Account, today: date) -> tuple[str, str | None, date | None, dict[str, Any]]:
    owed = ledger_owed_balance(account, today)
    limit = _decimal(account.credit_limit or 0)
    util_dec = _credit_utilization_percent(owed, limit)
    due = account.next_payment_due_date
    days_until = (due - today).days if due else None
    payoff = account.payoff_to_avoid_interest

    past_due_amount = Decimal("0")
    if days_until is not None and days_until < 0 and (payoff > 0 or owed > 0):
        past_due_amount = payoff if payoff > 0 else owed

    target_util = _target_utilization_percent(account)
    watch_at, risk_at, critical_at = _credit_utilization_thresholds(target_util)

    details: dict[str, Any] = {
        "lowest_projected_balance": None,
        "available_to_spend": None,
        "minimum_buffer": str(account.minimum_buffer or 0),
        "utilization_percent": _serialize_decimal(util_dec),
        "target_utilization_percent": _serialize_decimal(target_util),
        "days_until_due": days_until,
        "past_due_amount": _serialize_decimal(past_due_amount) if past_due_amount > 0 else None,
        "unmatched_import_count": _count_unmatched_imports(account),
    }

    statuses: list[str] = []
    reasons: list[str] = []
    risk_date: date | None = due if due and due >= today else None

    if past_due_amount > 0:
        statuses.append(HEALTH_STATUS_CRITICAL)
        reasons.append("Payment is past due")

    if util_dec is not None and util_dec >= critical_at:
        statuses.append(HEALTH_STATUS_CRITICAL)
        reasons.append(_utilization_reason(util_dec, target_util))

    if limit > 0 and owed > limit:
        statuses.append(HEALTH_STATUS_CRITICAL)
        reasons.append("Balance exceeds credit limit")

    if (
        days_until is not None
        and 0 <= days_until <= PAYMENT_DUE_RISK_DAYS
        and payoff > 0
        and not account.autopay_enabled
    ):
        statuses.append(HEALTH_STATUS_RISK)
        reasons.append(f"Payment due in {days_until} day{'s' if days_until != 1 else ''}")

    if (
        days_until is not None
        and 0 <= days_until <= PAYMENT_DUE_WATCH_DAYS
        and payoff > 0
    ):
        if not any("Payment due" in r for r in reasons):
            statuses.append(HEALTH_STATUS_WATCH)
            reasons.append(f"Payment due in {days_until} day{'s' if days_until != 1 else ''}")

    if util_dec is not None and util_dec >= risk_at:
        statuses.append(HEALTH_STATUS_RISK)
        if not any("Utilization" in r for r in reasons):
            reasons.append(_utilization_reason(util_dec, target_util))

    projected_interest = account.projected_interest_if_unpaid
    if (
        payoff > 0
        and projected_interest > 0
        and not account.autopay_enabled
        and (days_until is None or days_until > PAYMENT_DUE_WATCH_DAYS)
    ):
        statuses.append(HEALTH_STATUS_RISK)
        reasons.append("Projected interest if statement balance remains unpaid")

    if util_dec is not None and util_dec > target_util and util_dec < risk_at:
        if not any("Utilization" in r for r in reasons):
            statuses.append(HEALTH_STATUS_WATCH)
            reasons.append(_utilization_reason(util_dec, target_util))

    min_pay = _decimal(account.minimum_payment_amount or 0)
    if owed > 0 and min_pay > 0 and _decimal(account.apr or 0) > 0:
        from credit_cards.services.payoff import IMPOSSIBLE_MESSAGE, project_credit_card_payoff

        min_proj = project_credit_card_payoff(account, "minimum_payment")
        if not min_proj.get("payoff_possible"):
            statuses.append(HEALTH_STATUS_CRITICAL)
            reasons.append(min_proj.get("message") or IMPOSSIBLE_MESSAGE)
            details["payoff_impossible"] = True

    apr = _decimal(account.apr or 0)
    if apr >= HIGH_APR_THRESHOLD and owed > 0 and payoff > 0:
        statuses.append(HEALTH_STATUS_WATCH)
        if not any("interest" in r.lower() or "APR" in r for r in reasons):
            reasons.append("High APR with carried balance")

    has_payment_link = account.autopay_enabled or AccountRelationship.objects.filter(
        destination_account_id=account.pk,
        is_active=True,
        relationship_type__in=(
            AccountRelationship.RelationshipType.CREDIT_CARD_PAYMENT,
            AccountRelationship.RelationshipType.AUTOPAY,
            AccountRelationship.RelationshipType.DEBT_PAYMENT,
        ),
    ).exists()
    if owed > 0 and not has_payment_link:
        statuses.append(HEALTH_STATUS_WATCH)
        reasons.append("No payment account linked.")

    if account.autopay_enabled and payoff <= 0:
        return HEALTH_STATUS_HEALTHY, None, None, details

    if util_dec is not None and util_dec <= target_util and payoff <= 0:
        return HEALTH_STATUS_HEALTHY, None, None, details

    if not statuses:
        return HEALTH_STATUS_HEALTHY, None, None, details

    status = _worst_status(*statuses)
    reason = reasons[0]
    priority_phrases = ("past due", "Payment due", "Utilization", "limit", "interest")
    for phrase in priority_phrases:
        for r in reasons:
            if phrase.lower() in r.lower():
                reason = r
                break
        else:
            continue
        break
    return status, reason, risk_date, details


def _savings_health(
    account: Account,
    forecast: dict[str, Any] | None,
    today: date,
) -> tuple[str, str | None, date | None, dict[str, Any]]:
    details: dict[str, Any] = {
        "lowest_projected_balance": None,
        "available_to_spend": None,
        "minimum_buffer": str(account.minimum_buffer or 0),
        "utilization_percent": None,
        "days_until_due": None,
        "past_due_amount": None,
        "unmatched_import_count": _count_unmatched_imports(account),
    }

    if forecast and forecast.get("supports_available_to_spend"):
        lowest = _decimal(forecast["lowest_projected_balance"])
        minimum_buffer = _decimal(forecast.get("minimum_buffer") or account.minimum_buffer or 0)
        details["lowest_projected_balance"] = forecast.get("lowest_projected_balance")
        details["available_to_spend"] = forecast.get("available_to_spend")
        risk_date_str = forecast.get("risk_date")
        risk_date = date.fromisoformat(risk_date_str) if risk_date_str else None

        if lowest < Decimal("0"):
            return (
                HEALTH_STATUS_CRITICAL,
                "Projected balance drops below zero",
                risk_date,
                details,
            )
        if lowest < minimum_buffer:
            date_label = risk_date.isoformat() if risk_date else "the forecast window"
            return (
                HEALTH_STATUS_RISK,
                f"Projected below buffer on {date_label}",
                risk_date,
                details,
            )
        current = _decimal(forecast.get("current_balance") or 0)
        if current > 0 and lowest < current * Decimal("0.90"):
            return (
                HEALTH_STATUS_WATCH,
                "Balance trending down in forecast window",
                risk_date,
                details,
            )
        return HEALTH_STATUS_HEALTHY, None, None, details

    balance = _balance_at_end_of_date(account.pk, today)
    minimum_buffer = _decimal(account.minimum_buffer or 0)
    details["lowest_projected_balance"] = str(balance)
    if balance < minimum_buffer:
        return HEALTH_STATUS_RISK, "Balance below minimum buffer", None, details
    return HEALTH_STATUS_HEALTHY, None, None, details


def _loan_health(account: Account, today: date) -> tuple[str, str | None, date | None, dict[str, Any]]:
    due = account.next_payment_due_date
    days_until = (due - today).days if due else None
    details: dict[str, Any] = {
        "lowest_projected_balance": None,
        "available_to_spend": None,
        "minimum_buffer": str(account.minimum_buffer or 0),
        "utilization_percent": None,
        "days_until_due": days_until,
        "past_due_amount": None,
        "unmatched_import_count": _count_unmatched_imports(account),
    }
    if not due:
        return HEALTH_STATUS_HEALTHY, None, None, details

    if days_until is not None and days_until < 0:
        return HEALTH_STATUS_CRITICAL, "Payment is past due", due, details

    has_planned = Transaction.objects.filter(
        account_id=account.pk,
        date__gte=today,
        date__lte=due,
        status=Transaction.Status.PLANNED,
        amount__lt=0,
    ).exists()

    if 0 <= days_until <= PAYMENT_DUE_RISK_DAYS and not has_planned and not account.autopay_enabled:
        return (
            HEALTH_STATUS_RISK,
            f"Payment due in {days_until} day{'s' if days_until != 1 else ''}",
            due,
            details,
        )

    if 0 <= days_until <= PAYMENT_DUE_WATCH_DAYS:
        return (
            HEALTH_STATUS_WATCH,
            f"Payment due in {days_until} day{'s' if days_until != 1 else ''}",
            due,
            details,
        )

    return HEALTH_STATUS_HEALTHY, None, None, details


def _recommended_action(
    account: Account,
    status: str,
    reason: str | None,
    details: dict[str, Any],
    forecast: dict[str, Any] | None,
) -> str | None:
    if status == HEALTH_STATUS_HEALTHY:
        return None

    if account.is_credit_card():
        util = details.get("utilization_percent")
        if status == HEALTH_STATUS_CRITICAL and details.get("past_due_amount"):
            return "Schedule a payment immediately to avoid late fees."
        target = _target_utilization_percent(account)
        _, risk_at, _ = _credit_utilization_thresholds(target)
        if util and _decimal(util) >= risk_at:
            return f"Reduce card utilization toward your {target:.0f}% target."
        days = details.get("days_until_due")
        if days is not None and days >= 0:
            return "Schedule a payment before the due date."
        if reason and "interest" in reason.lower():
            return "Pay statement balance before the due date to avoid interest."
        return "Review payment and utilization on this card."

    if account.role == Account.AccountRole.LOAN:
        if status in (HEALTH_STATUS_CRITICAL, HEALTH_STATUS_RISK):
            return "Schedule a payment before the due date."
        return "Confirm an upcoming payment is planned."

    shortfall = None
    if forecast and forecast.get("supports_available_to_spend"):
        shortfall = cash_account_risk_shortfall(forecast)

    risk_date = forecast.get("risk_date") if forecast else None
    if shortfall and shortfall > 0:
        date_part = f" before {risk_date}" if risk_date else ""
        return f"Move ${shortfall.quantize(Decimal('0.01'))} into this account{date_part}."

    if reason and "buffer" in reason.lower():
        return "Increase minimum buffer or adjust upcoming bills."
    if reason and "outflow" in reason.lower():
        return "Review large upcoming bills in the next week."
    return "Review upcoming activity on this account."


def calculate_account_health(
    user,
    account: Account,
    *,
    as_of_date: Optional[date] = None,
    days: int = DEFAULT_FORECAST_DAYS,
    forecast_summary: Optional[dict[str, Any]] = None,
    timeline_rows: Optional[list[dict]] = None,
) -> dict[str, Any]:
    """Compute health for a single account."""
    days = normalize_forecast_days(days)
    today = as_of_date or date.today()

    if account.status != Account.Status.ACTIVE:
        return {
            "health_status": None,
            "health_score": None,
            "health_reason": None,
            "health_risk_date": None,
            "health_details": {"lifecycle_inactive": True, "status": account.status},
            "health_recommended_action": None,
        }

    if forecast_summary is None and account_supports_available_to_spend(account):
        if timeline_rows is None:
            window_end = today + timedelta(days=days)
            timeline_rows = build_timeline(
                user,
                start_date=today,
                end_date=window_end,
                account_id=account.pk,
                as_of_date=today,
                projection_only=True,
                caller="account_health",
            )
        from accounts.services.available_to_spend import calculate_account_forecast_summary

        forecast_summary = calculate_account_forecast_summary(
            user,
            account,
            as_of_date=today,
            days=days,
            timeline_rows=timeline_rows,
        )

    if account.is_credit_card() or account.role == Account.AccountRole.CREDIT_CARD:
        status, reason, risk_date, details = _credit_card_health(account, today)
        forecast = None
    elif account.role == Account.AccountRole.LOAN:
        status, reason, risk_date, details = _loan_health(account, today)
        forecast = forecast_summary
    elif account.role in SAVINGS_ROLES or account.account_type == Account.AccountType.SAVINGS:
        status, reason, risk_date, details = _savings_health(account, forecast_summary, today)
        forecast = forecast_summary
    elif account_supports_available_to_spend(account):
        status, reason, risk_date, details = _cash_health(
            account, forecast_summary, today, timeline_rows
        )
        forecast = forecast_summary
    else:
        status, reason, risk_date, details = (
            HEALTH_STATUS_HEALTHY,
            None,
            None,
            {
                "lowest_projected_balance": None,
                "available_to_spend": None,
                "minimum_buffer": str(account.minimum_buffer or 0),
                "utilization_percent": None,
                "days_until_due": None,
                "past_due_amount": None,
                "unmatched_import_count": _count_unmatched_imports(account),
            },
        )
        forecast = forecast_summary

    headroom = None
    if forecast and forecast.get("supports_available_to_spend"):
        lowest = _decimal(forecast.get("lowest_projected_balance") or 0)
        buffer = _decimal(forecast.get("minimum_buffer") or 0)
        if buffer > 0:
            headroom = max(Decimal("0"), (lowest - buffer) / buffer)

    score = _status_score(status, headroom_ratio=headroom)
    action = _recommended_action(account, status, reason, details, forecast)

    return {
        "status": status,
        "score": score,
        "reason": reason,
        "risk_date": risk_date.isoformat() if risk_date else None,
        "recommended_action": action,
        "details": details,
    }


def calculate_account_health_for_accounts(
    user,
    accounts: list[Account],
    *,
    as_of_date: Optional[date] = None,
    days: int = DEFAULT_FORECAST_DAYS,
    timeline_rows: list[dict] | None = None,
) -> dict[int, dict[str, Any]]:
    """Batch health calculation with shared forecast timeline where possible."""
    days = normalize_forecast_days(days)
    today = as_of_date or date.today()

    forecasts, shared_timeline = calculate_forecast_summaries_for_accounts_with_timeline(
        user,
        accounts,
        as_of_date=today,
        days=days,
        timeline_rows=timeline_rows,
    )
    effective_timeline = timeline_rows if timeline_rows is not None else shared_timeline

    for account in accounts:
        if account.is_credit_card():
            sync_current_balance_from_ledger(account, today)

    result: dict[int, dict[str, Any]] = {}
    for account in accounts:
        result[account.id] = calculate_account_health(
            user,
            account,
            as_of_date=today,
            days=days,
            forecast_summary=forecasts.get(account.id),
            timeline_rows=effective_timeline,
        )
    return result


def serialize_account_health(health: dict[str, Any]) -> dict[str, Any]:
    """API field names for account serializers."""
    return {
        "health_status": health.get("status"),
        "health_score": health.get("score"),
        "health_reason": health.get("reason"),
        "health_risk_date": health.get("risk_date"),
        "health_details": health.get("details"),
        "health_recommended_action": health.get("recommended_action"),
    }


def dashboard_account_health_aggregate(
    health_by_id: dict[int, dict[str, Any]],
    accounts_by_id: dict[int, Account],
    *,
    safe_to_spend_total: str | None = None,
) -> dict[str, Any]:
    """Household-level health summary for dashboard."""
    needing_attention: list[dict[str, Any]] = []
    critical_count = 0
    next_risk_date: date | None = None
    worst: dict[str, Any] | None = None

    for aid, health in health_by_id.items():
        account = accounts_by_id.get(aid)
        if not account:
            continue
        status = health.get("status", HEALTH_STATUS_HEALTHY)
        if status == HEALTH_STATUS_HEALTHY:
            continue
        if status == HEALTH_STATUS_CRITICAL:
            critical_count += 1

        entry = {
            "account_id": aid,
            "account_name": account.effective_display_name,
            "health_status": status,
            "health_score": health.get("score"),
            "health_reason": health.get("reason"),
            "health_risk_date": health.get("risk_date"),
        }
        needing_attention.append(entry)

        rd = health.get("risk_date")
        if rd:
            try:
                rd_date = date.fromisoformat(rd)
                if next_risk_date is None or rd_date < next_risk_date:
                    next_risk_date = rd_date
            except ValueError:
                pass

        score = health.get("score", 100)
        if worst is None or score < worst.get("health_score", 100):
            worst = {
                "account_id": aid,
                "account_name": account.effective_display_name,
                "health_status": status,
                "health_score": score,
                "health_reason": health.get("reason"),
                "health_risk_date": health.get("risk_date"),
            }

    needing_attention.sort(
        key=lambda e: (
            -STATUS_SEVERITY.get(e["health_status"], 0),
            e.get("health_risk_date") or "9999-12-31",
        )
    )

    next_issue_account = needing_attention[0] if needing_attention else None
    next_issue_text = None
    if next_issue_account and next_issue_account.get("health_reason"):
        name = next_issue_account["account_name"]
        reason = next_issue_account["health_reason"]
        rd = next_issue_account.get("health_risk_date")
        if rd and "on " not in reason.lower():
            next_issue_text = f"Next issue: {name} — {reason} on {rd}"
        else:
            next_issue_text = f"Next issue: {name} — {reason}"

    return {
        "accounts_needing_attention_count": len(needing_attention),
        "critical_accounts_count": critical_count,
        "accounts_needing_attention": needing_attention,
        "next_health_risk_date": next_risk_date.isoformat() if next_risk_date else None,
        "worst_health_account": worst,
        "next_health_issue_text": next_issue_text,
        "total_safe_to_spend": safe_to_spend_total,
    }
