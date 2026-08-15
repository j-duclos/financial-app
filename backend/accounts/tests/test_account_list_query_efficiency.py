"""Accounts list SQL efficiency: lightweight vs enriched, N+1 bounds."""
from __future__ import annotations

import time
from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db import connection
from django.db.models.query import QuerySet
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from accounts.models import Account
from accounts.relationship_models import AccountRelationship
from common.services.profiler import get_build_timeline_count, reset_build_timeline_count
from core.models import Household, HouseholdMembership
from transactions.models import Transaction
from transactions.services.posting import post_transaction

User = get_user_model()
AS_OF = date.today()
WRITE_SQL = ("INSERT", "UPDATE", "DELETE")
LIGHTWEIGHT = "/api/accounts/?balance=true&page_size=500"
ENRICHED = (
    "/api/accounts/?balance=true&forecast_summary=true&health=true&days=30&page_size=500"
)


@pytest.fixture
def user(db):
    return User.objects.create_user(username="accteff", password="testpass123")


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="Accounts Efficiency HH")
    HouseholdMembership.objects.create(
        household=h, user=user, role=HouseholdMembership.Role.OWNER
    )
    return h


@pytest.fixture
def auth_client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _make_checking(household, name: str, starting: str = "1200") -> Account:
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        name=name,
        starting_balance=Decimal(starting),
        minimum_buffer=Decimal("100"),
        currency="USD",
    )


def _make_card(household, name: str, owed: str = "400") -> Account:
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        role=Account.AccountRole.CREDIT_CARD,
        name=name,
        credit_limit=Decimal("5000"),
        starting_balance=-Decimal(owed),
        current_balance=Decimal(owed),
        statement_balance=Decimal(owed),
        last_statement_date=AS_OF - timedelta(days=20),
        apr=Decimal("19.99"),
        payment_due_day=10,
        statement_closing_day=15,
        next_payment_due_date=AS_OF + timedelta(days=12),
        minimum_payment_amount=Decimal("25"),
        currency="USD",
    )


def _make_savings(household, name: str = "Savings") -> Account:
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.SAVINGS,
        role=Account.AccountRole.SAVINGS,
        name=name,
        starting_balance=Decimal("8000"),
        minimum_buffer=Decimal("500"),
        currency="USD",
    )


def _seed_unmatched_import(account: Account) -> None:
    Transaction.objects.create(
        account=account,
        date=AS_OF - timedelta(days=2),
        payee="Plaid import",
        amount=Decimal("-12.34"),
        status=Transaction.Status.CLEARED,
        source=Transaction.Source.PLAID,
        import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
    )


def seed_accounts_fixture(
    user,
    household,
    *,
    n_checking: int,
    n_cards: int,
    n_txns_per_account: int = 8,
    n_relationships: int = 1,
) -> dict[str, list]:
    checkings = [
        _make_checking(household, f"Checking {i}", starting="1500")
        for i in range(n_checking)
    ]
    cards = [_make_card(household, f"Card {i}") for i in range(n_cards)]
    savings = _make_savings(household)
    accounts = checkings + cards + [savings]
    for acc in accounts:
        _seed_unmatched_import(acc)
        for j in range(n_txns_per_account):
            post_transaction(
                user,
                acc.id,
                AS_OF - timedelta(days=j + 1),
                f"{acc.name} txn {j}",
                Decimal("-11.50"),
            )
    if cards and checkings:
        for i in range(min(n_relationships, len(cards), len(checkings))):
            AccountRelationship.objects.create(
                household=household,
                source_account=checkings[i],
                destination_account=cards[i],
                relationship_type=AccountRelationship.RelationshipType.CREDIT_CARD_PAYMENT,
                is_active=True,
            )
    return {"checkings": checkings, "cards": cards, "savings": [savings]}


def _sql_count(queries, needle: str) -> int:
    token = needle.lower()
    return sum(1 for q in queries if token in q["sql"].lower())


def _financial_writes(queries) -> list[str]:
    out = []
    for q in queries:
        sql = q["sql"].strip()
        verb = sql.split(None, 1)[0].upper() if sql else ""
        if verb not in WRITE_SQL:
            continue
        low = sql.lower()
        if any(
            needle in low
            for needle in ("accounts_account", "transactions_transaction", "goals_")
        ):
            out.append(sql)
    return out


def _capture(auth_client, url: str, monkeypatch):
    import accounts.services.account_health as ah
    import accounts.services.available_to_spend as ats
    import accounts.services.projected_statement as ps
    import credit_cards.services.payoff as payoff

    counters = {
        "forecast_account": 0,
        "forecast_batch": 0,
        "health_batch": 0,
        "projected_batch": 0,
        "payoff_batch": 0,
        "account_annotated_fetches": 0,
    }
    orig_account = ats.calculate_account_forecast_summary
    orig_batch = ats._calculate_forecast_summaries_for_accounts
    orig_health = ah.calculate_account_health_for_accounts
    orig_projected = ps.calculate_projected_statements_for_accounts
    orig_payoff = payoff.payoff_estimates_for_accounts
    orig_fetch = QuerySet._fetch_all

    def wrapped_account(*args, **kwargs):
        counters["forecast_account"] += 1
        return orig_account(*args, **kwargs)

    def wrapped_batch(*args, **kwargs):
        counters["forecast_batch"] += 1
        return orig_batch(*args, **kwargs)

    def wrapped_health(*args, **kwargs):
        counters["health_batch"] += 1
        return orig_health(*args, **kwargs)

    def wrapped_projected(*args, **kwargs):
        counters["projected_batch"] += 1
        return orig_projected(*args, **kwargs)

    def wrapped_payoff(*args, **kwargs):
        counters["payoff_batch"] += 1
        return orig_payoff(*args, **kwargs)

    def wrapped_fetch(self):
        if (
            getattr(self, "model", None) is Account
            and getattr(self, "_result_cache", None) is None
        ):
            sql = str(self.query).lower()
            if "last_activity" in sql or ("max(" in sql and "transactions" in sql):
                counters["account_annotated_fetches"] += 1
        return orig_fetch(self)

    monkeypatch.setattr(ats, "calculate_account_forecast_summary", wrapped_account)
    monkeypatch.setattr(ats, "_calculate_forecast_summaries_for_accounts", wrapped_batch)
    monkeypatch.setattr(ah, "calculate_account_health_for_accounts", wrapped_health)
    monkeypatch.setattr(
        "accounts.views.calculate_account_health_for_accounts", wrapped_health
    )
    monkeypatch.setattr(ps, "calculate_projected_statements_for_accounts", wrapped_projected)
    monkeypatch.setattr(
        "accounts.views.calculate_projected_statements_for_accounts", wrapped_projected
    )
    monkeypatch.setattr(payoff, "payoff_estimates_for_accounts", wrapped_payoff)
    monkeypatch.setattr(QuerySet, "_fetch_all", wrapped_fetch)

    cache.clear()
    reset_build_timeline_count()
    start = time.perf_counter()
    with CaptureQueriesContext(connection) as ctx:
        response = auth_client.get(url)
    elapsed_ms = (time.perf_counter() - start) * 1000
    assert response.status_code == 200, response.content
    return {
        "response": response,
        "sql": len(ctx.captured_queries),
        "queries": ctx.captured_queries,
        "elapsed_ms": elapsed_ms,
        "timeline_builds": get_build_timeline_count(),
        "writes": _financial_writes(ctx.captured_queries),
        **counters,
    }


def test_profile_account_list_query_counts(user, household, auth_client, monkeypatch, capsys):
    seed_accounts_fixture(
        user,
        household,
        n_checking=5,
        n_cards=5,
        n_txns_per_account=12,
        n_relationships=3,
    )

    light = _capture(auth_client, LIGHTWEIGHT, monkeypatch)
    enriched = _capture(auth_client, ENRICHED, monkeypatch)

    print(
        "\nACCOUNTS_LIST_QUERY_PROFILE "
        f"light_sql={light['sql']} "
        f"light_ms={light['elapsed_ms']:.0f} "
        f"light_account_qs={light['account_annotated_fetches']} "
        f"light_timeline={light['timeline_builds']} "
        f"light_forecast_batch={light['forecast_batch']} "
        f"light_health={light['health_batch']} "
        f"enriched_sql={enriched['sql']} "
        f"enriched_ms={enriched['elapsed_ms']:.0f} "
        f"enriched_account_qs={enriched['account_annotated_fetches']} "
        f"enriched_timeline={enriched['timeline_builds']} "
        f"enriched_forecast_account={enriched['forecast_account']} "
        f"enriched_forecast_batch={enriched['forecast_batch']} "
        f"enriched_health={enriched['health_batch']} "
        f"enriched_projected={enriched['projected_batch']} "
        f"enriched_payoff={enriched['payoff_batch']} "
        f"light_writes={len(light['writes'])} "
        f"enriched_writes={len(enriched['writes'])}"
    )

    assert light["sql"] > 0
    assert enriched["sql"] > 0


def test_lightweight_and_enriched_query_count_does_not_scale_with_accounts(
    user, household, auth_client, monkeypatch
):
    seed_accounts_fixture(
        user, household, n_checking=1, n_cards=1, n_txns_per_account=6, n_relationships=1
    )
    small_light = _capture(auth_client, LIGHTWEIGHT, monkeypatch)
    small_enriched = _capture(auth_client, ENRICHED, monkeypatch)

    household2 = Household.objects.create(name="Accounts Efficiency HH 2")
    HouseholdMembership.objects.create(
        household=household2, user=user, role=HouseholdMembership.Role.OWNER
    )
    seed_accounts_fixture(
        user,
        household2,
        n_checking=6,
        n_cards=6,
        n_txns_per_account=6,
        n_relationships=4,
    )
    large_light = _capture(auth_client, LIGHTWEIGHT, monkeypatch)
    large_enriched = _capture(auth_client, ENRICHED, monkeypatch)

    extra_accounts = 13  # 6 checking + 6 cards + 1 savings in household2
    assert large_light["sql"] <= small_light["sql"] + 8
    # Timeline SQL grows with household data volume; bound per-account N+1 instead.
    assert (large_enriched["sql"] - small_enriched["sql"]) / extra_accounts < 5
    assert _sql_count(large_light["queries"], "UNMATCHED") <= _sql_count(
        small_light["queries"], "UNMATCHED"
    ) + 1
    assert _sql_count(large_enriched["queries"], "UNMATCHED") <= _sql_count(
        small_enriched["queries"], "UNMATCHED"
    ) + 1
    assert _sql_count(large_enriched["queries"], "accounts_account_relationship") <= (
        _sql_count(small_enriched["queries"], "accounts_account_relationship") + 2
    )
    assert large_enriched["forecast_batch"] == small_enriched["forecast_batch"]
    assert large_enriched["health_batch"] == small_enriched["health_batch"]
    assert large_enriched["timeline_builds"] == small_enriched["timeline_builds"]
    assert large_enriched["forecast_account"] == 0
    assert large_enriched["timeline_builds"] <= 1
    assert large_enriched["forecast_batch"] <= 1
    assert large_enriched["health_batch"] <= 1
    assert large_enriched["projected_batch"] <= 1
    assert large_enriched["payoff_batch"] <= 1
    assert large_light["account_annotated_fetches"] <= 2
    assert large_enriched["account_annotated_fetches"] <= 2


def test_enriched_list_does_not_persist_credit_sync(user, household, auth_client):
    seeded = seed_accounts_fixture(
        user, household, n_checking=1, n_cards=1, n_txns_per_account=3
    )
    card = seeded["cards"][0]
    Account.objects.filter(pk=card.pk).update(current_balance=Decimal("9999.00"))
    cache.clear()
    r = auth_client.get(ENRICHED)
    assert r.status_code == 200
    card.refresh_from_db()
    assert card.current_balance == Decimal("9999.00")
    row = next(x for x in r.json()["results"] if x["id"] == card.id)
    assert row.get("balance_owed") is not None
    assert float(row["balance_owed"]) != 9999.00


def test_lightweight_list_omits_relationship_payload_unless_requested(
    user, household, auth_client
):
    seeded = seed_accounts_fixture(
        user, household, n_checking=1, n_cards=1, n_relationships=1
    )
    checking = seeded["checkings"][0]
    light = auth_client.get(LIGHTWEIGHT)
    assert light.status_code == 200
    row = next(x for x in light.json()["results"] if x["id"] == checking.id)
    assert row.get("outgoing_relationships") in (None, [])

    explicit = auth_client.get(LIGHTWEIGHT + "&relationships=true")
    assert explicit.status_code == 200
    explicit_row = next(x for x in explicit.json()["results"] if x["id"] == checking.id)
    assert len(explicit_row.get("outgoing_relationships") or []) >= 1


def test_lightweight_and_enriched_balances_match(user, household, auth_client):
    seeded = seed_accounts_fixture(
        user, household, n_checking=2, n_cards=2, n_txns_per_account=4
    )
    light = auth_client.get(LIGHTWEIGHT)
    enriched = auth_client.get(ENRICHED)
    assert light.status_code == 200
    assert enriched.status_code == 200
    light_by_id = {row["id"]: row for row in light.json()["results"]}
    for row in enriched.json()["results"]:
        base = light_by_id[row["id"]]
        assert row["balance"] == base["balance"]
        assert row.get("balance_owed") == base.get("balance_owed")
        assert row.get("utilization_percent") == base.get("utilization_percent")
    checking = seeded["checkings"][0]
    card = seeded["cards"][0]
    assert not light_by_id[checking.id].get("health_status")
    enriched_card = next(x for x in enriched.json()["results"] if x["id"] == card.id)
    assert enriched_card.get("health_status") is not None
    assert enriched_card.get("projected_statement_balance") is not None


def test_retrieve_still_includes_relationships(user, household, auth_client):
    seeded = seed_accounts_fixture(
        user, household, n_checking=1, n_cards=1, n_relationships=1
    )
    checking = seeded["checkings"][0]
    r = auth_client.get(f"/api/accounts/{checking.id}/")
    assert r.status_code == 200
    assert len(r.json().get("outgoing_relationships") or []) >= 1


def test_health_loop_issues_no_sql_when_list_builds_context(
    user, household, auth_client, monkeypatch
):
    seed_accounts_fixture(
        user, household, n_checking=3, n_cards=3, n_txns_per_account=4, n_relationships=2
    )
    import accounts.services.account_health as ah

    inner_sql = {"count": None}
    orig = ah.calculate_account_health_for_accounts

    def wrapped(*args, **kwargs):
        with CaptureQueriesContext(connection) as ctx:
            result = orig(*args, **kwargs)
        inner_sql["count"] = len(ctx.captured_queries)
        return result

    monkeypatch.setattr("accounts.views.calculate_account_health_for_accounts", wrapped)
    r = auth_client.get(ENRICHED)
    assert r.status_code == 200
    assert inner_sql["count"] == 0
