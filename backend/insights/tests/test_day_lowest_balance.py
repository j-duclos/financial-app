"""Tests for daily lowest projected balance markers."""
from decimal import Decimal

import pytest

from accounts.models import Account
from core.models import Household
from insights.services.day_lowest_balance import (
    calculate_day_lowest_marker,
    scan_transaction_lows,
    should_show_lowest_marker,
)
from insights.services.day_heat import HEAT_DANGEROUS, HEAT_HEALTHY, HEAT_TIGHT


@pytest.fixture
def household(db):
    return Household.objects.create(name="Lowest HH")


@pytest.fixture
def accounts_by_id(db, household):
    main = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        name="Main",
        starting_balance=Decimal("1000"),
        minimum_buffer=Decimal("200"),
        currency="USD",
        include_in_forecast=True,
    )
    savings = Account.objects.create(
        household=household,
        account_type=Account.AccountType.SAVINGS,
        role=Account.AccountRole.SAVINGS,
        name="Savings",
        starting_balance=Decimal("5000"),
        minimum_buffer=Decimal("500"),
        currency="USD",
        include_in_forecast=True,
    )
    credit = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        role=Account.AccountRole.CREDIT_CARD,
        name="Venture",
        credit_limit=Decimal("5000"),
        currency="USD",
        include_in_forecast=True,
    )
    return {main.id: main, savings.id: savings, credit.id: credit}


def _txn(**kwargs):
    base = {
        "id": "t1",
        "account_id": None,
        "account_name": "Main",
        "description": "Rent",
        "balance_after": "500.00",
    }
    base.update(kwargs)
    return base


def test_picks_worst_account_across_day(accounts_by_id):
    main_id = next(a.id for a in accounts_by_id.values() if a.name == "Main")
    savings_id = next(a.id for a in accounts_by_id.values() if a.name == "Savings")
    txns = [
        _txn(account_id=main_id, balance_after="400.00"),
        _txn(account_id=savings_id, account_name="Savings", balance_after="-50.00"),
    ]
    marker = calculate_day_lowest_marker(
        txns, accounts_by_id, date_iso="2025-06-17", heat_level=HEAT_DANGEROUS
    )
    assert marker["lowest_projected_balance_account_name"] == "Savings"
    assert Decimal(marker["lowest_projected_balance"]) == Decimal("-50.00")
    assert marker["show_lowest_balance_marker"] is True


def test_amount_needed_to_zero_and_buffer(accounts_by_id):
    main_id = next(a.id for a in accounts_by_id.values() if a.name == "Main")
    txns = [_txn(account_id=main_id, balance_after="-1043.00")]
    marker = calculate_day_lowest_marker(
        txns, accounts_by_id, date_iso="2025-06-17", heat_level=HEAT_DANGEROUS
    )
    assert marker["amount_needed_to_zero"] == "1043.00"
    assert Decimal(marker["amount_needed_to_buffer"]) == Decimal("1243.00")


def test_below_buffer_tight_day(accounts_by_id):
    main_id = next(a.id for a in accounts_by_id.values() if a.name == "Main")
    txns = [_txn(account_id=main_id, balance_after="42.00")]
    marker = calculate_day_lowest_marker(
        txns, accounts_by_id, date_iso="2025-06-05", heat_level=HEAT_TIGHT
    )
    assert marker["show_lowest_balance_marker"] is True
    assert Decimal(marker["below_buffer_amount"]) == Decimal("158.00")


def test_healthy_day_hides_marker(accounts_by_id):
    main_id = next(a.id for a in accounts_by_id.values() if a.name == "Main")
    txns = [_txn(account_id=main_id, balance_after="900.00")]
    marker = calculate_day_lowest_marker(
        txns, accounts_by_id, date_iso="2025-06-01", heat_level=HEAT_HEALTHY
    )
    assert marker["show_lowest_balance_marker"] is False


def test_credit_card_balance_ignored(accounts_by_id):
    credit_id = next(a.id for a in accounts_by_id.values() if a.is_credit_card())
    main_id = next(a.id for a in accounts_by_id.values() if a.name == "Main")
    txns = [
        _txn(
            account_id=credit_id,
            account_name="Venture",
            balance_after="-2000.00",
        ),
        _txn(account_id=main_id, balance_after="800.00"),
    ]
    lows = scan_transaction_lows(txns, accounts_by_id)
    assert len(lows) == 1
    assert lows[0].account_name == "Main"


def test_transaction_that_caused_low(accounts_by_id):
    main_id = next(a.id for a in accounts_by_id.values() if a.name == "Main")
    txns = [
        _txn(account_id=main_id, id="t0", balance_after="500.00", description="Start"),
        _txn(account_id=main_id, id="t1", balance_after="-50.00", description="Transfer out"),
    ]
    marker = calculate_day_lowest_marker(
        txns, accounts_by_id, date_iso="2025-06-10", heat_level=HEAT_DANGEROUS
    )
    assert marker["lowest_projected_balance_after_description"] == "Transfer out"
    assert marker["lowest_projected_balance_transaction_id"] == "t1"


def test_should_show_for_negative_without_heat_flag():
    assert should_show_lowest_marker(
        heat_level=HEAT_HEALTHY,
        balance=Decimal("-1"),
        minimum_buffer=Decimal("0"),
    )


def test_carry_forward_marker_on_quiet_negative_days():
    from insights.services.day_lowest_balance import carry_forward_lowest_markers

    days = [
        {
            "date": "2025-06-17",
            "show_lowest_balance_marker": True,
            "lowest_projected_balance": "-562.88",
            "lowest_projected_balance_account_id": 1,
            "lowest_projected_balance_account_name": "Main",
            "lowest_projected_balance_after_description": "Netflix",
            "amount_needed_to_zero": "562.88",
            "amount_needed_to_buffer": "762.88",
            "is_negative": True,
            "account_balances": {"1": "-562.88"},
        },
        {
            "date": "2025-06-18",
            "show_lowest_balance_marker": False,
            "lowest_projected_balance": "-562.88",
            "is_negative": True,
            "heat_level": HEAT_DANGEROUS,
            "account_balances": {"1": "-562.88"},
        },
        {
            "date": "2025-06-19",
            "show_lowest_balance_marker": False,
            "lowest_projected_balance": "500.00",
            "is_negative": False,
            "heat_level": HEAT_HEALTHY,
            "account_balances": {"1": "500.00"},
        },
    ]
    carry_forward_lowest_markers(days)
    assert days[1]["show_lowest_balance_marker"] is True
    assert days[1]["lowest_projected_balance_account_name"] == "Main"
    assert days[1]["lowest_projected_balance_after_description"] == "Netflix"
    assert days[1]["amount_needed_to_zero"] == "562.88"
    assert days[2]["show_lowest_balance_marker"] is False


def test_marker_from_snapshots_when_no_transactions(accounts_by_id):
    from insights.services.day_heat import AccountDayBalance
    from insights.services.day_lowest_balance import (
        calculate_day_lowest_marker_from_snapshots,
    )

    snapshots = [
        AccountDayBalance(
            account_name="Main",
            balance=Decimal("-562.88"),
            minimum_buffer=Decimal("200"),
        )
    ]
    marker = calculate_day_lowest_marker_from_snapshots(
        snapshots,
        accounts_by_id,
        date_iso="2025-06-18",
        heat_level=HEAT_DANGEROUS,
    )
    assert marker["show_lowest_balance_marker"] is True
    assert marker["lowest_projected_balance_account_name"] == "Main"
    assert marker["amount_needed_to_zero"] == "562.88"
