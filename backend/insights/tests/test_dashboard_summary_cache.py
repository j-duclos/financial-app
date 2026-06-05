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
