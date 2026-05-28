"""Tests for credit-card projected balance day warnings."""
from decimal import Decimal

import pytest

from accounts.models import Account
from core.models import Household
from insights.services.day_credit_warnings import (
    build_credit_day_warning,
    scan_credit_day_warnings,
)


@pytest.fixture
def household(db):
    return Household.objects.create(name="Credit warn HH")


@pytest.fixture
def accounts_by_id(household):
    main = Account.objects.create(
        household=household,
        name="Main",
        account_type=Account.AccountType.CHECKING,
        currency="USD",
        minimum_buffer=Decimal("1000"),
    )
    venture = Account.objects.create(
        household=household,
        name="Venture",
        account_type=Account.AccountType.CREDIT,
        role=Account.AccountRole.CREDIT_CARD,
        credit_limit=Decimal("5000"),
        currency="USD",
    )
    return {main.id: main, venture.id: venture}


def _txn(*, account_id: int, account_name: str, balance_after: str) -> dict:
    return {
        "id": f"t-{account_id}",
        "account_id": account_id,
        "account_name": account_name,
        "balance_after": balance_after,
    }


def test_high_utilization_warning(accounts_by_id):
    credit_id = next(a.id for a in accounts_by_id.values() if a.is_credit_card())
    # 80% of $5000 limit
    txns = [_txn(account_id=credit_id, account_name="Venture", balance_after="-4000.00")]
    warnings = scan_credit_day_warnings(txns, accounts_by_id)
    assert len(warnings) == 1
    assert warnings[0]["account_name"] == "Venture"
    assert "80% utilized" in warnings[0]["message"]


def test_over_limit_warning(accounts_by_id):
    credit_id = next(a.id for a in accounts_by_id.values() if a.is_credit_card())
    txns = [_txn(account_id=credit_id, account_name="Venture", balance_after="-5200.00")]
    warnings = scan_credit_day_warnings(txns, accounts_by_id)
    assert len(warnings) == 1
    assert "over limit" in warnings[0]["message"]
    assert "104% utilized" in warnings[0]["message"]


def test_low_utilization_suppressed(accounts_by_id):
    credit_id = next(a.id for a in accounts_by_id.values() if a.is_credit_card())
    txns = [_txn(account_id=credit_id, account_name="Venture", balance_after="-200.00")]
    warnings = scan_credit_day_warnings(txns, accounts_by_id)
    assert warnings == []


def test_cash_account_excluded(accounts_by_id):
    main_id = next(a.id for a in accounts_by_id.values() if a.name == "Main")
    txns = [_txn(account_id=main_id, account_name="Main", balance_after="-100.00")]
    assert scan_credit_day_warnings(txns, accounts_by_id) == []


def test_no_limit_shows_owed(accounts_by_id):
    credit = next(a for a in accounts_by_id.values() if a.is_credit_card())
    credit.credit_limit = None
    credit.save()
    msg = build_credit_day_warning(credit, Decimal("-1000.68"))
    assert msg == "Venture owes $1000.68 projected"
