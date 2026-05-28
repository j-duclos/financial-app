"""Tests for daily heat indicator calculation."""
from decimal import Decimal

import pytest

from insights.services.day_heat import (
    HEAT_DANGEROUS,
    HEAT_HEALTHY,
    HEAT_NEUTRAL,
    HEAT_TIGHT,
    AccountDayBalance,
    calculate_day_heat,
)


@pytest.mark.parametrize(
    "balances,expected",
    [
        (
            [AccountDayBalance("Main", Decimal("2000"), Decimal("1000"))],
            HEAT_HEALTHY,
        ),
        (
            [AccountDayBalance("Main", Decimal("500"), Decimal("1000"))],
            HEAT_TIGHT,
        ),
        (
            [AccountDayBalance("Main", Decimal("-50"), Decimal("1000"))],
            HEAT_DANGEROUS,
        ),
    ],
)
def test_calculate_day_heat_by_balance(balances, expected):
    heat = calculate_day_heat(has_activity=True, account_balances=balances)
    assert heat["heat_level"] == expected


def test_neutral_when_no_activity_and_balances_ok():
    heat = calculate_day_heat(
        has_activity=False,
        account_balances=[AccountDayBalance("Main", Decimal("5000"), Decimal("1000"))],
    )
    assert heat["heat_level"] == HEAT_NEUTRAL


def test_worst_account_selected_for_multi_account():
    heat = calculate_day_heat(
        has_activity=True,
        account_balances=[
            AccountDayBalance("Savings", Decimal("3000"), Decimal("500")),
            AccountDayBalance("Main", Decimal("-200"), Decimal("1000")),
        ],
    )
    assert heat["heat_level"] == HEAT_DANGEROUS
    assert heat["affected_account_name"] == "Main"
    assert heat["is_negative"] is True
    assert heat["heat_reason"] == "Main projected -$200.00"


def test_credit_card_excluded_from_cash_heat():
    from insights.services.day_heat import account_balances_from_txn_lows

    class _Acc:
        def __init__(self, name: str, credit: bool):
            self._name = name
            self._credit = credit
            self.minimum_buffer = Decimal("0")

        @property
        def effective_display_name(self):
            return self._name

        def is_credit_card(self):
            return self._credit

    accounts = {1: _Acc("Venture", True), 2: _Acc("Main", False)}
    rows = [
        {"account_name": "Venture", "balance": "-5000.00"},
        {"account_name": "Main", "balance": "-100.00"},
    ]
    balances = account_balances_from_txn_lows(rows, accounts)
    assert len(balances) == 1
    assert balances[0].account_name == "Main"


def test_negative_heat_reason_includes_amount():
    heat = calculate_day_heat(
        has_activity=True,
        account_balances=[AccountDayBalance("Savor", Decimal("-50.25"), Decimal("0"))],
    )
    assert heat["heat_reason"] == "Savor projected -$50.25"


def test_below_buffer_amount_on_tight_day():
    heat = calculate_day_heat(
        has_activity=True,
        account_balances=[AccountDayBalance("Main", Decimal("86"), Decimal("1000"))],
    )
    assert heat["heat_level"] == HEAT_TIGHT
    assert heat["below_buffer_amount"] == "914.00"


def test_health_alert_marks_tight():
    heat = calculate_day_heat(
        has_activity=True,
        account_balances=[AccountDayBalance("Main", Decimal("2000"), Decimal("1000"))],
        health_alert_names=["Main"],
    )
    assert heat["heat_level"] == HEAT_TIGHT
    assert "Main" in (heat["heat_reason"] or "")
