"""Forecast summary Django cache: keys, hits, and invalidation."""
from datetime import date
from unittest.mock import patch

import pytest
from django.core.cache import cache

from accounts.models import Account
from accounts.services.available_to_spend import calculate_forecast_summaries_for_accounts
from common.services.cache import (
    get_forecast_summary_cache_key,
    invalidate_user_forecast_cache,
)
from core.models import Household, HouseholdMembership


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="Cache HH")
    HouseholdMembership.objects.create(
        household=h, user=user, role=HouseholdMembership.Role.OWNER
    )
    return h


@pytest.fixture
def spending_account(household):
    return Account.objects.create(
        household=household,
        name="Checking",
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        starting_balance="1000.00",
        minimum_buffer="100.00",
        currency="USD",
    )


@pytest.mark.django_db
def test_forecast_summary_cache_hit_after_first_call(user, spending_account):
    accounts = [spending_account]
    today = date(2026, 6, 2)
    key = get_forecast_summary_cache_key(
        user_id=user.pk,
        household_ids=[spending_account.household_id],
        account_ids=[spending_account.id],
        forecast_days=30,
        as_of_date=today,
    )
    cache.delete(key)

    with patch(
        "accounts.services.available_to_spend._calculate_forecast_summaries_for_accounts"
    ) as mock_calc:
        mock_calc.return_value = {spending_account.id: {"account_id": spending_account.id}}
        first = calculate_forecast_summaries_for_accounts(
            user, accounts, as_of_date=today, days=30
        )
        second = calculate_forecast_summaries_for_accounts(
            user, accounts, as_of_date=today, days=30
        )

    assert first == second
    assert mock_calc.call_count == 1


@pytest.mark.django_db
def test_invalidate_user_forecast_cache_bumps_version(user, spending_account):
    today = date(2026, 6, 2)
    before = get_forecast_summary_cache_key(
        user_id=user.pk,
        household_ids=[spending_account.household_id],
        account_ids=[spending_account.id],
        forecast_days=30,
        as_of_date=today,
    )
    invalidate_user_forecast_cache(user.pk)
    after = get_forecast_summary_cache_key(
        user_id=user.pk,
        household_ids=[spending_account.household_id],
        account_ids=[spending_account.id],
        forecast_days=30,
        as_of_date=today,
    )
    assert before != after
