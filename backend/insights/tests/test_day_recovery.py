"""Tests for day recovery detection."""
from decimal import Decimal

from insights.services.day_recovery import attach_recovery_to_days


def test_recovery_attached_after_negative_day():
    days = [
        {
            "date": "2025-06-01",
            "heat_level": "dangerous",
            "is_negative": True,
            "lowest_projected_balance_account_id": 1,
            "ending_balance": "-100.00",
            "account_balances": {"1": "-100.00"},
            "transactions": [],
        },
        {
            "date": "2025-06-05",
            "heat_level": "healthy",
            "ending_balance": "1500.00",
            "account_balances": {"1": "1500.00"},
            "transactions": [
                {
                    "account_id": 1,
                    "amount": "1600.00",
                    "description": "Payroll",
                    "is_transfer": False,
                }
            ],
        },
    ]

    class Acc:
        minimum_buffer = Decimal("500")

    attach_recovery_to_days(days, accounts_by_id={1: Acc()})

    assert days[0]["recovery_date"] == "2025-06-05"
    assert days[0]["recovery_days_until"] == 4
    assert days[0]["recovery_is_payroll"] is True
