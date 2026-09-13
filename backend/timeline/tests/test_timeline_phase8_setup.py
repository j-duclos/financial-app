"""Phase 8: exclusive setup-stage attribution for canonical cache misses."""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import override_settings
from rest_framework.test import APIClient

from accounts.models import Account
from core.models import Household, HouseholdMembership
from timeline.services.canonical_timeline_cache import get_or_build_canonical_forecast_timeline
from timeline.services.forecast_build_perf import SETUP_STAGE_NAMES, last_forecast_build_perf, reset_forecast_build_perf
from transactions.models import Transaction

User = get_user_model()

IDENTITY_FIELDS = (
    "account_id",
    "date",
    "amount",
    "type",
    "status",
    "source",
    "description",
    "transaction_id",
    "financially_active",
    "running_balance",
    "balance_after",
)


@pytest.fixture
def user(db):
    return User.objects.create_user(username="p8_user", password="pass1234")


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="P8 HH")
    HouseholdMembership.objects.create(household=h, user=user, role=HouseholdMembership.Role.OWNER)
    return h


@pytest.fixture
def auth_client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _seed_household(household, n_accounts: int, n_rows: int) -> Account:
    accounts = [
        Account.objects.create(
            household=household,
            account_type=Account.AccountType.CHECKING,
            name=f"Acct {i}",
            currency="USD",
            starting_balance=Decimal("2500.00"),
            include_in_forecast=True,
        )
        for i in range(n_accounts)
    ]
    today = date.today()
    primary = accounts[0]
    Transaction.objects.bulk_create(
        [
            Transaction(
                account=primary,
                date=today + timedelta(days=(i % 70)),
                payee=f"Item {i}",
                amount=Decimal("-12.34") if i % 2 else Decimal("40.00"),
                status=Transaction.Status.PLANNED,
                source=Transaction.Source.ONE_TIME,
                tags=[],
            )
            for i in range(n_rows)
        ]
    )
    extra = []
    for acc in accounts[1:]:
        extra.append(
            Transaction(
                account=acc,
                date=today + timedelta(days=3),
                payee="Other",
                amount=Decimal("-5.00"),
                status=Transaction.Status.PLANNED,
                source=Transaction.Source.ONE_TIME,
                tags=[],
            )
        )
    if extra:
        Transaction.objects.bulk_create(extra)
    return primary


def _identity(row: dict) -> dict:
    return {field: row.get(field) for field in IDENTITY_FIELDS}


def _print_phase8(perf: dict) -> None:
    stages = sorted(perf["stages"].items(), key=lambda item: item[1]["total_ms"], reverse=True)
    print(
        f"[forecast-build-perf] rows={perf['rows']} total_ms={perf['total_ms']:.1f} "
        f"setup_ms={perf['setup_ms']:.1f} explained_miss_ms={perf['explained_miss_ms']:.1f} "
        f"unexplained_miss_ms={perf['unexplained_build_ms']:.1f}"
    )
    for name, rec in stages:
        print(
            f"[forecast-build-perf] stage={name} total_ms={rec['total_ms']:.1f} "
            f"sql_ms={rec['sql_ms']:.1f} python_ms={rec['python_ms']:.1f} "
            f"queries={rec['queries']}"
        )
    print(f"[forecast-build-perf] sorts={perf.get('sorts')}")
    print(f"[forecast-build-perf] walk={perf.get('walk')}")
    print(f"[forecast-build-perf] cache_write={perf.get('cache_write')}")
    print(f"[forecast-build-perf] counts={perf.get('counts')}")


@pytest.mark.django_db
@override_settings(ENABLE_PERF_LOGS=True)
@pytest.mark.parametrize(
    "n_rows,n_accounts,days",
    [(290, 12, 30), (400, 8, 80), (600, 12, 80), (1000, 12, 80)],
)
def test_phase8_miss_setup_decomposition(user, household, n_rows, n_accounts, days):
    _seed_household(household, n_accounts, n_rows)
    today = date.today()
    cache.clear()
    reset_forecast_build_perf()
    rows, hit = get_or_build_canonical_forecast_timeline(
        user,
        today=today,
        forecast_days=days,
        household_id=household.pk,
        caller="p8_profile",
    )
    perf = last_forecast_build_perf()
    assert hit is False
    assert rows
    assert perf is not None
    _print_phase8(perf)
    assert perf["rows"] == len(rows)
    for name in SETUP_STAGE_NAMES:
        assert name in perf["stages"], name
        rec = perf["stages"][name]
        assert "total_ms" in rec
        assert "sql_ms" in rec
        assert "python_ms" in rec
        assert "queries" in rec
    setup_sum = sum(perf["stages"][name]["total_ms"] for name in SETUP_STAGE_NAMES)
    assert setup_sum == pytest.approx(perf["setup_ms"], abs=0.01)
    assert perf["walk"]
    assert "anchor_ms" in perf["walk"]
    assert "python_walk_ms" in perf["walk"]
    assert perf["cache_write"]
    assert "cache_serialize_ms" in perf["cache_write"]
    assert "cache_write_ms" in perf["cache_write"]
    assert all("financially_active" in row for row in rows)
    assert all("running_balance" in row for row in rows)
    assert all("balance_after" in row for row in rows)


@pytest.mark.django_db
def test_phase8_instrumentation_does_not_change_canonical_identity(user, household):
    _seed_household(household, 8, 120)
    today = date.today()

    with override_settings(ENABLE_PERF_LOGS=False):
        cache.clear()
        quiet_rows, quiet_hit = get_or_build_canonical_forecast_timeline(
            user,
            today=today,
            forecast_days=80,
            household_id=household.pk,
            caller="p8_quiet",
        )
    with override_settings(ENABLE_PERF_LOGS=True):
        cache.clear()
        reset_forecast_build_perf()
        logged_rows, logged_hit = get_or_build_canonical_forecast_timeline(
            user,
            today=today,
            forecast_days=80,
            household_id=household.pk,
            caller="p8_logged",
        )
    assert quiet_hit is False
    assert logged_hit is False
    assert [_identity(row) for row in quiet_rows] == [_identity(row) for row in logged_rows]
