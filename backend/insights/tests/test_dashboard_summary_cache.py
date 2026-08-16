"""Dashboard summary Django cache: hits and invalidation."""
from datetime import date
from unittest.mock import patch

import pytest
from django.core.cache import cache

from common.services.cache import (
    get_dashboard_summary_cache_key,
    invalidate_user_dashboard_cache,
)
from core.models import Household, HouseholdMembership
from insights.services.dashboard_summary import build_dashboard_summary


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="Dashboard Cache HH")
    HouseholdMembership.objects.create(
        household=h, user=user, role=HouseholdMembership.Role.OWNER
    )
    return h


@pytest.mark.django_db
def test_dashboard_summary_cache_hit_after_first_call(user, household):
    today = date(2026, 6, 2)
    key = get_dashboard_summary_cache_key(
        user_id=user.pk,
        household_ids=[household.id],
        forecast_days=30,
        as_of_date=today,
    )
    cache.delete(key)

    with patch("insights.services.dashboard_summary._build_dashboard_summary") as mock_build:
        mock_build.return_value = {"safe_to_spend": {"amount": "0.00"}}
        first = build_dashboard_summary(user, days=30, as_of_date=today)
        second = build_dashboard_summary(user, days=30, as_of_date=today)

    assert first == second
    assert mock_build.call_count == 1


@pytest.mark.django_db
def test_invalidate_user_dashboard_cache_bumps_version(user, household):
    today = date(2026, 6, 2)
    before = get_dashboard_summary_cache_key(
        user_id=user.pk,
        household_ids=[household.id],
        forecast_days=30,
        as_of_date=today,
    )
    invalidate_user_dashboard_cache(user.pk)
    after = get_dashboard_summary_cache_key(
        user_id=user.pk,
        household_ids=[household.id],
        forecast_days=30,
        as_of_date=today,
    )
    assert before != after


@pytest.mark.django_db
def test_dashboard_summary_cache_isolated_by_forecast_days(user, household):
    today = date(2026, 6, 2)
    cache.clear()
    key_30 = get_dashboard_summary_cache_key(
        user_id=user.pk,
        household_ids=[household.id],
        forecast_days=30,
        as_of_date=today,
    )
    key_90 = get_dashboard_summary_cache_key(
        user_id=user.pk,
        household_ids=[household.id],
        forecast_days=90,
        as_of_date=today,
    )
    assert key_30 != key_90
    assert ":days:30:" in key_30
    assert ":days:90:" in key_90

    with patch("insights.services.dashboard_summary._build_dashboard_summary") as mock_build:
        mock_build.side_effect = [
            {"safe_to_spend": {"amount": "30.00"}, "forecast_days": 30},
            {"safe_to_spend": {"amount": "90.00"}, "forecast_days": 90},
        ]
        thirty = build_dashboard_summary(user, days=30, as_of_date=today)
        ninety = build_dashboard_summary(user, days=90, as_of_date=today)

    assert thirty["forecast_days"] == 30
    assert ninety["forecast_days"] == 90
    assert mock_build.call_count == 2
