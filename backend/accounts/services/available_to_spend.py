"""
Forecast-aware Available-to-Spend (Safe-to-Spend) for cash accounts.

Uses build_timeline for projected activity (rules, planned, transfers) with the same
ledger visibility rules as the main timeline. Available to spend is based on the
lowest projected balance in the window minus minimum_buffer, not ending balance.
"""
from __future__ import annotations

import time
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal
from typing import Any, Optional

from django.core.cache import cache

from accounts.models import Account
from common.services.cache import (
    FORECAST_SUMMARY_CACHE_SECONDS,
    get_forecast_summary_cache_key,
)
from common.services.profiler import (
    PerfTimer,
    QueryProfiler,
    log_perf,
    perf_enabled,
    phase_end,
    phase_start,
)
from timeline.services.ledger import _balance_at_end_of_date, build_timeline

DEFAULT_FORECAST_DAYS = 30
ALLOWED_FORECAST_DAYS = frozenset({7, 14, 30, 60, 90})

WATCH_ABSOLUTE_THRESHOLD = Decimal("100")
WATCH_PERCENT_OF_BALANCE = Decimal("0.10")

RISK_STATUS_HEALTHY = "healthy"
RISK_STATUS_WATCH = "watch"
RISK_STATUS_RISK = "risk"
RISK_STATUS_CRITICAL = "critical"

ROLES_WITHOUT_AVAILABLE_TO_SPEND = frozenset(
    {
        Account.AccountRole.CREDIT_CARD,
        Account.AccountRole.LOAN,
        Account.AccountRole.INVESTMENT,
    }
)


def normalize_forecast_days(days: int | None) -> int:
    if days is None:
        return DEFAULT_FORECAST_DAYS
    if days not in ALLOWED_FORECAST_DAYS:
        raise ValueError(
            f"days must be one of {sorted(ALLOWED_FORECAST_DAYS)}; got {days!r}"
        )
    return days


def account_supports_available_to_spend(account: Account) -> bool:
    if account.role in ROLES_WITHOUT_AVAILABLE_TO_SPEND:
        return False
    if account.account_type == Account.AccountType.CREDIT:
        return False
    return True


def _decimal(val) -> Decimal:
    if isinstance(val, Decimal):
        return val
    return Decimal(str(val))


def _risk_status(
    lowest: Decimal,
    available: Decimal,
    minimum_buffer: Decimal,
    current_balance: Decimal,
) -> str:
    if lowest < Decimal("0"):
        return RISK_STATUS_CRITICAL
    if lowest < minimum_buffer:
        return RISK_STATUS_RISK
    if available <= WATCH_ABSOLUTE_THRESHOLD:
        return RISK_STATUS_WATCH
    if current_balance > 0 and available <= current_balance * WATCH_PERCENT_OF_BALANCE:
        return RISK_STATUS_WATCH
    return RISK_STATUS_HEALTHY


def _risk_reason(
    status: str,
    lowest: Decimal,
    minimum_buffer: Decimal,
    risk_date: Optional[date],
) -> Optional[str]:
    if status == RISK_STATUS_HEALTHY:
        return None
    date_str = risk_date.isoformat() if risk_date else "the forecast window"
    if status == RISK_STATUS_CRITICAL:
        return f"Projected balance drops below zero on {date_str}."
    if status == RISK_STATUS_RISK:
        return f"Projected balance falls below your {minimum_buffer} buffer on {date_str}."
    if status == RISK_STATUS_WATCH:
        return "Available to spend is low relative to your balance or buffer."
    return None


def _project_balances(
    current_balance: Decimal,
    future_amounts_by_date: dict[date, list[Decimal]],
    window_start: date,
    window_end: date,
    minimum_buffer: Decimal,
) -> tuple[
    Decimal,
    Decimal,
    date,
    Decimal,
    date | None,
    Decimal | None,
    date | None,
    Decimal | None,
]:
    """
    Walk day-by-day from window_start through window_end.
    future_amounts_by_date only includes dates strictly after window_start (today).
    Returns (
        lowest_balance,
        ending_balance,
        lowest_date,
        projected_at_window_end,
        first_negative_date,
        first_negative_balance,
        first_below_buffer_date,
        first_below_buffer_balance,
    ).
    """
    balance = current_balance
    lowest = balance
    lowest_date = window_start
    first_negative_date: date | None = None
    first_negative_balance: Decimal | None = None
    first_below_buffer_date: date | None = None
    first_below_buffer_balance: Decimal | None = None
    d = window_start
    while d <= window_end:
        if d > window_start:
            for amt in future_amounts_by_date.get(d, ()):
                balance += amt
        if balance < lowest:
            lowest = balance
            lowest_date = d
        if first_negative_date is None and balance < Decimal("0"):
            first_negative_date = d
            first_negative_balance = balance
        if first_below_buffer_date is None and balance < minimum_buffer:
            first_below_buffer_date = d
            first_below_buffer_balance = balance
        d += timedelta(days=1)
    return (
        lowest,
        balance,
        lowest_date,
        balance,
        first_negative_date,
        first_negative_balance,
        first_below_buffer_date,
        first_below_buffer_balance,
    )


def _row_superseded_by_cleared_posting(row: dict, account_rows: list[dict]) -> bool:
    """Skip PLANNED timeline rows when a matching CLEARED posting exists same day (same as web ledger)."""
    from timeline.services.ledger import is_superseded_planned_row

    return is_superseded_planned_row(row, account_rows)


def _summarize_future_rows(
    rows: list[dict],
    account_id: int,
    today: date,
    window_end: date,
) -> tuple[dict[date, list[Decimal]], Decimal, Decimal, Decimal]:
    """Future-only rows for one account: daily amounts and inflow/outflow totals."""
    by_date: dict[date, list[Decimal]] = defaultdict(list)
    inflows = Decimal("0")
    outflows = Decimal("0")
    committed_outflows = Decimal("0")

    account_rows = [r for r in rows if r.get("account_id") == account_id]

    for r in account_rows:
        row_date = r["date"]
        if hasattr(row_date, "isoformat") and not isinstance(row_date, date):
            row_date = date.fromisoformat(str(row_date)[:10])
        if row_date <= today or row_date > window_end:
            continue
        if _row_superseded_by_cleared_posting(r, account_rows):
            continue
        amt = _decimal(r["amount"])
        by_date[row_date].append(amt)
        if amt > 0:
            inflows += amt
        elif amt < 0:
            outflows += abs(amt)
            committed_outflows += abs(amt)

    return by_date, inflows, outflows, committed_outflows


def _calculate_account_forecast_summary(
    user,
    account: Account,
    *,
    as_of_date: Optional[date] = None,
    days: int = DEFAULT_FORECAST_DAYS,
    timeline_rows: Optional[list[dict]] = None,
) -> dict[str, Any]:
    """Uncached forecast summary for one account."""
    days = normalize_forecast_days(days)
    today = as_of_date or date.today()
    window_start = today
    window_end = today + timedelta(days=days)
    minimum_buffer = _decimal(account.minimum_buffer or 0)

    if not account.participates_in_forecast() or not account_supports_available_to_spend(account):
        return {
            "account_id": account.id,
            "supports_available_to_spend": False,
            "current_balance": None,
            "minimum_buffer": str(minimum_buffer),
            "forecast_window_start": window_start.isoformat(),
            "forecast_window_end": window_end.isoformat(),
            "forecast_days": days,
            "upcoming_inflows": None,
            "upcoming_outflows": None,
            "upcoming_committed_outflows": None,
            "projected_balance_at_window_end": None,
            "lowest_projected_balance": None,
            "available_to_spend": None,
            "risk_status": None,
            "risk_date": None,
            "risk_reason": None,
        }

    current_balance = _balance_at_end_of_date(account.pk, today)

    if timeline_rows is None:
        timeline_rows = build_timeline(
            user,
            start_date=window_start,
            end_date=window_end,
            account_id=account.pk,
            as_of_date=today,
        )

    by_date, inflows, outflows, committed_outflows = _summarize_future_rows(
        timeline_rows, account.pk, today, window_end
    )
    (
        lowest,
        ending,
        lowest_date,
        _,
        first_negative_date,
        first_negative_balance,
        first_below_buffer_date,
        first_below_buffer_balance,
    ) = _project_balances(
        current_balance,
        by_date,
        window_start,
        window_end,
        minimum_buffer,
    )
    bucket_allocation = Decimal("0")
    try:
        from goals.bucket_services import bucket_reserve_for_account

        bucket_allocation = bucket_reserve_for_account(account.pk, today=today)
    except Exception:
        bucket_allocation = Decimal("0")

    available = lowest - minimum_buffer - bucket_allocation
    status = _risk_status(lowest, available, minimum_buffer, current_balance)
    if status == RISK_STATUS_CRITICAL:
        risk_date = first_negative_date or lowest_date
    elif status == RISK_STATUS_RISK:
        risk_date = first_below_buffer_date or lowest_date
    else:
        risk_date = lowest_date
    reason = _risk_reason(status, lowest, minimum_buffer, risk_date)

    return {
        "account_id": account.id,
        "supports_available_to_spend": True,
        "current_balance": str(current_balance),
        "bucket_allocation": str(bucket_allocation),
        "minimum_buffer": str(minimum_buffer),
        "forecast_window_start": window_start.isoformat(),
        "forecast_window_end": window_end.isoformat(),
        "forecast_days": days,
        "upcoming_inflows": str(inflows),
        "upcoming_outflows": str(outflows),
        "upcoming_committed_outflows": str(committed_outflows),
        "projected_balance_at_window_end": str(ending),
        "lowest_projected_balance": str(lowest),
        "lowest_projected_balance_date": lowest_date.isoformat(),
        "first_negative_balance": (
            str(first_negative_balance) if first_negative_balance is not None else None
        ),
        "first_below_buffer_balance": (
            str(first_below_buffer_balance) if first_below_buffer_balance is not None else None
        ),
        "available_to_spend": str(available),
        "risk_status": status,
        "risk_date": risk_date.isoformat() if status != RISK_STATUS_HEALTHY else None,
        "risk_reason": reason,
    }


def calculate_account_forecast_summary(
    user,
    account: Account,
    *,
    as_of_date: Optional[date] = None,
    days: int = DEFAULT_FORECAST_DAYS,
    timeline_rows: Optional[list[dict]] = None,
) -> dict[str, Any]:
    """
    Full forecast summary for one account. Pass timeline_rows when batching
    to avoid multiple build_timeline calls (batch callers skip cache).
    """
    if timeline_rows is not None:
        return _calculate_account_forecast_summary(
            user,
            account,
            as_of_date=as_of_date,
            days=days,
            timeline_rows=timeline_rows,
        )

    days = normalize_forecast_days(days)
    today = as_of_date or date.today()
    cache_key = get_forecast_summary_cache_key(
        user_id=user.pk,
        household_ids=[account.household_id],
        account_ids=[account.id],
        forecast_days=days,
        as_of_date=today,
    )
    cached = cache.get(cache_key)
    if cached is not None:
        log_perf(
            "forecast_summary",
            cache="HIT",
            user=user.pk,
            accounts=1,
            account_id=account.id,
            days=days,
        )
        return cached

    wall_start = time.perf_counter()
    result = _calculate_account_forecast_summary(
        user,
        account,
        as_of_date=today,
        days=days,
        timeline_rows=None,
    )
    log_perf(
        "forecast_summary",
        cache="MISS",
        user=user.pk,
        accounts=1,
        account_id=account.id,
        days=days,
        elapsed_ms=f"{(time.perf_counter() - wall_start) * 1000:.0f}",
    )
    cache.set(cache_key, result, timeout=FORECAST_SUMMARY_CACHE_SECONDS)
    return result


def calculate_available_to_spend(
    user,
    account: Account,
    *,
    as_of_date: Optional[date] = None,
    days: int = DEFAULT_FORECAST_DAYS,
    timeline_rows: Optional[list[dict]] = None,
) -> Optional[Decimal]:
    summary = calculate_account_forecast_summary(
        user,
        account,
        as_of_date=as_of_date,
        days=days,
        timeline_rows=timeline_rows,
    )
    if not summary.get("supports_available_to_spend"):
        return None
    return _decimal(summary["available_to_spend"])


def _calculate_forecast_summaries_for_accounts(
    user,
    accounts: list[Account],
    *,
    as_of_date: Optional[date] = None,
    days: int = DEFAULT_FORECAST_DAYS,
) -> dict[int, dict[str, Any]]:
    """Uncached batch forecast summaries: one build_timeline for supported accounts."""
    timer = PerfTimer() if perf_enabled() else None
    query_profiler = QueryProfiler() if perf_enabled() else None
    wall_start = time.perf_counter() if perf_enabled() else None
    if query_profiler is not None:
        query_profiler.start()

    days = normalize_forecast_days(days)
    today = as_of_date or date.today()
    window_end = today + timedelta(days=days)

    supported = [
        a for a in accounts
        if a.participates_in_forecast() and account_supports_available_to_spend(a)
    ]
    if not supported:
        return {
            a.id: calculate_account_forecast_summary(user, a, as_of_date=today, days=days)
            for a in accounts
        }

    supported_ids = {a.id for a in supported}
    _phase_timeline = phase_start(timer, "timeline_build")
    timeline_rows = build_timeline(
        user,
        start_date=today,
        end_date=window_end,
        as_of_date=today,
    )
    phase_end(timer, _phase_timeline)

    result: dict[int, dict[str, Any]] = {}
    _phase_summaries = phase_start(timer, "account_summaries")
    for account in accounts:
        if account.id in supported_ids:
            result[account.id] = _calculate_account_forecast_summary(
                user,
                account,
                as_of_date=today,
                days=days,
                timeline_rows=timeline_rows,
            )
        else:
            result[account.id] = _calculate_account_forecast_summary(
                user,
                account,
                as_of_date=today,
                days=days,
            )
    phase_end(timer, _phase_summaries)

    if perf_enabled() and wall_start is not None:
        if query_profiler is not None:
            query_profiler.stop()
        log_perf(
            "forecast_summary_compute",
            timer=timer,
            query_profiler=query_profiler,
            user=user.pk,
            accounts=len(accounts),
            supported_accounts=len(supported),
            days=days,
            elapsed_ms=f"{(time.perf_counter() - wall_start) * 1000:.0f}",
        )
    return result


def calculate_forecast_summaries_for_accounts(
    user,
    accounts: list[Account],
    *,
    as_of_date: Optional[date] = None,
    days: int = DEFAULT_FORECAST_DAYS,
) -> dict[int, dict[str, Any]]:
    """
    Batch forecast summaries with Django cache (5-minute TTL).

    Expensive build_timeline() runs once per cache miss; dashboard and account list
    endpoints hit this path repeatedly.
    """
    days = normalize_forecast_days(days)
    today = as_of_date or date.today()
    account_ids = [a.id for a in accounts]
    household_ids = [a.household_id for a in accounts]
    cache_key = get_forecast_summary_cache_key(
        user_id=user.pk,
        household_ids=household_ids,
        account_ids=account_ids,
        forecast_days=days,
        as_of_date=today,
    )
    cached = cache.get(cache_key)
    if cached is not None:
        log_perf(
            "forecast_summary",
            cache="HIT",
            user=user.pk,
            accounts=len(account_ids),
            days=days,
        )
        return cached

    wall_start = time.perf_counter()
    result = _calculate_forecast_summaries_for_accounts(
        user,
        accounts,
        as_of_date=today,
        days=days,
    )
    log_perf(
        "forecast_summary",
        cache="MISS",
        user=user.pk,
        accounts=len(account_ids),
        days=days,
        elapsed_ms=f"{(time.perf_counter() - wall_start) * 1000:.0f}",
    )
    cache.set(cache_key, result, timeout=FORECAST_SUMMARY_CACHE_SECONDS)
    return result


def serialize_forecast_summary(summary: dict[str, Any]) -> dict[str, Any]:
    """API-friendly field names aligned with serializer / frontend."""
    if not summary.get("supports_available_to_spend"):
        return {
            "available_to_spend": None,
            "projected_balance_30_days": None,
            "lowest_projected_balance_30_days": None,
            "upcoming_inflows_30_days": None,
            "upcoming_outflows_30_days": None,
            "risk_status": None,
            "risk_date": None,
            "risk_reason": None,
            "forecast_summary": summary,
        }
    days = summary.get("forecast_days", DEFAULT_FORECAST_DAYS)
    suffix = f"_{days}_days" if days != 30 else "_30_days"
    return {
        "available_to_spend": summary.get("available_to_spend"),
        "bucket_allocation": summary.get("bucket_allocation"),
        "projected_balance_30_days": summary.get("projected_balance_at_window_end"),
        "lowest_projected_balance_30_days": summary.get("lowest_projected_balance"),
        "lowest_projected_balance_date_30_days": summary.get("lowest_projected_balance_date"),
        "first_negative_balance": summary.get("first_negative_balance"),
        "first_below_buffer_balance": summary.get("first_below_buffer_balance"),
        "upcoming_inflows_30_days": summary.get("upcoming_inflows"),
        "upcoming_outflows_30_days": summary.get("upcoming_outflows"),
        "risk_status": summary.get("risk_status"),
        "risk_date": summary.get("risk_date"),
        "risk_reason": summary.get("risk_reason"),
        f"projected_balance{suffix}": summary.get("projected_balance_at_window_end"),
        f"lowest_projected_balance{suffix}": summary.get("lowest_projected_balance"),
        f"lowest_projected_balance_date{suffix}": summary.get("lowest_projected_balance_date"),
        f"upcoming_inflows{suffix}": summary.get("upcoming_inflows"),
        f"upcoming_outflows{suffix}": summary.get("upcoming_outflows"),
        "forecast_summary": summary,
    }


def dashboard_safe_to_spend_aggregate(
    summaries: dict[int, dict[str, Any]],
    accounts_by_id: dict[int, Account],
) -> dict[str, Any]:
    """
    Aggregate safe-to-spend across spending/bills accounts for dashboard widget.
    """
    total = Decimal("0")
    at_risk: list[dict[str, Any]] = []
    worst: Optional[dict[str, Any]] = None
    next_risk_date: Optional[date] = None

    prominent_roles = {
        Account.AccountRole.SPENDING,
        Account.AccountRole.BILLS,
    }

    for aid, summary in summaries.items():
        account = accounts_by_id.get(aid)
        if not account or not summary.get("supports_available_to_spend"):
            continue
        if account.role not in prominent_roles:
            continue
        avail = _decimal(summary["available_to_spend"])
        total += avail
        status = summary.get("risk_status")
        if status in (RISK_STATUS_CRITICAL, RISK_STATUS_RISK, RISK_STATUS_WATCH):
            entry = {
                "account_id": aid,
                "account_name": account.effective_display_name,
                "risk_status": status,
                "available_to_spend": summary["available_to_spend"],
                "risk_date": summary.get("risk_date"),
                "risk_reason": summary.get("risk_reason"),
            }
            at_risk.append(entry)
            rd = summary.get("risk_date")
            if rd:
                try:
                    rd_date = date.fromisoformat(rd)
                    if next_risk_date is None or rd_date < next_risk_date:
                        next_risk_date = rd_date
                except ValueError:
                    pass
            lowest = _decimal(summary["lowest_projected_balance"])
            if worst is None or lowest < _decimal(worst["lowest_projected_balance"]):
                worst = {
                    "account_id": aid,
                    "account_name": account.effective_display_name,
                    "lowest_projected_balance": summary["lowest_projected_balance"],
                    "risk_date": summary.get("risk_date"),
                }

    return {
        "total_safe_to_spend": str(total),
        "accounts_at_risk_count": len(at_risk),
        "accounts_at_risk": at_risk,
        "next_risk_date": next_risk_date.isoformat() if next_risk_date else None,
        "worst_projected_account": worst,
    }
