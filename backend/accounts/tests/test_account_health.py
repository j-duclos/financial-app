"""Tests for computed account health indicators."""
from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from accounts.models import Account
from accounts.services.account_health import (
    calculate_account_health,
    calculate_account_health_for_accounts,
)
from accounts.services.account_health_constants import (
    HEALTH_STATUS_CRITICAL,
    HEALTH_STATUS_HEALTHY,
    HEALTH_STATUS_RISK,
    HEALTH_STATUS_WATCH,
)
from categories.models import Category
from core.models import Household, HouseholdMembership
from django.core.cache import cache
from transactions.models import Transaction
from transactions.services.posting import post_transaction

User = get_user_model()

AS_OF = date(2025, 5, 1)


@pytest.fixture(autouse=True)
def _clear_caches():
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def user(db):
    return User.objects.create_user(username="healthuser", password="testpass123")


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="Health Household")
    HouseholdMembership.objects.create(household=h, user=user, role=HouseholdMembership.Role.OWNER)
    return h


@pytest.fixture
def auth_client(api_client, user):
    api_client.force_authenticate(user=user)
    return api_client


@pytest.fixture
def checking(db, household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        name="Main Checking",
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
        name="Visa",
        credit_limit=Decimal("5000"),
        apr=Decimal("22"),
        statement_closing_day=15,
        payment_due_day=10,
        current_balance=Decimal("0"),
        currency="USD",
    )


@pytest.fixture
def expense_category(db, household):
    return Category.objects.create(
        household=household,
        name="Rent",
        category_type=Category.CategoryType.EXPENSE,
        sort_order=1,
    )


def _health(user, account, **kwargs):
    return calculate_account_health(user, account, as_of_date=AS_OF, **kwargs)


def _set_credit_owed(user, card, owed: Decimal, as_of=AS_OF):
    """Set ledger owed via a purchase so health matches transaction balance."""
    from accounts.services.credit_card import ledger_owed_balance

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


def test_cash_healthy_above_buffer(user, checking):
    h = _health(user, checking, days=30)
    assert h["status"] == HEALTH_STATUS_HEALTHY
    assert h["score"] >= 85
    assert h["reason"] is None


def test_cash_risk_below_buffer(user, savings, expense_category):
    Transaction.objects.create(
        account=savings,
        date=AS_OF + timedelta(days=10),
        payee="Bill",
        amount=Decimal("-4600"),
        category=expense_category,
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.ONE_TIME,
    )
    h = _health(user, savings, days=30)
    assert h["status"] in (HEALTH_STATUS_RISK, HEALTH_STATUS_CRITICAL)
    assert "buffer" in (h["reason"] or "").lower()


def test_cash_critical_below_zero(user, checking, expense_category):
    Transaction.objects.create(
        account=checking,
        date=AS_OF + timedelta(days=5),
        payee="Rent",
        amount=Decimal("-1500"),
        category=expense_category,
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.ONE_TIME,
    )
    h = _health(user, checking, days=30)
    assert h["status"] == HEALTH_STATUS_CRITICAL


def test_safe_to_spend_negative_spending_critical(user, checking, expense_category):
    checking.role = Account.AccountRole.SPENDING
    checking.save()
    Transaction.objects.create(
        account=checking,
        date=AS_OF + timedelta(days=3),
        payee="Big",
        amount=Decimal("-1200"),
        category=expense_category,
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.ONE_TIME,
    )
    h = _health(user, checking, days=30)
    assert h["status"] in (HEALTH_STATUS_CRITICAL, HEALTH_STATUS_RISK)
    assert h["details"]["available_to_spend"] is not None


def test_credit_healthy_at_or_below_target_utilization(user, credit_card):
    _set_credit_owed(user, credit_card, Decimal("400"))
    h = _health(user, credit_card, days=30)
    assert h["status"] == HEALTH_STATUS_HEALTHY
    assert h["reason"] is None


def test_credit_custom_target_utilization_does_not_create_watch(user, credit_card):
    """Exceeding the user target is not itself a health severity."""
    credit_card.target_utilization_percent = Decimal("20")
    credit_card.save(update_fields=["target_utilization_percent"])
    _set_credit_owed(user, credit_card, Decimal("1000"))
    assert _health(user, credit_card, days=30, has_payment_link=True)["status"] == HEALTH_STATUS_HEALTHY
    _set_credit_owed(user, credit_card, Decimal("1100"))
    h = _health(user, credit_card, days=30, has_payment_link=True)
    assert h["status"] == HEALTH_STATUS_HEALTHY
    assert Decimal(h["details"]["target_utilization_percent"]) == Decimal("20")
    assert h["reason_code"] == "utilization_above_target"
    assert "Above 20% target" in (h["reason"] or "")


def test_credit_utilization_watch(user, credit_card):
    _set_credit_owed(user, credit_card, Decimal("2500"))
    h = _health(user, credit_card, days=30)
    assert h["status"] == HEALTH_STATUS_WATCH
    assert h["reason_code"] == "high_utilization"
    assert "High utilization" in (h["reason"] or "")
    assert "Above 10% target" in (h["reason"] or "")


def test_credit_utilization_risk(user, credit_card):
    _set_credit_owed(user, credit_card, Decimal("3600"))
    h = _health(user, credit_card, days=30)
    assert h["status"] == HEALTH_STATUS_RISK
    assert h["reason_code"] == "high_utilization"
    assert "High utilization" in (h["reason"] or "")


def test_credit_high_utilization_is_not_critical(user, credit_card):
    """98% utilization vs a 10% target is At Risk (near limit), not Critical."""
    _set_credit_owed(user, credit_card, Decimal("4900"))
    h = _health(user, credit_card, days=30)
    assert h["status"] == HEALTH_STATUS_RISK
    assert h["status"] != HEALTH_STATUS_CRITICAL
    assert h["reason_code"] == "near_limit"
    assert "Near limit" in (h["reason"] or "")
    assert "Above 10% target" in (h["reason"] or "")


def test_credit_utilization_watch_at_absolute_floor(user, credit_card):
    _set_credit_owed(user, credit_card, Decimal("3400"))
    h = _health(user, credit_card, days=30)
    assert h["status"] == HEALTH_STATUS_WATCH
    assert h["reason_code"] == "high_utilization"
    assert "High utilization" in (h["reason"] or "")
    assert "Above 10% target" in (h["reason"] or "")


def test_credit_health_uses_ledger_not_stale_db_balance(user, credit_card):
    """Health reason utilization must match ledger when current_balance is stale."""
    _set_credit_owed(user, credit_card, Decimal("2500"))
    Account.objects.filter(pk=credit_card.pk).update(current_balance=Decimal("4600"))
    credit_card.refresh_from_db()
    h = _health(user, credit_card, days=30)
    assert h["reason_code"] == "high_utilization"
    assert "92" not in (h["reason"] or "")
    assert h["details"]["utilization_percent"] == "50.00"


def test_credit_over_limit_is_critical(user, credit_card):
    _set_credit_owed(user, credit_card, Decimal("5200"))
    h = _health(user, credit_card, days=30)
    assert h["status"] == HEALTH_STATUS_CRITICAL
    assert "limit" in (h["reason"] or "").lower()


def test_credit_target_change_does_not_make_utilization_critical(user, credit_card):
    _set_credit_owed(user, credit_card, Decimal("3600"))
    credit_card.target_utilization_percent = Decimal("10")
    credit_card.save(update_fields=["target_utilization_percent"])
    h10 = _health(user, credit_card, days=30)
    credit_card.target_utilization_percent = Decimal("30")
    credit_card.save(update_fields=["target_utilization_percent"])
    h30 = _health(user, credit_card, days=30)
    assert h10["status"] == HEALTH_STATUS_RISK
    assert h30["status"] == HEALTH_STATUS_RISK
    assert h10["status"] != HEALTH_STATUS_CRITICAL
    assert "Above 10% target" in (h10["reason"] or "")
    assert "Above 30% target" in (h30["reason"] or "")
    assert "Reduce card utilization toward your 10% target." in (h10["recommended_action"] or "")
    assert "Reduce card utilization toward your 30% target." in (h30["recommended_action"] or "")


def test_credit_planned_payment_below_interest_is_actionable_not_critical(user, credit_card):
    _set_credit_owed(user, credit_card, Decimal("2000"))
    Account.objects.filter(pk=credit_card.pk).update(
        current_balance=Decimal("2000"),
        minimum_payment_amount=Decimal("25"),
        statement_balance=Decimal("0"),
        apr=Decimal("24"),
        next_payment_due_date=AS_OF + timedelta(days=20),
        autopay_enabled=False,
    )
    credit_card.refresh_from_db()
    h = _health(user, credit_card, days=30)
    assert h["status"] != HEALTH_STATUS_CRITICAL
    assert h["details"].get("payoff_impossible") is True
    assert h["details"].get("estimated_monthly_interest") is not None
    assert Decimal(h["details"]["estimated_monthly_interest"]) > Decimal("25")
    reason = h["reason"] or ""
    action = h["recommended_action"] or ""
    blob = f"{reason} {action}"
    assert "interest" in blob.lower() or "principal" in blob.lower()
    assert "25" in blob or "~$" in blob or "at least" in blob.lower()


def test_forecast_window_changes_projected_overdraft(user, checking, expense_category):
    Transaction.objects.create(
        account=checking,
        date=AS_OF + timedelta(days=20),
        payee="Rent",
        amount=Decimal("-1500"),
        category=expense_category,
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.ONE_TIME,
    )
    near = _health(user, checking, days=7)
    far = _health(user, checking, days=30)
    assert near["status"] == HEALTH_STATUS_HEALTHY
    assert far["status"] == HEALTH_STATUS_CRITICAL


def test_credit_due_within_7_days_watch(user, credit_card):
    _set_credit_owed(user, credit_card, Decimal("100"))
    Account.objects.filter(pk=credit_card.pk).update(
        current_balance=Decimal("100"),
        statement_balance=Decimal("100"),
        last_statement_date=AS_OF - timedelta(days=30),
        next_payment_due_date=AS_OF + timedelta(days=5),
        apr=Decimal("0"),
        autopay_enabled=False,
    )
    credit_card.refresh_from_db()
    h = _health(user, credit_card, days=30)
    assert h["status"] in (HEALTH_STATUS_WATCH, HEALTH_STATUS_RISK)
    assert "due" in (h["reason"] or "").lower()


def test_credit_due_within_3_days_risk(user, credit_card):
    _set_credit_owed(user, credit_card, Decimal("500"))
    Account.objects.filter(pk=credit_card.pk).update(
        current_balance=Decimal("500"),
        statement_balance=Decimal("500"),
        last_statement_date=AS_OF - timedelta(days=30),
        next_payment_due_date=AS_OF + timedelta(days=2),
        apr=Decimal("0"),
        autopay_enabled=False,
    )
    credit_card.refresh_from_db()
    h = _health(user, credit_card, days=30)
    assert h["status"] in (HEALTH_STATUS_RISK, HEALTH_STATUS_CRITICAL)
    assert "due" in (h["reason"] or "").lower()


def test_credit_past_due_critical(user, credit_card):
    _set_credit_owed(user, credit_card, Decimal("300"))
    Account.objects.filter(pk=credit_card.pk).update(
        current_balance=Decimal("300"),
        statement_balance=Decimal("300"),
        last_statement_date=AS_OF - timedelta(days=35),
        next_payment_due_date=AS_OF - timedelta(days=2),
        autopay_enabled=False,
    )
    credit_card.refresh_from_db()
    h = _health(user, credit_card, days=30)
    assert h["status"] == HEALTH_STATUS_CRITICAL
    assert "past due" in (h["reason"] or "").lower()


def test_credit_stale_due_date_is_not_permanently_critical(user, credit_card):
    _set_credit_owed(user, credit_card, Decimal("300"))
    Account.objects.filter(pk=credit_card.pk).update(
        current_balance=Decimal("300"),
        statement_balance=Decimal("0"),
        minimum_payment_amount=Decimal("0"),
        last_statement_date=AS_OF - timedelta(days=90),
        next_payment_due_date=AS_OF - timedelta(days=60),
        autopay_enabled=False,
    )
    credit_card.refresh_from_db()
    h = _health(user, credit_card, days=30)
    assert h["status"] == HEALTH_STATUS_WATCH
    assert h["reason_code"] == "due_date_stale"
    assert h["details"].get("payment_due_is_stale") is True
    assert "outdated" in (h["reason"] or "").lower()
    assert "past due" not in (h["reason"] or "").lower()


def test_credit_near_zero_owed_stale_due_is_healthy(user, credit_card):
    """Pocket-change balances must not trigger stale-due / missing-link watches."""
    _set_credit_owed(user, credit_card, Decimal("8.28"))
    Account.objects.filter(pk=credit_card.pk).update(
        current_balance=Decimal("8.28"),
        credit_limit=Decimal("2000"),
        statement_balance=Decimal("0"),
        minimum_payment_amount=Decimal("30"),
        last_statement_date=AS_OF - timedelta(days=90),
        next_payment_due_date=AS_OF - timedelta(days=60),
        autopay_enabled=False,
        apr=Decimal("31.99"),
    )
    credit_card.refresh_from_db()
    h = _health(user, credit_card, days=30, has_payment_link=False)
    assert h["status"] == HEALTH_STATUS_HEALTHY
    assert h["reason_code"] in (None, "utilization_above_target")


def test_cash_low_nominal_balance_without_forecast_pressure_is_healthy(user, checking):
    """A $40 balance with no projected shortfall is not Watch."""
    Account.objects.filter(pk=checking.pk).update(
        starting_balance=Decimal("40.15"),
        minimum_buffer=Decimal("0"),
    )
    checking.refresh_from_db()
    h = _health(user, checking, days=30)
    assert h["status"] == HEALTH_STATUS_HEALTHY
    assert h["reason_code"] is None


def test_cash_projected_negative_exposes_reason_code(user, checking, expense_category):
    Transaction.objects.create(
        account=checking,
        date=AS_OF + timedelta(days=4),
        payee="Large bill",
        amount=Decimal("-5000"),
        category=expense_category,
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.ONE_TIME,
    )
    h = _health(user, checking, days=30)
    assert h["status"] == HEALTH_STATUS_CRITICAL
    assert h["reason_code"] == "forecast_negative"
    assert "Projected negative" in (h["reason"] or "")
    assert h["risk_date"] is not None


def test_credit_past_due_is_critical_not_utilization(user, credit_card):
    _set_credit_owed(user, credit_card, Decimal("1070"))
    Account.objects.filter(pk=credit_card.pk).update(
        current_balance=Decimal("1070"),
        credit_limit=Decimal("4800"),
        statement_balance=Decimal("1070"),
        minimum_payment_amount=Decimal("63"),
        next_payment_due_date=AS_OF - timedelta(days=34),
        last_statement_date=AS_OF - timedelta(days=10),
        autopay_enabled=False,
    )
    credit_card.refresh_from_db()
    h = _health(user, credit_card, days=30, has_payment_link=True)
    assert h["status"] == HEALTH_STATUS_CRITICAL
    assert h["reason_code"] == "payment_past_due"
    assert "past due" in (h["reason"] or "").lower()


def test_savings_below_buffer_risk(user, savings, expense_category):
    Transaction.objects.create(
        account=savings,
        date=AS_OF + timedelta(days=8),
        payee="Withdrawal",
        amount=Decimal("-4800"),
        category=expense_category,
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.ONE_TIME,
    )
    h = _health(user, savings, days=30)
    assert h["status"] in (HEALTH_STATUS_RISK, HEALTH_STATUS_CRITICAL)


def test_unknown_account_type_returns_valid_health(user, household):
    other = Account.objects.create(
        household=household,
        account_type=Account.AccountType.OTHER,
        role=Account.AccountRole.OTHER,
        name="Misc",
        starting_balance=Decimal("100"),
    )
    h = _health(user, other, days=30)
    assert h["status"] in (
        HEALTH_STATUS_HEALTHY,
        HEALTH_STATUS_WATCH,
        HEALTH_STATUS_RISK,
        HEALTH_STATUS_CRITICAL,
    )
    assert 0 <= h["score"] <= 100


def test_batch_health_single_timeline(user, checking, savings, credit_card):
    accounts = [checking, savings, credit_card]
    with CaptureQueriesContext(connection) as ctx:
        result = calculate_account_health_for_accounts(
            user, accounts, as_of_date=AS_OF, days=30
        )
    assert len(result) == 3
    assert all("status" in result[a.id] for a in accounts)
    query_count = len(ctx.captured_queries)
    assert query_count < 55


def test_health_api_list(auth_client, checking):
    r = auth_client.get("/api/accounts/?health=true&days=30&balance=true")
    assert r.status_code == 200
    data = r.json()
    acc = next(a for a in data["results"] if a["id"] == checking.id)
    assert acc["health_status"] == HEALTH_STATUS_HEALTHY
    assert acc["health_score"] is not None


def test_health_batch_endpoint(auth_client, checking, credit_card):
    r = auth_client.get("/api/accounts/health/?days=30")
    assert r.status_code == 200
    body = r.json()
    assert "accounts" in body
    assert "accounts_needing_attention_count" in body
    assert len(body["accounts"]) >= 2


def test_dashboard_includes_health_aggregate(auth_client, checking):
    r = auth_client.get("/api/accounts/safe-to-spend-dashboard/?days=30")
    assert r.status_code == 200
    body = r.json()
    assert "critical_accounts_count" in body
    assert "accounts_needing_attention_count" in body
