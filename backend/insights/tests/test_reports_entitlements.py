"""Basic vs Advanced Reports entitlement on the unified monthly endpoint."""
from __future__ import annotations

from decimal import Decimal

import pytest

from billing.tests.helpers import grant_premium
from insights.tests.test_reports_query_efficiency import seed_reports_world


@pytest.fixture
def auth_client(api_client, user):
    api_client.force_authenticate(user=user)
    return api_client


@pytest.mark.django_db
def test_free_user_gets_basic_monthly_reports(auth_client, household, user):
    seed_reports_world(household, user)
    res = auth_client.get("/api/insights/reports/monthly/?month=2026-08&months=12")
    assert res.status_code == 200
    data = res.json()
    assert data["month"] == "2026-08"
    assert Decimal(data["overview"]["total_income"]) == Decimal("3900.00")
    assert data["overview"]["trend"] == []
    assert data["debt"]["interest_trend"] == []
    assert data["goals"]["contribution_history"] == []
    assert data["goals"]["projected_monthly_funding"] == []
    funding_months = {row["month"] for row in data["goals"]["monthly_funding"]}
    assert funding_months <= {"2026-08"}


@pytest.mark.django_db
def test_free_include_history_does_not_return_contribution_history(auth_client, household, user):
    seed_reports_world(household, user)
    res = auth_client.get(
        "/api/insights/reports/monthly/?month=2026-08&months=12&include_history=true"
    )
    assert res.status_code == 200
    assert res.json()["goals"]["contribution_history"] == []


@pytest.mark.django_db
def test_premium_user_gets_advanced_history(auth_client, household, user):
    seed_reports_world(household, user)
    grant_premium(user)
    res = auth_client.get("/api/insights/reports/monthly/?month=2026-08&months=12")
    assert res.status_code == 200
    data = res.json()
    assert len(data["overview"]["trend"]) == 12
    assert data["overview"]["trend"][0]["month"] == "2025-09"
    assert data["overview"]["trend"][-1]["month"] == "2026-08"
    assert data["goals"]["monthly_funding"]


@pytest.mark.django_db
def test_premium_24_month_window(auth_client, household, user):
    seed_reports_world(household, user)
    grant_premium(user)
    res = auth_client.get("/api/insights/reports/monthly/?month=2026-08&months=24")
    assert res.status_code == 200
    assert len(res.json()["overview"]["trend"]) == 24
