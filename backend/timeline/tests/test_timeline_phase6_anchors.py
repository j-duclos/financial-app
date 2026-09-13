"""Phase 6: one posted-before-pending snapshot per /api/timeline/ request."""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Account
from core.models import Household, HouseholdMembership
from timeline.services.canonical_timeline_cache import (
    get_or_build_canonical_forecast_timeline,
    peek_canonical_forecast_timeline,
)
from timeline.services.engine_shadow import load_posted_before_pending_anchors
from timeline.services.ledger_anchors import load_ledger_anchor_snapshots
from timeline.services.ledger_section_balances import _resolve_ledger_anchors
from timeline.services.timeline_perf import last_timeline_perf
from timeline.views import _load_timeline_anchor_snapshots
from transactions.models import Reconciliation, Transaction
from transactions.services.posting import create_transfer
from transactions.services.reconciliation import (
    ledger_today_balances_before_pending,
    past_ledger_opening_balance,
)

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
    return User.objects.create_user(username="p6_user", password="pass1234")


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="P6 HH")
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
        caller="p6_warm",
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


def _shadow_anchor_map(payload: dict) -> dict[int, str]:
    return {
        int(item["account_id"]): item["posted_balance_before_pending"]
        for item in (payload.get("engine_shadow") or {}).get("accounts") or []
    }


def _completed_reconciliation(account, user, *, balance: Decimal, period_end: date) -> Reconciliation:
    return Reconciliation.objects.create(
        user=user,
        account=account,
        bank_current_balance=balance,
        app_current_balance=balance,
        last_reconciled_balance=balance,
        final_reconciled_balance=balance,
        difference=Decimal("0"),
        status=Reconciliation.Status.COMPLETED,
        is_active=True,
        completed_at=timezone.now(),
        period_start_date=period_end.replace(day=1),
        period_end_date=period_end,
    )


@pytest.mark.django_db
@override_settings(TIMELINE_CACHE_ENABLED=False)
def test_posted_before_pending_is_not_past_opening(user, household):
    checking = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Checking",
        currency="USD",
        starting_balance=Decimal("1000.00"),
        include_in_forecast=True,
    )
    today = date.today()
    _completed_reconciliation(
        checking, user, balance=Decimal("1000.00"), period_end=today - timedelta(days=10)
    )
    Transaction.objects.create(
        account=checking,
        date=today - timedelta(days=2),
        payee="Posted coffee",
        amount=Decimal("-25.00"),
        status=Transaction.Status.CLEARED,
        source=Transaction.Source.ACTUAL,
        cleared=True,
    )
    snapshots = load_ledger_anchor_snapshots({checking.pk}, today)
    snap = snapshots[checking.pk]
    assert snap.posted_balance_before_pending == Decimal("975.00")
    assert snap.past_opening_from_checkpoint() == Decimal("1000.00")
    assert past_ledger_opening_balance(checking, today) == Decimal("1000.00")
    assert snap.posted_balance_before_pending != snap.past_opening_from_checkpoint()


@pytest.mark.django_db
@override_settings(TIMELINE_CACHE_ENABLED=False)
def test_checkpoint_past_opening_skips_sql_fallback(user, household, auth_client):
    checking = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Checking",
        currency="USD",
        starting_balance=Decimal("1000.00"),
        include_in_forecast=True,
    )
    today = date.today()
    _completed_reconciliation(
        checking, user, balance=Decimal("1000.00"), period_end=today - timedelta(days=10)
    )
    Transaction.objects.create(
        account=checking,
        date=today + timedelta(days=1),
        payee="Upcoming",
        amount=Decimal("-40.00"),
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.ONE_TIME,
        tags=[],
    )
    _warm(user, household, today, 30)
    with patch(
        "transactions.services.reconciliation.past_ledger_opening_balance",
        wraps=past_ledger_opening_balance,
    ) as spy:
        res = auth_client.get("/api/timeline/", _params(checking, today, 30))
    assert res.status_code == 200
    spy.assert_not_called()
    assert res.json()["past_opening_balance"] == str(past_ledger_opening_balance(checking, today))


@pytest.mark.django_db
@override_settings(TIMELINE_CACHE_ENABLED=False)
def test_never_reconciled_past_opening_keeps_sql(user, household, auth_client):
    primary = _seed_household(household, 2, 20)
    today = date.today()
    _warm(user, household, today, 30)
    with patch(
        "transactions.services.reconciliation.past_ledger_opening_balance",
        wraps=past_ledger_opening_balance,
    ) as spy:
        res = auth_client.get("/api/timeline/", _params(primary, today, 30))
    assert res.status_code == 200
    spy.assert_called()
    assert res.json()["past_opening_balance"] == str(past_ledger_opening_balance(primary, today))


@pytest.mark.django_db
@override_settings(TIMELINE_CACHE_ENABLED=False)
def test_server_shadow_client_share_one_anchor_load(user, household, auth_client):
    primary = _seed_household(household, 3, 40)
    today = date.today()
    _warm(user, household, today, 80)
    expected = load_ledger_anchor_snapshots({primary.pk}, today)[primary.pk]
    expected_posted = format(expected.posted_balance_before_pending.quantize(Decimal("0.01")), "f")

    fallback_used: list[bool] = []
    orig_resolve = _resolve_ledger_anchors

    def _wrapped_resolve(account_ids, today_value, anchors):
        fallback_used.append(anchors is None)
        return orig_resolve(account_ids, today_value, anchors)

    payloads = {}
    with (
        patch("timeline.views._load_timeline_anchor_snapshots", wraps=_load_timeline_anchor_snapshots) as load_spy,
        patch(
            "timeline.services.ledger_section_balances._resolve_ledger_anchors",
            side_effect=_wrapped_resolve,
        ),
        patch(
            "timeline.services.engine_shadow.load_posted_before_pending_anchors",
            wraps=load_posted_before_pending_anchors,
        ) as engine_load_spy,
        patch(
            "transactions.services.reconciliation.ledger_today_balances_before_pending",
            wraps=ledger_today_balances_before_pending,
        ) as bulk_spy,
    ):
        for name, extra in (
            ("server", {}),
            ("shadow", {"include_engine_shadow": "true"}),
            ("client", {"balance_walk": "client"}),
        ):
            load_spy.reset_mock()
            engine_load_spy.reset_mock()
            bulk_spy.reset_mock()
            fallback_used.clear()
            res = auth_client.get("/api/timeline/", {**_params(primary, today, 80), **extra})
            assert res.status_code == 200, res.json()
            payloads[name] = res.json()
            assert load_spy.call_count == 1
            assert set(load_spy.call_args.args[0]) == {primary.pk}
            engine_load_spy.assert_not_called()
            bulk_spy.assert_not_called()
            if name == "client":
                assert fallback_used == []
            else:
                assert fallback_used == [False]

    shadow_map = _shadow_anchor_map(payloads["shadow"])
    client_map = _shadow_anchor_map(payloads["client"])
    assert shadow_map == client_map
    assert shadow_map[primary.pk] == expected_posted
    assert "engine_shadow" not in payloads["server"]
    server_ids = [_identity(r) for r in payloads["server"]["timeline"]]
    shadow_ids = [_identity(r) for r in payloads["shadow"]["timeline"]]
    client_ids = [_identity(r) for r in payloads["client"]["timeline"]]
    assert server_ids == shadow_ids == client_ids
    assert all(r["balance_after"] is None for r in payloads["client"]["timeline"])
    assert payloads["server"]["timeline"]
    assert payloads["server"]["timeline"][0]["balance_after"] is not None


@pytest.mark.django_db
@override_settings(TIMELINE_CACHE_ENABLED=False)
def test_household_wide_server_skips_anchor_load(user, household, auth_client):
    _seed_household(household, 3, 40)
    today = date.today()
    _warm(user, household, today, 30)
    with patch(
        "timeline.views._load_timeline_anchor_snapshots",
        wraps=_load_timeline_anchor_snapshots,
    ) as spy:
        res = auth_client.get("/api/timeline/", _params(None, today, 30))
    assert res.status_code == 200
    spy.assert_not_called()


@pytest.mark.django_db
@override_settings(TIMELINE_CACHE_ENABLED=False)
def test_canonical_cache_not_mutated_after_injected_walk(user, household, auth_client):
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
def test_transfer_and_pending_order_unchanged_across_modes(user, household, auth_client):
    checking = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Checking",
        currency="USD",
        starting_balance=Decimal("2000.00"),
        include_in_forecast=True,
    )
    savings = Account.objects.create(
        household=household,
        account_type=Account.AccountType.SAVINGS,
        name="Savings",
        currency="USD",
        starting_balance=Decimal("500.00"),
        include_in_forecast=True,
    )
    today = date.today()
    create_transfer(
        user,
        from_account_id=checking.pk,
        to_account_id=savings.pk,
        amount=Decimal("150.00"),
        transfer_date=today + timedelta(days=2),
        payee="Move to savings",
    )
    Transaction.objects.create(
        account=checking,
        date=today,
        payee="Pending bill",
        amount=Decimal("-20.00"),
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.ONE_TIME,
        tags=[],
    )
    _warm(user, household, today, 30)
    server = auth_client.get("/api/timeline/", _params(checking, today, 30))
    shadow = auth_client.get(
        "/api/timeline/",
        {**_params(checking, today, 30), "include_engine_shadow": "true"},
    )
    client = auth_client.get(
        "/api/timeline/",
        {**_params(checking, today, 30), "balance_walk": "client"},
    )
    assert server.status_code == shadow.status_code == client.status_code == 200
    server_ids = [_identity(r) for r in server.json()["timeline"]]
    assert server_ids == [_identity(r) for r in shadow.json()["timeline"]]
    assert server_ids == [_identity(r) for r in client.json()["timeline"]]
    descriptions = [r["description"] for r in server.json()["timeline"]]
    assert "Pending bill" in descriptions
    assert any("savings" in (d or "").lower() for d in descriptions)


@pytest.mark.django_db
@override_settings(TIMELINE_CACHE_ENABLED=False)
def test_historical_lookback_past_opening_unchanged(user, household, auth_client):
    checking = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Checking",
        currency="USD",
        starting_balance=Decimal("1000.00"),
        include_in_forecast=True,
    )
    today = date.today()
    _completed_reconciliation(
        checking, user, balance=Decimal("880.00"), period_end=today - timedelta(days=20)
    )
    Transaction.objects.create(
        account=checking,
        date=today - timedelta(days=5),
        payee="Posted",
        amount=Decimal("-10.00"),
        status=Transaction.Status.CLEARED,
        source=Transaction.Source.ACTUAL,
        cleared=True,
    )
    start = (today - timedelta(days=30)).isoformat()
    res = auth_client.get(
        "/api/timeline/",
        {
            "start": start,
            "end": (today + timedelta(days=30)).isoformat(),
            "as_of": today.isoformat(),
            "exclude_reconciled_past": "true",
            "account_id": checking.pk,
        },
    )
    assert res.status_code == 200
    assert res.json()["past_opening_balance"] == str(past_ledger_opening_balance(checking, today))


@pytest.mark.django_db
@pytest.mark.parametrize("n_rows,n_accounts,days", [(400, 8, 80), (600, 12, 80), (1000, 12, 80)])
@override_settings(TIMELINE_CACHE_ENABLED=False, ENABLE_PERF_LOGS=True)
def test_warm_anchor_reuse_stage_timings(user, household, auth_client, n_rows, n_accounts, days):
    primary = _seed_household(household, n_accounts, n_rows)
    today = date.today()
    cache.clear()

    def _run(extra: dict, label: str) -> dict:
        res = auth_client.get("/api/timeline/", {**_params(primary, today, days), **extra})
        assert res.status_code == 200
        stats = last_timeline_perf()
        assert stats is not None
        print(
            f"[timeline-perf-p6] {label} rows={n_rows} accounts={n_accounts} "
            f"total_ms={stats['total_ms']} anchor_ms={stats['anchor_ms']} "
            f"past_opening_ms={stats['past_opening_ms']} "
            f"balance_walk_ms={stats['balance_walk_ms']} "
            f"summary_ms={stats['account_summary_ms']} queries={stats['db_queries']}"
        )
        return stats

    miss = auth_client.get("/api/timeline/", _params(primary, today, days))
    assert miss.status_code == 200
    miss_stats = last_timeline_perf()
    print(
        f"[timeline-perf-p6-miss] rows={n_rows} accounts={n_accounts} "
        f"total_ms={miss_stats['total_ms']} "
        f"forecast_build_ms={miss_stats['forecast_build_ms']} "
        f"running_balances_ms={miss_stats['running_balances_ms']} "
        f"queries={miss_stats['db_queries']}"
    )
    server = _run({}, "server")
    shadow = _run({"include_engine_shadow": "true"}, "shadow")
    client = _run({"balance_walk": "client"}, "client")
    assert server["returned_rows"] == client["returned_rows"] == shadow["returned_rows"]
    assert client["balance_walk_ms"] == 0


@pytest.mark.django_db
@override_settings(TIMELINE_CACHE_ENABLED=False, ENABLE_PERF_LOGS=True)
def test_narrow_request_shapes_phase6(user, household, auth_client):
    primary = _seed_household(household, 12, 600)
    today = date.today()
    _warm(user, household, today, 30)
    shapes = [
        ("one_30", _params(primary, today, 30)),
        ("all_30", _params(None, today, 30)),
    ]
    for name, params in shapes:
        res = auth_client.get("/api/timeline/", params)
        assert res.status_code == 200
        stats = last_timeline_perf()
        print(
            f"[timeline-perf-p6-shape] {name} total_ms={stats['total_ms']} "
            f"anchor_ms={stats['anchor_ms']} past_opening_ms={stats['past_opening_ms']} "
            f"balance_walk_ms={stats['balance_walk_ms']} "
            f"summary_ms={stats['account_summary_ms']} queries={stats['db_queries']}"
        )
        if name.startswith("one_"):
            assert stats["requested_accounts"] == 1
    _warm(user, household, today, 90)
    res = auth_client.get("/api/timeline/", _params(primary, today, 90))
    assert res.status_code == 200
    stats = last_timeline_perf()
    print(
        f"[timeline-perf-p6-shape] one_90 total_ms={stats['total_ms']} "
        f"anchor_ms={stats['anchor_ms']} past_opening_ms={stats['past_opening_ms']} "
        f"balance_walk_ms={stats['balance_walk_ms']} "
        f"summary_ms={stats['account_summary_ms']} queries={stats['db_queries']}"
    )


@pytest.mark.django_db
@override_settings(ENABLE_PERF_LOGS=True)
def test_running_balances_miss_is_bulk_python(user, household):
    primary = _seed_household(household, 12, 200)
    today = date.today()
    cache.clear()
    from timeline.services.ledger import build_timeline

    rows = build_timeline(
        user,
        start_date=today,
        end_date=today + timedelta(days=80),
        household_id=household.pk,
        account_id=primary.pk,
        as_of_date=today,
        projection_only=True,
        exclude_reconciled_past=True,
        caller="p6_running_balances",
    )
    assert rows
    assert all("running_balance" in r for r in rows)
