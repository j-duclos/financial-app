"""Accounts enrichment: canonical forecast reuse, invalidation, and payment-due semantics."""
from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.core.cache import cache
from rest_framework.test import APIClient

from accounts.models import Account
from common.services.profiler import get_build_timeline_count, reset_build_timeline_count
from core.models import Household
from transactions.models import Transaction

ENRICHED = (
    "/api/accounts/?balance=true&forecast_summary=true&health=true&days=30&page_size=500"
)


@pytest.fixture
def auth_client(api_client, user):
    api_client.force_authenticate(user=user)
    return api_client


@pytest.fixture
def main_checking(household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        name="Main",
        starting_balance=Decimal("1000.00"),
        minimum_buffer=Decimal("0"),
        currency="USD",
        include_in_forecast=True,
    )


def _planned(account, day, payee, amount):
    return Transaction.objects.create(
        account=account,
        date=day,
        payee=payee,
        amount=amount,
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.ONE_TIME,
    )


@pytest.mark.django_db
def test_accounts_enrichment_invalidates_after_future_edit(
    auth_client, user, household, main_checking
):
    today = date.today()
    bill = _planned(main_checking, today + timedelta(days=4), "Future bill", Decimal("-1200.00"))
    cache.clear()

    first = auth_client.get(ENRICHED)
    assert first.status_code == 200
    row = next(x for x in first.json()["results"] if x["id"] == main_checking.id)
    lowest_before = Decimal(row["lowest_projected_balance_30_days"])
    sts_before = Decimal(row["available_to_spend"])
    rev_before = Household.objects.get(pk=household.pk).financial_revision
    assert lowest_before == Decimal("-200.00")

    patched = auth_client.patch(
        f"/api/transactions/{bill.pk}/",
        {"amount": "-1500.00"},
        format="json",
    )
    assert patched.status_code == 200, patched.data
    household.refresh_from_db()
    assert household.financial_revision > rev_before

    second = auth_client.get(ENRICHED)
    assert second.status_code == 200
    row2 = next(x for x in second.json()["results"] if x["id"] == main_checking.id)
    lowest_after = Decimal(row2["lowest_projected_balance_30_days"])
    sts_after = Decimal(row2["available_to_spend"])
    assert lowest_after == Decimal("-500.00")
    assert sts_after == sts_before - Decimal("300.00")
    assert Decimal(row2["first_negative_balance"]) == Decimal("-500.00")


@pytest.mark.django_db
def test_accounts_lowest_and_first_shortfall_match_dashboard(
    auth_client, household, main_checking
):
    today = date.today()
    _planned(main_checking, today + timedelta(days=4), "Bill A", Decimal("-200.00"))
    _planned(main_checking, today + timedelta(days=20), "Bill B", Decimal("-900.00"))
    cache.clear()

    accounts = auth_client.get(ENRICHED)
    dashboard = auth_client.get("/api/insights/dashboard/summary/?days=30")
    assert accounts.status_code == 200
    assert dashboard.status_code == 200

    row = next(x for x in accounts.json()["results"] if x["id"] == main_checking.id)
    dash = dashboard.json()
    lowest = dash.get("lowest_projected_cash") or {}
    shortfall = dash.get("first_cash_shortfall") or {}

    assert lowest.get("account_id") == main_checking.id
    assert Decimal(row["lowest_projected_balance_30_days"]) == Decimal(lowest["amount"])
    assert row["lowest_projected_balance_date_30_days"] == lowest.get("date")
    if shortfall.get("account_id") == main_checking.id:
        assert row["first_negative_date"] == shortfall.get("date")
        assert Decimal(row["first_negative_balance"]) == Decimal(shortfall["amount"])


@pytest.mark.django_db
def test_accounts_safe_to_spend_matches_canonical_forecast_summary(
    auth_client, user, household, main_checking
):
    from accounts.services.available_to_spend import calculate_forecast_summaries_for_accounts

    today = date.today()
    _planned(main_checking, today + timedelta(days=6), "Rent", Decimal("-400.00"))
    cache.clear()

    accounts = auth_client.get(ENRICHED)
    assert accounts.status_code == 200
    row = next(x for x in accounts.json()["results"] if x["id"] == main_checking.id)
    summaries = calculate_forecast_summaries_for_accounts(
        user, [main_checking], as_of_date=today, days=30
    )
    summary = summaries[main_checking.id]
    assert row.get("available_to_spend") == summary.get("available_to_spend")
    assert row.get("lowest_projected_balance_30_days") == summary.get(
        "lowest_projected_balance"
    )
    assert row.get("first_negative_date") == summary.get("first_negative_date")


@pytest.mark.django_db
def test_payment_due_amount_unavailable_when_zeros_are_defaults(auth_client, household):
    card = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        role=Account.AccountRole.CREDIT_CARD,
        name="Care Credit",
        credit_limit=Decimal("4800"),
        starting_balance=Decimal("-926.24"),
        current_balance=Decimal("926.24"),
        statement_balance=Decimal("0"),
        minimum_payment_amount=Decimal("0"),
        next_payment_due_date=date.today() - timedelta(days=21),
        currency="USD",
    )
    r = auth_client.get(f"/api/accounts/{card.id}/?balance=true")
    assert r.status_code == 200
    data = r.json()
    assert data["payment_due_amount"] is None
    assert data["payment_due_amount_unavailable"] is True
    assert data["statement_balance"] in ("0.00", "0", "0.0")


@pytest.mark.django_db
def test_enriched_accounts_builds_one_timeline_for_many_accounts(
    auth_client, household, main_checking
):
    for i in range(4):
        Account.objects.create(
            household=household,
            account_type=Account.AccountType.CHECKING,
            role=Account.AccountRole.SPENDING,
            name=f"Checking {i}",
            starting_balance=Decimal("800.00"),
            currency="USD",
        )
    cache.clear()
    reset_build_timeline_count()
    r = auth_client.get(ENRICHED)
    assert r.status_code == 200
    assert get_build_timeline_count() <= 1
    assert len(r.json()["results"]) >= 5


@pytest.mark.django_db
def test_accounts_enrichment_reuses_warm_canonical_timeline(
    auth_client, user, household, main_checking
):
    """Home/Dashboard-warmed canonical cache must prevent a second timeline build."""
    from timeline.services.canonical_timeline_cache import (
        get_or_build_canonical_forecast_timeline,
    )

    today = date.today()
    _planned(main_checking, today + timedelta(days=5), "Bill", Decimal("-50.00"))
    cache.clear()
    reset_build_timeline_count()

    get_or_build_canonical_forecast_timeline(
        user,
        today=today,
        forecast_days=30,
        caller="dashboard_warmup",
    )
    builds_after_warmup = get_build_timeline_count()
    assert builds_after_warmup == 1

    r = auth_client.get(ENRICHED)
    assert r.status_code == 200
    assert get_build_timeline_count() == builds_after_warmup

    detail = auth_client.get(
        f"/api/accounts/{main_checking.id}/"
        "?balance=true&forecast_summary=true&health=true&days=30"
    )
    assert detail.status_code == 200
    assert get_build_timeline_count() == builds_after_warmup
