"""Query-count and timing profile for the Payment Planner debt-plan endpoint.

BEFORE (captured 2026-08-15, six cards, current code):
  SQL queries: 121
  ledger_owed_balance calls: 60
  total backend time: 392.1ms
  writes: 0
  weighted APR: 0.00  (bug: used final zeroed simulation state)
  total debt: 4650.00
  interest burn: 102.41
  frontend plan requests typing 1500 with no debounce: 4

AFTER: see test_profile_six_card_plan_endpoint output and assertions below.
"""
from __future__ import annotations

import time
from datetime import date
from decimal import Decimal

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from accounts.models import Account
from accounts.services.credit_card import ledger_owed_balance
from transactions.services.posting import post_transaction

TODAY = date.today()
WRITE_SQL = ("INSERT", "UPDATE", "DELETE")


def _sql_verb(sql: str) -> str:
    return sql.strip().split(None, 1)[0].upper() if sql.strip() else ""


@pytest.fixture
def auth_client(api_client, user):
    api_client.force_authenticate(user=user)
    return api_client


def _make_card(household, index: int, *, apr: str, limit: str, minimum: str) -> Account:
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        name=f"Card {index}",
        credit_limit=Decimal(limit),
        apr=Decimal(apr),
        minimum_payment_amount=Decimal(minimum),
    )


def seed_cards(household, user, n: int) -> list[Account]:
    aprs = ["32.99", "31.99", "29.49", "28.99", "24.99", "18.99", "15.99", "12.99"]
    cards: list[Account] = []
    for i in range(n):
        card = _make_card(
            household,
            i + 1,
            apr=aprs[i % len(aprs)],
            limit=str(2000 + i * 500),
            minimum=str(25 + i * 5),
        )
        post_transaction(
            user,
            card.id,
            TODAY,
            "Charge",
            Decimal(str(-(400 + i * 150))),
        )
        cards.append(card)
    return cards


def _profile_plan(auth_client: APIClient, extra: str = "150") -> dict:
    connection.queries_log.clear()
    t0 = time.perf_counter()
    with CaptureQueriesContext(connection) as ctx:
        res = auth_client.get(
            "/api/credit-cards/plan/",
            {"strategy": "avalanche", "mode": "aggressive", "extra_monthly": extra},
        )
    elapsed_ms = (time.perf_counter() - t0) * 1000
    assert res.status_code == 200, res.content[:400]
    writes = sum(1 for q in ctx.captured_queries if _sql_verb(q["sql"]) in WRITE_SQL)
    return {
        "queries": len(ctx.captured_queries),
        "elapsed_ms": elapsed_ms,
        "writes": writes,
        "body": res.json(),
    }


def _expected_weighted_apr(n: int) -> Decimal:
    aprs = [Decimal(x) for x in ["32.99", "31.99", "29.49", "28.99", "24.99", "18.99", "15.99", "12.99"]]
    num = Decimal("0")
    den = Decimal("0")
    for i in range(n):
        bal = Decimal(str(400 + i * 150))
        apr = aprs[i % len(aprs)]
        num += bal * apr
        den += bal
    return (num / den).quantize(Decimal("0.01"))


@pytest.mark.django_db
def test_profile_six_card_plan_endpoint(auth_client, household, user, monkeypatch):
    seed_cards(household, user, 6)
    calls = {"n": 0}
    orig = ledger_owed_balance

    def wrapped(account, as_of=None):
        calls["n"] += 1
        return orig(account, as_of)

    monkeypatch.setattr("accounts.services.credit_card.ledger_owed_balance", wrapped)
    monkeypatch.setattr("credit_cards.services.debt_engine.ledger_owed_balance", wrapped)
    monkeypatch.setattr("credit_cards.services.payoff.ledger_owed_balance", wrapped)

    stats = _profile_plan(auth_client)
    body = stats["body"]

    from django.core.cache import cache
    from accounts.services.balances import bulk_signed_ledger_balances
    from credit_cards.services.debt_engine import (
        _copy_card_states,
        _load_card_states,
        _run_payoff_loop,
        _simulate_minimums_only,
    )

    cards = list(
        Account.objects.filter(
            household=household, account_type=Account.AccountType.CREDIT
        )
    )
    today = date.today()
    balance_map = bulk_signed_ledger_balances(cards, today)
    opening = _load_card_states(cards, as_of=today, balance_by_account=balance_map)
    t_main = time.perf_counter()
    _run_payoff_loop(
        _copy_card_states(opening),
        strategy="avalanche",
        mode="aggressive",
        extra_monthly=Decimal("150"),
        custom_order=None,
        today=today,
        max_months=360,
    )
    main_ms = (time.perf_counter() - t_main) * 1000
    cache.clear()
    t_base = time.perf_counter()
    _simulate_minimums_only(opening, as_of=today, max_months=360)
    baseline_uncached_ms = (time.perf_counter() - t_base) * 1000
    t_base_hit = time.perf_counter()
    _simulate_minimums_only(opening, as_of=today, max_months=360)
    baseline_cached_ms = (time.perf_counter() - t_base_hit) * 1000

    print(
        "\nPLAN PROFILE six_cards "
        f"queries={stats['queries']} time_ms={stats['elapsed_ms']:.1f} "
        f"writes={stats['writes']} ledger_owed_calls={calls['n']} "
        f"weighted_apr={body.get('weighted_apr')} total_debt={body.get('total_debt')} "
        f"interest_burn={body.get('monthly_interest_burn')} "
        f"main_sim_ms={main_ms:.1f} baseline_uncached_ms={baseline_uncached_ms:.1f} "
        f"baseline_cached_ms={baseline_cached_ms:.1f}"
    )
    assert stats["writes"] == 0
    assert Decimal(body["total_debt"]) == Decimal("4650.00")
    assert Decimal(body["weighted_apr"]) == _expected_weighted_apr(6)
    assert Decimal(body["weighted_apr"]) > 0
    assert calls["n"] == 0
    assert stats["queries"] < 40


@pytest.mark.django_db
def test_plan_query_count_scales_with_cards_not_n_plus_one(auth_client, household, user):
    counts = {}
    for n in (1, 6, 20):
        Account.objects.filter(household=household, account_type=Account.AccountType.CREDIT).delete()
        seed_cards(household, user, n)
        stats = _profile_plan(auth_client)
        counts[n] = stats["queries"]
        assert stats["writes"] == 0
        print(f"\nPLAN SCALE n={n} queries={stats['queries']} time_ms={stats['elapsed_ms']:.1f}")
    assert counts[20] <= counts[1] + 6
    assert counts[6] <= counts[1] + 6


@pytest.mark.django_db
def test_plan_get_is_read_only(auth_client, household, user):
    seed_cards(household, user, 3)
    stats = _profile_plan(auth_client)
    assert stats["writes"] == 0


@pytest.mark.django_db
def test_individual_payoff_uses_one_starting_balance(auth_client, household, user, monkeypatch):
    cards = seed_cards(household, user, 1)
    card = cards[0]
    calls = {"n": 0}
    orig = ledger_owed_balance

    def wrapped(account, as_of=None):
        calls["n"] += 1
        return orig(account, as_of)

    monkeypatch.setattr("accounts.services.credit_card.ledger_owed_balance", wrapped)
    monkeypatch.setattr("credit_cards.services.payoff.ledger_owed_balance", wrapped)
    monkeypatch.setattr("accounts.views.ledger_owed_balance", wrapped)

    res = auth_client.get(
        f"/api/accounts/{card.pk}/payoff/",
        {"strategy": "custom_amount", "custom_amount": "150"},
    )
    assert res.status_code == 200
    assert calls["n"] == 1
    assert res.json()["payoff_possible"] is True
