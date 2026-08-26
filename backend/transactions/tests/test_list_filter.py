"""Transaction list query filters."""
from datetime import date
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from accounts.models import Account
from core.models import Household, HouseholdMembership
from timeline.models import RecurringRule
from transactions.models import Transaction

User = get_user_model()


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def user(db):
    return User.objects.create_user(username="list_filter_user", password="pass1234")


@pytest.fixture
def account(db, user):
    h = Household.objects.create(name="H")
    HouseholdMembership.objects.create(household=h, user=user, role=HouseholdMembership.Role.OWNER)
    return Account.objects.create(
        household=h,
        account_type=Account.AccountType.CHECKING,
        name="Checking",
        currency="USD",
    )


@pytest.mark.django_db
def test_list_transactions_reconciled_filter(api_client, user, account):
    api_client.force_authenticate(user=user)
    open_txn = Transaction.objects.create(
        account=account,
        date=date(2026, 6, 1),
        payee="Open",
        amount=Decimal("-10.00"),
        reconciled=False,
    )
    closed_txn = Transaction.objects.create(
        account=account,
        date=date(2026, 6, 2),
        payee="Closed",
        amount=Decimal("-20.00"),
        reconciled=True,
    )

    all_resp = api_client.get("/api/transactions/", {"account": account.id})
    assert all_resp.status_code == 200
    all_ids = {r["id"] for r in all_resp.data["results"]}
    assert open_txn.id in all_ids
    assert closed_txn.id in all_ids

    open_resp = api_client.get("/api/transactions/", {"account": account.id, "reconciled": "false"})
    assert open_resp.status_code == 200
    open_ids = {r["id"] for r in open_resp.data["results"]}
    assert open_txn.id in open_ids
    assert closed_txn.id not in open_ids

    closed_resp = api_client.get("/api/transactions/", {"account": account.id, "reconciled": "true"})
    assert closed_resp.status_code == 200
    closed_ids = {r["id"] for r in closed_resp.data["results"]}
    assert closed_txn.id in closed_ids
    assert open_txn.id not in closed_ids


@pytest.mark.django_db
def test_list_transactions_rule_id_filter(api_client, user, account):
    api_client.force_authenticate(user=user)
    rule_a = RecurringRule.objects.create(
        household=account.household,
        name="Rent",
        account=account,
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("1200.00"),
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        day_of_month=1,
        start_date=date(2026, 1, 1),
    )
    rule_b = RecurringRule.objects.create(
        household=account.household,
        name="Paycheck",
        account=account,
        direction=RecurringRule.Direction.INCOME,
        amount=Decimal("3000.00"),
        frequency=RecurringRule.Frequency.BIWEEKLY,
        day_of_week=4,
        start_date=date(2026, 1, 1),
    )
    rent_txn = Transaction.objects.create(
        account=account,
        date=date(2026, 6, 1),
        payee="Rent",
        amount=Decimal("-1200.00"),
        source=Transaction.Source.RULE,
        rule_id=rule_a.id,
    )
    pay_txn = Transaction.objects.create(
        account=account,
        date=date(2026, 6, 15),
        payee="Paycheck",
        amount=Decimal("3000.00"),
        source=Transaction.Source.RULE,
        rule_id=rule_b.id,
    )

    resp = api_client.get("/api/transactions/", {"rule_id": rule_a.id})
    assert resp.status_code == 200
    ids = {r["id"] for r in resp.data["results"]}
    assert rent_txn.id in ids
    assert pay_txn.id not in ids
