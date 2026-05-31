"""
Goal progress, projections, and dashboard summaries.
"""
from __future__ import annotations

import calendar
from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from accounts.models import Account
from accounts.services.available_to_spend import _decimal
from accounts.services.credit_card import ledger_owed_balance
from goals.models import FinancialGoal
from timeline.models import RecurringRule
from timeline.services.ledger import _balance_at_end_of_date

ON_TRACK = "on_track"
BEHIND = "behind"
AHEAD = "ahead"
NO_TARGET_DATE = "no_target_date"

HEALTH_AHEAD = "ahead"
HEALTH_ON_TRACK = "on_track"
HEALTH_WATCH = "watch"
HEALTH_BEHIND = "behind"
HEALTH_COMPLETED = "completed"
HEALTH_NO_SCHEDULE = "no_schedule"

MILESTONE_THRESHOLDS = (25, 50, 75, 100)

DATE_DRIVEN_GOAL_TYPES = frozenset(
    {
        FinancialGoal.GoalType.HOUSE_DOWN_PAYMENT,
        FinancialGoal.GoalType.COLLEGE,
        FinancialGoal.GoalType.VACATION,
        FinancialGoal.GoalType.TAXES,
        FinancialGoal.GoalType.CAR,
        FinancialGoal.GoalType.PURCHASE,
    }
)

CASH_ROLES_FOR_BUFFER = frozenset(
    {
        Account.AccountRole.SPENDING,
        Account.AccountRole.BILLS,
        Account.AccountRole.CASH_RESERVE,
    }
)


def _quantize_money(val: Decimal) -> Decimal:
    return val.quantize(Decimal("0.01"))


def _serialize_decimal(val: Decimal | None) -> str | None:
    if val is None:
        return None
    return str(_quantize_money(val))


def last_day_of_month(year: int, month: int) -> date:
    last = calendar.monthrange(year, month)[1]
    return date(year, month, last)


def parse_report_month(month: str) -> date:
    """Last calendar day of YYYY-MM (for month-scoped goal reports)."""
    year, month_int = map(int, month.split("-"))
    return last_day_of_month(year, month_int)


def _actual_balance_at_end_of_date(account_id: int, as_of: date) -> Decimal:
    """Posted ledger balance through end of ``as_of`` (actual + Plaid imports only)."""
    from transactions.models import Transaction
    from timeline.services.ledger import sum_transaction_amounts_for_balance

    txn_sum = sum_transaction_amounts_for_balance(
        account_id,
        date_lt=as_of + timedelta(days=1),
        sources=(Transaction.Source.ACTUAL, Transaction.Source.PLAID),
    )
    acc = Account.objects.filter(pk=account_id).first()
    opening = Decimal("0")
    if acc and acc.starting_balance is not None:
        opening = Decimal(str(acc.starting_balance))
    return opening + txn_sum


def _timeline_balance_at_end_of_date(user, account_id: int, as_of: date) -> Decimal | None:
    """Forecast running balance on ``as_of`` from the account timeline."""
    from timeline.services.ledger import build_timeline

    start = as_of - timedelta(days=120)
    rows = build_timeline(
        user,
        start_date=start,
        end_date=as_of,
        account_id=account_id,
        as_of_date=date.today(),
    )
    last: Decimal | None = None
    for row in rows:
        if row.get("account_id") != account_id:
            continue
        row_date = row.get("date")
        if isinstance(row_date, str):
            row_date = date.fromisoformat(row_date[:10])
        if row_date is None or row_date > as_of:
            continue
        rb = row.get("running_balance")
        if rb is not None:
            last = _decimal(rb)
    return last


def _linked_savings_balance(
    account: Account,
    as_of: date,
    *,
    user=None,
) -> Decimal:
    """
    Goal progress = linked account balance on ``as_of``.

    Past/current: actual posted transactions only (matches the account register).
    Future month-ends: timeline projected running balance.
    """
    today = date.today()
    if as_of > today:
        if user is None:
            balance = _actual_balance_at_end_of_date(account.pk, today)
        else:
            projected = _timeline_balance_at_end_of_date(user, account.pk, as_of)
            balance = projected if projected is not None else _actual_balance_at_end_of_date(account.pk, today)
    else:
        balance = _actual_balance_at_end_of_date(account.pk, as_of)

    buffer = _decimal(account.minimum_buffer or 0)
    if account.role in CASH_ROLES_FOR_BUFFER and buffer > 0:
        return max(Decimal("0"), balance - buffer)
    return max(Decimal("0"), balance)


def _monthly_from_rule(rule: RecurringRule | None) -> Decimal:
    if rule is None or not rule.active:
        return Decimal("0")
    amount = abs(_decimal(rule.amount))
    if amount <= 0:
        return Decimal("0")
    freq = rule.frequency
    if freq == RecurringRule.Frequency.WEEKLY:
        return amount * Decimal("52") / Decimal("12")
    if freq == RecurringRule.Frequency.BIWEEKLY:
        return amount * Decimal("26") / Decimal("12")
    if freq in (
        RecurringRule.Frequency.MONTHLY_DAY,
        RecurringRule.Frequency.MONTHLY_NTH_WEEKDAY,
    ):
        return amount
    if freq == RecurringRule.Frequency.YEARLY:
        return amount / Decimal("12")
    return amount


def _effective_monthly_contribution(goal: FinancialGoal) -> Decimal:
    rule_amt = _monthly_from_rule(goal.contribution_rule)
    if rule_amt > 0:
        return rule_amt
    return max(Decimal("0"), _decimal(goal.monthly_contribution))


def _add_months(d: date, months: int) -> date:
    month = d.month - 1 + months
    year = d.year + month // 12
    month = month % 12 + 1
    day = min(d.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def calculate_projected_completion(
    goal: FinancialGoal,
    *,
    remaining_amount: Decimal,
    monthly_contribution: Decimal | None = None,
    today: date | None = None,
) -> date | None:
    today = today or date.today()
    monthly = monthly_contribution if monthly_contribution is not None else _effective_monthly_contribution(goal)
    if remaining_amount <= 0:
        return today
    if monthly <= 0:
        return None
    months_needed = max(1, int((remaining_amount + monthly - Decimal("0.01")) / monthly))
    if months_needed <= 0:
        return today
    return _add_months(today, months_needed)


def _on_track_status(
    goal: FinancialGoal,
    projected: date | None,
    today: date,
) -> str:
    if not goal.target_date:
        return NO_TARGET_DATE
    if projected is None:
        return NO_TARGET_DATE
    if projected <= goal.target_date:
        if (goal.target_date - projected).days > 31:
            return AHEAD
        return ON_TRACK
    return BEHIND


def _expected_progress_percent(goal: FinancialGoal, today: date) -> Decimal | None:
    if not goal.target_date:
        return None
    start = goal.created_at.date() if goal.created_at else today
    if goal.target_date <= start:
        return Decimal("100")
    total_days = (goal.target_date - start).days
    if total_days <= 0:
        return Decimal("100")
    if today >= goal.target_date:
        return Decimal("100")
    elapsed = max(0, (today - start).days)
    return min(Decimal("100"), Decimal(elapsed) / Decimal(total_days) * Decimal("100"))


def calculate_goal_health(
    goal: FinancialGoal,
    progress_percent: Decimal,
    *,
    today: date | None = None,
) -> str:
    today = today or date.today()
    if goal.status == FinancialGoal.Status.COMPLETED or progress_percent >= Decimal("100"):
        return HEALTH_COMPLETED
    expected = _expected_progress_percent(goal, today)
    if expected is None:
        return HEALTH_NO_SCHEDULE
    delta = progress_percent - expected
    if delta >= Decimal("5"):
        return HEALTH_AHEAD
    if delta >= Decimal("-5"):
        return HEALTH_ON_TRACK
    if delta >= Decimal("-15"):
        return HEALTH_WATCH
    return HEALTH_BEHIND


def calculate_milestones(
    goal: FinancialGoal,
    *,
    progress_percent: Decimal,
    current: Decimal,
    target: Decimal,
) -> list[dict[str, Any]]:
    milestones: list[dict[str, Any]] = []
    for pct in MILESTONE_THRESHOLDS:
        threshold_amount = _quantize_money(target * Decimal(pct) / Decimal("100"))
        achieved = progress_percent >= Decimal(pct)
        if pct == 100:
            label = "Completion"
        elif pct == 50:
            label = "Halfway"
        elif pct == 25:
            label = f"First ${_quantize_money(threshold_amount)}"
        else:
            label = f"{pct}%"
        milestones.append(
            {
                "percent": pct,
                "label": label,
                "threshold_amount": _serialize_decimal(threshold_amount),
                "achieved": achieved,
            }
        )
    return milestones


def _monthly_required(goal: FinancialGoal, remaining: Decimal, today: date) -> Decimal | None:
    recommended = _recommended_monthly(goal, remaining, today)
    if recommended is not None:
        return recommended
    monthly = _effective_monthly_contribution(goal)
    return monthly if monthly > 0 else None


def enrich_goal_progress(goal: FinancialGoal, progress: dict[str, Any], *, today: date | None = None) -> dict[str, Any]:
    today = today or date.today()
    progress_pct = Decimal(progress["progress_percent"])
    remaining = _decimal(progress["remaining_amount"])
    monthly = _effective_monthly_contribution(goal)
    monthly_required = _monthly_required(goal, remaining, today)
    forecast_gap: Decimal | None = None
    if monthly_required is not None and monthly_required > 0:
        gap = monthly_required - monthly
        forecast_gap = gap if gap > 0 else Decimal("0")

    funding_name = None
    if goal.is_debt_goal() and goal.linked_credit_account:
        funding_name = goal.linked_credit_account.effective_display_name
    elif goal.linked_account:
        funding_name = goal.linked_account.effective_display_name

    health = calculate_goal_health(goal, progress_pct, today=today)
    current = _decimal(progress["current_amount"])
    target = _decimal(progress["target_amount"])

    return {
        **progress,
        "goal_health": health,
        "monthly_required": _serialize_decimal(monthly_required) if monthly_required else None,
        "current_contribution_rate": _serialize_decimal(monthly) if monthly > 0 else None,
        "forecast_gap": _serialize_decimal(forecast_gap) if forecast_gap is not None else None,
        "funding_account": funding_name,
        "milestones": calculate_milestones(
            goal, progress_percent=progress_pct, current=current, target=target
        ),
    }


def calculate_aggregate_goal_summary(
    goals: list[FinancialGoal],
    *,
    today: date | None = None,
) -> dict[str, Any]:
    today = today or date.today()
    active = [
        g
        for g in goals
        if g.status in (FinancialGoal.Status.ACTIVE, FinancialGoal.Status.PAUSED)
    ]
    total_saved = Decimal("0")
    total_target = Decimal("0")
    monthly_needed_total = Decimal("0")
    on_track_count = 0
    latest_completion: date | None = None
    warnings: list[dict[str, Any]] = []

    for goal in active:
        progress = enrich_goal_progress(goal, calculate_goal_progress(goal, today=today), today=today)
        current = _decimal(progress["current_amount"])
        target = _decimal(progress["target_amount"])
        if goal.is_debt_goal():
            total_saved += current
            total_target += _decimal(goal.starting_debt_amount or target)
        else:
            total_saved += current
            total_target += target

        monthly_req = progress.get("monthly_required")
        if monthly_req:
            monthly_needed_total += _decimal(monthly_req)

        health = progress.get("goal_health")
        if health in (HEALTH_AHEAD, HEALTH_ON_TRACK, HEALTH_COMPLETED):
            on_track_count += 1

        gap = progress.get("forecast_gap")
        if gap and float(gap) > 0 and health == HEALTH_BEHIND:
            warnings.append(
                {
                    "goal_id": goal.id,
                    "bucket_id": goal.id,
                    "name": goal.name,
                    "message": f"{goal.name} goal behind by ${gap}/mo",
                    "gap": gap,
                }
            )

        projected = progress.get("projected_completion_date")
        if projected:
            proj_date = date.fromisoformat(projected)
            if latest_completion is None or proj_date > latest_completion:
                latest_completion = proj_date

    return {
        "total_saved": _serialize_decimal(_quantize_money(total_saved)),
        "total_target": _serialize_decimal(_quantize_money(total_target)),
        "monthly_needed_total": _serialize_decimal(_quantize_money(monthly_needed_total)),
        "goals_on_track": on_track_count,
        "goals_active_count": len(active),
        "projected_completion": latest_completion.isoformat() if latest_completion else None,
        "warnings": warnings,
    }


def _recommended_monthly(goal: FinancialGoal, remaining: Decimal, today: date) -> Decimal | None:
    if remaining <= 0 or not goal.target_date or goal.target_date <= today:
        return None
    months = max(
        1,
        (goal.target_date.year - today.year) * 12
        + (goal.target_date.month - today.month)
        + (1 if goal.target_date.day > today.day else 0),
    )
    return _quantize_money(remaining / Decimal(months))


def ensure_starting_debt(goal: FinancialGoal, today: date | None = None) -> None:
    if not goal.is_debt_goal() or not goal.linked_credit_account_id:
        return
    if goal.starting_debt_amount is not None and goal.starting_debt_amount > 0:
        return
    account = goal.linked_credit_account
    if account is None:
        return
    owed = ledger_owed_balance(account, today or date.today())
    if owed > 0:
        goal.starting_debt_amount = _quantize_money(owed)
        goal.save(update_fields=["starting_debt_amount", "updated_at"])


def calculate_goal_progress(
    goal: FinancialGoal,
    *,
    today: date | None = None,
) -> dict[str, Any]:
    today = today or date.today()
    target = _decimal(goal.target_amount)
    if target <= 0:
        target = Decimal("0.01")

    linked_account_balance: Decimal | None = None
    linked_debt_balance: Decimal | None = None
    is_debt = goal.is_debt_goal()

    if is_debt:
        ensure_starting_debt(goal, today)
        starting_debt = _decimal(goal.starting_debt_amount or 0)
        if goal.linked_credit_account_id:
            account = goal.linked_credit_account
            if account:
                owed = ledger_owed_balance(account, today)
                linked_debt_balance = owed
                if starting_debt <= 0 and owed > 0:
                    starting_debt = owed
                paid_down = max(Decimal("0"), starting_debt - owed)
                current = paid_down
                remaining = owed
                progress = (
                    (paid_down / starting_debt * Decimal("100")) if starting_debt > 0 else Decimal("0")
                )
            else:
                current = max(Decimal("0"), _decimal(goal.current_amount))
                remaining = max(Decimal("0"), starting_debt - current) if starting_debt > 0 else target
                progress = (current / starting_debt * Decimal("100")) if starting_debt > 0 else Decimal("0")
        else:
            current = max(Decimal("0"), _decimal(goal.current_amount))
            remaining = max(Decimal("0"), target - current)
            progress = min(Decimal("100"), current / target * Decimal("100"))
    else:
        if goal.linked_account_id and goal.linked_account:
            current = _linked_savings_balance(goal.linked_account, today)
            linked_account_balance = current
        else:
            current = max(Decimal("0"), _decimal(goal.current_amount))
        remaining = max(Decimal("0"), target - current)
        progress = min(Decimal("100"), current / target * Decimal("100"))

    progress = min(Decimal("100"), max(Decimal("0"), progress))
    monthly = _effective_monthly_contribution(goal)
    projected = calculate_projected_completion(goal, remaining_amount=remaining, monthly_contribution=monthly, today=today)
    recommended = _recommended_monthly(goal, remaining, today)
    on_track = _on_track_status(goal, projected, today)

    return {
        "current_amount": _serialize_decimal(_quantize_money(current)),
        "target_amount": _serialize_decimal(_quantize_money(target)),
        "remaining_amount": _serialize_decimal(_quantize_money(remaining)),
        "progress_percent": str(progress.quantize(Decimal("0.01"))),
        "projected_completion_date": projected.isoformat() if projected else None,
        "on_track_status": on_track,
        "recommended_monthly_contribution": _serialize_decimal(recommended) if recommended else None,
        "linked_account_balance": _serialize_decimal(linked_account_balance),
        "linked_debt_balance": _serialize_decimal(linked_debt_balance),
        "is_debt_goal": is_debt,
        "starting_debt_amount": _serialize_decimal(_decimal(goal.starting_debt_amount))
        if goal.starting_debt_amount is not None
        else None,
    }


def goal_to_dashboard_dict(goal: FinancialGoal, progress: dict[str, Any]) -> dict[str, Any]:
    linked_name = progress.get("funding_account")
    if not linked_name:
        if goal.is_debt_goal() and goal.linked_credit_account:
            linked_name = goal.linked_credit_account.effective_display_name
        elif goal.linked_account:
            linked_name = goal.linked_account.effective_display_name

    return {
        "id": goal.id,
        "name": goal.name,
        "goal_type": goal.goal_type,
        "current_amount": progress["current_amount"],
        "target_amount": progress["target_amount"],
        "remaining_amount": progress["remaining_amount"],
        "progress_percent": progress["progress_percent"],
        "projected_completion_date": progress["projected_completion_date"],
        "on_track_status": progress["on_track_status"],
        "recommended_monthly_contribution": progress["recommended_monthly_contribution"],
        "goal_health": progress.get("goal_health"),
        "priority": goal.priority,
        "status": goal.status,
        "target_date": goal.target_date.isoformat() if goal.target_date else None,
        "linked_account_name": linked_name,
        "is_debt_goal": progress["is_debt_goal"],
        "linked_debt_balance": progress.get("linked_debt_balance"),
    }


def calculate_goals_summary(
    goals: list[FinancialGoal],
    *,
    today: date | None = None,
) -> list[dict[str, Any]]:
    today = today or date.today()
    results = []
    for goal in goals:
        progress = calculate_goal_progress(goal, today=today)
        results.append({**goal_to_dashboard_dict(goal, progress), **progress})
    return results


def dashboard_goals_for_user(user, *, limit: int = 3, today: date | None = None) -> list[dict[str, Any]]:
    from core.utils import get_households_for_user

    today = today or date.today()
    households = get_households_for_user(user)
    qs = (
        FinancialGoal.objects.filter(
            household__in=households,
            status=FinancialGoal.Status.ACTIVE,
        )
        .select_related("linked_account", "linked_credit_account")
        .order_by("priority", "-created_at")
    )
    goals = list(qs)
    if limit is not None:
        goals = goals[:limit]
    result: list[dict[str, Any]] = []
    for goal in goals:
        progress = enrich_goal_progress(
            goal, calculate_goal_progress(goal, today=today), today=today
        )
        result.append(goal_to_dashboard_dict(goal, progress))
    return result
