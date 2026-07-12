"""Dashboard upcoming money flow uses reconciliation-aware timeline (matches Transactions)."""
from datetime import date, timedelta
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone

from accounts.models import Account
from categories.models import Category
from core.models import Household, HouseholdMembership
from insights.services.dashboard_summary import (
    _build_dashboard_timeline,
    build_dashboard_summary_details,
    build_upcoming_events,
)
from insights.services.dashboard_upcoming import build_upcoming_groups, load_transfer_rule_context
from timeline.services.ledger import build_timeline
from transactions.models import Reconciliation, Transaction
from transactions.services.posting import create_transfer

User = get_user_model()

AS_OF = date(2026, 7, 11)
JUL_12 = date(2026, 7, 12)
JUL_13 = date(2026, 7, 13)


@pytest.fixture
def user(db):
    return User.objects.create_user(username="dash_upcoming_user", password="testpass123")


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="Upcoming Recon HH")
    HouseholdMembership.objects.create(household=h, user=user, role=HouseholdMembership.Role.OWNER)
    return h


@pytest.fixture
def expense_category(db, household):
    return Category.objects.create(
        household=household,
        name="Healthcare",
        category_type=Category.CategoryType.EXPENSE,
        sort_order=1,
    )


@pytest.fixture
def main(db, household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        name="Main",
        starting_balance=Decimal("-2854.55"),
        minimum_buffer=Decimal("0"),
        currency="USD",
    )


@pytest.fixture
def savings(db, household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.SAVINGS,
        role=Account.AccountRole.SAVINGS,
        name="Savings",
        starting_balance=Decimal("5000"),
        currency="USD",
    )


def _completed_reconciliation(account, user, *, balance: Decimal, period_end: date) -> Reconciliation:
    return Reconciliation.objects.create(
        user=user,
        account=account,
        bank_current_balance=balance,
        app_current_balance=balance,
        last_reconciled_balance=balance,
        final_reconciled_balance=balance,
        difference=Decimal("0"),
        status=Reconciliation.Status.COMPLETED,
        is_active=True,
        completed_at=timezone.now(),
        period_start_date=period_end.replace(day=1),
        period_end_date=period_end,
    )


def _row_balance(rows, account_id: int, description_substr: str) -> Decimal:
    for row in rows:
        if row.get("account_id") != account_id:
            continue
        if description_substr.lower() in (row.get("description") or "").lower():
            return Decimal(str(row["running_balance"]))
    raise AssertionError(f"No row matching {description_substr!r} for account {account_id}")


def _group_for_date(groups: list[dict], day: date) -> dict:
    iso = day.isoformat()
    for group in groups:
        if group.get("date") == iso:
            return group
    raise AssertionError(f"No upcoming group for {iso}")


def _txn_balance_after(group: dict, description_substr: str) -> Decimal:
    for txn in group.get("transactions") or []:
        if description_substr.lower() in (txn.get("description") or "").lower():
            return Decimal(str(txn["balance_after"]))
    raise AssertionError(f"No transaction matching {description_substr!r}")


@pytest.fixture
def reconciled_main_scenario(user, main, expense_category):
    """Reconciled Main at $245.43 with pending/upcoming expenses (user-reported case)."""
    Transaction.objects.create(
        account=main,
        date=date(2026, 1, 15),
        payee="Historical deposit",
        amount=Decimal("3100.00"),
        reconciled=True,
        cleared=True,
        source=Transaction.Source.ACTUAL,
        status=Transaction.Status.CLEARED,
    )
    _completed_reconciliation(main, user, balance=Decimal("245.43"), period_end=date(2026, 7, 10))
    Transaction.objects.create(
        account=main,
        date=JUL_12,
        payee="PayPal",
        amount=Decimal("-36.88"),
        reconciled=False,
        cleared=False,
        source=Transaction.Source.PLAID,
        status=Transaction.Status.PLANNED,
    )
    Transaction.objects.create(
        account=main,
        date=JUL_13,
        payee="Henry Meds",
        amount=Decimal("-99.00"),
        reconciled=False,
        cleared=False,
        source=Transaction.Source.ONE_TIME,
        status=Transaction.Status.PLANNED,
        category=expense_category,
    )
    return main


def test_dashboard_timeline_uses_exclude_reconciled_past(user):
    today = AS_OF
    end = today + timedelta(days=30)
    with patch("insights.services.dashboard_summary.build_timeline", return_value=[]) as mock_build:
        _build_dashboard_timeline(user, today=today, end_date=end, caller="dashboard_summary")
    mock_build.assert_called_once_with(
        user,
        start_date=today,
        end_date=end,
        as_of_date=today,
        projection_only=True,
        exclude_reconciled_past=True,
        caller="dashboard_summary",
    )


def test_reconciled_account_upcoming_balances_match_transactions_ledger(
    user, reconciled_main_scenario
):
    """A: reconciled anchor + pending/upcoming — dashboard matches Transactions timeline."""
    main = reconciled_main_scenario
    end = JUL_13

    dashboard_rows = _build_dashboard_timeline(
        user, today=AS_OF, end_date=end, caller="dashboard_summary"
    )
    ledger_rows = build_timeline(
        user,
        start_date=AS_OF,
        end_date=end,
        as_of_date=AS_OF,
        projection_only=True,
        exclude_reconciled_past=True,
        account_id=main.id,
        caller="timeline_page",
    )

    dash_paypal = _row_balance(dashboard_rows, main.id, "PayPal")
    dash_henry = _row_balance(dashboard_rows, main.id, "Henry")
    ledger_paypal = _row_balance(ledger_rows, main.id, "PayPal")
    ledger_henry = _row_balance(ledger_rows, main.id, "Henry")

    assert dash_paypal == ledger_paypal == Decimal("208.55")
    assert dash_henry == ledger_henry == Decimal("109.55")

    events = build_upcoming_events(user, [main], {}, today=AS_OF, timeline_rows=dashboard_rows)
    rule_ids, rule_targets, rule_sources = load_transfer_rule_context([main.household])
    grouped = build_upcoming_groups(
        events,
        transfer_rule_ids=rule_ids,
        transfer_rule_targets=rule_targets,
        transfer_rule_sources=rule_sources,
        accounts_by_id={main.id: main},
        health_by_id={},
        today=AS_OF,
    )
    jul_12 = _group_for_date(grouped["groups"], JUL_12)
    jul_13 = _group_for_date(grouped["groups"], JUL_13)

    assert _txn_balance_after(jul_12, "PayPal") == Decimal("208.55")
    assert _txn_balance_after(jul_13, "Henry") == Decimal("109.55")
    assert jul_13.get("is_negative") is False
    assert Decimal(jul_13.get("lowest_projected_balance") or "0") == Decimal("109.55")

    details = build_dashboard_summary_details(user, days=30, as_of_date=AS_OF)
    api_jul_13 = _group_for_date(details["upcoming_groups"], JUL_13)
    assert _txn_balance_after(api_jul_13, "Henry") == Decimal("109.55")
    assert api_jul_13.get("is_negative") is False


def test_unreconciled_account_uses_ledger_balance(user, household, expense_category):
    """B: no reconciliation — normal starting balance + posted activity."""
    main = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        name="Checking",
        starting_balance=Decimal("1000.00"),
        currency="USD",
    )
    Transaction.objects.create(
        account=main,
        date=AS_OF,
        payee="Coffee",
        amount=Decimal("-5.00"),
        reconciled=False,
        cleared=True,
        source=Transaction.Source.ACTUAL,
        status=Transaction.Status.CLEARED,
    )
    Transaction.objects.create(
        account=main,
        date=JUL_13,
        payee="Rent",
        amount=Decimal("-200.00"),
        reconciled=False,
        cleared=False,
        source=Transaction.Source.ONE_TIME,
        status=Transaction.Status.PLANNED,
        category=expense_category,
    )

    rows = _build_dashboard_timeline(user, today=AS_OF, end_date=JUL_13, caller="dashboard_summary")
    assert _row_balance(rows, main.id, "Rent") == Decimal("795.00")


def test_reconciliation_on_one_account_does_not_affect_another(user, household, savings, expense_category):
    """C: reconciled Main vs unreconciled Savings stay independent."""
    main = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        name="Main",
        starting_balance=Decimal("-2854.55"),
        currency="USD",
    )
    _completed_reconciliation(main, user, balance=Decimal("245.43"), period_end=date(2026, 7, 10))
    Transaction.objects.create(
        account=main,
        date=JUL_13,
        payee="Henry Meds",
        amount=Decimal("-99.00"),
        reconciled=False,
        source=Transaction.Source.ONE_TIME,
        status=Transaction.Status.PLANNED,
        category=expense_category,
    )
    Transaction.objects.create(
        account=savings,
        date=JUL_13,
        payee="Withdrawal",
        amount=Decimal("-100.00"),
        reconciled=False,
        source=Transaction.Source.ONE_TIME,
        status=Transaction.Status.PLANNED,
        category=expense_category,
    )

    rows = _build_dashboard_timeline(user, today=AS_OF, end_date=JUL_13, caller="dashboard_summary")
    assert _row_balance(rows, main.id, "Henry") == Decimal("146.43")
    assert _row_balance(rows, savings.id, "Withdrawal") == Decimal("4900.00")


def test_transfer_not_double_counted_on_source_account(user, household, main, savings, expense_category):
    """D: transfer outflow only affects source account balance once."""
    create_transfer(
        user=user,
        from_account_id=main.id,
        to_account_id=savings.id,
        amount=Decimal("50.00"),
        transfer_date=JUL_13.isoformat(),
        memo="Save",
    )
    _completed_reconciliation(main, user, balance=Decimal("245.43"), period_end=date(2026, 7, 10))

    rows = _build_dashboard_timeline(user, today=AS_OF, end_date=JUL_13, caller="dashboard_summary")
    main_rows = [r for r in rows if r.get("account_id") == main.id and r.get("date") == JUL_13]
    outflows = [r for r in main_rows if Decimal(str(r.get("amount"))) < 0]
    assert len(outflows) == 1
    assert Decimal(str(outflows[0]["running_balance"])) == Decimal("195.43")


def test_actual_negative_balance_still_surfaces_risk(user, household, expense_category):
    """E: corrected timeline still flags true cash risk."""
    main = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        name="Main",
        starting_balance=Decimal("50.00"),
        minimum_buffer=Decimal("0"),
        currency="USD",
    )
    Transaction.objects.create(
        account=main,
        date=JUL_13,
        payee="Large bill",
        amount=Decimal("-200.00"),
        reconciled=False,
        source=Transaction.Source.ONE_TIME,
        status=Transaction.Status.PLANNED,
        category=expense_category,
    )

    events = build_upcoming_events(user, [main], {}, today=AS_OF, upcoming_days=14)
    rule_ids, rule_targets, rule_sources = load_transfer_rule_context([household])
    grouped = build_upcoming_groups(
        events,
        transfer_rule_ids=rule_ids,
        transfer_rule_targets=rule_targets,
        transfer_rule_sources=rule_sources,
        accounts_by_id={main.id: main},
        health_by_id={},
        today=AS_OF,
    )
    jul_13 = _group_for_date(grouped["groups"], JUL_13)
    assert jul_13.get("has_risk") is True
    assert Decimal(jul_13["lowest_projected_balance"]) < 0


def test_legacy_starting_balance_replay_differs_from_reconciliation_aware(
    user, reconciled_main_scenario
):
    """Without exclude_reconciled_past, replay from starting_balance diverges (regression guard)."""
    main = reconciled_main_scenario
    end = JUL_13

    aware_rows = build_timeline(
        user,
        start_date=AS_OF,
        end_date=end,
        as_of_date=AS_OF,
        projection_only=True,
        exclude_reconciled_past=True,
        account_id=main.id,
        caller="timeline_page",
    )
    legacy_rows = build_timeline(
        user,
        start_date=AS_OF,
        end_date=end,
        as_of_date=AS_OF,
        projection_only=True,
        exclude_reconciled_past=False,
        account_id=main.id,
        caller="legacy_dashboard",
    )

    aware = _row_balance(aware_rows, main.id, "Henry")
    legacy = _row_balance(legacy_rows, main.id, "Henry")
    assert aware == Decimal("109.55")
    assert legacy != aware
