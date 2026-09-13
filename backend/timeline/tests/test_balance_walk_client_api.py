"""GET /api/timeline/ Phase 4 — ``balance_walk=client`` skips the server walk."""
from __future__ import annotations

import time
from datetime import date, timedelta
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db import connection
from django.test import override_settings
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from accounts.models import Account
from categories.models import Category
from core.models import Household, HouseholdMembership
from timeline.models import RecurringRule
from timeline.services.canonical_timeline_cache import get_or_build_canonical_forecast_timeline
from timeline.services.ledger_section_balances import assign_canonical_ledger_balance_after
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
    return User.objects.create_user(username="walk_user", password="pass1234")


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="Walk HH")
    HouseholdMembership.objects.create(household=h, user=user, role=HouseholdMembership.Role.OWNER)
    return h


@pytest.fixture
def checking(db, household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Checking",
        currency="USD",
        starting_balance=Decimal("1000.00"),
        include_in_forecast=True,
    )


@pytest.fixture
def expense_rule(db, household, checking):
    category = Category.objects.create(
        household=household,
        name="Rent",
        category_type=Category.CategoryType.EXPENSE,
        sort_order=1,
    )
    return RecurringRule.objects.create(
        household=household,
        name="Weekly rent",
        account=checking,
        category=category,
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("100.00"),
        currency="USD",
        frequency=RecurringRule.Frequency.WEEKLY,
        interval=1,
        day_of_week=0,
        start_date=date.today() - timedelta(days=14),
        end_date=None,
        active=True,
    )


@pytest.fixture
def auth_client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _params(checking, today: date, **extra) -> dict:
    params = {
        "start": today.isoformat(),
        "end": (today + timedelta(days=30)).isoformat(),
        "as_of": today.isoformat(),
        "account_id": checking.pk,
        "exclude_reconciled_past": "true",
    }
    params.update(extra)
    return params


def _warm_canonical(user, household, today: date, days: int = 30) -> None:
    cache.clear()
    get_or_build_canonical_forecast_timeline(
        user,
        today=today,
        forecast_days=days,
        household_id=household.pk,
        caller="test_warm",
    )


def _identity(row: dict) -> dict:
    return {field: row.get(field) for field in IDENTITY_FIELDS}


@pytest.mark.django_db
def test_default_timeline_still_assigns_balance_after(
    user, household, checking, expense_rule, auth_client
):
    today = date.today()
    _warm_canonical(user, household, today)
    with patch(
        "timeline.services.timeline_response.assign_canonical_ledger_balance_after",
        wraps=assign_canonical_ledger_balance_after,
    ) as spy:
        res = auth_client.get("/api/timeline/", _params(checking, today))
    assert res.status_code == 200
    spy.assert_called()
    body = res.json()
    assert "engine_shadow" not in body
    walk_rows = [r for r in body["timeline"] if r.get("balance_after") is not None]
    assert walk_rows, "default request must still include server balance_after"
    assert res.headers.get("X-Balance-Walk-Mode") == "server"
    assert res.headers.get("X-Balance-Walk-Skipped") is None


@pytest.mark.django_db
def test_shadow_timeline_walks_and_includes_anchors(
    user, household, checking, expense_rule, auth_client
):
    today = date.today()
    _warm_canonical(user, household, today)
    with patch(
        "timeline.services.timeline_response.assign_canonical_ledger_balance_after",
        wraps=assign_canonical_ledger_balance_after,
    ) as spy:
        res = auth_client.get(
            "/api/timeline/",
            _params(checking, today, include_engine_shadow="true"),
        )
    assert res.status_code == 200
    spy.assert_called()
    body = res.json()
    shadow = body["engine_shadow"]
    assert shadow["balance_walk_source"] == "server"
    assert shadow["accounts"]
    assert any(r.get("balance_after") not in (None, "") for r in body["timeline"])


@pytest.mark.django_db
def test_client_balance_walk_skips_assign_and_nulls_balances(
    user, household, checking, expense_rule, auth_client
):
    today = date.today()
    _warm_canonical(user, household, today)
    default = auth_client.get("/api/timeline/", _params(checking, today))
    assert default.status_code == 200
    default_body = default.json()

    with patch(
        "timeline.services.timeline_response.assign_canonical_ledger_balance_after",
        wraps=assign_canonical_ledger_balance_after,
    ) as assign_spy:
        with patch(
            "timeline.services.ledger_section_balances._resolve_ledger_anchors",
        ) as anchor_spy:
            res = auth_client.get(
                "/api/timeline/",
                _params(checking, today, balance_walk="client"),
            )
    assert res.status_code == 200
    assign_spy.assert_not_called()
    anchor_spy.assert_not_called()
    body = res.json()
    shadow = body["engine_shadow"]
    assert shadow["as_of"] == today.isoformat()
    assert shadow["balance_walk_source"] == "client"
    assert shadow["accounts"]
    assert body["timeline"], "canonical rows must still be returned"
    for row in body["timeline"]:
        assert row.get("balance_after") is None
        for field in IDENTITY_FIELDS:
            assert field in row
    assert [_identity(r) for r in body["timeline"]] == [_identity(r) for r in default_body["timeline"]]
    assert res.headers.get("X-Balance-Walk-Mode") == "client"
    assert res.headers.get("X-Balance-Walk-Skipped") == "true"


@pytest.mark.django_db
def test_unknown_balance_walk_keeps_server_behavior(
    user, household, checking, expense_rule, auth_client
):
    today = date.today()
    _warm_canonical(user, household, today)
    res = auth_client.get("/api/timeline/", _params(checking, today, balance_walk="nope"))
    assert res.status_code == 200
    body = res.json()
    assert "engine_shadow" not in body
    assert any(r.get("balance_after") not in (None, "") for r in body["timeline"])


@pytest.mark.django_db
@override_settings(TIMELINE_CACHE_ENABLED=True)
def test_client_skip_payload_is_not_stored_in_http_cache(
    user, household, checking, expense_rule, auth_client
):
    today = date.today()
    cache.clear()
    params = _params(checking, today)
    client_res = auth_client.get("/api/timeline/", {**params, "balance_walk": "client"})
    assert client_res.status_code == 200
    assert client_res.headers.get("X-Timeline-Cache") == "miss"
    assert all(r.get("balance_after") is None for r in client_res.json()["timeline"])

    plain = auth_client.get("/api/timeline/", params)
    assert plain.status_code == 200
    assert plain.headers.get("X-Timeline-Cache") == "miss"
    assert any(r.get("balance_after") not in (None, "") for r in plain.json()["timeline"])
    assert "engine_shadow" not in plain.json()

    cached_plain = auth_client.get("/api/timeline/", params)
    assert cached_plain.headers.get("X-Timeline-Cache") == "hit"
    assert any(r.get("balance_after") not in (None, "") for r in cached_plain.json()["timeline"])

    cached_client = auth_client.get("/api/timeline/", {**params, "balance_walk": "client"})
    assert cached_client.status_code == 200
    assert cached_client.headers.get("X-Timeline-Cache") == "hit"
    body = cached_client.json()
    assert body["engine_shadow"]["balance_walk_source"] == "client"
    assert all(r.get("balance_after") is None for r in body["timeline"])


@pytest.mark.django_db
def test_client_skip_does_not_raise_and_keeps_row_order(
    user, household, checking, expense_rule, auth_client
):
    today = date.today()
    _warm_canonical(user, household, today)
    server = auth_client.get("/api/timeline/", _params(checking, today)).json()["timeline"]
    client = auth_client.get(
        "/api/timeline/", _params(checking, today, balance_walk="client")
    ).json()["timeline"]
    assert [r["transaction_id"] for r in client] == [r["transaction_id"] for r in server]
    assert [r["date"] for r in client] == [r["date"] for r in server]


@pytest.mark.django_db
def test_client_mode_query_count_does_not_reload_walk_anchors(
    user, household, checking, expense_rule, auth_client
):
    today = date.today()
    _warm_canonical(user, household, today)
    # Prime any one-off auth/session queries.
    auth_client.get("/api/timeline/", _params(checking, today))

    with CaptureQueriesContext(connection) as shadow_qs:
        shadow = auth_client.get(
            "/api/timeline/",
            _params(checking, today, include_engine_shadow="true"),
        )
    with CaptureQueriesContext(connection) as client_qs:
        client = auth_client.get(
            "/api/timeline/",
            _params(checking, today, balance_walk="client"),
        )
    assert shadow.status_code == 200
    assert client.status_code == 200
    print(
        f"[timeline-query-count] shadow={len(shadow_qs.captured_queries)} "
        f"client={len(client_qs.captured_queries)}"
    )
    assert len(client_qs.captured_queries) <= len(shadow_qs.captured_queries)


def _seed_planned_rows(household, n_accounts: int, n_rows: int) -> Account:
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
    return primary


@pytest.mark.django_db
@pytest.mark.parametrize("n_rows,n_accounts", [(400, 8), (600, 12), (1000, 12)])
@override_settings(TIMELINE_CACHE_ENABLED=False, ENABLE_PERF_LOGS=True)
def test_balance_walk_timing_server_shadow_client(
    user, household, auth_client, n_rows, n_accounts
):
    primary = _seed_planned_rows(household, n_accounts, n_rows)
    today = date.today()
    days = 80
    _warm_canonical(user, household, today, days=days)
    params = {
        "start": today.isoformat(),
        "end": (today + timedelta(days=days)).isoformat(),
        "as_of": today.isoformat(),
        "account_id": primary.pk,
        "exclude_reconciled_past": "true",
    }

    def _timed(extra: dict) -> dict:
        t0 = time.perf_counter()
        res = auth_client.get("/api/timeline/", {**params, **extra})
        elapsed = (time.perf_counter() - t0) * 1000
        assert res.status_code == 200
        return {
            "status": res.status_code,
            "rows": len(res.json()["timeline"]),
            "elapsed_ms": elapsed,
            "assembly_ms": res.headers.get("X-Timeline-Assembly-Ms"),
            "walk_ms": res.headers.get("X-Balance-Walk-Ms"),
            "skipped": res.headers.get("X-Balance-Walk-Skipped"),
            "mode": res.headers.get("X-Balance-Walk-Mode"),
            "service_ms": res.headers.get("X-Timeline-Elapsed-Ms"),
            "canonical": res.headers.get("X-Canonical-Timeline"),
        }

    server = _timed({})
    shadow = _timed({"include_engine_shadow": "true"})
    client = _timed({"balance_walk": "client"})
    print(
        f"[timeline-bench] rows_requested={n_rows} accounts={n_accounts} "
        f"returned_server={server['rows']} returned_client={client['rows']} "
        f"canonical={server['canonical']} "
        f"server={{elapsed={server['elapsed_ms']:.1f} assembly={server['assembly_ms']} "
        f"walk={server['walk_ms']} service={server['service_ms']}}} "
        f"shadow={{elapsed={shadow['elapsed_ms']:.1f} assembly={shadow['assembly_ms']} "
        f"walk={shadow['walk_ms']} service={shadow['service_ms']}}} "
        f"client={{elapsed={client['elapsed_ms']:.1f} assembly={client['assembly_ms']} "
        f"skipped={client['skipped']} service={client['service_ms']}}}"
    )
    assert server["mode"] == "server"
    assert shadow["mode"] == "server"
    assert client["mode"] == "client"
    assert client["skipped"] == "true"
    assert server["walk_ms"] is not None
    assert client["rows"] == server["rows"]
