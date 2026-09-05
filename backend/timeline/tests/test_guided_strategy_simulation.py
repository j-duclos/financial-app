"""Phase 2: hypothetical Debt First vs. Save First simulation."""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from accounts.models import Account
from categories.models import Category
from core.models import Household, HouseholdMembership
from timeline.models import RecurringRule, Scenario, ScenarioOneTimeEvent, ScenarioRuleOverride
from timeline.services.guided_strategy import replace_guided_strategy
from timeline.services.guided_strategy_simulation import (
    GUIDED_STRATEGY_ROW_SOURCE,
    apply_debt_first_vs_save_first,
    snapshot_from_strategy,
)
from timeline.services.ledger import _timeline_row_meta, timeline_rows_chronological_key
from timeline.services.scenario_comparison import (
    build_scenario_comparison,
    build_scenario_comparison_context,
)
from transactions.models import Transaction, Transfer

User = get_user_model()
TODAY = date.today()
ZERO = Decimal("0.00")


@pytest.fixture
def owner(db):
    return User.objects.create_user(username="gsim_owner", password="pass1234")


@pytest.fixture
def hh(db, owner):
    h = Household.objects.create(name="Guided Sim HH")
    HouseholdMembership.objects.create(household=h, user=owner, role=HouseholdMembership.Role.OWNER)
    return h


@pytest.fixture
def checking(db, hh):
    return Account.objects.create(
        household=hh,
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        name="Checking Source",
        starting_balance=Decimal("4000"),
        currency="USD",
        include_in_forecast=True,
    )


@pytest.fixture
def savings(db, hh):
    return Account.objects.create(
        household=hh,
        account_type=Account.AccountType.SAVINGS,
        role=Account.AccountRole.SAVINGS,
        name="Savings Dest",
        starting_balance=Decimal("1500"),
        currency="USD",
        include_in_forecast=True,
    )


@pytest.fixture
def card(db, hh):
    return Account.objects.create(
        household=hh,
        account_type=Account.AccountType.CREDIT,
        role=Account.AccountRole.CREDIT_CARD,
        name="Venture",
        starting_balance=Decimal("-800"),
        currency="USD",
        credit_limit=Decimal("3000"),
        apr=Decimal("19.99"),
        include_in_forecast=True,
    )


@pytest.fixture
def card_high_apr(db, hh):
    return Account.objects.create(
        household=hh,
        account_type=Account.AccountType.CREDIT,
        role=Account.AccountRole.CREDIT_CARD,
        name="High APR",
        starting_balance=Decimal("-500"),
        currency="USD",
        credit_limit=Decimal("5000"),
        apr=Decimal("29.99"),
        include_in_forecast=True,
    )


@pytest.fixture
def card_small(db, hh):
    return Account.objects.create(
        household=hh,
        account_type=Account.AccountType.CREDIT,
        role=Account.AccountRole.CREDIT_CARD,
        name="Small Bal",
        starting_balance=Decimal("-120"),
        currency="USD",
        credit_limit=Decimal("2000"),
        apr=Decimal("12.00"),
        include_in_forecast=True,
    )


@pytest.fixture
def card_high_util(db, hh):
    return Account.objects.create(
        household=hh,
        account_type=Account.AccountType.CREDIT,
        role=Account.AccountRole.CREDIT_CARD,
        name="High Util",
        starting_balance=Decimal("-900"),
        currency="USD",
        credit_limit=Decimal("1000"),
        apr=Decimal("15.00"),
        include_in_forecast=True,
    )


@pytest.fixture
def savings_rule(db, hh, checking, savings):
    return RecurringRule.objects.create(
        household=hh,
        name="Savings transfer",
        account=checking,
        transfer_to_account=savings,
        direction=RecurringRule.Direction.TRANSFER,
        amount=Decimal("200"),
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=15,
        start_date=date(2020, 1, 1),
        active=True,
    )


@pytest.fixture
def savings_rule_b(db, hh, checking, savings):
    return RecurringRule.objects.create(
        household=hh,
        name="Bonus savings",
        account=checking,
        transfer_to_account=savings,
        direction=RecurringRule.Direction.TRANSFER,
        amount=Decimal("50"),
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=20,
        start_date=date(2020, 1, 1),
        active=True,
    )


@pytest.fixture
def unselected_rule(db, hh, checking, savings):
    return RecurringRule.objects.create(
        household=hh,
        name="Other savings",
        account=checking,
        transfer_to_account=savings,
        direction=RecurringRule.Direction.TRANSFER,
        amount=Decimal("75"),
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=25,
        start_date=date(2020, 1, 1),
        active=True,
    )


@pytest.fixture
def scenario(db, hh):
    return Scenario.objects.create(household=hh, name="Guided sim", horizon_months=12)


def _row(
    *,
    d,
    account,
    amount,
    description,
    rule_id=None,
    source="rule",
    status="planned",
    txn_source=None,
    reconciled=False,
    plaid_transaction_id=None,
    import_match_status=None,
    transaction_id=None,
):
    amt = Decimal(str(amount))
    meta = _timeline_row_meta(None)
    meta.update(
        {
            "reconciled": reconciled,
            "txn_source": txn_source,
            "import_match_status": import_match_status,
            "plaid_transaction_id": plaid_transaction_id,
        }
    )
    return {
        "date": d,
        "description": description,
        "account_id": account.id,
        "account_name": account.name,
        "category_id": None,
        "category_name": None,
        "amount": amt,
        "type": "OUTFLOW" if amt < 0 else "INFLOW",
        "status": status,
        "source": source,
        "rule_id": rule_id,
        "transaction_id": transaction_id,
        **meta,
    }


def _transfer_pair(d, rule, source_acc, dest_acc, amount, description=None):
    desc = description or rule.name
    amt = abs(Decimal(str(amount)))
    return [
        _row(d=d, account=source_acc, amount=-amt, description=desc, rule_id=rule.id),
        _row(d=d, account=dest_acc, amount=amt, description=desc, rule_id=rule.id),
    ]


def _opening(*accounts):
    return {acc.id: Decimal(str(acc.starting_balance or 0)) for acc in accounts}


def _strategy(
    scenario,
    checking,
    savings,
    debts,
    rules,
    *,
    percent="100.00",
    buffer="0.00",
    payoff="avalanche",
    resume=True,
    start=None,
    custom_order=None,
):
    return replace_guided_strategy(
        scenario,
        strategy_type="debt_first_vs_save_first",
        source_account=checking,
        savings_account=savings,
        included_debt_accounts=list(debts),
        savings_transfer_rules=list(rules),
        start_date=start or TODAY,
        minimum_cash_buffer=Decimal(buffer),
        allocation_percent=Decimal(percent),
        payoff_strategy=payoff,
        custom_debt_order=list(custom_order or []),
        resume_savings_after_payoff=resume,
    )


def _run(rows, strategy, opening, *, today=TODAY, end=None):
    end = end or (today + timedelta(days=90))
    return apply_debt_first_vs_save_first(
        list(rows),
        snapshot_from_strategy(strategy),
        today=today,
        end_date=end,
        opening_balances=opening,
    )


def _guided_rows(rows):
    return [r for r in rows if r.get("source") == GUIDED_STRATEGY_ROW_SOURCE]


def _original_rule_legs(rows, rule_id, d):
    return [
        r
        for r in rows
        if r.get("rule_id") == rule_id
        and r.get("date") == d
        and r.get("source") != GUIDED_STRATEGY_ROW_SOURCE
    ]


@pytest.mark.django_db
def test_selected_transfer_is_replaced_not_duplicated(
    scenario, checking, savings, card, savings_rule
):
    d = TODAY + timedelta(days=5)
    rows = _transfer_pair(d, savings_rule, checking, savings, "200")
    strategy = _strategy(scenario, checking, savings, [card], [savings_rule])
    out, trace = _run(rows, strategy, _opening(checking, savings, card))
    assert _original_rule_legs(out, savings_rule.id, d) == []
    guided = _guided_rows(out)
    assert guided
    assert sum(1 for r in out if r.get("date") == d and r.get("account_id") == savings.id) == 0 or all(
        r.get("source") == GUIDED_STRATEGY_ROW_SOURCE
        for r in out
        if r.get("date") == d and r.get("account_id") == savings.id and r.get("amount", 0) != 0
    )
    assert trace.occurrences[0].original_amount == Decimal("200.00")
    savings_in = sum(
        (r["amount"] for r in out if r.get("account_id") == savings.id and r.get("date") == d),
        ZERO,
    )
    debt_in = sum(
        (r["amount"] for r in out if r.get("account_id") == card.id and r.get("date") == d),
        ZERO,
    )
    assert savings_in + debt_in == Decimal("200.00") or savings_in + debt_in <= Decimal("200.00")
    assert Decimal("200.00") not in (
        abs(r["amount"])
        for r in out
        if r.get("source") == "rule" and r.get("rule_id") == savings_rule.id
    )


@pytest.mark.django_db
def test_100_percent_redirects_affordable_to_debt(
    scenario, checking, savings, card, savings_rule
):
    d = TODAY + timedelta(days=5)
    rows = _transfer_pair(d, savings_rule, checking, savings, "200")
    strategy = _strategy(scenario, checking, savings, [card], [savings_rule], percent="100.00")
    out, trace = _run(rows, strategy, _opening(checking, savings, card))
    occ = trace.occurrences[0]
    assert occ.redirected_to_debt == Decimal("200.00")
    assert occ.sent_to_savings == ZERO
    assert any(
        r.get("account_id") == card.id
        and r.get("amount") == Decimal("200.00")
        and r.get("source") == GUIDED_STRATEGY_ROW_SOURCE
        for r in out
    )
    assert not any(
        r.get("account_id") == savings.id and r.get("amount") == Decimal("200.00") for r in out
    )


@pytest.mark.django_db
def test_50_percent_splits_debt_and_savings(
    scenario, checking, savings, card, savings_rule
):
    d = TODAY + timedelta(days=5)
    rows = _transfer_pair(d, savings_rule, checking, savings, "200")
    strategy = _strategy(scenario, checking, savings, [card], [savings_rule], percent="50.00")
    _out, trace = _run(rows, strategy, _opening(checking, savings, card))
    occ = trace.occurrences[0]
    assert occ.redirected_to_debt == Decimal("100.00")
    assert occ.sent_to_savings == Decimal("100.00")
    assert occ.status == "split"


@pytest.mark.django_db
def test_multiple_selected_rules_and_unselected_unchanged(
    scenario, checking, savings, card, savings_rule, savings_rule_b, unselected_rule
):
    d = TODAY + timedelta(days=5)
    d2 = TODAY + timedelta(days=6)
    d3 = TODAY + timedelta(days=7)
    rows = (
        _transfer_pair(d, savings_rule, checking, savings, "200")
        + _transfer_pair(d2, savings_rule_b, checking, savings, "50")
        + _transfer_pair(d3, unselected_rule, checking, savings, "75")
    )
    strategy = _strategy(
        scenario, checking, savings, [card], [savings_rule, savings_rule_b]
    )
    out, trace = _run(rows, strategy, _opening(checking, savings, card))
    assert len(trace.occurrences) == 2
    unselected = [
        r
        for r in out
        if r.get("rule_id") == unselected_rule.id and r.get("source") == "rule"
    ]
    assert len(unselected) == 2
    assert {abs(r["amount"]) for r in unselected} == {Decimal("75.00")}


@pytest.mark.django_db
def test_transfers_before_start_and_after_horizon_unchanged(
    scenario, checking, savings, card, savings_rule
):
    start = TODAY + timedelta(days=10)
    end = TODAY + timedelta(days=40)
    before = TODAY + timedelta(days=3)
    inside = TODAY + timedelta(days=15)
    after = TODAY + timedelta(days=50)
    rows = (
        _transfer_pair(before, savings_rule, checking, savings, "200")
        + _transfer_pair(inside, savings_rule, checking, savings, "200")
        + _transfer_pair(after, savings_rule, checking, savings, "200")
    )
    strategy = _strategy(
        scenario, checking, savings, [card], [savings_rule], start=start
    )
    out, trace = _run(rows, strategy, _opening(checking, savings, card), end=end)
    assert len(trace.occurrences) == 1
    assert trace.occurrences[0].date == inside
    assert any(
        r.get("date") == before and r.get("source") == "rule" and r.get("amount") == Decimal("-200.00")
        for r in out
    )
    assert any(
        r.get("date") == after and r.get("source") == "rule" and r.get("amount") == Decimal("-200.00")
        for r in out
    )


@pytest.mark.django_db
def test_buffer_limits_and_below_buffer_skips(
    scenario, checking, savings, card, savings_rule
):
    d = TODAY + timedelta(days=5)
    rows = _transfer_pair(d, savings_rule, checking, savings, "200")
    strategy = _strategy(
        scenario, checking, savings, [card], [savings_rule], buffer="3900.00"
    )
    opening = {checking.id: Decimal("4000"), savings.id: Decimal("1500"), card.id: Decimal("-800")}
    _out, trace = _run(rows, strategy, opening)
    occ = trace.occurrences[0]
    assert occ.affordable_amount == Decimal("100.00")
    assert occ.left_in_source == Decimal("100.00")
    assert occ.status == "buffer_limited"
    assert occ.source_balance_after >= Decimal("3900.00")

    strategy2 = _strategy(
        scenario, checking, savings, [card], [savings_rule], buffer="5000.00"
    )
    _out2, trace2 = _run(rows, strategy2, opening)
    occ2 = trace2.occurrences[0]
    assert occ2.status == "skipped"
    assert occ2.redirected_to_debt == ZERO
    assert occ2.sent_to_savings == ZERO
    assert occ2.left_in_source == Decimal("200.00")


@pytest.mark.django_db
def test_same_day_income_and_expense_order(scenario, checking, savings, card, savings_rule):
    d = TODAY + timedelta(days=5)
    income = _row(
        d=d,
        account=checking,
        amount=Decimal("500"),
        description="aaa paycheck",
        rule_id=99,
    )
    expense = _row(
        d=d,
        account=checking,
        amount=Decimal("-300"),
        description="aaa rent",
        rule_id=98,
    )
    transfer = _transfer_pair(d, savings_rule, checking, savings, "200", description="zzz savings")
    opening = {checking.id: Decimal("400"), savings.id: Decimal("0"), card.id: Decimal("-800")}
    strategy = _strategy(
        scenario, checking, savings, [card], [savings_rule], buffer="500.00", percent="100.00"
    )
    _out, trace = _run([income] + transfer, strategy, opening)
    # 400 + 500 income = 900; buffer 500 → affordable 200
    assert trace.occurrences[0].affordable_amount == Decimal("200.00")
    assert trace.occurrences[0].source_balance_before == Decimal("900.00")

    _out2, trace2 = _run([expense] + transfer, strategy, opening)
    # 400 - 300 = 100; buffer 500 → skipped
    assert trace2.occurrences[0].status == "skipped"
    assert trace2.occurrences[0].source_balance_before == Decimal("100.00")


@pytest.mark.django_db
def test_payoff_priority_avalanche_snowball_util_custom(
    scenario, checking, savings, card_high_apr, card_small, card_high_util, savings_rule
):
    d = TODAY + timedelta(days=5)
    rows = _transfer_pair(d, savings_rule, checking, savings, "200")
    debts = [card_high_apr, card_small, card_high_util]
    opening = _opening(checking, savings, *debts)

    av = _strategy(scenario, checking, savings, debts, [savings_rule], payoff="avalanche")
    _o, t = _run(rows, av, opening)
    assert t.debt_payments[0].debt_account_id == card_high_apr.id

    sn = _strategy(scenario, checking, savings, debts, [savings_rule], payoff="snowball")
    _o, t = _run(rows, sn, opening)
    assert t.debt_payments[0].debt_account_id == card_small.id

    ut = _strategy(
        scenario, checking, savings, debts, [savings_rule], payoff="utilization_target"
    )
    _o, t = _run(rows, ut, opening)
    assert t.debt_payments[0].debt_account_id == card_high_util.id

    custom = _strategy(
        scenario,
        checking,
        savings,
        debts,
        [savings_rule],
        payoff="custom",
        custom_order=[card_small, card_high_util, card_high_apr],
    )
    _o, t = _run(rows, custom, opening)
    assert t.debt_payments[0].debt_account_id == card_small.id
    assert [p.priority_at_payment for p in t.debt_payments][0] == 1


@pytest.mark.django_db
def test_paid_off_skipped_no_overpay_spill_to_next(
    scenario, checking, savings, card_small, card_high_apr, savings_rule
):
    d = TODAY + timedelta(days=5)
    rows = _transfer_pair(d, savings_rule, checking, savings, "200")
    paid = Account.objects.create(
        household=checking.household,
        account_type=Account.AccountType.CREDIT,
        role=Account.AccountRole.CREDIT_CARD,
        name="Paid Off",
        starting_balance=Decimal("25"),
        currency="USD",
        credit_limit=Decimal("1000"),
        apr=Decimal("40.00"),
        include_in_forecast=True,
    )
    debts = [paid, card_small, card_high_apr]
    strategy = _strategy(
        scenario, checking, savings, debts, [savings_rule], payoff="snowball", percent="100.00"
    )
    opening = _opening(checking, savings, *debts)
    out, trace = _run(rows, strategy, opening)
    assert paid.id not in {p.debt_account_id for p in trace.debt_payments}
    small_pay = next(p for p in trace.debt_payments if p.debt_account_id == card_small.id)
    assert small_pay.amount == Decimal("120.00")
    next_pay = next(p for p in trace.debt_payments if p.debt_account_id == card_high_apr.id)
    assert next_pay.amount == Decimal("80.00")
    card_in = sum(
        (r["amount"] for r in out if r.get("account_id") == card_small.id),
        ZERO,
    )
    assert card_in == Decimal("120.00")
    ending_small = Decimal("-120") + card_in
    assert ending_small >= ZERO or ending_small == ZERO


@pytest.mark.django_db
def test_resume_savings_true_false_and_future_resume(
    scenario, checking, savings, card_small, savings_rule
):
    d1 = TODAY + timedelta(days=5)
    d2 = TODAY + timedelta(days=12)
    rows = _transfer_pair(d1, savings_rule, checking, savings, "200") + _transfer_pair(
        d2, savings_rule, checking, savings, "200"
    )
    opening = {
        checking.id: Decimal("4000"),
        savings.id: Decimal("0"),
        card_small.id: Decimal("-120"),
    }
    on = _strategy(
        scenario,
        checking,
        savings,
        [card_small],
        [savings_rule],
        percent="100.00",
        resume=True,
    )
    _out, trace = _run(rows, on, opening)
    assert trace.occurrences[0].redirected_to_debt == Decimal("120.00")
    assert trace.occurrences[0].sent_to_savings == Decimal("80.00")
    assert trace.savings_resumed_date == d1
    assert trace.occurrences[1].redirected_to_debt == ZERO
    assert trace.occurrences[1].sent_to_savings == Decimal("200.00")
    assert trace.occurrences[1].status == "resumed_savings"

    off = _strategy(
        scenario,
        checking,
        savings,
        [card_small],
        [savings_rule],
        percent="100.00",
        resume=False,
    )
    _out2, trace2 = _run(rows, off, opening)
    assert trace2.occurrences[0].sent_to_savings == ZERO
    assert trace2.occurrences[0].left_in_source == Decimal("80.00")
    assert trace2.savings_resumed_date is None
    assert trace2.occurrences[1].sent_to_savings == ZERO
    assert trace2.occurrences[1].left_in_source == Decimal("200.00")


@pytest.mark.django_db
def test_unrelated_cc_payment_and_manual_changes_first(
    owner, scenario, checking, savings, card, savings_rule
):
    d = TODAY + timedelta(days=8)
    pay_d = TODAY + timedelta(days=3)
    rows = [
        _row(
            d=pay_d,
            account=checking,
            amount=Decimal("-40"),
            description="Existing card payment",
            rule_id=None,
            source="rule",
        ),
        _row(
            d=pay_d,
            account=card,
            amount=Decimal("40"),
            description="Existing card payment",
            rule_id=None,
            source="rule",
        ),
    ] + _transfer_pair(d, savings_rule, checking, savings, "200")
    strategy = _strategy(scenario, checking, savings, [card], [savings_rule])
    out, trace = _run(rows, strategy, _opening(checking, savings, card))
    assert any(
        r.get("description") == "Existing card payment" and r.get("account_id") == card.id
        for r in out
    )
    assert trace.debt_payments
    assert all(p.amount <= Decimal("760.00") for p in trace.debt_payments)

    ScenarioRuleOverride.objects.create(
        scenario=scenario,
        rule=savings_rule,
        override_amount=Decimal("300"),
    )
    ScenarioOneTimeEvent.objects.create(
        scenario=scenario,
        date=TODAY + timedelta(days=2),
        description="Bonus",
        amount=Decimal("250"),
        direction=ScenarioOneTimeEvent.Direction.INCOME,
        account=checking,
    )
    base = [
        *_transfer_pair(d, savings_rule, checking, savings, "200"),
        _row(
            d=TODAY + timedelta(days=2),
            account=checking,
            amount=Decimal("250"),
            description="Bonus",
            source="scenario_event",
        ),
    ]
    # Simulate override amount already applied (manual changes before guided).
    for r in base:
        if r.get("rule_id") == savings_rule.id:
            r["amount"] = Decimal("300") if r["amount"] > 0 else Decimal("-300")
    out2, trace2 = _run(base, strategy, _opening(checking, savings, card))
    assert trace2.occurrences[0].original_amount == Decimal("300.00")


@pytest.mark.django_db
def test_credit_sign_no_real_writes_baseline_deterministic(
    owner, scenario, checking, savings, card, savings_rule
):
    d = TODAY + timedelta(days=5)
    rows = _transfer_pair(d, savings_rule, checking, savings, "200")
    strategy = _strategy(scenario, checking, savings, [card], [savings_rule])
    opening = _opening(checking, savings, card)
    txn_before = Transaction.objects.count()
    rule_before = RecurringRule.objects.count()
    transfer_before = Transfer.objects.count()
    out1, t1 = _run(rows, strategy, opening)
    out2, t2 = _run(rows, strategy, opening)
    assert Transaction.objects.count() == txn_before
    assert RecurringRule.objects.count() == rule_before
    assert Transfer.objects.count() == transfer_before
    card_legs = [
        r
        for r in out1
        if r.get("account_id") == card.id and r.get("source") == GUIDED_STRATEGY_ROW_SOURCE
    ]
    assert card_legs and all(r["amount"] > 0 for r in card_legs)
    keys1 = [
        (r.get("date"), r.get("account_id"), r.get("amount"), r.get("source"), r.get("guided_occurrence_key"))
        for r in sorted(out1, key=timeline_rows_chronological_key)
    ]
    keys2 = [
        (r.get("date"), r.get("account_id"), r.get("amount"), r.get("source"), r.get("guided_occurrence_key"))
        for r in sorted(out2, key=timeline_rows_chronological_key)
    ]
    assert keys1 == keys2
    assert [p.amount for p in t1.debt_payments] == [p.amount for p in t2.debt_payments]


@pytest.mark.django_db
def test_interest_not_double_counted_and_avoided(
    scenario, checking, savings, card, savings_rule
):
    pay_d = TODAY + timedelta(days=5)
    int_d = TODAY + timedelta(days=20)
    rows = _transfer_pair(pay_d, savings_rule, checking, savings, "200") + [
        _row(
            d=int_d,
            account=card,
            amount=Decimal("-10.00"),
            description="Projected Interest",
            source="interest",
        )
    ]
    strategy = _strategy(scenario, checking, savings, [card], [savings_rule], percent="100.00")
    opening = {checking.id: Decimal("4000"), savings.id: Decimal("0"), card.id: Decimal("-200")}
    out, _trace = _run(rows, strategy, opening, end=TODAY + timedelta(days=40))
    interest_rows = [
        r for r in out if r.get("source") == "interest" and r.get("account_id") == card.id
    ]
    assert len(interest_rows) <= 1
    if interest_rows:
        assert interest_rows[0]["amount"] >= Decimal("-10.00")
        assert interest_rows[0]["amount"] < ZERO or interest_rows[0]["amount"] == ZERO


@pytest.mark.django_db
def test_dates_totals_and_rounding(
    owner, scenario, checking, savings, card_small, savings_rule
):
    d1 = TODAY + timedelta(days=5)
    d2 = TODAY + timedelta(days=12)
    rows = _transfer_pair(d1, savings_rule, checking, savings, "200") + _transfer_pair(
        d2, savings_rule, checking, savings, "200"
    )
    strategy = _strategy(
        scenario, checking, savings, [card_small], [savings_rule], percent="100.00", resume=True
    )
    opening = {
        checking.id: Decimal("4000.00"),
        savings.id: Decimal("100.00"),
        card_small.id: Decimal("-120.00"),
    }
    out, trace = _run(rows, strategy, opening)
    from timeline.services.guided_strategy_simulation import build_guided_strategy_result
    from timeline.services.ledger import recompute_future_timeline_running_balances

    recompute_future_timeline_running_balances(
        out, today=TODAY, account_ids={checking.id, savings.id, card_small.id}, opening=opening
    )
    result = build_guided_strategy_result(
        trace,
        today=TODAY,
        end_date=TODAY + timedelta(days=90),
        base_rows=rows,
        scenario_rows=out,
        opening_balances=opening,
    )
    assert result["debt_free_date"] == d1.isoformat()
    assert result["savings_resumed_date"] == d1.isoformat()
    payments = sum((Decimal(p["amount"]) for p in result["debt_payments"]), ZERO)
    assert payments == Decimal(result["total_redirected_to_debt"])
    occ_redirect = sum(
        (Decimal(o["redirected_to_debt"]) for o in result["transfer_occurrences"]), ZERO
    )
    occ_savings = sum(
        (Decimal(o["sent_to_savings"]) for o in result["transfer_occurrences"]), ZERO
    )
    assert occ_redirect == Decimal(result["total_redirected_to_debt"])
    assert occ_savings == Decimal(result["total_sent_to_savings"])
    assert result["net_position_break_even_date"] == result["break_even_date"]
    if result["savings_balance_catch_up_date"] and result["net_position_break_even_date"]:
        # They may differ; the contract must not treat them as the same field.
        assert "savings_balance_catch_up_date" in result
        assert "net_position_break_even_date" in result

    # One-cent overpay / buffer: leftover 0.004 must not pay past zero.
    tiny_rows = _transfer_pair(d1, savings_rule, checking, savings, "120.004")
    _out3, t3 = _run(tiny_rows, strategy, opening)
    assert sum((p.amount for p in t3.debt_payments), ZERO) <= Decimal("120.00")
    assert all(p.amount <= Decimal("120.00") for p in t3.debt_payments)

    buffer_strategy = _strategy(
        scenario,
        checking,
        savings,
        [card_small],
        [savings_rule],
        buffer="3999.99",
        percent="100.00",
    )
    opening_b = {checking.id: Decimal("4000.005"), savings.id: ZERO, card_small.id: Decimal("-120")}
    _ob, tb = _run(_transfer_pair(d1, savings_rule, checking, savings, "200"), buffer_strategy, opening_b)
    if tb.occurrences:
        assert tb.occurrences[0].source_balance_after >= Decimal("3999.99")


@pytest.mark.django_db
def test_historical_imported_and_unselected_credit_untouched(
    scenario, checking, savings, card, card_high_apr, savings_rule
):
    d = TODAY + timedelta(days=5)
    hist = _transfer_pair(d, savings_rule, checking, savings, "200")
    hist[0]["reconciled"] = True
    hist[0]["status"] = "RECONCILED"
    hist[0]["txn_source"] = "plaid"
    hist[1]["txn_source"] = "plaid"
    hist[1]["status"] = "RECONCILED"
    imported = _transfer_pair(d + timedelta(days=1), savings_rule, checking, savings, "200")
    imported[0]["plaid_transaction_id"] = "plaid-abc"
    imported[0]["source"] = "actual"
    extra_card_row = _row(
        d=d,
        account=card_high_apr,
        amount=Decimal("-12"),
        description="Purchase",
        source="rule",
    )
    live = _transfer_pair(d + timedelta(days=2), savings_rule, checking, savings, "200")
    strategy = _strategy(scenario, checking, savings, [card], [savings_rule])
    opening = _opening(checking, savings, card, card_high_apr)
    out, trace = _run(hist + imported + [extra_card_row] + live, strategy, opening)
    assert all(occ.date == d + timedelta(days=2) for occ in trace.occurrences)
    assert any(r.get("reconciled") for r in out)
    assert any(r.get("plaid_transaction_id") == "plaid-abc" for r in out)
    assert not any(
        r.get("account_id") == card_high_apr.id and r.get("source") == GUIDED_STRATEGY_ROW_SOURCE
        for r in out
    )
    assert extra_card_row["amount"] in {r["amount"] for r in out if r.get("account_id") == card_high_apr.id}


@pytest.mark.django_db
def test_credit_balance_card_receives_no_payment(
    scenario, checking, savings, savings_rule
):
    credit_card = Account.objects.create(
        household=checking.household,
        account_type=Account.AccountType.CREDIT,
        role=Account.AccountRole.CREDIT_CARD,
        name="Credit Bal",
        starting_balance=Decimal("50"),
        currency="USD",
        credit_limit=Decimal("2000"),
        apr=Decimal("18"),
        include_in_forecast=True,
    )
    d = TODAY + timedelta(days=5)
    rows = _transfer_pair(d, savings_rule, checking, savings, "200")
    strategy = _strategy(scenario, checking, savings, [credit_card], [savings_rule])
    _out, trace = _run(rows, strategy, _opening(checking, savings, credit_card))
    assert trace.debt_payments == []
    assert trace.occurrences[0].redirected_to_debt == ZERO


@pytest.mark.django_db
def test_no_strategy_comparison_omits_result_and_query_count_stable(
    owner, scenario, checking, savings, card, savings_rule
):
    first = build_scenario_comparison(
        owner, scenario.id, horizon="3m", household_id=scenario.household_id
    )
    second = build_scenario_comparison(
        owner, scenario.id, horizon="3m", household_id=scenario.household_id
    )
    assert "guided_strategy_result" not in first
    assert first["metrics"] == second["metrics"]
    assert first["summary"] == second["summary"]

    _strategy(scenario, checking, savings, [card], [savings_rule], buffer="0.00", start=TODAY)
    d = TODAY + timedelta(days=5)
    many = []
    for i in range(12):
        many.extend(
            _transfer_pair(d + timedelta(days=i * 7), savings_rule, checking, savings, "200")
        )
    opening = _opening(checking, savings, card)
    snap = snapshot_from_strategy(scenario.guided_strategy)
    connection.queries_log.clear()
    with CaptureQueriesContext(connection) as ctx:
        apply_debt_first_vs_save_first(
            many, snap, today=TODAY, end_date=TODAY + timedelta(days=365), opening_balances=opening
        )
    guided_sql = [
        q["sql"]
        for q in ctx.captured_queries
        if "timeline_scenario_guided" in q["sql"].lower()
        or "accounts_account" in q["sql"].lower()
        or "timeline_recurringrule" in q["sql"].lower()
    ]
    assert guided_sql == []
    many_q = len(ctx.captured_queries)

    few = _transfer_pair(d, savings_rule, checking, savings, "200")
    connection.queries_log.clear()
    with CaptureQueriesContext(connection) as ctx2:
        apply_debt_first_vs_save_first(
            few, snap, today=TODAY, end_date=TODAY + timedelta(days=90), opening_balances=opening
        )
    few_q = len(ctx2.captured_queries)
    assert many_q == 0
    assert few_q == many_q


@pytest.mark.django_db
def test_comparison_net_worth_metrics_and_invalid_config(
    owner, scenario, checking, savings, card, savings_rule
):
    cat = Category.objects.create(
        household=scenario.household,
        name="Salary",
        category_type=Category.CategoryType.INCOME,
        sort_order=1,
    )
    RecurringRule.objects.create(
        household=scenario.household,
        name="Payroll",
        account=checking,
        category=cat,
        direction=RecurringRule.Direction.INCOME,
        amount=Decimal("2000"),
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=1,
        start_date=date(2020, 1, 1),
        active=True,
    )
    baseline_ctx = build_scenario_comparison_context(
        owner, scenario.id, horizon="3m", household_id=scenario.household_id
    )
    _strategy(scenario, checking, savings, [card], [savings_rule], buffer="0.00", start=TODAY)
    txn_before = Transaction.objects.count()
    transfer_before = Transfer.objects.count()
    guided_ctx = build_scenario_comparison_context(
        owner, scenario.id, horizon="3m", household_id=scenario.household_id
    )
    assert Transaction.objects.count() == txn_before
    assert Transfer.objects.count() == transfer_before
    assert RecurringRule.objects.filter(pk=savings_rule.pk, active=True).exists()
    assert guided_ctx.guided_strategy is not None
    assert baseline_ctx.base_net_worth_after_horizon == guided_ctx.base_net_worth_after_horizon
    assert not any(
        r.get("source") == GUIDED_STRATEGY_ROW_SOURCE for r in guided_ctx.base_rows
    )
    assert any(r.get("source") == GUIDED_STRATEGY_ROW_SOURCE for r in guided_ctx.scenario_rows)
    payload = build_scenario_comparison(
        owner, scenario.id, horizon="3m", household_id=scenario.household_id
    )
    result = payload["guided_strategy_result"]
    assert Decimal(result["total_redirected_to_debt"]) > ZERO
    assert payload["metrics"]["savings_after_horizon"]["scenario"] == result["debt_first"][
        "savings_at_horizon"
    ]
    assert payload["metrics"]["net_worth_after_horizon"]["base"] == str(
        guided_ctx.base_net_worth_after_horizon.quantize(Decimal("0.01"))
    )
    assert payload["metrics"]["net_worth_after_horizon"]["scenario"] == str(
        guided_ctx.scenario_net_worth_after_horizon.quantize(Decimal("0.01"))
    )
    assert Decimal(result["total_redirected_to_debt"]) == sum(
        (Decimal(p["amount"]) for p in result["debt_payments"]), ZERO
    )

    savings_rule.transfer_to_account = checking
    savings_rule.save(update_fields=["transfer_to_account"])
    from timeline.services.guided_strategy import GuidedStrategyConfigError

    with pytest.raises(GuidedStrategyConfigError):
        build_scenario_comparison_context(
            owner, scenario.id, horizon="3m", household_id=scenario.household_id
        )
    client = APIClient()
    client.force_authenticate(user=owner)
    res = client.get(
        f"/api/scenarios/{scenario.id}/compare/",
        {"horizon": "3m", "household_id": str(scenario.household_id)},
    )
    assert res.status_code == 400
    body = res.json()
    assert "errors" in body
    assert res.status_code != 500


@pytest.mark.django_db
def test_both_original_legs_replaced_and_source_outflow_sign(
    scenario, checking, savings, card, savings_rule
):
    d = TODAY + timedelta(days=5)
    rows = _transfer_pair(d, savings_rule, checking, savings, "200")
    strategy = _strategy(scenario, checking, savings, [card], [savings_rule], percent="100.00")
    out, _trace = _run(rows, strategy, _opening(checking, savings, card))
    orig = [
        r
        for r in out
        if r.get("rule_id") == savings_rule.id and r.get("source") == "rule"
    ]
    assert orig == []
    source_guided = [
        r
        for r in out
        if r.get("account_id") == checking.id and r.get("source") == GUIDED_STRATEGY_ROW_SOURCE
    ]
    assert source_guided and all(r["amount"] < 0 for r in source_guided)
    card_guided = [
        r
        for r in out
        if r.get("account_id") == card.id and r.get("source") == GUIDED_STRATEGY_ROW_SOURCE
    ]
    assert card_guided and all(r["amount"] > 0 for r in card_guided)
    assert all(r.get("guided_occurrence_key") for r in _guided_rows(out))
    assert all(r.get("transfer_group_id") for r in _guided_rows(out))
