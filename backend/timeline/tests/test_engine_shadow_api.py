"""GET /api/timeline/ engine_shadow payload — opt-in, no identity inference on the client."""
from __future__ import annotations

import json
from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import override_settings
from rest_framework.test import APIClient

from accounts.models import Account
from categories.models import Category
from core.models import Household, HouseholdMembership
from timeline.models import RecurringRule
from transactions.services.reconciliation import ledger_today_balance_before_pending

User = get_user_model()

ORDERING_FIELDS = (
    "account_id",
    "date",
    "amount",
    "type",
    "status",
    "source",
    "description",
    "transaction_id",
    "financially_active",
    "balance_after",
)


@pytest.fixture
def user(db):
    return User.objects.create_user(username="shadow_user", password="pass1234")


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="Shadow HH")
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


def _json_bytes(body: dict) -> int:
    return len(json.dumps(body, separators=(",", ":"), default=str).encode("utf-8"))


@pytest.mark.django_db
def test_timeline_omits_engine_shadow_by_default(user, household, checking, expense_rule, auth_client):
    today = date.today()
    res = auth_client.get("/api/timeline/", _params(checking, today))
    assert res.status_code == 200
    body = res.json()
    assert "engine_shadow" not in body
    assert "timeline" in body


@pytest.mark.django_db
def test_timeline_engine_shadow_has_explicit_anchors_and_financially_active(
    user, household, checking, expense_rule, auth_client
):
    today = date.today()
    res = auth_client.get("/api/timeline/", _params(checking, today, include_engine_shadow="true"))
    assert res.status_code == 200
    body = res.json()
    shadow = body["engine_shadow"]
    assert shadow["as_of"] == today.isoformat()
    assert shadow["balance_walk_source"] == "server"
    assert shadow["accounts"]
    acct = next(a for a in shadow["accounts"] if a["account_id"] == checking.pk)
    expected_anchor = format(
        ledger_today_balance_before_pending(checking, today).quantize(Decimal("0.01")),
        "f",
    )
    assert acct["posted_balance_before_pending"] == expected_anchor
    assert set(acct.keys()) == {"account_id", "posted_balance_before_pending"}
    assert body["timeline"], "expected at least one pending/upcoming row"
    for row in body["timeline"]:
        for field in ORDERING_FIELDS:
            assert field in row, f"missing {field}"
        assert row["financially_active"] in (True, False)
        # Client must not infer canonical identity — the flag is already resolved.
        assert isinstance(row["financially_active"], bool)


@pytest.mark.django_db
def test_timeline_engine_shadow_payload_size_is_anchors_only(
    user, household, checking, expense_rule, auth_client
):
    today = date.today()
    plain = auth_client.get("/api/timeline/", _params(checking, today))
    shadow = auth_client.get("/api/timeline/", _params(checking, today, include_engine_shadow="true"))
    assert plain.status_code == 200
    assert shadow.status_code == 200
    plain_body = plain.json()
    shadow_body = shadow.json()
    assert set(shadow_body) - set(plain_body) == {"engine_shadow"}
    extra = _json_bytes(shadow_body) - _json_bytes(plain_body)
    shadow_only = _json_bytes(shadow_body["engine_shadow"])
    # Parent key overhead plus optional financially_active copies — not a second timeline.
    assert extra < shadow_only + 64 + (len(shadow_body["timeline"]) * 48)
    assert extra < 4_000


@pytest.mark.django_db
def test_ledger_anchor_still_rejected_when_shadow_requested(checking, auth_client):
    today = date.today()
    res = auth_client.get(
        "/api/timeline/",
        _params(checking, today, include_engine_shadow="true", ledger_anchor="950.00"),
    )
    assert res.status_code == 400
    assert "ledger_anchor" in res.json()["detail"].lower()


@pytest.mark.django_db
@override_settings(TIMELINE_CACHE_ENABLED=True)
def test_engine_shadow_is_not_stored_in_http_cache(
    user, household, checking, expense_rule, auth_client
):
    today = date.today()
    cache.clear()
    params = _params(checking, today)
    first = auth_client.get("/api/timeline/", {**params, "include_engine_shadow": "true"})
    assert first.status_code == 200
    assert "engine_shadow" in first.json()

    cached_plain = auth_client.get("/api/timeline/", params)
    assert cached_plain.status_code == 200
    assert cached_plain.headers.get("X-Timeline-Cache") == "hit"
    assert "engine_shadow" not in cached_plain.json()

    cached_shadow = auth_client.get("/api/timeline/", {**params, "include_engine_shadow": "true"})
    assert cached_shadow.status_code == 200
    assert cached_shadow.headers.get("X-Timeline-Cache") == "hit"
    assert "engine_shadow" in cached_shadow.json()
    assert cached_shadow.json()["engine_shadow"]["accounts"]
