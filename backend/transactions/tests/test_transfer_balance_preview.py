"""Transfer balance preview — canonical before/after without persistence."""
from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Account
from core.models import Household, HouseholdMembership
from transactions.models import Transaction, Transfer
from transactions.services.posting import create_transfer
from transactions.services.transfer_balance_preview import preview_transfer_balances

User = get_user_model()


class TransferBalancePreviewTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="preview_user", password="test")
        self.household = Household.objects.create(name="Preview HH")
        HouseholdMembership.objects.create(
            household=self.household, user=self.user, role=HouseholdMembership.Role.OWNER
        )
        self.checking = Account.objects.create(
            household=self.household,
            name="Checking",
            account_type=Account.AccountType.CHECKING,
            starting_balance=Decimal("1000.00"),
        )
        self.savings = Account.objects.create(
            household=self.household,
            name="Savings",
            account_type=Account.AccountType.SAVINGS,
            starting_balance=Decimal("200.00"),
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_preview_create_transfer_shows_source_before_and_after(self):
        result = preview_transfer_balances(
            self.user,
            from_account_id=self.checking.pk,
            to_account_id=self.savings.pk,
            amount=Decimal("50.00"),
            transfer_date=date.today(),
        )
        self.assertIsNotNone(result["source_balance_before"])
        self.assertIsNotNone(result["source_balance_after"])
        self.assertIsNotNone(result["destination_balance_before"])
        self.assertIsNotNone(result["destination_balance_after"])
        before = Decimal(result["source_balance_before"])
        after = Decimal(result["source_balance_after"])
        self.assertEqual(after, before - Decimal("50.00"))

    def test_preview_edit_excludes_existing_transfer_legs(self):
        transfer = create_transfer(
            user=self.user,
            from_account_id=self.checking.pk,
            to_account_id=self.savings.pk,
            amount=Decimal("25.00"),
            transfer_date=date.today(),
        )
        out_txn = transfer.from_transaction
        in_txn = transfer.to_transaction
        result = preview_transfer_balances(
            self.user,
            from_account_id=self.checking.pk,
            to_account_id=self.savings.pk,
            amount=Decimal("40.00"),
            transfer_date=date.today(),
            exclude_transaction_ids=[out_txn.pk, in_txn.pk],
        )
        before = Decimal(result["source_balance_before"])
        after = Decimal(result["source_balance_after"])
        self.assertEqual(after, before - Decimal("40.00"))

    def test_preview_api_endpoint(self):
        response = self.client.post(
            "/api/transactions/transfers/preview/",
            {
                "from_account_id": self.checking.pk,
                "to_account_id": self.savings.pk,
                "amount": "10.00",
                "date": date.today().isoformat(),
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("source_balance_before", response.data)
        self.assertIn("source_balance_after", response.data)

    def test_preview_does_not_persist_transactions_or_transfers(self):
        txn_before = Transaction.objects.count()
        transfer_before = Transfer.objects.count()
        preview_transfer_balances(
            self.user,
            from_account_id=self.checking.pk,
            to_account_id=self.savings.pk,
            amount=Decimal("15.00"),
            transfer_date=date.today(),
        )
        self.assertEqual(Transaction.objects.count(), txn_before)
        self.assertEqual(Transfer.objects.count(), transfer_before)

    def test_zero_amount_preview_returns_credit_destination_owed_before(self):
        card = Account.objects.create(
            household=self.household,
            name="Venture",
            account_type=Account.AccountType.CREDIT,
            starting_balance=Decimal("-250.00"),
        )
        result = preview_transfer_balances(
            self.user,
            from_account_id=self.checking.pk,
            to_account_id=card.pk,
            amount=Decimal("0"),
            transfer_date=date.today(),
        )
        self.assertEqual(Decimal(result["destination_balance_owed_before"]), Decimal("250.00"))
        self.assertEqual(result["destination_balance_after"], result["destination_balance_before"])
