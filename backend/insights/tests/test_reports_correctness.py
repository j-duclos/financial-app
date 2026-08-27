"""Correctness tests for monthly Reports: dates, goals window, comparisons."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from insights.tests.test_reports_query_efficiency import seed_reports_world
from transactions.models import Transaction


@pytest.fixture
def auth_client(api_client, user):
    api_client.force_authenticate(user=user)
    return api_client

REPORT_MONTHS = ["2026-08", "2025-06", "2026-01", "2026-12", "2024-02"]


@pytest.mark.django_db
@pytest.mark.parametrize("month", REPORT_MONTHS)
def test_all_report_sections_use_selected_month(auth_client, household, user, month):
    seed_reports_world(household, user)
    unified = auth_client.get(f"/api/insights/reports/monthly/?month={month}&months=12")
    assert unified.status_code == 200, unified.content[:400]
    body = unified.json()
    assert body["month"] == month
    assert body["overview"]["month"] == month
    assert body["category_breakdown"]["month"] == month
    assert body["goals"]["report_month"] == month
    assert body["debt"]["month"] == month
    assert body["spending_limits"]["anchor_date"].startswith(month)
    assert body["period"]["end"].startswith(month)

    summary = auth_client.get(f"/api/insights/monthly-summary/?month={month}")
    assert summary.status_code == 200
    assert summary.json()["month"] == month

    cats = auth_client.get(f"/api/insights/category-breakdown/?month={month}")
    assert cats.status_code == 200
    assert cats.json()["month"] == month

    goals = auth_client.get(f"/api/buckets/reports/?months=12&month={month}")
    assert goals.status_code == 200
    assert goals.json()["report_month"] == month
    assert goals.json()["history_end"].startswith(month)

    debt = auth_client.get(f"/api/credit-cards/interest-report/?month={month}")
    assert debt.status_code == 200
    assert debt.json()["month"] == month


@pytest.mark.django_db
def test_august_2026_goals_history_excludes_future_as_actual(auth_client, household, user):
    seed_reports_world(household, user)
    res = auth_client.get("/api/buckets/reports/?months=12&month=2026-08")
    assert res.status_code == 200
    data = res.json()
    assert data["history_start"] == "2025-09-01"
    assert data["history_end"] == "2026-08-31"
    actual_months = {row["month"] for row in data["monthly_funding"]}
    assert "2026-11" not in actual_months
    assert all(row["kind"] == "actual" for row in data["monthly_funding"])
    assert "2026-05" in actual_months
    assert "2026-08" in actual_months
    projected_months = {row["month"] for row in data["projected_monthly_funding"]}
    assert "2026-11" in projected_months
    assert all(row["kind"] == "projected" for row in data["projected_monthly_funding"])
    july = next(row for row in data["monthly_funding"] if row["month"] == "2026-07")
    assert Decimal(july["total"]) == Decimal("-50.00")
    assert Decimal(july["released"]) == Decimal("50.00")
    assert Decimal(july["contributed"]) == Decimal("0.00")
    assert data["contribution_history"] == []


@pytest.mark.django_db
def test_goals_raw_history_optional_and_bounded(auth_client, household, user):
    seed_reports_world(household, user)
    res = auth_client.get(
        "/api/buckets/reports/?months=12&month=2026-08&include_history=true"
    )
    assert res.status_code == 200
    history = res.json()["contribution_history"]
    assert history
    dates = {row["date"] for row in history}
    assert "2026-11-10" not in dates
    assert "2026-08-10" in dates


@pytest.mark.django_db
def test_monthly_summary_comparison_previous_month(auth_client, household, user):
    seed_reports_world(household, user)
    res = auth_client.get("/api/insights/monthly-summary/?month=2026-08")
    assert res.status_code == 200
    data = res.json()
    assert Decimal(data["total_income"]) == Decimal("3900.00")
    assert Decimal(data["total_expenses"]) == Decimal("-2102.40")
    assert Decimal(data["net"]) == Decimal("1797.60")
    assert data["previous_month"] == "2026-07"
    income_cmp = data["comparison"]["total_income"]
    assert Decimal(income_cmp["previous"]) == Decimal("3400.00")
    assert Decimal(income_cmp["delta"]) == Decimal("500.00")


@pytest.mark.django_db
def test_category_breakdown_includes_previous_delta(auth_client, household, user):
    seed_reports_world(household, user)
    res = auth_client.get("/api/insights/category-breakdown/?month=2026-08")
    assert res.status_code == 200
    by_name = {row["category_name"]: row for row in res.json()["breakdown"]}
    groceries = by_name["Groceries"]
    assert Decimal(groceries["total"]) == Decimal("-220.00")
    assert Decimal(groceries["previous_total"]) == Decimal("-310.00")
    assert Decimal(groceries["delta"]) == Decimal("90.00")


@pytest.mark.django_db
def test_unified_monthly_reports_payload(auth_client, household, user):
    seed_reports_world(household, user)
    res = auth_client.get("/api/insights/reports/monthly/?month=2026-08&months=12")
    assert res.status_code == 200
    data = res.json()
    assert data["month"] == "2026-08"
    assert Decimal(data["overview"]["total_income"]) == Decimal("3900.00")
    assert len(data["overview"]["trend"]) == 12
    assert data["overview"]["trend"][0]["month"] == "2025-09"
    assert data["overview"]["trend"][-1]["month"] == "2026-08"
    assert data["goals"]["monthly_funding"]
    assert data["spending_limits"]["targets"]
    assert Decimal(data["debt"]["total_interest_paid"]) == Decimal("18.40")
    assert data["overview"]["top_expense_categories"]


@pytest.mark.django_db
def test_uncategorized_category_label(auth_client, household, user, account):
    Transaction.objects.create(
        account=account, date=date(2026, 8, 4), payee="Mystery", amount=Decimal("-12.00")
    )
    res = auth_client.get("/api/insights/category-breakdown/?month=2026-08")
    assert res.status_code == 200
    names = {row["category_name"] for row in res.json()["breakdown"]}
    assert "Uncategorized" in names


@pytest.mark.django_db
def test_monthly_reports_exclude_credit_card_payment_transfers(auth_client, household, account):
    """Paired CC payments must not double-count purchase + payment as two expenses."""
    from accounts.models import Account
    from categories.models import Category
    from transactions.models import TransferGroup

    card = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        role=Account.AccountRole.CREDIT_CARD,
        name="Visa",
        starting_balance=Decimal("0"),
        currency="USD",
        include_in_forecast=True,
    )
    groceries, _ = Category.objects.get_or_create(
        household=household,
        name="Groceries",
        category_type=Category.CategoryType.EXPENSE,
        defaults={"sort_order": 1},
    )
    cc_pay, _ = Category.objects.get_or_create(
        household=household,
        name="Credit Card Payment",
        category_type=Category.CategoryType.EXPENSE,
        defaults={"sort_order": 98},
    )
    Transaction.objects.create(
        account=card,
        date=date(2026, 8, 8),
        payee="Store",
        amount=Decimal("-40.00"),
        category=groceries,
    )
    tg = TransferGroup.objects.create(
        household=household,
        from_account=account,
        to_account=card,
        amount=Decimal("40.00"),
        scheduled_date=date(2026, 8, 15),
    )
    Transaction.objects.create(
        account=account,
        date=date(2026, 8, 15),
        payee="CC payment out",
        amount=Decimal("-40.00"),
        category=cc_pay,
        transfer_group=tg,
    )
    Transaction.objects.create(
        account=card,
        date=date(2026, 8, 15),
        payee="CC payment in",
        amount=Decimal("40.00"),
        category=cc_pay,
        transfer_group=tg,
    )
    Transaction.objects.create(
        account=account, date=date(2026, 8, 10), payee="Job", amount=Decimal("1000.00")
    )

    summary = auth_client.get("/api/insights/monthly-summary/?month=2026-08")
    assert summary.status_code == 200
    body = summary.json()
    assert Decimal(str(body["total_income"])) == Decimal("1000.00")
    assert Decimal(str(body["total_expenses"])) == Decimal("-40.00")
    assert Decimal(str(body["net"])) == Decimal("960.00")

    unified = auth_client.get("/api/insights/reports/monthly/?month=2026-08&months=6")
    assert unified.status_code == 200
    overview = unified.json()["overview"]
    assert Decimal(str(overview["total_income"])) == Decimal("1000.00")
    assert Decimal(str(overview["total_expenses"])) == Decimal("-40.00")
    names = {row["category_name"] for row in unified.json()["category_breakdown"]["breakdown"]}
    assert "Groceries" in names
    assert "Credit Card Payment" not in names
