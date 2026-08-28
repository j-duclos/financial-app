"""Account ledger list: ascending order + canonical running_balance."""
from datetime import date, timedelta
from decimal import Decimal

import pytest

from accounts.models import Account
from transactions.models import Transaction
from transactions.services.historical_ledger import (
    iter_historical_ledger_steps,
    validate_historical_ledger_chain,
)
from transactions.services.reconciliation import ledger_today_balance_before_pending


@pytest.mark.django_db
def test_transaction_list_ascending_with_running_balances(authenticated_client, household):
    account = Account.objects.create(
        household=household,
        name="Main",
        account_type=Account.AccountType.CHECKING,
        currency="USD",
        starting_balance=Decimal("1000.00"),
    )
    today = date.today()
    t1 = Transaction.objects.create(
        account=account,
        date=today - timedelta(days=3),
        payee="Older",
        amount=Decimal("-100.00"),
        status=Transaction.Status.CLEARED,
        cleared=True,
    )
    t2 = Transaction.objects.create(
        account=account,
        date=today - timedelta(days=1),
        payee="Newer",
        amount=Decimal("-50.00"),
        status=Transaction.Status.CLEARED,
        cleared=True,
    )
    # Same-day pair — id order must be preserved with date,id ascending.
    t3a = Transaction.objects.create(
        account=account,
        date=today,
        payee="A",
        amount=Decimal("-10.00"),
        status=Transaction.Status.CLEARED,
        cleared=True,
    )
    t3b = Transaction.objects.create(
        account=account,
        date=today,
        payee="B",
        amount=Decimal("-20.00"),
        status=Transaction.Status.CLEARED,
        cleared=True,
    )

    r = authenticated_client.get(
        "/api/transactions/",
        {
            "account": account.id,
            "date_after": (today - timedelta(days=14)).isoformat(),
            "date_before": today.isoformat(),
            "ordering": "date,id",
            "include_running_balance": "true",
            "reconciled": "false",
            "page_size": 100,
        },
    )
    assert r.status_code == 200, r.content
    results = r.json()["results"]
    ids = [row["id"] for row in results]
    assert ids == [t1.id, t2.id, t3a.id, t3b.id]
    assert all(row.get("running_balance") is not None for row in results)
    bals = [Decimal(row["running_balance"]) for row in results]
    assert bals[0] == Decimal("900.00")
    assert bals[1] == Decimal("850.00")
    assert bals[2] == Decimal("840.00")
    assert bals[3] == Decimal("820.00")


@pytest.mark.django_db
def test_running_balances_exclude_pending_expected_planned(authenticated_client, household):
    """
    Due PLANNED rule rows must not fold into Recent posted Bal.

    Regression: posted Chewy showed Bal $81.15 because Venture pending -$100
    (and other pending) were applied in the walk — that $81.15 is the Pending
    section ending, not the Recent ending.
    """
    account = Account.objects.create(
        household=household,
        name="Main",
        account_type=Account.AccountType.CHECKING,
        currency="USD",
        starting_balance=Decimal("1000.00"),
    )
    today = date.today()
    # Pending Expected created first (lower ids) so they sort before posted on same day
    # without the skip — that was the production bug (pending folded into Recent Bal).
    Transaction.objects.create(
        account=account,
        date=today,
        payee="Geico",
        amount=Decimal("-400.00"),
        status=Transaction.Status.PLANNED,
        cleared=False,
        source=Transaction.Source.RULE,
    )
    Transaction.objects.create(
        account=account,
        date=today,
        payee="Venture",
        amount=Decimal("-100.00"),
        status=Transaction.Status.PLANNED,
        cleared=False,
        source=Transaction.Source.ONE_TIME,
    )
    posted = Transaction.objects.create(
        account=account,
        date=today,
        payee="Chewy",
        amount=Decimal("-100.00"),
        status=Transaction.Status.CLEARED,
        cleared=True,
        source=Transaction.Source.ACTUAL,
    )

    r = authenticated_client.get(
        "/api/transactions/",
        {
            "account": account.id,
            "date_after": (today - timedelta(days=14)).isoformat(),
            "date_before": today.isoformat(),
            "ordering": "date,id",
            "include_running_balance": "true",
            "reconciled": "false",
            "page_size": 100,
        },
    )
    assert r.status_code == 200, r.content
    by_payee = {row["payee"]: row for row in r.json()["results"]}
    assert "Chewy" in by_payee
    # 1000 - 100 = 900 — not 1000 - 100 - 400 - 100 = 400
    assert Decimal(by_payee["Chewy"]["running_balance"]) == Decimal("900.00")
    assert posted.id == by_payee["Chewy"]["id"]


@pytest.mark.django_db
def test_default_ordering_remains_descending_without_param(authenticated_client, household):
    account = Account.objects.create(
        household=household,
        name="Main",
        account_type=Account.AccountType.CHECKING,
        currency="USD",
        starting_balance=Decimal("100.00"),
    )
    today = date.today()
    Transaction.objects.create(
        account=account,
        date=today - timedelta(days=2),
        payee="Old",
        amount=Decimal("-1.00"),
        status=Transaction.Status.CLEARED,
        cleared=True,
    )
    Transaction.objects.create(
        account=account,
        date=today,
        payee="New",
        amount=Decimal("-2.00"),
        status=Transaction.Status.CLEARED,
        cleared=True,
    )
    r = authenticated_client.get(
        "/api/transactions/",
        {"account": account.id, "page_size": 10},
    )
    assert r.status_code == 200
    payees = [row["payee"] for row in r.json()["results"]]
    assert payees[0] == "New"


STARTING = Decimal("1828.40")
PAYMENT = Decimal("-329.02")
EXPECTED_AFTER = STARTING + PAYMENT


@pytest.mark.django_db
def test_first_row_balance_after_not_starting(authenticated_client, household):
    """First visible row must show starting + signed amount, never starting alone."""
    account = Account.objects.create(
        household=household,
        name="Main",
        account_type=Account.AccountType.CHECKING,
        currency="USD",
        starting_balance=STARTING,
    )
    pay_day = date(2026, 8, 17)
    txn = Transaction.objects.create(
        account=account,
        date=pay_day,
        payee="Quicksilver C/C Payment",
        amount=PAYMENT,
        status=Transaction.Status.CLEARED,
        cleared=True,
        source=Transaction.Source.ACTUAL,
    )
    opening, steps = iter_historical_ledger_steps(account, as_of=date(2026, 8, 28))
    validate_historical_ledger_chain(opening_balance=opening, steps=steps)
    assert opening == STARTING
    participating = [s for s in steps if s.participates]
    assert len(participating) == 1
    assert participating[0].balance_after == EXPECTED_AFTER
    assert participating[0].balance_before == STARTING

    r = authenticated_client.get(
        "/api/transactions/",
        {
            "account": account.id,
            "date_after": "2026-08-01",
            "date_before": "2026-08-28",
            "ordering": "date,id",
            "include_running_balance": "true",
            "reconciled": "false",
            "page_size": 100,
        },
    )
    assert r.status_code == 200, r.content
    row = next(x for x in r.json()["results"] if x["id"] == txn.id)
    assert Decimal(row["running_balance"]) == EXPECTED_AFTER


@pytest.mark.django_db
def test_date_edit_recomputes_running_balance(authenticated_client, household):
    """Moving 08/18 → 08/17 must recompute balance_after from checkpoint opening."""
    account = Account.objects.create(
        household=household,
        name="Main",
        account_type=Account.AccountType.CHECKING,
        currency="USD",
        starting_balance=STARTING,
    )
    txn = Transaction.objects.create(
        account=account,
        date=date(2026, 8, 18),
        payee="Quicksilver C/C Payment",
        amount=PAYMENT,
        status=Transaction.Status.CLEARED,
        cleared=True,
        source=Transaction.Source.ACTUAL,
    )
    later = Transaction.objects.create(
        account=account,
        date=date(2026, 8, 20),
        payee="Groceries",
        amount=Decimal("-50.00"),
        status=Transaction.Status.CLEARED,
        cleared=True,
        source=Transaction.Source.ACTUAL,
    )

    def fetch_bal(tid):
        r = authenticated_client.get(
            "/api/transactions/",
            {
                "account": account.id,
                "date_after": "2026-08-01",
                "date_before": "2026-08-28",
                "ordering": "date,id",
                "include_running_balance": "true",
                "reconciled": "false",
                "page_size": 100,
            },
        )
        assert r.status_code == 200
        return Decimal(next(x for x in r.json()["results"] if x["id"] == tid)["running_balance"])

    assert fetch_bal(txn.id) == EXPECTED_AFTER
    assert fetch_bal(later.id) == EXPECTED_AFTER + Decimal("-50.00")

    txn.date = date(2026, 8, 17)
    txn.save(update_fields=["date", "updated_at"])

    assert fetch_bal(txn.id) == EXPECTED_AFTER
    assert fetch_bal(later.id) == EXPECTED_AFTER + Decimal("-50.00")
    opening, steps = iter_historical_ledger_steps(account, as_of=date(2026, 8, 28))
    validate_historical_ledger_chain(opening_balance=opening, steps=steps)


@pytest.mark.django_db
def test_historical_ending_matches_pending_anchor(household):
    account = Account.objects.create(
        household=household,
        name="Main",
        account_type=Account.AccountType.CHECKING,
        currency="USD",
        starting_balance=STARTING,
    )
    as_of = date(2026, 8, 28)
    Transaction.objects.create(
        account=account,
        date=date(2026, 8, 17),
        payee="Quicksilver C/C Payment",
        amount=PAYMENT,
        status=Transaction.Status.CLEARED,
        cleared=True,
    )
    Transaction.objects.create(
        account=account,
        date=date(2026, 8, 20),
        payee="Groceries",
        amount=Decimal("-50.00"),
        status=Transaction.Status.CLEARED,
        cleared=True,
    )
    opening, steps = iter_historical_ledger_steps(account, as_of=as_of)
    participating = [s for s in steps if s.participates]
    assert participating[-1].balance_after == ledger_today_balance_before_pending(account, as_of)
    validate_historical_ledger_chain(opening_balance=opening, steps=steps)


@pytest.mark.django_db
def test_skipped_pending_row_has_no_running_balance_in_api(authenticated_client, household):
    account = Account.objects.create(
        household=household,
        name="Main",
        account_type=Account.AccountType.CHECKING,
        currency="USD",
        starting_balance=Decimal("1000.00"),
    )
    today = date.today()
    pending = Transaction.objects.create(
        account=account,
        date=today,
        payee="Geico",
        amount=Decimal("-400.00"),
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.RULE,
    )
    r = authenticated_client.get(
        "/api/transactions/",
        {
            "account": account.id,
            "date_after": (today - timedelta(days=14)).isoformat(),
            "date_before": today.isoformat(),
            "ordering": "date,id",
            "include_running_balance": "true",
            "reconciled": "false",
            "page_size": 100,
        },
    )
    assert r.status_code == 200
    row = next(x for x in r.json()["results"] if x["id"] == pending.id)
    assert row.get("running_balance") is None
