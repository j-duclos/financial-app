"""Cross-user authorization: User A cannot read or mutate User B's financial objects."""
from datetime import date
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from accounts.models import Account
from budgets.models import SpendingTarget
from categories.models import Category
from core.models import Household, HouseholdMembership
from plaid_link.crypto import encrypt_secret
from plaid_link.models import PlaidItem
from timeline.models import ReconciliationMatch, StatementTransaction
from transactions.models import Transaction

User = get_user_model()

pytestmark = pytest.mark.django_db


@pytest.fixture
def other_user(db):
    return User.objects.create_user(username="victim-user", password="testpass123")


@pytest.fixture
def other_household(db, other_user):
    household = Household.objects.create(name="Victim Household")
    HouseholdMembership.objects.create(
        household=household, user=other_user, role=HouseholdMembership.Role.OWNER
    )
    return household


@pytest.fixture
def other_account(db, other_household):
    return Account.objects.create(
        household=other_household,
        account_type=Account.AccountType.CHECKING,
        name="Victim Checking",
        currency="USD",
        starting_balance=Decimal("10.00"),
    )


@pytest.fixture
def other_category(db, other_household):
    return Category.objects.create(
        household=other_household,
        name="Victim Expenses",
        category_type=Category.CategoryType.EXPENSE,
        sort_order=1,
    )


def test_cannot_create_category_in_foreign_household(
    authenticated_client, other_household
):
    r = authenticated_client.post(
        "/api/categories/",
        {
            "household": other_household.id,
            "name": "Injected",
            "category_type": "EXPENSE",
        },
        format="json",
    )
    assert r.status_code in (400, 403)
    assert not Category.objects.filter(household=other_household, name="Injected").exists()


def test_cannot_create_spending_target_in_foreign_household(
    authenticated_client, other_household, other_category
):
    r = authenticated_client.post(
        "/api/spending-targets/",
        {
            "household": other_household.id,
            "category": other_category.id,
            "target_amount": "50.00",
            "period": "monthly",
            "target_type": "variable",
        },
        format="json",
    )
    assert r.status_code in (400, 403)
    assert not SpendingTarget.objects.filter(household=other_household).exists()


def test_cannot_read_foreign_transaction(
    authenticated_client, other_account
):
    txn = Transaction.objects.create(
        account=other_account,
        date=date(2026, 1, 1),
        payee="Secret payee",
        amount=Decimal("-12.00"),
        status=Transaction.Status.CLEARED,
        source=Transaction.Source.ACTUAL,
    )
    r = authenticated_client.get(f"/api/transactions/{txn.id}/")
    assert r.status_code == 404
    assert "Secret payee" not in r.content.decode()


def test_cannot_patch_foreign_transaction(authenticated_client, other_account):
    txn = Transaction.objects.create(
        account=other_account,
        date=date(2026, 1, 1),
        payee="Leave me",
        amount=Decimal("-3.00"),
        status=Transaction.Status.CLEARED,
        source=Transaction.Source.ACTUAL,
    )
    r = authenticated_client.patch(
        f"/api/transactions/{txn.id}/",
        {"payee": "Hacked"},
        format="json",
    )
    assert r.status_code == 404
    txn.refresh_from_db()
    assert txn.payee == "Leave me"


def test_cannot_retrieve_foreign_plaid_item(authenticated_client, other_household):
    item = PlaidItem.objects.create(
        household=other_household,
        item_id="item-victim-1",
        access_token_cipher=encrypt_secret("access-sandbox-victim"),
        institution_name="Victim Bank",
    )
    r = authenticated_client.get(f"/api/plaid/items/{item.id}/")
    assert r.status_code == 404
    assert "access-sandbox-victim" not in r.content.decode()


def test_reconcile_match_rejects_foreign_transaction(
    authenticated_client, household, account, other_account
):
    own_stmt = StatementTransaction.objects.create(
        household=household,
        account=account,
        posted_date=date(2026, 1, 2),
        amount=Decimal("-8.00"),
        description="Coffee",
    )
    foreign_txn = Transaction.objects.create(
        account=other_account,
        date=date(2026, 1, 2),
        payee="Victim secret payee",
        amount=Decimal("-8.00"),
        status=Transaction.Status.CLEARED,
        source=Transaction.Source.ACTUAL,
    )
    r = authenticated_client.post(
        "/api/reconcile/match/",
        {
            "statement_txn_id": own_stmt.id,
            "matched_transaction_id": foreign_txn.id,
            "status": ReconciliationMatch.Status.MATCHED,
        },
        format="json",
    )
    assert r.status_code == 404
    assert "Victim secret payee" not in r.content.decode()
    assert not ReconciliationMatch.objects.filter(statement_txn=own_stmt).exists()


def test_export_excludes_foreign_household(
    authenticated_client, user, account, other_account
):
    Transaction.objects.create(
        account=account,
        date=date(2026, 3, 1),
        payee="Mine",
        amount=Decimal("-1.00"),
        status=Transaction.Status.CLEARED,
        source=Transaction.Source.ACTUAL,
    )
    Transaction.objects.create(
        account=other_account,
        date=date(2026, 3, 1),
        payee="Not yours",
        amount=Decimal("-2.00"),
        status=Transaction.Status.CLEARED,
        source=Transaction.Source.ACTUAL,
    )
    r = authenticated_client.get("/api/profile/export-data/")
    assert r.status_code == 200
    assert r["Cache-Control"] == "private, no-store"
    body = r.json()
    payees = [t["payee"] for t in body["transactions"]]
    assert "Mine" in payees
    assert "Not yours" not in payees
    assert "access_token_cipher" not in r.content.decode()
    csv_r = authenticated_client.get("/api/profile/export-transactions.csv")
    assert csv_r.status_code == 200
    assert csv_r["Cache-Control"] == "private, no-store"
    assert "Not yours" not in csv_r.content.decode()
