"""Backfill Plaid rows skipped when sync cursor advanced past locked reconcile dates."""
from datetime import date
from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest

from accounts.models import Account
from plaid_link.models import PlaidItem, PlaidLinkedAccount
from plaid_link.services import backfill_missing_plaid_imports, sync_transactions_for_item
from transactions.models import Transaction
from transactions.services.posting import post_transaction
from transactions.services.reconciliation import complete_reconciliation


@pytest.fixture
def plaid_item(db, household):
    account = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Checking",
        currency="USD",
        starting_balance=Decimal("1000.00"),
    )
    item = PlaidItem.objects.create(
        household=household,
        item_id="item-backfill",
        access_token_cipher="cipher",
        institution_name="Test Bank",
    )
    PlaidLinkedAccount.objects.create(
        item=item,
        plaid_account_id="pa-checking",
        mask="9009",
        account=account,
    )
    return item


def _exeter_txn(*, txn_id: str, txn_date: date) -> dict:
    return {
        "account_id": "pa-checking",
        "transaction_id": txn_id,
        "amount": 393.79,
        "date": txn_date.isoformat(),
        "name": "EXETERFINA LOAN PMNT PPD ID: 5221907813",
        "merchant_name": "Exeterfina Loan",
        "pending": False,
    }


@pytest.mark.django_db
class TestBackfillMissingPlaidImports:
    @patch("plaid_link.services.decrypt_plaid_access_token", return_value="token")
    @patch("plaid_link.services.get_plaid_client")
    def test_backfill_creates_missing_import_after_reconciled_period(self, mock_client, _mock_decrypt, plaid_item, user):
        account = plaid_item.linked_accounts.first().account
        anchor = post_transaction(
            user=user,
            account_id=account.pk,
            date=date(2026, 7, 3),
            payee="Coffee",
            amount=Decimal("-4.00"),
        )
        complete_reconciliation(
            account=account,
            user=user,
            bank_current_balance=Decimal("996.00"),
            checked_transaction_ids=[anchor.pk],
            period_start=date(2026, 7, 3),
            period_end=date(2026, 7, 3),
            as_of=date(2026, 7, 3),
        )

        client = MagicMock()
        mock_client.return_value = client
        client.transactions_sync.return_value.to_dict.return_value = {
            "added": [_exeter_txn(txn_id="pl-exeter-july", txn_date=date(2026, 7, 6))],
            "modified": [],
            "removed": [],
            "next_cursor": "cursor-done",
            "has_more": False,
        }

        result = backfill_missing_plaid_imports(plaid_item)
        assert result["backfill_added"] == 1
        imported = Transaction.objects.get(plaid_transaction_id="pl-exeter-july")
        assert imported.account_id == account.pk
        assert imported.date == date(2026, 7, 6)
        assert imported.amount == Decimal("-393.79")
        assert imported.source == Transaction.Source.PLAID

    @patch("plaid_link.services.decrypt_plaid_access_token", return_value="token")
    @patch("plaid_link.services.get_plaid_client")
    @patch("plaid_link.services.reconcile_linked_account_ids_with_plaid")
    def test_sync_runs_backfill_after_incremental_pass(
        self, _mock_reconcile, mock_client, _mock_decrypt, plaid_item, user
    ):
        account = plaid_item.linked_accounts.first().account
        anchor = post_transaction(
            user=user,
            account_id=account.pk,
            date=date(2026, 7, 3),
            payee="Coffee",
            amount=Decimal("-4.00"),
        )
        complete_reconciliation(
            account=account,
            user=user,
            bank_current_balance=Decimal("996.00"),
            checked_transaction_ids=[anchor.pk],
            period_start=date(2026, 7, 3),
            period_end=date(2026, 7, 3),
            as_of=date(2026, 7, 3),
        )
        plaid_item.transactions_cursor = "already-caught-up"
        plaid_item.save(update_fields=["transactions_cursor"])

        client = MagicMock()
        mock_client.return_value = client
        empty_incremental = {
            "added": [],
            "modified": [],
            "removed": [],
            "next_cursor": "already-caught-up",
            "has_more": False,
        }
        backfill_page = {
            "added": [_exeter_txn(txn_id="pl-exeter-july-sync", txn_date=date(2026, 7, 6))],
            "modified": [],
            "removed": [],
            "next_cursor": "cursor-done",
            "has_more": False,
        }
        client.transactions_sync.return_value.to_dict.side_effect = [
            empty_incremental,
            empty_incremental,
            backfill_page,
        ]
        client.transactions_refresh.return_value = None

        totals = sync_transactions_for_item(plaid_item)
        assert totals.get("backfill_added") == 1
        assert Transaction.objects.filter(plaid_transaction_id="pl-exeter-july-sync").exists()
