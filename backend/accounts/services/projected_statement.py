"""Projected credit card statement balance at the next billing cycle close."""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any, Optional

from accounts.models import Account
from accounts.services.credit_card import calculate_next_statement_date
from timeline.services.ledger import _credit_card_balance_through_date, build_timeline


def _signed_balance_at_cycle_end(
    account: Account,
    cycle_end: date,
    timeline_rows: list[dict],
) -> Decimal:
    return _credit_card_balance_through_date(
        account.pk,
        cycle_end,
        timeline_rows,
        include_row_leg_without_txn=True,
    )


def _owed_from_signed(signed: Decimal) -> Decimal:
    if signed < 0:
        return abs(signed).quantize(Decimal("0.01"))
    return Decimal("0")


def calculate_projected_statement_for_account(
    user,
    account: Account,
    *,
    as_of_date: Optional[date] = None,
    timeline_rows: Optional[list[dict]] = None,
) -> dict[str, Any]:
    """Projected statement balance (positive owed) at the next cycle close."""
    if not account.is_credit_card():
        return {
            "projected_statement_balance": None,
            "billing_cycle_end_date": None,
        }

    today = as_of_date or date.today()
    closing = account.get_statement_closing_day()
    if closing is None:
        return {
            "projected_statement_balance": None,
            "billing_cycle_end_date": None,
        }

    cycle_end = calculate_next_statement_date(closing, today)
    if timeline_rows is None:
        timeline_rows = build_timeline(
            user,
            start_date=today,
            end_date=cycle_end,
            account_id=account.pk,
            as_of_date=today,
        )

    signed = _signed_balance_at_cycle_end(account, cycle_end, timeline_rows)
    return {
        "projected_statement_balance": str(_owed_from_signed(signed)),
        "billing_cycle_end_date": cycle_end.isoformat(),
    }


def calculate_projected_statements_for_accounts(
    user,
    accounts: list[Account],
    *,
    as_of_date: Optional[date] = None,
    timeline_rows: Optional[list[dict]] = None,
) -> dict[int, dict[str, Any]]:
    """Batch projected statement balances with one shared timeline build."""
    today = as_of_date or date.today()
    credit_cards: list[Account] = []
    cycle_end_by_id: dict[int, date] = {}
    max_end = today

    for account in accounts:
        if not account.is_credit_card():
            continue
        closing = account.get_statement_closing_day()
        if closing is None:
            continue
        cycle_end = calculate_next_statement_date(closing, today)
        credit_cards.append(account)
        cycle_end_by_id[account.id] = cycle_end
        if cycle_end > max_end:
            max_end = cycle_end

    if not credit_cards:
        return {}

    if timeline_rows is None:
        timeline_rows = build_timeline(
            user,
            start_date=today,
            end_date=max_end,
            as_of_date=today,
        )

    result: dict[int, dict[str, Any]] = {}
    for account in credit_cards:
        cycle_end = cycle_end_by_id[account.id]
        signed = _signed_balance_at_cycle_end(account, cycle_end, timeline_rows)
        result[account.id] = {
            "projected_statement_balance": str(_owed_from_signed(signed)),
            "billing_cycle_end_date": cycle_end.isoformat(),
        }
    return result


def serialize_projected_statement(summary: dict[str, Any]) -> dict[str, Any]:
    return {
        "projected_statement_balance": summary.get("projected_statement_balance"),
        "billing_cycle_end_date": summary.get("billing_cycle_end_date"),
    }
