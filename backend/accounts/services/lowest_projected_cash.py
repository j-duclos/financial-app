"""
Dashboard Lowest Projected Cash — single lowest projected balance across cash accounts.

Pure timeline walk: no buffers, no goal reserves, no cross-account aggregation.
"""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from accounts.models import Account
from accounts.services.available_to_spend import DEFAULT_FORECAST_DAYS
from timeline.services.ledger import (
    _timeline_row_date,
    forecast_lowest_balance_from_rows,
    is_superseded_planned_row,
    timeline_row_process_order,
)

DASHBOARD_LOWEST_PROJECTED_CASH_ROLES = frozenset(
    {
        Account.AccountRole.SPENDING,
        Account.AccountRole.BILLS,
        Account.AccountRole.CASH_RESERVE,
        Account.AccountRole.SAVINGS,
        Account.AccountRole.EMERGENCY_FUND,
        Account.AccountRole.OTHER,
    }
)

_EXCLUDED_LOWEST_PROJECTED_CASH_ROLES = frozenset(
    {
        Account.AccountRole.CREDIT_CARD,
        Account.AccountRole.LOAN,
        Account.AccountRole.INVESTMENT,
    }
)

_EXCLUDED_LOWEST_PROJECTED_CASH_TYPES = frozenset(
    {
        Account.AccountType.CREDIT,
        Account.AccountType.INVESTMENT,
        Account.AccountType.RETIREMENT_401K,
    }
)


def account_eligible_for_lowest_projected_cash(account: Account) -> bool:
    """Active forecast cash accounts — excludes credit, loans, and investments."""
    if not account.participates_in_forecast() or account.is_hidden:
        return False
    if account.role in _EXCLUDED_LOWEST_PROJECTED_CASH_ROLES:
        return False
    if account.account_type in _EXCLUDED_LOWEST_PROJECTED_CASH_TYPES:
        return False
    if account.account_type in (
        Account.AccountType.CHECKING,
        Account.AccountType.SAVINGS,
        Account.AccountType.CASH,
    ):
        return True
    return account.role in DASHBOARD_LOWEST_PROJECTED_CASH_ROLES


def _decimal(val) -> Decimal:
    if isinstance(val, Decimal):
        return val
    return Decimal(str(val))


def _opening_balances_from_timeline_rows(
    rows: list[dict],
    account_ids: set[int],
    today: date,
) -> dict[int, Decimal]:
    """
    Derive start-of-window opening balances from timeline running_balance fields.

    No SQL — uses the same running_balance math build_timeline already applied.
    """
    rows_by_account: dict[int, list[dict]] = {aid: [] for aid in account_ids}
    for row in rows:
        aid = row.get("account_id")
        if aid in account_ids:
            rows_by_account[aid].append(row)

    opening: dict[int, Decimal] = {}
    for aid, acct_rows in rows_by_account.items():
        candidates: list[dict] = []
        for row in acct_rows:
            row_date = _timeline_row_date(row.get("date"))
            if row_date is None or row_date < today:
                continue
            if is_superseded_planned_row(row, acct_rows):
                continue
            candidates.append(row)
        if not candidates:
            continue
        first = min(
            candidates,
            key=lambda r: (_timeline_row_date(r["date"]), timeline_row_process_order(r)),
        )
        running = _decimal(first["running_balance"])
        amount = _decimal(first["amount"])
        opening[aid] = running - amount
    return opening


def get_lowest_projected_cash_from_forecasts(
    accounts: list[Account] | dict[int, Account],
    forecast_summaries: dict[int, dict[str, Any]],
) -> dict[str, Any] | None:
    """
    Single lowest projected cash balance from precomputed per-account forecast summaries.

    Reuses dashboard forecast batch output — no timeline rebuild and no buffer/goal math.
    """
    if isinstance(accounts, dict):
        accounts_by_id = accounts
    else:
        accounts_by_id = {a.id: a for a in accounts}

    best_amount: Decimal | None = None
    best_aid: int | None = None
    best_date: str | None = None

    for aid, summary in forecast_summaries.items():
        account = accounts_by_id.get(aid)
        if not account or not account_eligible_for_lowest_projected_cash(account):
            continue
        if not summary.get("supports_available_to_spend"):
            continue
        lowest_raw = summary.get("lowest_projected_balance")
        if lowest_raw is None:
            continue
        lowest = _decimal(lowest_raw)
        if best_amount is None or lowest < best_amount:
            best_amount = lowest
            best_aid = aid
            best_date = (summary.get("lowest_projected_balance_date") or "")[:10] or None

    if best_amount is None or best_aid is None:
        return None

    account = accounts_by_id.get(best_aid)
    amount = best_amount.quantize(Decimal("0.01"))
    return {
        "amount": str(amount),
        "account_id": best_aid,
        "account_name": account.effective_display_name if account else "",
        "date": best_date,
        "is_negative": amount < 0,
    }


def get_lowest_projected_cash(
    accounts: list[Account] | dict[int, Account],
    timeline_rows: list[dict],
    *,
    today: date | None = None,
    end_date: date | None = None,
) -> dict[str, Any] | None:
    """
    Single lowest projected cash balance among eligible accounts in the forecast window.

    Pure function — no ORM or SQL. Reuses precomputed timeline rows only.
    """
    today = today or date.today()
    if isinstance(accounts, dict):
        accounts_by_id = accounts
        account_list = list(accounts.values())
    else:
        account_list = list(accounts)
        accounts_by_id = {a.id: a for a in account_list}

    if end_date is None:
        end_date = today + timedelta(days=DEFAULT_FORECAST_DAYS)

    eligible_ids = {
        a.id for a in account_list if account_eligible_for_lowest_projected_cash(a)
    }
    if not eligible_ids:
        return None

    opening = _opening_balances_from_timeline_rows(timeline_rows, eligible_ids, today)
    for aid in eligible_ids:
        if aid in opening:
            continue
        account = accounts_by_id.get(aid)
        if account is not None:
            opening[aid] = _decimal(account.starting_balance or 0)

    active_ids = eligible_ids
    lowest, lowest_date, lowest_account_id = forecast_lowest_balance_from_rows(
        timeline_rows,
        account_ids=active_ids,
        today=today,
        end_date=end_date,
        opening=opening,
    )
    if lowest is None or lowest_date is None or lowest_account_id is None:
        return None

    account = accounts_by_id.get(lowest_account_id)
    amount = lowest.quantize(Decimal("0.01"))
    return {
        "amount": str(amount),
        "account_id": lowest_account_id,
        "account_name": account.effective_display_name if account else "",
        "date": lowest_date.isoformat(),
        "is_negative": amount < 0,
    }
