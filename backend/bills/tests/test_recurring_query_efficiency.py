# BEFORE (26-rule representative page, captured 2026-08-15):
#   bills overview FIRST:  queries=700 inserts=29 updates=29 occ_select=29 occ_insert=29 occ_update=29 time_ms=788
#   bills overview STEADY: queries=580 inserts=0  updates=29 occ_select=29 occ_insert=0  occ_update=29 time_ms=446
#   rules list:            queries=58  inserts=0  updates=0  time_ms=37
#   subscription intel:    queries=60  time_ms=17
#   full page (sum):       842ms
# AFTER:
#   bills overview FIRST:  queries=12 inserts=1 updates=1 occ_select=2 occ_insert=1 occ_update=1 time_ms=348
#   bills overview STEADY: queries=9  inserts=0 updates=0 occ_select=1 occ_insert=0 occ_update=0 time_ms=28
#   rules list:            queries=33 inserts=0 updates=0 time_ms=34
#   subscription intel:    queries=4  time_ms=13
#   full page (sum):       395ms first / ~74ms steady overview + rules + subs

from __future__ import annotations

import time
from calendar import monthrange
from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from accounts.models import Account
from bills.models import BillOccurrence
from categories.models import Category
from core.models import Household, HouseholdMembership
from timeline.models import RecurringRule
from transactions.models import Transaction

User = get_user_model()
AS_OF = date.today()
MONTH_KEY = f"{AS_OF.year:04d}-{AS_OF.month:02d}"
WRITE_SQL = ("INSERT", "UPDATE", "DELETE")


@pytest.fixture
def user(db):
    return User.objects.create_user(username="receff", password="testpass123")


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="Recurring Efficiency HH")
    HouseholdMembership.objects.create(
        household=h, user=user, role=HouseholdMembership.Role.OWNER
    )
    return h


@pytest.fixture
def auth_client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _sql_verb(sql: str) -> str:
    return sql.strip().split(None, 1)[0].upper() if sql.strip() else ""


def _count_table_ops(queries, table: str, verb: str) -> int:
    needle = table.lower()
    target = verb.upper()
    n = 0
    for q in queries:
        sql = q["sql"]
        if needle not in sql.lower():
            continue
        if _sql_verb(sql) == target:
            n += 1
    return n


def _write_verbs(queries) -> dict[str, int]:
    counts = {"INSERT": 0, "UPDATE": 0, "DELETE": 0}
    for q in queries:
        verb = _sql_verb(q["sql"])
        if verb in counts:
            counts[verb] += 1
    return counts


def _profile(auth_client, url: str) -> dict:
    connection.queries_log.clear()
    t0 = time.perf_counter()
    with CaptureQueriesContext(connection) as ctx:
        res = auth_client.get(url)
    elapsed_ms = (time.perf_counter() - t0) * 1000
    assert res.status_code == 200, res.content[:500]
    writes = _write_verbs(ctx.captured_queries)
    return {
        "status": res.status_code,
        "queries": len(ctx.captured_queries),
        "elapsed_ms": elapsed_ms,
        "inserts": writes["INSERT"],
        "updates": writes["UPDATE"],
        "deletes": writes["DELETE"],
        "occ_select": _count_table_ops(ctx.captured_queries, "bills_occurrence", "SELECT"),
        "occ_insert": _count_table_ops(ctx.captured_queries, "bills_occurrence", "INSERT"),
        "occ_update": _count_table_ops(ctx.captured_queries, "bills_occurrence", "UPDATE"),
        "body": res.json(),
        "sql": [q["sql"] for q in ctx.captured_queries],
    }


def _month_day(day: int) -> date:
    last = monthrange(AS_OF.year, AS_OF.month)[1]
    return date(AS_OF.year, AS_OF.month, min(day, last))


def _prior_month_date(months_ago: int, day: int) -> date:
    y, m = AS_OF.year, AS_OF.month - months_ago
    while m < 1:
        m += 12
        y -= 1
    last = monthrange(y, m)[1]
    return date(y, m, min(day, last))


def seed_recurring_page(
    household,
    *,
    n_rules: int = 26,
    with_history: bool = True,
) -> dict:
    checking = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        name="Checking",
        starting_balance=Decimal("5000"),
        currency="USD",
    )
    savings = Account.objects.create(
        household=household,
        account_type=Account.AccountType.SAVINGS,
        role=Account.AccountRole.SAVINGS,
        name="Savings",
        starting_balance=Decimal("8000"),
        currency="USD",
    )
    card = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        role=Account.AccountRole.CREDIT_CARD,
        name="Venture",
        currency="USD",
        credit_limit=Decimal("5000"),
        starting_balance=Decimal("-400"),
        current_balance=Decimal("400"),
    )
    def _cat(name: str) -> Category:
        return Category.objects.get(
            household=household,
            name=name,
            category_type=Category.CategoryType.EXPENSE,
        )

    utilities = _cat("Electricity")
    streaming = _cat("Streaming")
    cc_pay = _cat("Credit Card Payment")
    transfer_cat = _cat("Bank Transfer")

    names = [
        "Electric",
        "Water",
        "Internet",
        "Phone",
        "Netflix",
        "Spotify",
        "Hulu",
        "Gym",
        "Insurance",
        "Rent",
        "Trash",
        "Gas",
        "Sewer",
        "Adobe",
        "iCloud",
        "Storage",
        "HOA",
        "Parking",
        "Daycare",
        "Tuition",
        "Affirm",
        "Peacock",
        "Audible",
        "Dropbox",
        "Credit Card Payment",
        "Bank Transfer",
    ]
    rules = []
    for i in range(n_rules):
        name = names[i] if i < len(names) else f"Bill {i + 1}"
        day = 1 + (i % 28)
        if name == "Credit Card Payment":
            rule = RecurringRule.objects.create(
                household=household,
                name=name,
                account=checking,
                transfer_to_account=card,
                category=cc_pay,
                direction=RecurringRule.Direction.TRANSFER,
                amount=Decimal("200.00"),
                frequency=RecurringRule.Frequency.MONTHLY_DAY,
                day_of_month=min(day, 28),
                start_date=date(2024, 1, 1),
                active=True,
            )
        elif name == "Bank Transfer":
            rule = RecurringRule.objects.create(
                household=household,
                name=name,
                account=checking,
                transfer_to_account=savings,
                category=transfer_cat,
                direction=RecurringRule.Direction.TRANSFER,
                amount=Decimal("300.00"),
                frequency=RecurringRule.Frequency.MONTHLY_DAY,
                day_of_month=min(day, 28),
                start_date=date(2024, 1, 1),
                active=True,
                is_bill=True,
            )
        elif name in {"Netflix", "Spotify", "Hulu", "Peacock", "Audible"}:
            rule = RecurringRule.objects.create(
                household=household,
                name=name,
                account=checking,
                category=streaming,
                direction=RecurringRule.Direction.EXPENSE,
                amount=Decimal("15.99"),
                frequency=RecurringRule.Frequency.MONTHLY_DAY,
                day_of_month=min(day, 28),
                start_date=date(2024, 1, 1),
                active=True,
            )
        elif i == 7:
            rule = RecurringRule.objects.create(
                household=household,
                name=name,
                account=checking,
                category=utilities,
                direction=RecurringRule.Direction.EXPENSE,
                amount=Decimal("40.00"),
                frequency=RecurringRule.Frequency.WEEKLY,
                interval=1,
                day_of_week=4,
                start_date=date(2024, 1, 1),
                active=True,
            )
        elif i == 8:
            rule = RecurringRule.objects.create(
                household=household,
                name=name,
                account=checking,
                category=utilities,
                direction=RecurringRule.Direction.EXPENSE,
                amount=Decimal("55.00"),
                frequency=RecurringRule.Frequency.WEEKLY,
                interval=3,
                day_of_week=4,
                start_date=date(2024, 1, 1),
                active=True,
            )
        elif i == 9:
            rule = RecurringRule.objects.create(
                household=household,
                name=name,
                account=checking,
                category=utilities,
                direction=RecurringRule.Direction.EXPENSE,
                amount=Decimal("1800.00"),
                frequency=RecurringRule.Frequency.MONTHLY_DAY,
                day_of_month=1,
                start_date=date(2024, 1, 1),
                active=False,
                paused_at=AS_OF - timedelta(days=10),
            )
        else:
            rule = RecurringRule.objects.create(
                household=household,
                name=name,
                account=checking,
                category=utilities,
                direction=RecurringRule.Direction.EXPENSE,
                amount=Decimal(str(40 + i)),
                frequency=RecurringRule.Frequency.MONTHLY_DAY,
                day_of_month=min(day, 28),
                start_date=date(2024, 1, 1),
                active=True,
            )
        rules.append(rule)

        if with_history and rule.active:
            due_day = rule.day_of_month or 5
            for ago in range(1, 7):
                txn_date = _prior_month_date(ago, due_day)
                Transaction.objects.create(
                    account=checking,
                    date=txn_date,
                    payee=rule.name,
                    amount=-abs(rule.amount),
                    category=rule.category,
                    status=Transaction.Status.CLEARED,
                    source=Transaction.Source.PLAID if ago <= 4 else Transaction.Source.RULE,
                    rule=rule,
                    cleared=True,
                )
            if i % 3 == 0:
                due = _month_day(due_day)
                if due <= AS_OF:
                    Transaction.objects.create(
                        account=checking,
                        date=due,
                        payee=rule.name,
                        amount=-abs(rule.amount),
                        category=rule.category,
                        status=Transaction.Status.CLEARED,
                        source=Transaction.Source.PLAID,
                        rule=rule,
                        cleared=True,
                    )

    return {
        "checking": checking,
        "savings": savings,
        "card": card,
        "rules": rules,
        "streaming": streaming,
    }


def _print_profile(label: str, stats: dict) -> None:
    print(
        f"\n{label}: queries={stats['queries']} "
        f"inserts={stats['inserts']} updates={stats['updates']} "
        f"occ_select={stats['occ_select']} occ_insert={stats['occ_insert']} "
        f"occ_update={stats['occ_update']} time_ms={stats['elapsed_ms']:.1f}"
    )


@pytest.mark.django_db
def test_recurring_page_metrics_report(auth_client, user, household):
    seed_recurring_page(household, n_rules=26)
    overview_url = (
        f"/api/bills/overview/?month={MONTH_KEY}&months_before=0&months_after=0"
    )
    first = _profile(auth_client, overview_url)
    steady = _profile(auth_client, overview_url)
    rules = _profile(auth_client, "/api/rules/?page_size=200")
    subs = _profile(auth_client, "/api/insights/subscriptions/")
    _print_profile("BEFORE/AFTER bills overview FIRST", first)
    _print_profile("BEFORE/AFTER bills overview STEADY", steady)
    _print_profile("BEFORE/AFTER rules list", rules)
    _print_profile("BEFORE/AFTER subscription intelligence", subs)
    page_ms = first["elapsed_ms"] + rules["elapsed_ms"] + subs["elapsed_ms"]
    print(f"\nFull Recurring page (parallel-equivalent sum of endpoint times): {page_ms:.1f}ms")
    assert first["status"] == 200
    assert steady["status"] == 200
    assert rules["status"] == 200
    assert subs["status"] == 200
    assert len(first["body"]["checklist"]["items"]) >= 10
    assert subs["body"]["subscription_count"] >= 1


def _client_with_rules(n_rules: int, username: str) -> APIClient:
    user = User.objects.create_user(username=username, password="testpass123")
    household = Household.objects.create(name=username)
    HouseholdMembership.objects.create(
        household=household, user=user, role=HouseholdMembership.Role.OWNER
    )
    seed_recurring_page(household, n_rules=n_rules)
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.mark.django_db
def test_bills_overview_query_count_does_not_scale_with_rules():
    url = f"/api/bills/overview/?month={MONTH_KEY}&months_before=0&months_after=0"
    one_client = _client_with_rules(1, "receff1")
    many_client = _client_with_rules(25, "receff25")
    one_client.get(url)
    one = _profile(one_client, url)
    many_client.get(url)
    many = _profile(many_client, url)

    _print_profile("1-rule steady bills overview", one)
    _print_profile("25-rule steady bills overview", many)
    assert many["queries"] - one["queries"] < 15
    assert many["occ_select"] - one["occ_select"] <= 2
    assert many["inserts"] == 0
    assert many["updates"] == 0
    assert one["inserts"] == 0
    assert one["updates"] == 0


@pytest.mark.django_db
def test_bills_overview_missing_occurrences_use_bounded_writes(auth_client, household):
    seed_recurring_page(household, n_rules=25)
    url = f"/api/bills/overview/?month={MONTH_KEY}&months_before=0&months_after=0"
    first = _profile(auth_client, url)
    _print_profile("missing-occurrence bills overview", first)
    assert first["occ_insert"] <= 2
    assert first["occ_update"] <= 2
    assert first["inserts"] <= 4
    steady = _profile(auth_client, url)
    assert steady["inserts"] == 0
    assert steady["updates"] == 0
    assert BillOccurrence.objects.filter(household=household).count() >= 20


@pytest.mark.django_db
def test_subscription_intelligence_query_count_does_not_scale_with_transactions(
    auth_client, household
):
    seeded = seed_recurring_page(household, n_rules=3, with_history=False)
    checking = seeded["checking"]
    streaming = seeded["streaming"]
    today = AS_OF
    for i in range(50):
        Transaction.objects.create(
            account=checking,
            date=today - timedelta(days=(i % 100)),
            payee="Adobe Creative Cloud",
            amount=Decimal("-54.99"),
            category=streaming,
            status=Transaction.Status.CLEARED,
            source=Transaction.Source.PLAID,
            cleared=True,
        )
    small = _profile(auth_client, "/api/insights/subscriptions/")
    for i in range(450):
        Transaction.objects.create(
            account=checking,
            date=today - timedelta(days=(i % 110)),
            payee="Microsoft 365",
            amount=Decimal("-9.99"),
            category=streaming,
            status=Transaction.Status.CLEARED,
            source=Transaction.Source.PLAID,
            cleared=True,
        )
    large = _profile(auth_client, "/api/insights/subscriptions/")
    _print_profile("subscriptions 50 txns", small)
    _print_profile("subscriptions 500 txns", large)
    assert large["queries"] - small["queries"] <= 3
    assert large["queries"] < 25
    assert small["body"]["suggested"] or small["body"]["subscription_count"] >= 0
