"""Imported and reconciled field locks; undo restores financial editability."""
from datetime import date
from decimal import Decimal

import pytest
from rest_framework.test import APIClient

from accounts.models import Account
from transactions.models import Reconciliation, Transaction
from transactions.services.posting import post_transaction
from transactions.services.reconciliation import complete_reconciliation, undo_reconciliation


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def checking(db, household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Chase",
        currency="USD",
        starting_balance=Decimal("1000.00"),
    )


def _complete(user, account, txn, ending: Decimal, d: date):
    complete_reconciliation(
        account=account,
        user=user,
        bank_current_balance=ending,
        checked_transaction_ids=[txn.pk],
        period_start=d,
        period_end=d,
        as_of=d,
    )
    txn.refresh_from_db()


@pytest.mark.django_db
def test_imported_bank_fields_cannot_be_patched(api_client, user, checking):
    txn = Transaction.objects.create(
        account=checking,
        date=date(2026, 8, 1),
        payee="STARBUCKS",
        amount=Decimal("-4.50"),
        status=Transaction.Status.CLEARED,
        source=Transaction.Source.ACTUAL,
        plaid_transaction_id="plaid-abc",
        imported_description="STARBUCKS STORE 123",
    )
    api_client.force_authenticate(user=user)
    resp = api_client.patch(
        f"/api/transactions/{txn.pk}/",
        {"amount": "-9.00", "date": "2026-08-02"},
        format="json",
    )
    assert resp.status_code == 400
    txn.refresh_from_db()
    assert txn.amount == Decimal("-4.50")
    assert txn.date == date(2026, 8, 1)


@pytest.mark.django_db
def test_imported_metadata_can_be_patched(api_client, user, checking, household):
    from categories.models import Category

    cat = Category.objects.create(
        household=household,
        name="Imported Coffee",
        category_type=Category.CategoryType.EXPENSE,
        sort_order=9,
    )
    txn = Transaction.objects.create(
        account=checking,
        date=date(2026, 8, 1),
        payee="STARBUCKS",
        amount=Decimal("-4.50"),
        status=Transaction.Status.CLEARED,
        source=Transaction.Source.ACTUAL,
        plaid_transaction_id="plaid-meta",
        memo="",
    )
    api_client.force_authenticate(user=user)
    resp = api_client.patch(
        f"/api/transactions/{txn.pk}/",
        {"payee": "Coffee", "category_id": cat.pk, "memo": "Work meeting"},
        format="json",
    )
    assert resp.status_code == 200, resp.data
    txn.refresh_from_db()
    assert txn.payee == "Coffee"
    assert txn.category_id == cat.pk
    assert txn.memo == "Work meeting"
    assert txn.amount == Decimal("-4.50")


@pytest.mark.django_db
def test_reconciled_financial_fields_cannot_be_patched(api_client, user, checking):
    txn = post_transaction(
        user=user,
        account_id=checking.pk,
        date=date(2026, 6, 10),
        payee="Coffee",
        amount=Decimal("-4.00"),
    )
    _complete(user, checking, txn, Decimal("996.00"), date(2026, 6, 10))
    api_client.force_authenticate(user=user)
    resp = api_client.patch(
        f"/api/transactions/{txn.pk}/",
        {"amount": "-10.00", "date": "2026-06-11"},
        format="json",
    )
    assert resp.status_code == 400
    txn.refresh_from_db()
    assert txn.amount == Decimal("-4.00")
    assert txn.date == date(2026, 6, 10)


@pytest.mark.django_db
def test_reconciled_memo_can_be_patched(api_client, user, checking):
    txn = post_transaction(
        user=user,
        account_id=checking.pk,
        date=date(2026, 6, 10),
        payee="Coffee",
        amount=Decimal("-4.00"),
        memo="",
    )
    _complete(user, checking, txn, Decimal("996.00"), date(2026, 6, 10))
    api_client.force_authenticate(user=user)
    resp = api_client.patch(
        f"/api/transactions/{txn.pk}/",
        {"memo": "Receipt in envelope"},
        format="json",
    )
    assert resp.status_code == 200, resp.data
    txn.refresh_from_db()
    assert txn.memo == "Receipt in envelope"


@pytest.mark.django_db
def test_reconciled_cannot_be_deleted(api_client, user, checking):
    txn = post_transaction(
        user=user,
        account_id=checking.pk,
        date=date(2026, 6, 11),
        payee="Groceries",
        amount=Decimal("-20.00"),
    )
    _complete(user, checking, txn, Decimal("980.00"), date(2026, 6, 11))
    api_client.force_authenticate(user=user)
    resp = api_client.delete(f"/api/transactions/{txn.pk}/")
    assert resp.status_code == 400
    assert Transaction.objects.filter(pk=txn.pk).exists()


@pytest.mark.django_db
def test_undo_reconciliation_restores_financial_editability(api_client, user, checking):
    txn = post_transaction(
        user=user,
        account_id=checking.pk,
        date=date(2026, 6, 12),
        payee="Books",
        amount=Decimal("-15.00"),
    )
    _complete(user, checking, txn, Decimal("985.00"), date(2026, 6, 12))
    session = Reconciliation.objects.get(account=checking, is_active=True)
    undo_reconciliation(session=session, user=user)
    txn.refresh_from_db()
    assert txn.reconciled is False

    api_client.force_authenticate(user=user)
    resp = api_client.patch(
        f"/api/transactions/{txn.pk}/",
        {"amount": "-18.00"},
        format="json",
    )
    assert resp.status_code == 200, resp.data
    txn.refresh_from_db()
    assert txn.amount == Decimal("-18.00")
