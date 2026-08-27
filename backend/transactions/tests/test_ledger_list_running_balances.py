"""Account ledger list: ascending order + canonical running_balance."""
from datetime import date, timedelta
from decimal import Decimal

import pytest

from accounts.models import Account
from transactions.models import Transaction


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
