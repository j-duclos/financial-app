"""Record goal contributions via transfers or ledger transactions."""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any

from accounts.models import Account
from accounts.services.available_to_spend import calculate_account_forecast_summary
from goals.models import FinancialGoal
from goals.services import _decimal, _quantize_money, calculate_goal_progress
from transactions.services.posting import create_transfer, post_transaction


def _funding_account(goal: FinancialGoal) -> Account | None:
    if goal.is_debt_goal():
        return goal.linked_credit_account
    return goal.linked_account


def preview_contribution(
    user,
    goal: FinancialGoal,
    *,
    from_account_id: int,
    amount: Decimal,
    contrib_date: date,
    today: date | None = None,
) -> dict[str, Any]:
    today = today or date.today()
    amount = _quantize_money(_decimal(amount))
    if amount <= 0:
        raise ValueError("Amount must be positive.")

    progress = calculate_goal_progress(goal, today=today)
    current = _decimal(progress["current_amount"])
    target = _decimal(progress["target_amount"])

    try:
        from_account = Account.objects.select_related("household").get(pk=from_account_id)
    except Account.DoesNotExist:
        raise ValueError("From account not found.")
    if from_account.household_id != goal.household_id:
        raise ValueError("From account must belong to the goal household.")

    if goal.is_debt_goal():
        after_current = min(target, current + amount)
    else:
        after_current = current + amount

    after_progress = calculate_goal_progress(goal, today=today)
    if not goal.is_debt_goal():
        after_progress = {
            **after_progress,
            "current_amount": str(_quantize_money(after_current)),
            "remaining_amount": str(_quantize_money(max(Decimal("0"), target - after_current))),
            "progress_percent": str(
                min(Decimal("100"), after_current / target * Decimal("100")).quantize(Decimal("0.01"))
            ),
        }

    forecast = calculate_account_forecast_summary(user, from_account, as_of_date=today)
    sts_before = None
    sts_after = None
    if forecast.get("supports_available_to_spend"):
        sts_before = _decimal(forecast["available_to_spend"])
        sts_after = max(Decimal("0"), sts_before - amount)

    funding = _funding_account(goal)
    can_transfer = funding is not None and from_account_id != funding.id

    return {
        "current_amount": progress["current_amount"],
        "after_amount": after_progress["current_amount"],
        "progress_percent": progress["progress_percent"],
        "after_progress_percent": after_progress["progress_percent"],
        "safe_to_spend_before": str(sts_before) if sts_before is not None else None,
        "safe_to_spend_after": str(_quantize_money(sts_after)) if sts_after is not None else None,
        "can_transfer": can_transfer,
        "funding_account_id": funding.id if funding else None,
        "funding_account_name": funding.effective_display_name if funding else None,
        "requires_linked_account_for_transfer": not goal.is_debt_goal() and funding is None,
    }


def execute_contribution(
    user,
    goal: FinancialGoal,
    *,
    from_account_id: int | None,
    amount: Decimal,
    contrib_date: date,
    method: str,
    today: date | None = None,
) -> dict[str, Any]:
    today = today or date.today()
    amount = _quantize_money(_decimal(amount))
    if amount <= 0:
        raise ValueError("Amount must be positive.")

    method = (method or "transfer").lower()
    if method not in ("transfer", "manual"):
        raise ValueError("method must be 'transfer' or 'manual'.")

    payee = f"Goal: {goal.name}"

    if goal.is_debt_goal():
        credit = goal.linked_credit_account
        if credit is None:
            raise ValueError("Link a credit or loan account for debt payoff goals.")
        if method == "transfer":
            if not from_account_id:
                raise ValueError("from_account is required for transfers.")
            create_transfer(
                user,
                from_account_id,
                credit.id,
                amount,
                contrib_date,
                memo=payee,
                payee=payee,
            )
        else:
            post_transaction(user, credit.id, contrib_date, payee, amount)
    else:
        funding = goal.linked_account
        if method == "transfer":
            if funding is None:
                raise ValueError("Link a funding account to record a transfer contribution.")
            if not from_account_id:
                raise ValueError("from_account is required for transfers.")
            create_transfer(
                user,
                from_account_id,
                funding.id,
                amount,
                contrib_date,
                memo=payee,
                payee=payee,
            )
        elif funding is not None:
            post_transaction(user, funding.id, contrib_date, payee, amount)
        else:
            goal.current_amount = _quantize_money(_decimal(goal.current_amount) + amount)
            goal.save(update_fields=["current_amount", "updated_at"])

    progress = calculate_goal_progress(goal, today=today)
    remaining = _decimal(progress["remaining_amount"])
    if remaining <= 0 and goal.status == FinancialGoal.Status.ACTIVE:
        goal.status = FinancialGoal.Status.COMPLETED
        from django.utils import timezone

        goal.completed_at = timezone.now()
        goal.save(update_fields=["status", "completed_at", "updated_at"])

    return {"goal_progress": progress}
