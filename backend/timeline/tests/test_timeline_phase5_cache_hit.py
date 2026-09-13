"""Phase 5: cache-hit slice/copy, identity reuse, mutation safety, timings."""
from __future__ import annotations

import copy
import time
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
from timeline.services.canonical_ledger import resolve_canonical_financial_state
from timeline.services.canonical_timeline_cache import (
    get_or_build_canonical_forecast_timeline,
    peek_canonical_forecast_timeline,
)
from timeline.services.timeline_perf import last_timeline_perf
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
)


@pytest.fixture
def user(db):
    return User.objects.create_user(username="p5_user", password="pass1234")


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="P5 HH")
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


def _warm(user, household, today: date, days: int) -> list:
    cache.clear()
    rows, _ = get_or_build_canonical_forecast_timeline(
        user,
        today=today,
        forecast_days=days,
        household_id=household.pk,
        caller="p5_warm",
    )
    return rows


def _params(account, today: date, days: int, **extra) -> dict:
    params = {
        "start": today.isoformat(),
        "end": (today + timedelta(days=days)).isoformat(),
        "as_of": today.isoformat(),
        "exclude_reconciled_past": "true",
    }
    if account is not None:
        params["account_id"] = account.pk
    params.update(extra)
    return params


def _identity(row: dict) -> dict:
    return {field: row.get(field) for field in IDENTITY_FIELDS}


@pytest.mark.django_db
@override_settings(TIMELINE_CACHE_ENABLED=False, ENABLE_PERF_LOGS=True)
def test_canonical_cache_not_mutated_across_requests(user, household, auth_client):
    primary = _seed_household(household, 3, 80)
    today = date.today()
    cached = _warm(user, household, today, 80)
    snapshot_date = cached[0].get("date")
    snapshot_bal = cached[0].get("balance_after")
    snapshot_active = cached[0].get("financially_active")

    res = auth_client.get("/api/timeline/", _params(primary, today, 80))
    assert res.status_code == 200
    peeked = peek_canonical_forecast_timeline(
        user, today=today, forecast_days=80, household_id=household.pk
    )
    assert peeked is not None
    assert peeked[0].get("date") == snapshot_date
    assert peeked[0].get("balance_after") == snapshot_bal
    assert peeked[0].get("financially_active") == snapshot_active
    assert not isinstance(peeked[0].get("date"), str)


@pytest.mark.django_db
@override_settings(TIMELINE_CACHE_ENABLED=False)
def test_cache_hit_skips_identity_resolve(user, household, auth_client):
    primary = _seed_household(household, 3, 40)
    today = date.today()
    _warm(user, household, today, 80)
    with patch(
        "timeline.services.canonical_ledger.resolve_canonical_financial_state",
        wraps=resolve_canonical_financial_state,
    ) as spy:
        res = auth_client.get("/api/timeline/", _params(primary, today, 80))
    assert res.status_code == 200
    spy.assert_not_called()
    assert any(r.get("financially_active") is not None for r in res.json()["timeline"])


@pytest.mark.django_db
@override_settings(TIMELINE_CACHE_ENABLED=False)
def test_cache_hit_and_miss_row_identity_match(user, household, auth_client):
    primary = _seed_household(household, 3, 40)
    today = date.today()
    params = _params(primary, today, 80)
    miss = auth_client.get("/api/timeline/", params)
    assert miss.status_code == 200
    miss_stats = last_timeline_perf()
    print(
        f"[timeline-perf-miss] total={miss_stats['total_ms']} "
        f"forecast_build={miss_stats['forecast_build_ms']} "
        f"copy={miss_stats['cache_copy_ms']} identity={miss_stats['identity_ms']} "
        f"walk={miss_stats['balance_walk_ms']} serial={miss_stats['serialization_ms']} "
        f"other={miss_stats['other_ms']} queries={miss_stats['db_queries']}"
    )
    hit = auth_client.get("/api/timeline/", params)
    assert hit.status_code == 200
    assert hit.headers.get("X-Canonical-Timeline") == "hit"
    miss_ids = [_identity(r) for r in miss.json()["timeline"]]
    hit_ids = [_identity(r) for r in hit.json()["timeline"]]
    assert miss_ids == hit_ids
    assert [r["account_id"] for r in miss.json()["account_summary"]] == [
        r["account_id"] for r in hit.json()["account_summary"]
    ]


@pytest.mark.django_db
@override_settings(TIMELINE_CACHE_ENABLED=False)
def test_account_scoped_copy_is_smaller_than_household_source(user, household, auth_client):
    primary = _seed_household(household, 8, 200)
    today = date.today()
    _warm(user, household, today, 80)
    res = auth_client.get("/api/timeline/", _params(primary, today, 80))
    assert res.status_code == 200
    stats = last_timeline_perf()
    assert stats is not None
    assert stats["cache_hit"] is True
    assert stats["requested_accounts"] == 1
    assert stats["household_accounts"] >= 8
    assert stats["source_rows"] > stats["returned_rows"]
    assert stats["returned_rows"] == len(res.json()["timeline"])


def _print_before_components(cached_rows: list, account_id: int) -> dict:
    t0 = time.perf_counter()
    copied = copy.deepcopy(cached_rows)
    deepcopy_ms = (time.perf_counter() - t0) * 1000
    scoped = [r for r in copied if int(r.get("account_id") or 0) == account_id]
    t1 = time.perf_counter()
    resolve_canonical_financial_state(scoped)
    identity_ms = (time.perf_counter() - t1) * 1000
    out = {
        "deepcopy_ms": round(deepcopy_ms, 1),
        "identity_ms": round(identity_ms, 1),
        "source_rows": len(cached_rows),
        "account_rows": len(scoped),
    }
    print(
        f"[timeline-perf-before] deepcopy={out['deepcopy_ms']:.1f}ms "
        f"identity={out['identity_ms']:.1f}ms source_rows={out['source_rows']} "
        f"account_rows={out['account_rows']}"
    )
    return out


@pytest.mark.django_db
@pytest.mark.parametrize("n_rows,n_accounts,days", [(400, 8, 80), (600, 12, 80), (1000, 12, 80)])
@override_settings(TIMELINE_CACHE_ENABLED=False, ENABLE_PERF_LOGS=True)
def test_warm_cache_stage_timings(user, household, auth_client, n_rows, n_accounts, days):
    primary = _seed_household(household, n_accounts, n_rows)
    today = date.today()
    cached = _warm(user, household, today, days)
    before = _print_before_components(cached, primary.pk)

    def _run(extra: dict) -> dict:
        res = auth_client.get("/api/timeline/", {**_params(primary, today, days), **extra})
        assert res.status_code == 200
        stats = last_timeline_perf()
        assert stats is not None
        print(
            f"[timeline-perf-after] mode={'client' if extra else 'server'} "
            f"rows={n_rows} accounts={n_accounts} total={stats['total_ms']} "
            f"copy={stats['cache_copy_ms']} identity={stats['identity_ms']} "
            f"filter={stats['filter_ms']} slice={stats['slice_ms']} "
            f"walk={stats['balance_walk_ms']} serial={stats['serialization_ms']} "
            f"anchors={stats['anchor_ms']} summary={stats['account_summary_ms']} "
            f"other={stats['other_ms']} queries={stats['db_queries']} "
            f"groups={stats['query_groups']} source={stats['source_rows']} "
            f"returned={stats['returned_rows']}"
        )
        return stats

    server = _run({})
    client = _run({"balance_walk": "client"})
    assert server["identity_ms"] == 0
    assert server["cache_copy_ms"] <= before["deepcopy_ms"] + 5
    assert client["balance_walk_ms"] == 0
    assert server["returned_rows"] == client["returned_rows"]


@pytest.mark.django_db
@override_settings(TIMELINE_CACHE_ENABLED=False, ENABLE_PERF_LOGS=True)
def test_narrow_request_shapes(user, household, auth_client):
    primary = _seed_household(household, 12, 600)
    today = date.today()
    _warm(user, household, today, 30)
    shapes = [
        ("one_30", _params(primary, today, 30)),
        ("all_30", _params(None, today, 30)),
    ]
    for name, params in shapes:
        res = auth_client.get("/api/timeline/", params)
        assert res.status_code == 200, res.json() if res.status_code >= 400 else name
        stats = last_timeline_perf()
        assert stats is not None
        print(
            f"[timeline-perf-shape] {name} total={stats['total_ms']} "
            f"copy={stats['cache_copy_ms']} identity={stats['identity_ms']} "
            f"returned={stats['returned_rows']} source={stats['source_rows']} "
            f"requested_accounts={stats['requested_accounts']} "
            f"household_accounts={stats['household_accounts']} "
            f"queries={stats['db_queries']}"
        )
        assert stats["identity_ms"] == 0
        if name.startswith("one_"):
            assert stats["requested_accounts"] == 1
            assert stats["source_rows"] > stats["returned_rows"]

    _warm(user, household, today, 90)
    res = auth_client.get("/api/timeline/", _params(primary, today, 90))
    assert res.status_code == 200
    stats = last_timeline_perf()
    print(
        f"[timeline-perf-shape] one_90 total={stats['total_ms']} "
        f"copy={stats['cache_copy_ms']} identity={stats['identity_ms']} "
        f"returned={stats['returned_rows']} source={stats['source_rows']} "
        f"queries={stats['db_queries']}"
    )
    assert stats["identity_ms"] == 0
    assert stats["requested_accounts"] == 1
