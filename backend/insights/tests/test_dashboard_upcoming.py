"""Tests for dashboard upcoming grouping and transfer exclusion."""
from datetime import date
from decimal import Decimal

import pytest
from accounts.models import Account
from core.models import Household
from insights.services.dashboard_upcoming import (
    build_upcoming_groups,
    collapse_internal_transfer_pairs_for_display,
    is_credit_card_payment_outflow,
    is_expense_for_dashboard_totals,
    is_income_for_dashboard_totals,
    is_internal_money_movement,
)

AS_OF = date(2025, 5, 28)


@pytest.fixture
def household(db):
    h = Household.objects.create(name="Upcoming Test")
    return h


@pytest.fixture
def accounts_by_id(db, household):
    checking = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        name="Main",
        starting_balance=Decimal("1000"),
        currency="USD",
    )
    credit = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        role=Account.AccountRole.CREDIT_CARD,
        name="Care Credit",
        credit_limit=Decimal("5000"),
        currency="USD",
    )
    return {checking.id: checking, credit.id: credit}


def _event(**kwargs):
    base = {
        "id": "e1",
        "date": AS_OF.isoformat(),
        "account_id": 1,
        "account_name": "Main",
        "description": "Test",
        "amount": "0",
        "kind": "bill",
        "category": None,
        "rule_id": None,
        "projected_balance": None,
        "is_risk": False,
    }
    base.update(kwargs)
    return base


def _transfer_ctx(accounts_by_id, credit_rule_id=99):
    checking_id = next(
        a.id for a in accounts_by_id.values() if a.account_type == Account.AccountType.CHECKING
    )
    credit_id = next(a.id for a in accounts_by_id.values() if a.is_credit_card())
    return {99: credit_id}, {credit_rule_id: credit_id}, {credit_rule_id: checking_id}


def test_income_subtotal_includes_paycheck(accounts_by_id):
    ev = _event(amount="1835.52", kind="income", account_id=list(accounts_by_id.keys())[0])
    assert is_income_for_dashboard_totals(
        ev,
        transfer_rule_ids=set(),
        transfer_rule_targets={},
        accounts_by_id=accounts_by_id,
    )
    assert not is_expense_for_dashboard_totals(
        ev,
        transfer_rule_ids=set(),
        transfer_rule_targets={},
        accounts_by_id=accounts_by_id,
    )


def test_expense_subtotal_includes_bills(accounts_by_id):
    ev = _event(amount="-100.00", kind="bill")
    assert is_expense_for_dashboard_totals(
        ev,
        transfer_rule_ids=set(),
        transfer_rule_targets={},
        accounts_by_id=accounts_by_id,
    )
    assert not is_income_for_dashboard_totals(
        ev,
        transfer_rule_ids=set(),
        transfer_rule_targets={},
        accounts_by_id=accounts_by_id,
    )


def test_credit_card_payment_outflow_counts_as_expense(accounts_by_id):
    checking_id = next(
        a.id for a in accounts_by_id.values() if a.account_type == Account.AccountType.CHECKING
    )
    credit_id = next(a.id for a in accounts_by_id.values() if a.is_credit_card())
    transfer_rules, transfer_targets, transfer_sources = _transfer_ctx(accounts_by_id)
    outflow = _event(
        id="t-out",
        account_id=checking_id,
        amount="-393.79",
        kind="transfer",
        category="Credit Card Payment",
        rule_id=99,
    )
    inflow = _event(
        id="t-in",
        account_id=credit_id,
        account_name="Care Credit",
        amount="393.79",
        kind="credit_card",
        rule_id=99,
    )
    assert is_credit_card_payment_outflow(
        outflow, transfer_rule_targets=transfer_targets, accounts_by_id=accounts_by_id
    )
    assert is_expense_for_dashboard_totals(
        outflow,
        transfer_rule_ids=transfer_rules,
        transfer_rule_targets=transfer_targets,
        accounts_by_id=accounts_by_id,
    )
    assert not is_internal_money_movement(
        outflow,
        transfer_rule_ids=transfer_rules,
        transfer_rule_targets=transfer_targets,
        accounts_by_id=accounts_by_id,
    )
    assert is_internal_money_movement(
        inflow,
        transfer_rule_ids=transfer_rules,
        transfer_rule_targets=transfer_targets,
        accounts_by_id=accounts_by_id,
    )
    assert not is_expense_for_dashboard_totals(
        inflow,
        transfer_rule_ids=transfer_rules,
        transfer_rule_targets=transfer_targets,
        accounts_by_id=accounts_by_id,
    )


def test_collapse_credit_card_payment_to_one_display_row():
    legs = [
        {
            "id": "cc-out",
            "date": AS_OF.isoformat(),
            "account_id": 1,
            "account_name": "Main",
            "description": "Credit Card Pmt",
            "amount": "-650.00",
            "kind": "bill",
            "is_transfer": True,
            "is_internal_transfer": False,
            "is_credit_card_payment": True,
            "transfer_from_account_name": "Main",
            "transfer_to_account_name": "Savor",
            "risk_flag": False,
        },
        {
            "id": "cc-in",
            "date": AS_OF.isoformat(),
            "account_id": 2,
            "account_name": "Savor",
            "description": "Credit Card Pmt",
            "amount": "650.00",
            "kind": "credit_card",
            "is_transfer": True,
            "is_internal_transfer": True,
            "is_credit_card_payment": True,
            "transfer_from_account_name": "Main",
            "transfer_to_account_name": "Savor",
            "risk_flag": False,
        },
    ]
    collapsed = collapse_internal_transfer_pairs_for_display(legs)
    assert len(collapsed) == 1
    assert collapsed[0]["is_credit_card_payment"] is True
    assert collapsed[0]["kind"] == "bill"
    assert Decimal(collapsed[0]["amount"]) == Decimal("-650.00")


def test_collapse_bank_transfer_to_one_display_row():
    legs = [
        {
            "id": "out",
            "date": AS_OF.isoformat(),
            "account_id": 1,
            "account_name": "Savings",
            "description": "Move for Rent",
            "amount": "-900.00",
            "kind": "transfer",
            "is_transfer": True,
            "is_internal_transfer": True,
            "is_credit_card_payment": False,
            "transfer_from_account_name": "Savings",
            "transfer_to_account_name": "Main",
            "risk_flag": False,
        },
        {
            "id": "in",
            "date": AS_OF.isoformat(),
            "account_id": 2,
            "account_name": "Main",
            "description": "Move for Rent",
            "amount": "900.00",
            "kind": "transfer",
            "is_transfer": True,
            "is_internal_transfer": True,
            "is_credit_card_payment": False,
            "transfer_from_account_name": "Savings",
            "transfer_to_account_name": "Main",
            "risk_flag": False,
        },
    ]
    collapsed = collapse_internal_transfer_pairs_for_display(legs)
    assert len(collapsed) == 1
    assert collapsed[0]["amount"] == "900.00"
    assert collapsed[0]["kind"] == "transfer"
    assert collapsed[0]["transfer_from_account_name"] == "Savings"
    assert collapsed[0]["transfer_to_account_name"] == "Main"


def test_transfer_group_inflow_is_internal(accounts_by_id):
    checking_id = next(
        a.id for a in accounts_by_id.values() if a.account_type == Account.AccountType.CHECKING
    )
    inflow = _event(
        id="tg-in",
        account_id=checking_id,
        amount="900.00",
        kind="income",
        transfer_group_id=7,
        transaction_type="transfer",
    )
    assert is_internal_money_movement(
        inflow,
        transfer_rule_ids=set(),
        transfer_rule_targets={},
        accounts_by_id=accounts_by_id,
    )
    result = build_upcoming_groups(
        [inflow],
        transfer_rule_ids=set(),
        transfer_rule_targets={},
        transfer_rule_sources={},
        accounts_by_id=accounts_by_id,
        health_by_id={},
        today=AS_OF,
    )
    txn = result["groups"][0]["transactions"][0]
    assert txn["is_internal_transfer"] is True
    assert txn["is_transfer"] is True
    assert Decimal(result["groups"][0]["income_total"]) == 0


def test_bank_transfer_still_excluded_from_totals(accounts_by_id):
    checking_id = next(
        a.id for a in accounts_by_id.values() if a.account_type == Account.AccountType.CHECKING
    )
    xfer = _event(
        id="bank",
        account_id=checking_id,
        amount="-200",
        kind="transfer",
        category="Bank Transfer",
        rule_id=1,
    )
    assert is_internal_money_movement(
        xfer,
        transfer_rule_ids={1},
        transfer_rule_targets={1: checking_id},
        accounts_by_id=accounts_by_id,
    )
    assert not is_expense_for_dashboard_totals(
        xfer,
        transfer_rule_ids={1},
        transfer_rule_targets={1: checking_id},
        accounts_by_id=accounts_by_id,
    )


def test_groups_sorted_ascending_by_date(accounts_by_id):
    events = [
        _event(id="a", date="2025-05-29", amount="100", kind="income"),
        _event(id="b", date="2025-05-28", amount="-50", kind="bill"),
    ]
    result = build_upcoming_groups(
        events,
        transfer_rule_ids=set(),
        transfer_rule_targets={},
        transfer_rule_sources={},
        accounts_by_id=accounts_by_id,
        health_by_id={},
        today=AS_OF,
    )
    dates = [g["date"] for g in result["groups"]]
    assert dates == sorted(dates)


def test_net_equals_income_minus_expenses(accounts_by_id):
    events = [
        _event(id="a", date="2025-05-28", amount="1000", kind="income"),
        _event(id="b", date="2025-05-28", amount="-250", kind="bill"),
    ]
    result = build_upcoming_groups(
        events,
        transfer_rule_ids=set(),
        transfer_rule_targets={},
        transfer_rule_sources={},
        accounts_by_id=accounts_by_id,
        health_by_id={},
        today=AS_OF,
    )
    group = result["groups"][0]
    income = Decimal(group["income_total"])
    expense = Decimal(group["expense_total"])
    net = Decimal(group["net_total"])
    assert net == income - expense


def test_credit_card_payment_outflow_in_daily_expense_total(accounts_by_id):
    checking_id = next(
        a.id for a in accounts_by_id.values() if a.account_type == Account.AccountType.CHECKING
    )
    credit_id = next(a.id for a in accounts_by_id.values() if a.is_credit_card())
    transfer_rules, transfer_targets, transfer_sources = _transfer_ctx(accounts_by_id)
    events = [
        _event(
            id="out",
            date="2025-05-28",
            account_id=checking_id,
            amount="-650.00",
            kind="transfer",
            category="Credit Card Payment",
            rule_id=99,
        ),
        _event(
            id="in",
            date="2025-05-28",
            account_id=credit_id,
            account_name="Care Credit",
            amount="650.00",
            kind="credit_card",
            rule_id=99,
        ),
    ]
    result = build_upcoming_groups(
        events,
        transfer_rule_ids=transfer_rules,
        transfer_rule_targets=transfer_targets,
        transfer_rule_sources=transfer_sources,
        accounts_by_id=accounts_by_id,
        health_by_id={},
        today=AS_OF,
    )
    group = result["groups"][0]
    assert Decimal(group["expense_total"]) == Decimal("650.00")
    assert Decimal(group["net_total"]) == Decimal("-650.00")
    assert len(group["transactions"]) == 1
    pay = group["transactions"][0]
    assert pay["is_credit_card_payment"] is True
    assert pay["kind"] == "bill"
    assert Decimal(pay["amount"]) == Decimal("-650.00")
    assert pay["transfer_from_account_name"] == "Main"
    assert pay["transfer_to_account_name"] == "Care Credit"
    assert Decimal(group["income_total"]) == 0


def test_transfer_rows_still_in_group_transactions(accounts_by_id):
    checking_id = next(
        a.id for a in accounts_by_id.values() if a.account_type == Account.AccountType.CHECKING
    )
    events = [
        _event(
            id="xfer",
            date="2025-05-28",
            account_id=checking_id,
            amount="-200",
            kind="transfer",
            category="Bank Transfer",
            rule_id=1,
        ),
    ]
    result = build_upcoming_groups(
        events,
        transfer_rule_ids={1},
        transfer_rule_targets={1: checking_id},
        transfer_rule_sources={1: checking_id},
        accounts_by_id=accounts_by_id,
        health_by_id={},
        today=AS_OF,
    )
    txns = result["groups"][0]["transactions"]
    assert len(txns) == 1
    assert txns[0]["is_transfer"] is True
    assert Decimal(result["groups"][0]["income_total"]) == 0
    assert Decimal(result["groups"][0]["expense_total"]) == 0
    assert result["groups"][0]["transfers_excluded"] is True


def test_healthy_empty_groups(accounts_by_id):
    result = build_upcoming_groups(
        [],
        transfer_rule_ids=set(),
        transfer_rule_targets={},
        transfer_rule_sources={},
        accounts_by_id=accounts_by_id,
        health_by_id={},
        today=AS_OF,
    )
    assert result["groups"] == []

def test_risk_flag_when_projected_below_zero(accounts_by_id):
    checking_id = next(
        a.id for a in accounts_by_id.values() if a.account_type == Account.AccountType.CHECKING
    )
    events = [
        _event(
            id="risky",
            account_id=checking_id,
            amount="-500.00",
            kind="bill",
            projected_balance="-25.00",
        ),
    ]
    result = build_upcoming_groups(
        events,
        transfer_rule_ids=set(),
        transfer_rule_targets={},
        transfer_rule_sources={},
        accounts_by_id=accounts_by_id,
        health_by_id={},
        today=AS_OF,
    )
    group = result["groups"][0]
    assert group["transactions"][0]["risk_flag"] is True
    assert group["has_risk"] is True
    assert group["heat_level"] == "dangerous"
    assert group["is_negative"] is True
    assert group["heat_label"] == "Dangerous"
    assert group["show_lowest_balance_marker"] is True
    assert Decimal(group["amount_needed_to_zero"]) == Decimal("25.00")


def test_serialized_transfer_includes_route_names(accounts_by_id):
    checking_id = next(
        a.id for a in accounts_by_id.values() if a.account_type == Account.AccountType.CHECKING
    )
    credit_id = next(a.id for a in accounts_by_id.values() if a.is_credit_card())
    transfer_rules, transfer_targets, transfer_sources = _transfer_ctx(accounts_by_id)
    events = [
        _event(
            id="out",
            account_id=checking_id,
            amount="-650.00",
            kind="transfer",
            category="Credit Card Payment",
            rule_id=99,
        ),
    ]
    result = build_upcoming_groups(
        events,
        transfer_rule_ids=transfer_rules,
        transfer_rule_targets=transfer_targets,
        transfer_rule_sources=transfer_sources,
        accounts_by_id=accounts_by_id,
        health_by_id={},
        today=AS_OF,
    )
    txn = result["groups"][0]["transactions"][0]
    assert txn["transfer_from_account_name"] == "Main"
    assert txn["transfer_to_account_name"] == "Care Credit"
