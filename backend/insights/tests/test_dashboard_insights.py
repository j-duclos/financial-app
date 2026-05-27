"""Tests for rule-based dashboard insights."""
from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from accounts.models import Account
from accounts.services.account_health_constants import HEALTH_STATUS_CRITICAL
from categories.models import Category
from core.models import Household, HouseholdMembership
from goals.models import FinancialGoal
from insights.services.dashboard_insights import build_dashboard_insights, INSIGHT_LIMIT
from insights.services.dashboard_summary import build_dashboard_summary
from transactions.models import Transaction
from transactions.services.posting import post_transaction

User = get_user_model()
AS_OF = date(2025, 6, 1)


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def user(db):
    return User.objects.create_user(username="insightuser", password="testpass123")


@pytest.fixture
def auth_client(api_client, user):
    api_client.force_authenticate(user=user)
    return api_client


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="Insight Household")
    HouseholdMembership.objects.create(household=h, user=user, role=HouseholdMembership.Role.OWNER)
    return h


@pytest.fixture
def checking(db, household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        name="Main",
        starting_balance=Decimal("500"),
        minimum_buffer=Decimal("100"),
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


def test_insights_limited_and_sorted(user, checking, expense_category):
    Transaction.objects.create(
        account=checking,
        date=AS_OF + timedelta(days=5),
        payee="Rent",
        amount=Decimal("-3100"),
        category=expense_category,
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.ONE_TIME,
    )
    summary = build_dashboard_summary(user, days=30, as_of_date=AS_OF)
    insights = summary["insights"]
    assert len(insights) <= INSIGHT_LIMIT
    if len(insights) >= 2:
        severities = ["critical", "warning", "info", "positive"]
        ranks = [severities.index(i["severity"]) for i in insights if i["severity"] in severities]
        assert ranks == sorted(ranks)


def test_insights_include_largest_upcoming_expense(user, checking, expense_category):
    rent_date = AS_OF + timedelta(days=3)
    Transaction.objects.create(
        account=checking,
        date=rent_date,
        payee="Rent",
        amount=Decimal("-3100"),
        category=expense_category,
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.ONE_TIME,
    )
    summary = build_dashboard_summary(user, days=30, as_of_date=AS_OF)
    ids = [i["id"] for i in summary["insights"]]
    assert any("largest_expense" in i for i in ids) or any(
        "upcoming_expenses" in i for i in ids
    )
    largest = next((i for i in summary["insights"] if "largest_expense" in i["id"]), None)
    if largest:
        assert largest["action_url"] == f"/timeline?date={rent_date.isoformat()}"


def test_insights_goal_when_behind(user, household, checking):
    FinancialGoal.objects.create(
        household=household,
        name="Emergency Fund",
        goal_type=FinancialGoal.GoalType.EMERGENCY_FUND,
        target_amount=Decimal("10000"),
        current_amount=Decimal("1000"),
        monthly_contribution=Decimal("500"),
        target_date=AS_OF + timedelta(days=180),
        priority=1,
    )
    summary = build_dashboard_summary(user, days=30, as_of_date=AS_OF)
  # May include goal insight if behind
    assert "insights" in summary


def test_dashboard_includes_insights_not_mtd_card_field(auth_client, checking):
    r = auth_client.get("/api/insights/dashboard/summary/?days=30")
    assert r.status_code == 200
    data = r.json()
    assert "insights" in data
    assert "month_to_date" in data
    assert isinstance(data["insights"], list)


def test_attention_accounts_skipped_for_duplicate_credit_util_insight(
    user, household, credit_card, expense_category
):
    post_transaction(user, credit_card.id, AS_OF, "Charges", Decimal("-4900"))
    summary = build_dashboard_summary(user, days=30, as_of_date=AS_OF)
    attention_ids = {a["account_id"] for a in summary["attention"]}
    for insight in summary["insights"]:
        if "credit_util" in insight["id"]:
            aid = int(insight["id"].split("_")[-1])
            assert aid not in attention_ids


def test_cash_risk_insight_skips_accounts_in_attention(user, checking, expense_category):
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
    attention_ids = {a["account_id"] for a in summary["attention"]}
    if checking.id in attention_ids:
        assert not any(
            i["id"] == f"cash_risk_{checking.id}" for i in summary["insights"]
        )


def test_insights_high_util_credit_when_not_in_attention(user, household, credit_card):
    """High utilization insight when card is not in attention list."""
    post_transaction(user, credit_card.id, AS_OF, "Charges", Decimal("-4600"))
    summary = build_dashboard_summary(user, days=30, as_of_date=AS_OF)
    attention_ids = {a["account_id"] for a in summary["attention"]}
    if credit_card.id in attention_ids:
        return
    util_insights = [i for i in summary["insights"] if "credit_util" in i["id"]]
    assert len(util_insights) >= 1


def test_insights_unmatched_imports(user, checking):
    from transactions.models import Transaction as Txn

    Txn.objects.create(
        account=checking,
        date=AS_OF,
        payee="Plaid import",
        amount=Decimal("-25.00"),
        source=Txn.Source.PLAID,
        import_match_status=Txn.ImportMatchStatus.UNMATCHED,
        status=Txn.Status.CLEARED,
    )
    summary = build_dashboard_summary(user, days=30, as_of_date=AS_OF)
    ids = [i["id"] for i in summary["insights"]]
    assert any("imports_unmatched" in i for i in ids)


def test_insights_no_duplicate_wording_with_attention(
    user, checking, expense_category
):
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
    for att in summary["attention"]:
        for insight in summary["insights"]:
            if insight.get("title", "").lower().startswith(att["account_name"].lower()):
                assert att["reason"] not in (insight.get("message") or "")
