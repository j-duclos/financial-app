"""Phase 7: cache-miss identity-before-running-balance (profiling + correctness)."""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import override_settings
from rest_framework.test import APIClient

from accounts.models import Account
from core.models import Household, HouseholdMembership
from timeline.services.canonical_ledger import row_participates_financially
from timeline.services.canonical_timeline_cache import get_or_build_canonical_forecast_timeline
from timeline.services.identity_stats import identity_stats, reset_identity_stats
from timeline.services.ledger import build_forecast_projection_timeline, recompute_timeline_running_balances
from transactions.models import Transaction

User = get_user_model()


@pytest.fixture
def user(db):
    return User.objects.create_user(username="p7_user", password="pass1234")


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="P7 HH")
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


@pytest.mark.django_db
@override_settings(ENABLE_PERF_LOGS=True)
@pytest.mark.parametrize(
    "n_rows,n_accounts,days",
    [(290, 12, 30), (400, 8, 80), (600, 12, 80), (1000, 12, 80)],
)
def test_phase7_miss_identity_profile(user, household, n_rows, n_accounts, days):
    _seed_household(household, n_accounts, n_rows)
    today = date.today()
    cache.clear()
    reset_identity_stats()
    rows, hit = get_or_build_canonical_forecast_timeline(
        user,
        today=today,
        forecast_days=days,
        household_id=household.pk,
        caller="p7_profile",
    )
    stats = identity_stats()
    print(
        f"[timeline-perf-p7] rows={len(rows)} hit={hit} "
        f"participation_calls={stats['participation_calls']} "
        f"fallback_participation_calls={stats['participation_fallback_calls']} "
        f"sibling_scan_calls={stats['sibling_scan_calls']} "
        f"matched_rule_lookup_calls={stats['matched_rule_lookup_calls']} "
        f"resolve_work_calls={stats['resolve_work_calls']} "
        f"total_participation_ms={stats['participation_ms']:.1f}"
    )
    assert hit is False
    assert rows
    assert all("financially_active" in r for r in rows)
    assert stats["participation_fallback_calls"] == 0
    assert stats["resolve_work_calls"] == 1


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
)


def _identity(row: dict) -> dict:
    return {field: row.get(field) for field in IDENTITY_FIELDS}


@pytest.mark.django_db
@override_settings(ENABLE_PERF_LOGS=True)
def test_recompute_sees_explicit_financially_active(user, household):
    _seed_household(household, 3, 40)
    today = date.today()
    seen: list[int] = []

    orig = recompute_timeline_running_balances

    def _wrapped(rows, *, opening, account_ids):
        seen.append(len(rows))
        assert rows
        assert all("financially_active" in row for row in rows)
        return orig(rows, opening=opening, account_ids=account_ids)

    with patch("timeline.services.ledger.recompute_timeline_running_balances", side_effect=_wrapped):
        cache.clear()
        reset_identity_stats()
        rows, hit = get_or_build_canonical_forecast_timeline(
            user,
            today=today,
            forecast_days=80,
            household_id=household.pk,
            caller="p7_annotated",
        )
    assert hit is False
    assert seen
    assert identity_stats()["participation_fallback_calls"] == 0
    assert identity_stats()["resolve_work_calls"] == 1
    assert all("financially_active" in r for r in rows)


@pytest.mark.django_db
def test_inactive_superseded_row_does_not_change_running_balance(user, household):
    checking = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Checking",
        currency="USD",
        starting_balance=Decimal("1000.00"),
        include_in_forecast=True,
    )
    today = date.today()
    Transaction.objects.create(
        account=checking,
        date=today,
        payee="Posted rent",
        amount=Decimal("-50.00"),
        status=Transaction.Status.CLEARED,
        source=Transaction.Source.ACTUAL,
        cleared=True,
        tags=[],
    )
    Transaction.objects.create(
        account=checking,
        date=today,
        payee="Planned rent",
        amount=Decimal("-50.00"),
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.ONE_TIME,
        tags=[],
    )
    Transaction.objects.create(
        account=checking,
        date=today + timedelta(days=1),
        payee="Later bill",
        amount=Decimal("-10.00"),
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.ONE_TIME,
        tags=[],
    )
    rows = build_forecast_projection_timeline(
        user,
        today=today,
        end_date=today + timedelta(days=30),
        household_id=household.pk,
        caller="p7_inactive",
    )
    acct_rows = [r for r in rows if int(r.get("account_id") or 0) == checking.pk]
    planned = next(r for r in acct_rows if r.get("description") == "Planned rent")
    posted = next(r for r in acct_rows if r.get("description") == "Posted rent")
    later = next(r for r in acct_rows if r.get("description") == "Later bill")
    assert planned["financially_active"] is False
    assert posted["financially_active"] is True
    assert later["financially_active"] is True
    assert Decimal(str(planned["running_balance"])) == Decimal(str(posted["running_balance"]))
    assert Decimal(str(later["running_balance"])) == Decimal(str(posted["running_balance"])) + Decimal("-10.00")


@pytest.mark.django_db
def test_same_date_order_and_cache_hit_match_miss(user, household):
    checking = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Checking",
        currency="USD",
        starting_balance=Decimal("800.00"),
        include_in_forecast=True,
    )
    today = date.today()
    Transaction.objects.create(
        account=checking,
        date=today,
        payee="Alpha",
        amount=Decimal("-1.00"),
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.ONE_TIME,
        tags=[],
    )
    Transaction.objects.create(
        account=checking,
        date=today,
        payee="Beta",
        amount=Decimal("-2.00"),
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.ONE_TIME,
        tags=[],
    )
    cache.clear()
    miss, miss_hit = get_or_build_canonical_forecast_timeline(
        user,
        today=today,
        forecast_days=30,
        household_id=household.pk,
        caller="p7_parity_miss",
    )
    hit_rows, hit = get_or_build_canonical_forecast_timeline(
        user,
        today=today,
        forecast_days=30,
        household_id=household.pk,
        caller="p7_parity_hit",
    )
    assert miss_hit is False
    assert hit is True
    assert [_identity(r) for r in miss] == [_identity(r) for r in hit_rows]
    same_day = [r for r in miss if str(r.get("date"))[:10] == today.isoformat()]
    payees = [r.get("description") for r in same_day]
    assert "Alpha" in payees and "Beta" in payees
    ids = [r.get("transaction_id") for r in same_day]
    assert ids == sorted(ids, key=lambda v: (v is None, v or 0))


@pytest.mark.django_db
@override_settings(TIMELINE_CACHE_ENABLED=False)
def test_timeline_miss_then_hit_identity_equivalent(user, household, auth_client):
    primary = _seed_household(household, 3, 40)
    today = date.today()
    params = {
        "start": today.isoformat(),
        "end": (today + timedelta(days=80)).isoformat(),
        "as_of": today.isoformat(),
        "exclude_reconciled_past": "true",
        "account_id": primary.pk,
    }
    miss = auth_client.get("/api/timeline/", params)
    hit = auth_client.get("/api/timeline/", params)
    assert miss.status_code == hit.status_code == 200
    miss_ids = [_identity(r) for r in miss.json()["timeline"]]
    hit_ids = [_identity(r) for r in hit.json()["timeline"]]
    assert miss_ids == hit_ids


@pytest.mark.django_db
def test_participation_fallback_still_works_without_annotation():
    rows = [
        {
            "account_id": 1,
            "date": date.today(),
            "amount": Decimal("-10.00"),
            "status": "PLANNED",
            "source": "one_time",
        }
    ]
    assert row_participates_financially(rows[0], rows) is True
    assert "financially_active" not in rows[0]

