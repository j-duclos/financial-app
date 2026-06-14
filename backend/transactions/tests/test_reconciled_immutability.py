from datetime import date
from decimal import Decimal

import pytest
from rest_framework.test import APIClient

from accounts.models import Account
from transactions.models import Transaction
from transactions.services.posting import post_transaction
from transactions.services.reconciliation import complete_reconciliation


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def account(db, household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Checking",
        currency="USD",
        starting_balance=Decimal("1000.00"),
    )


@pytest.mark.django_db
def test_reconciled_transaction_cannot_be_patched(api_client, user, account):
    txn = post_transaction(
        user=user,
        account_id=account.pk,
        date=date(2026, 6, 10),
        payee="Coffee",
        amount=Decimal("-4.00"),
    )
    complete_reconciliation(
        account=account,
        user=user,
        bank_current_balance=Decimal("996.00"),
        checked_transaction_ids=[txn.pk],
        period_start=date(2026, 6, 10),
        period_end=date(2026, 6, 10),
        as_of=date(2026, 6, 10),
    )
    txn.refresh_from_db()
    assert txn.reconciled is True

    api_client.force_authenticate(user=user)
    resp = api_client.patch(
        f"/api/transactions/{txn.pk}/",
        {"payee": "Changed payee"},
        format="json",
    )
    assert resp.status_code == 400
    assert "Reconciled" in str(resp.data)


@pytest.mark.django_db
def test_reconciled_transaction_cannot_be_deleted(api_client, user, account):
    txn = post_transaction(
        user=user,
        account_id=account.pk,
        date=date(2026, 6, 11),
        payee="Groceries",
        amount=Decimal("-20.00"),
    )
    complete_reconciliation(
        account=account,
        user=user,
        bank_current_balance=Decimal("980.00"),
        checked_transaction_ids=[txn.pk],
        period_start=date(2026, 6, 11),
        period_end=date(2026, 6, 11),
        as_of=date(2026, 6, 11),
    )
    api_client.force_authenticate(user=user)
    resp = api_client.delete(f"/api/transactions/{txn.pk}/")
    assert resp.status_code == 400
    assert Transaction.objects.filter(pk=txn.pk).exists()
