"""Tests for dashboard summary endpoint and service."""
from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from accounts.models import Account
from accounts.services.account_health_constants import (
    HEALTH_STATUS_CRITICAL,
    HEALTH_STATUS_WATCH,
)
from accounts.services.balances import compute_net_worth, signed_ledger_balance
from categories.models import Category
from core.models import Household, HouseholdMembership
from insights.services.dashboard_summary import (
    ATTENTION_TOP_LIMIT,
    build_attention_items,
    build_dashboard_summary,
)
from transactions.models import Transaction

User = get_user_model()

AS_OF = date(2025, 5, 1)


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def user(db):
    return User.objects.create_user(username="dashuser", password="testpass123")


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="Dash Household")
    HouseholdMembership.objects.create(household=h, user=user, role=HouseholdMembership.Role.OWNER)
    return h


@pytest.fixture
def auth_client(api_client, user):
    api_client.force_authenticate(user=user)
    return api_client


@pytest.fixture
def expense_category(db, household):
    return Category.objects.create(
        household=household,
        name="Rent",
        category_type=Category.CategoryType.EXPENSE,
        sort_order=1,
    )


@pytest.fixture
def checking(db, household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        name="Main",
        starting_balance=Decimal("1000"),
        minimum_buffer=Decimal("200"),
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
        minimum_buffer=Decimal("500"),
        currency="USD",
    )


@pytest.fixture
def credit_card(db, household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        role=Account.AccountRole.CREDIT_CARD,
        name="Venture",
        credit_limit=Decimal("5000"),
        current_balance=Decimal("3900"),
        apr=Decimal("22"),
        payment_due_day=10,
        next_payment_due_date=AS_OF + timedelta(days=5),
        currency="USD",
    )


def test_dashboard_summary_api_returns_safe_to_spend(auth_client, checking):
    r = auth_client.get("/api/insights/dashboard/summary/?days=30")
    assert r.status_code == 200
    data = r.json()
    assert "safe_to_spend" in data
    assert data["safe_to_spend"]["window_days"] == 30
    assert "amount" in data["safe_to_spend"]
    assert data["safe_to_spend"]["status"] in ("healthy", "watch", "critical")


def test_attention_limited_to_top_three(auth_client, checking, savings, credit_card, expense_category):
    Transaction.objects.create(
        account=checking,
        date=AS_OF + timedelta(days=5),
        payee="Rent",
        amount=Decimal("-1500"),
        category=expense_category,
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.ONE_TIME,
    )
    Transaction.objects.create(
        account=savings,
        date=AS_OF + timedelta(days=10),
        payee="Bill",
        amount=Decimal("-4600"),
        category=expense_category,
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.ONE_TIME,
    )
    r = auth_client.get("/api/insights/dashboard/summary/?days=30")
    assert r.status_code == 200
    attention = r.json()["attention"]
    assert len(attention) <= ATTENTION_TOP_LIMIT


def test_critical_accounts_sort_before_watch(
    user, checking, savings, credit_card, expense_category
):
    Transaction.objects.create(
        account=checking,
        date=AS_OF + timedelta(days=5),
        payee="Rent",
        amount=Decimal("-1500"),
        category=expense_category,
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.ONE_TIME,
    )
    credit_card.current_balance = Decimal("4000")
    credit_card.save()
    summary = build_dashboard_summary(user, days=30, as_of_date=AS_OF)
    attention = summary["attention"]
    if len(attention) >= 2:
        severities = {"critical": 3, "risk": 2, "watch": 1, "healthy": 0}
        assert severities[attention[0]["status"]] >= severities[attention[1]["status"]]


def test_upcoming_sorted_by_date(auth_client, checking, expense_category):
    today = date.today()
    Transaction.objects.create(
        account=checking,
        date=today + timedelta(days=3),
        payee="Later bill",
        amount=Decimal("-100"),
        category=expense_category,
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.ONE_TIME,
    )
    Transaction.objects.create(
        account=checking,
        date=today + timedelta(days=1),
        payee="Soon bill",
        amount=Decimal("-50"),
        category=expense_category,
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.ONE_TIME,
    )
    r = auth_client.get("/api/insights/dashboard/summary/?days=30")
    groups = r.json()["upcoming_groups"]
    dates = [g["date"] for g in groups]
    assert dates == sorted(dates)
    assert "income_total" in groups[0]
    assert "net_total" in groups[0]


def test_net_worth_uses_ledger_balances_not_all_transactions(
    auth_client, checking, savings, credit_card, expense_category
):
    today = date.today()
    Transaction.objects.create(
        account=checking,
        date=today,
        payee="Today spend",
        amount=Decimal("-50"),
        status=Transaction.Status.CLEARED,
        source=Transaction.Source.ONE_TIME,
    )
    Transaction.objects.create(
        account=checking,
        date=today + timedelta(days=400),
        payee="Future income",
        amount=Decimal("100000"),
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.ONE_TIME,
    )
    r = auth_client.get("/api/insights/dashboard/summary/?days=30")
    assert r.status_code == 200
    net_worth = Decimal(r.json()["net_worth"])
    accounts = list(
        Account.objects.for_net_worth().filter(household=checking.household, is_hidden=False)
    )
    expected = compute_net_worth(accounts, today)
    assert net_worth == expected.quantize(Decimal("0.01"))
    assert net_worth < Decimal("10000")


def test_snapshot_totals_match_accounts(auth_client, checking, savings, credit_card, expense_category):
    Transaction.objects.create(
        account=credit_card,
        date=date.today(),
        payee="Purchase",
        amount=Decimal("-3900"),
        category=expense_category,
        status=Transaction.Status.CLEARED,
        source=Transaction.Source.ONE_TIME,
    )
    credit_card.current_balance = Decimal("3900")
    credit_card.save(update_fields=["current_balance"])
    r = auth_client.get("/api/insights/dashboard/summary/?days=30")
    snap = r.json()["snapshot"]
    cash = Decimal(snap["cash"])
    savings_total = Decimal(snap["savings"])
    credit_debt = Decimal(snap["credit_debt"])
    net_position = Decimal(snap["net_position"])
    assert net_position == cash - credit_debt
    assert savings_total == Decimal("5000")
    assert credit_debt > 0
    assert "cash_change_pct" in snap
    assert "utilization" in snap or snap.get("utilization") is None
    assert "top_summary" in r.json()
    assert "liquid_cash" in r.json()["top_summary"]
    assert "recommendations" in r.json()


def test_mtd_net_equals_income_minus_expenses(auth_client, checking, expense_category):
    today = date.today()
    Transaction.objects.create(
        account=checking,
        date=today,
        payee="Paycheck",
        amount=Decimal("2000"),
        status=Transaction.Status.CLEARED,
        source=Transaction.Source.ONE_TIME,
    )
    Transaction.objects.create(
        account=checking,
        date=today,
        payee="Groceries",
        amount=Decimal("-300"),
        category=expense_category,
        status=Transaction.Status.CLEARED,
        source=Transaction.Source.ONE_TIME,
    )
    r = auth_client.get("/api/insights/dashboard/summary/?days=30")
    mtd = r.json()["month_to_date"]
    income = Decimal(mtd["income"])
    expenses = Decimal(mtd["expenses"])
    net = Decimal(mtd["net"])
    assert net == income - expenses


def test_changing_days_changes_safe_to_spend_window(auth_client, checking):
    r30 = auth_client.get("/api/insights/dashboard/summary/?days=30")
    r7 = auth_client.get("/api/insights/dashboard/summary/?days=7")
    assert r30.json()["safe_to_spend"]["window_days"] == 30
    assert r7.json()["safe_to_spend"]["window_days"] == 7


def test_build_attention_items_prioritizes_critical(user, checking, savings, expense_category):
    Transaction.objects.create(
        account=checking,
        date=AS_OF + timedelta(days=5),
        payee="Rent",
        amount=Decimal("-1500"),
        category=expense_category,
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.ONE_TIME,
    )
    from accounts.services.account_health import calculate_account_health_for_accounts
    from accounts.services.available_to_spend import calculate_forecast_summaries_for_accounts

    accounts = [checking, savings]
    accounts_by_id = {a.id: a for a in accounts}
    forecasts = calculate_forecast_summaries_for_accounts(
        user, accounts, as_of_date=AS_OF, days=30
    )
    health_by_id = calculate_account_health_for_accounts(
        user, accounts, as_of_date=AS_OF, days=30
    )
    items = build_attention_items(
        health_by_id, accounts_by_id, forecasts, limit=3, today=AS_OF
    )
    assert len(items) <= 3
    if items:
        assert items[0]["status"] in (HEALTH_STATUS_CRITICAL, HEALTH_STATUS_WATCH)


def test_healthy_accounts_return_empty_attention(auth_client, checking):
    r = auth_client.get("/api/insights/dashboard/summary/?days=30")
    assert r.status_code == 200
    assert r.json()["attention"] == []
    assert r.json()["attention_total_count"] == 0


def test_attention_excludes_generic_watch_without_amount(user, checking):
    from accounts.services.account_health import calculate_account_health_for_accounts
    from accounts.services.available_to_spend import calculate_forecast_summaries_for_accounts

    accounts = [checking]
    accounts_by_id = {a.id: a for a in accounts}
    forecasts = calculate_forecast_summaries_for_accounts(
        user, accounts, as_of_date=AS_OF, days=30
    )
    health_by_id = calculate_account_health_for_accounts(
        user, accounts, as_of_date=AS_OF, days=30
    )
    health = health_by_id.get(checking.id, {})
    if health.get("status") != "watch":
        return
    health_by_id[checking.id] = {
        **health,
        "status": "watch",
        "reason": "Balance trending down in forecast window",
        "recommended_action": "Review upcoming activity on this account.",
    }
    items = build_attention_items(
        health_by_id, accounts_by_id, forecasts, limit=10, today=AS_OF
    )
    assert not any(i["account_id"] == checking.id for i in items)


def test_attention_cash_shortfall_action(user, checking, expense_category):
    Transaction.objects.create(
        account=checking,
        date=AS_OF + timedelta(days=5),
        payee="Rent",
        amount=Decimal("-2500"),
        category=expense_category,
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.ONE_TIME,
    )
    summary = build_dashboard_summary(user, days=30, as_of_date=AS_OF)
    attention = [a for a in summary["attention"] if a["account_id"] == checking.id]
    assert len(attention) == 1
    item = attention[0]
    assert item["status"] == HEALTH_STATUS_CRITICAL
    action = item["recommended_action"] or ""
    assert "Move $" in action or "Add $" in action
    assert item["amount"] is not None
    assert item["primary_action"]["type"] == "open_ledger"
    assert item["secondary_action"]["type"] == "move_money"


def _set_credit_owed(user, card, owed: Decimal, as_of=AS_OF):
    from accounts.services.credit_card import ledger_owed_balance

    from transactions.services.posting import post_transaction

    current = ledger_owed_balance(card, as_of)
    delta = Decimal(str(owed)) - current
    if delta == 0:
        return
    post_transaction(
        user,
        card.id,
        as_of,
        "Test balance",
        -delta if delta > 0 else abs(delta),
    )
    card.refresh_from_db()


def test_attention_credit_utilization_action(user, credit_card):
    _set_credit_owed(user, credit_card, Decimal("4900"))
    summary = build_dashboard_summary(user, days=30, as_of_date=AS_OF)
    attention = [a for a in summary["attention"] if a["account_id"] == credit_card.id]
    assert len(attention) == 1
    item = attention[0]
    assert "Utilization" in item["reason"]
    assert item.get("target_utilization_percent") is not None
    assert item["secondary_action"]["type"] == "make_payment"
    assert item["secondary_action"]["label"] == "Make payment"
    action = item["recommended_action"] or ""
    assert "Pay $" in action
    assert "utilization target" in action.lower()
    assert item["amount"] is not None


def test_attention_earliest_risk_date_within_same_severity(
    user, checking, savings, expense_category
):
    Transaction.objects.create(
        account=checking,
        date=AS_OF + timedelta(days=12),
        payee="Later rent",
        amount=Decimal("-1500"),
        category=expense_category,
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.ONE_TIME,
    )
    Transaction.objects.create(
        account=savings,
        date=AS_OF + timedelta(days=4),
        payee="Soon bill",
        amount=Decimal("-4600"),
        category=expense_category,
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.ONE_TIME,
    )
    summary = build_dashboard_summary(user, days=30, as_of_date=AS_OF)
    attention = summary["attention"]
    assert len(attention) >= 2
    same_status = [a for a in attention if a["status"] == attention[0]["status"]]
    if len(same_status) >= 2:
        dates = [a["risk_date"] for a in same_status if a.get("risk_date")]
        if len(dates) >= 2:
            assert dates == sorted(dates)


def test_attention_items_include_account_metadata(user, credit_card):
    _set_credit_owed(user, credit_card, Decimal("4500"))
    summary = build_dashboard_summary(user, days=30, as_of_date=AS_OF)
    assert summary["attention"]
    item = summary["attention"][0]
    assert item["account_role"] == credit_card.role
    assert item["account_type"] == credit_card.account_type
    assert item["url"].startswith("/accounts?account=")
