"""Lowest forecast balance vs first cash shortfall share one forecast walk."""
from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model

from accounts.models import Account
from categories.models import Category
from core.models import Household, HouseholdMembership
from insights.services.dashboard_summary import (
    build_dashboard_summary_details,
    build_dashboard_summary_fast,
)
from transactions.models import Transaction
from transactions.services.posting import create_transfer

User = get_user_model()
AS_OF = date(2026, 8, 15)
AUG_20 = date(2026, 8, 20)
AUG_21 = date(2026, 8, 21)
SEP_10 = date(2026, 9, 10)


@pytest.fixture
def user(db):
    return User.objects.create_user(username="forecast_consistency", password="testpass123")


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="Forecast Consistency HH")
    HouseholdMembership.objects.create(
        household=h, user=user, role=HouseholdMembership.Role.OWNER
    )
    return h


@pytest.fixture
def expense_category(db, household):
    return Category.objects.create(
        household=household,
        name="Bills",
        category_type=Category.CategoryType.EXPENSE,
        sort_order=1,
    )


@pytest.fixture
def income_category(db, household):
    return Category.objects.create(
        household=household,
        name="Paycheck",
        category_type=Category.CategoryType.INCOME,
        sort_order=2,
    )


@pytest.fixture
def main(db, household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        name="Main",
        starting_balance=Decimal("1000.00"),
        minimum_buffer=Decimal("0"),
        currency="USD",
    )


@pytest.fixture
def savor(db, household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        role=Account.AccountRole.CREDIT_CARD,
        name="Savor",
        starting_balance=Decimal("-2000.00"),
        credit_limit=Decimal("5000"),
        currency="USD",
    )


def _txn(account, day, payee, amount, category=None):
    return Transaction.objects.create(
        account=account,
        date=day,
        payee=payee,
        amount=amount,
        category=category,
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.ONE_TIME,
    )


def _group_for_date(groups, day):
    iso = day.isoformat()
    for group in groups:
        if group.get("date") == iso:
            return group
    raise AssertionError(f"No upcoming group for {iso}")


def _txn_balance_after(group, description_substr):
    needle = description_substr.lower()
    for txn in group.get("transactions") or []:
        if needle in (txn.get("description") or "").lower():
            return Decimal(str(txn["balance_after"]))
    raise AssertionError(f"No transaction matching {description_substr!r}")


def test_first_shortfall_can_be_milder_than_later_lowest(
    user, main, expense_category, income_category
):
    """First below-zero is earlier; lowest is a later deeper dip after payroll recovery."""
    _txn(main, AUG_20, "Quicksilver C/C Payment", Decimal("-329.02"), expense_category)
    _txn(main, AUG_20, "Utilities", Decimal("-712.00"), expense_category)
    _txn(main, AUG_21, "Payroll", Decimal("1835.52"), income_category)
    _txn(main, SEP_10, "Large planned bill", Decimal("-2700.00"), expense_category)

    fast = build_dashboard_summary_fast(user, days=30, as_of_date=AS_OF)
    lowest = fast["lowest_projected_cash"]
    shortfall = fast["first_cash_shortfall"]

    assert shortfall is not None
    assert shortfall["account_name"] == "Main"
    assert shortfall["date"] == AUG_20.isoformat()
    assert Decimal(shortfall["amount"]) == Decimal("-41.02")

    assert lowest is not None
    assert lowest["account_name"] == "Main"
    assert lowest["date"] == SEP_10.isoformat()
    assert Decimal(lowest["amount"]) == Decimal("-905.50")
    assert Decimal(lowest["amount"]) < Decimal(shortfall["amount"])
    assert shortfall["date"] < lowest["date"]


def test_credit_card_payment_transfer_is_included_in_both_metrics(
    user, main, savor, expense_category, income_category
):
    """Paying a card from checking reduces cash; first shortfall and lowest share that walk."""
    _txn(main, AUG_20, "Quicksilver C/C Payment", Decimal("-329.02"), expense_category)
    create_transfer(
        user,
        from_account_id=main.id,
        to_account_id=savor.id,
        amount=Decimal("1000.00"),
        transfer_date=AUG_20,
        payee="Move to credit card (Savor)",
    )
    _txn(main, AUG_21, "Payroll", Decimal("1835.52"), income_category)
    _txn(main, SEP_10, "Later bill", Decimal("-400.00"), expense_category)

    fast = build_dashboard_summary_fast(user, days=30, as_of_date=AS_OF)
    details = build_dashboard_summary_details(user, days=30, as_of_date=AS_OF)
    lowest = fast["lowest_projected_cash"]
    shortfall = fast["first_cash_shortfall"]
    aug_20 = _group_for_date(details["upcoming_groups"], AUG_20)
    transfer_after = _txn_balance_after(aug_20, "Move to credit card")

    assert shortfall is not None
    assert shortfall["date"] == AUG_20.isoformat()
    assert Decimal(shortfall["amount"]) == Decimal("-329.02")
    assert transfer_after == Decimal("-329.02")
    assert lowest is not None
    assert Decimal(lowest["amount"]) <= Decimal(shortfall["amount"])
    assert lowest["account_id"] == main.id
    assert shortfall["account_id"] == main.id


def test_no_shortfall_when_projected_balances_stay_positive(
    user, main, expense_category
):
    _txn(main, AUG_20, "Groceries", Decimal("-50.00"), expense_category)
    fast = build_dashboard_summary_fast(user, days=30, as_of_date=AS_OF)
    assert fast["first_cash_shortfall"] is None
    assert fast["lowest_projected_cash"] is not None
    assert Decimal(fast["lowest_projected_cash"]["amount"]) > 0
    assert fast["lowest_projected_cash"]["is_negative"] is False


def test_earliest_shortfall_wins_across_accounts(
    user, household, main, expense_category
):
    bills = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.BILLS,
        name="Bills",
        starting_balance=Decimal("100.00"),
        minimum_buffer=Decimal("0"),
        currency="USD",
    )
    _txn(main, AUG_21, "Main bill", Decimal("-1200.00"), expense_category)
    _txn(bills, AUG_20, "Bills hit", Decimal("-150.00"), expense_category)

    fast = build_dashboard_summary_fast(user, days=30, as_of_date=AS_OF)
    shortfall = fast["first_cash_shortfall"]
    lowest = fast["lowest_projected_cash"]

    assert shortfall is not None
    assert shortfall["account_name"] == "Bills"
    assert shortfall["date"] == AUG_20.isoformat()
    assert Decimal(shortfall["amount"]) == Decimal("-50.00")
    assert lowest is not None
    assert lowest["account_name"] == "Main"
    assert Decimal(lowest["amount"]) == Decimal("-200.00")


def test_internal_bank_transfer_affects_source_cash_once(
    user, household, main, expense_category
):
    savings = Account.objects.create(
        household=household,
        account_type=Account.AccountType.SAVINGS,
        role=Account.AccountRole.SAVINGS,
        name="Savings",
        starting_balance=Decimal("5000.00"),
        currency="USD",
    )
    create_transfer(
        user,
        from_account_id=main.id,
        to_account_id=savings.id,
        amount=Decimal("1100.00"),
        transfer_date=AUG_20,
        payee="Move to savings",
    )
    fast = build_dashboard_summary_fast(user, days=30, as_of_date=AS_OF)
    details = build_dashboard_summary_details(user, days=30, as_of_date=AS_OF)
    shortfall = fast["first_cash_shortfall"]
    lowest = fast["lowest_projected_cash"]
    aug_20 = _group_for_date(details["upcoming_groups"], AUG_20)

    assert shortfall is not None
    assert shortfall["account_name"] == "Main"
    assert Decimal(shortfall["amount"]) == Decimal("-100.00")
    assert lowest is not None
    assert Decimal(lowest["amount"]) == Decimal("-100.00")
    assert any(
        "savings" in (txn.get("description") or "").lower()
        for txn in aug_20.get("transactions") or []
    )


def test_overdue_pending_is_included_in_lowest_and_shortfall(
    user, main, expense_category
):
    """Past unmatched planned rows in the timeline must affect forecast cash."""
    _txn(main, AS_OF - timedelta(days=2), "Overdue bill", Decimal("-200.00"), expense_category)
    _txn(main, AUG_20, "Next bill", Decimal("-900.00"), expense_category)

    fast = build_dashboard_summary_fast(user, days=30, as_of_date=AS_OF)
    details = build_dashboard_summary_details(user, days=30, as_of_date=AS_OF)
    shortfall = fast["first_cash_shortfall"]
    lowest = fast["lowest_projected_cash"]
    aug_20 = _group_for_date(details["upcoming_groups"], AUG_20)
    after = _txn_balance_after(aug_20, "Next bill")

    assert after == Decimal("-100.00")
    assert shortfall is not None
    assert Decimal(shortfall["amount"]) == Decimal("-100.00")
    assert lowest is not None
    assert Decimal(lowest["amount"]) == Decimal("-100.00")


def test_empty_upcoming_still_returns_forecast_metrics(user, main):
    fast = build_dashboard_summary_fast(user, days=14, as_of_date=AS_OF)
    details = build_dashboard_summary_details(user, days=14, as_of_date=AS_OF)
    assert details["upcoming_groups"] == []
    assert fast["first_cash_shortfall"] is None
    assert fast["lowest_projected_cash"] is not None
    assert Decimal(fast["lowest_projected_cash"]["amount"]) == Decimal("1000.00")


def test_selected_forecast_window_changes_lowest_balance(
    user, main, expense_category
):
    _txn(main, AUG_20, "Near-term bill", Decimal("-50.00"), expense_category)
    _txn(main, SEP_10, "Later large bill", Decimal("-2000.00"), expense_category)

    fast_14 = build_dashboard_summary_fast(user, days=14, as_of_date=AS_OF)
    fast_30 = build_dashboard_summary_fast(user, days=30, as_of_date=AS_OF)

    assert Decimal(fast_14["lowest_projected_cash"]["amount"]) == Decimal("950.00")
    assert fast_14["first_cash_shortfall"] is None
    assert Decimal(fast_30["lowest_projected_cash"]["amount"]) == Decimal("-1050.00")
    assert fast_30["lowest_projected_cash"]["date"] == SEP_10.isoformat()
    assert fast_30["first_cash_shortfall"]["date"] == SEP_10.isoformat()


def test_action_center_first_negative_matches_dashboard_and_amount_covers_window(
    user, household, main, expense_category, income_category
):
    """Dashboard first-cash-shortfall date and Action Center move-money share one forecast."""
    from django.core.cache import cache

    from recommendations.services.calculators import (
        latest_safe_transfer_date,
        transfer_amount_to_restore,
    )
    from recommendations.services.engine import (
        build_recommendation_context,
        build_recommendations,
    )

    Account.objects.create(
        household=household,
        account_type=Account.AccountType.SAVINGS,
        role=Account.AccountRole.SAVINGS,
        name="Savings",
        starting_balance=Decimal("5000.00"),
        minimum_buffer=Decimal("0"),
        currency="USD",
    )
    _txn(main, AUG_20, "Quicksilver C/C Payment", Decimal("-329.02"), expense_category)
    _txn(main, AUG_20, "Utilities", Decimal("-712.00"), expense_category)
    _txn(main, AUG_21, "Payroll", Decimal("1835.52"), income_category)
    _txn(main, SEP_10, "Large planned bill", Decimal("-2700.00"), expense_category)

    cache.clear()
    fast = build_dashboard_summary_fast(user, days=30, as_of_date=AS_OF)
    ctx = build_recommendation_context(user, days=30, as_of_date=AS_OF)
    recs = build_recommendations(ctx, limit=20)
    move = next(
        rec for rec in recs if rec.get("type") == "move_money" and rec.get("account_id") == main.id
    )

    shortfall = fast["first_cash_shortfall"]
    assert shortfall is not None
    assert shortfall["date"] == AUG_20.isoformat()
    assert shortfall["date"] == ctx.forecasts[main.id]["first_negative_date"]
    assert "Aug 20" in move["why"]
    assert move["recommended_date"] == latest_safe_transfer_date(AUG_20, today=AS_OF).isoformat()

    needed = transfer_amount_to_restore(
        Decimal(str(ctx.forecasts[main.id]["lowest_projected_balance"])),
        Decimal(str(ctx.forecasts[main.id].get("minimum_buffer") or 0)),
    )
    assert Decimal(move["recommended_amount"]) == needed
    assert needed == Decimal("905.50")
    assert needed != abs(Decimal(shortfall["amount"]))
    assert "lowest projected balance" in move["recommended_action"]
    assert "avoid the shortfall" not in move["recommended_action"]


def test_recommendation_context_uses_reconciliation_aware_timeline(user, household):
    from unittest.mock import patch

    from django.core.cache import cache

    from recommendations.services.engine import build_recommendation_context

    cache.clear()
    with patch(
        "recommendations.services.engine.build_forecast_projection_timeline",
        return_value=[],
    ) as mock_build:
        build_recommendation_context(user, days=30, as_of_date=AS_OF)
    mock_build.assert_called_once()
    kwargs = mock_build.call_args.kwargs
    assert kwargs["today"] == AS_OF
    assert kwargs["end_date"] == AS_OF + timedelta(days=30)
