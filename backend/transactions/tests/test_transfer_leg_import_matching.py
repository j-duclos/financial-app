"""Transfer/payment leg import matching — destination-first and source-second flows."""
from datetime import date, timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase

from accounts.models import Account
from core.models import Household, HouseholdMembership
from transactions.models import Transaction, TransferGroup
from transactions.services import create_transfer
from transactions.services.matching import (
    find_transfer_payment_leg_for_import,
    ledger_visible_transactions,
    match_imported_transaction,
    merge_import_into_transfer_payment_leg,
    repair_transfer_leg_duplicates,
)

User = get_user_model()


class TransferLegImportMatchingTestCase(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="xfer_leg", password="p")
        self.h = Household.objects.create(name="XferH")
        HouseholdMembership.objects.create(
            household=self.h, user=self.user, role=HouseholdMembership.Role.OWNER
        )
        self.checking = Account.objects.create(
            household=self.h,
            account_type=Account.AccountType.CHECKING,
            name="Chase Main",
            currency="USD",
        )
        self.savor = Account.objects.create(
            household=self.h,
            account_type=Account.AccountType.CREDIT,
            name="Savor",
            currency="USD",
        )
        self.other = Account.objects.create(
            household=self.h,
            account_type=Account.AccountType.SAVINGS,
            name="Other Savings",
            currency="USD",
        )
        self.pay_date = date(2026, 3, 20)
        self.amount = Decimal("1100.00")

    def _create_payment(self):
        create_transfer(
            user=self.user,
            from_account_id=self.checking.id,
            to_account_id=self.savor.id,
            amount=self.amount,
            transfer_date=self.pay_date.isoformat(),
            payee="Credit Card Payment",
        )
        return (
            Transaction.objects.get(account=self.checking, amount=-self.amount),
            Transaction.objects.get(account=self.savor, amount=self.amount),
        )

    def _plaid_import(self, *, account, amount, plaid_id, on_date=None):
        on_date = on_date or self.pay_date
        return Transaction.objects.create(
            account=account,
            date=on_date,
            payee="AUTOPAY PAYMENT",
            amount=amount,
            source=Transaction.Source.PLAID,
            plaid_transaction_id=plaid_id,
            imported_description="AUTOPAY PAYMENT",
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        )

    def test_credit_card_payment_creates_two_legs(self):
        out_leg, in_leg = self._create_payment()
        self.assertIsNotNone(out_leg.transfer_group_id)
        self.assertEqual(in_leg.transfer_group_id, out_leg.transfer_group_id)
        self.assertEqual(out_leg.amount, -self.amount)
        self.assertEqual(in_leg.amount, self.amount)

    def test_destination_import_first_matches_dest_leg(self):
        out_leg, in_leg = self._create_payment()
        imp = self._plaid_import(account=self.savor, amount=self.amount, plaid_id="pl-savor-first")
        leg = find_transfer_payment_leg_for_import(imp)
        self.assertEqual(leg.pk, in_leg.pk)
        self.assertNotEqual(leg.pk, out_leg.pk)
        match_imported_transaction(imp)
        imp.refresh_from_db()
        in_leg.refresh_from_db()
        out_leg.refresh_from_db()
        self.assertEqual(imp.import_match_status, Transaction.ImportMatchStatus.DUPLICATE)
        self.assertEqual(in_leg.import_match_status, Transaction.ImportMatchStatus.MATCHED)
        self.assertEqual(in_leg.plaid_transaction_id, "pl-savor-first")
        self.assertTrue(Transaction.objects.filter(pk=in_leg.pk).exists())

    def test_no_duplicate_positive_destination_row(self):
        out_leg, in_leg = self._create_payment()
        imp = self._plaid_import(account=self.savor, amount=self.amount, plaid_id="pl-savor-dup")
        match_imported_transaction(imp)
        visible = ledger_visible_transactions(
            Transaction.objects.filter(account=self.savor, amount=self.amount)
        )
        self.assertEqual(visible.count(), 1)
        self.assertEqual(visible.first().pk, in_leg.pk)

    def test_source_leg_remains_pending_when_dest_imports_first(self):
        out_leg, in_leg = self._create_payment()
        imp = self._plaid_import(account=self.savor, amount=self.amount, plaid_id="pl-savor-only")
        match_imported_transaction(imp)
        out_leg.refresh_from_db()
        self.assertNotEqual(out_leg.import_match_status, Transaction.ImportMatchStatus.MATCHED)
        self.assertEqual(out_leg.plaid_transaction_id or "", "")
        visible_checking = ledger_visible_transactions(
            Transaction.objects.filter(account=self.checking, amount=-self.amount)
        )
        self.assertEqual(visible_checking.count(), 1)
        self.assertEqual(visible_checking.first().pk, out_leg.pk)

    def test_source_import_second_matches_source_leg(self):
        out_leg, in_leg = self._create_payment()
        dest_imp = self._plaid_import(account=self.savor, amount=self.amount, plaid_id="pl-savor-2")
        match_imported_transaction(dest_imp)
        src_imp = self._plaid_import(
            account=self.checking, amount=-self.amount, plaid_id="pl-chase-2"
        )
        match_imported_transaction(src_imp)
        out_leg.refresh_from_db()
        in_leg.refresh_from_db()
        self.assertEqual(out_leg.import_match_status, Transaction.ImportMatchStatus.MATCHED)
        self.assertEqual(in_leg.import_match_status, Transaction.ImportMatchStatus.MATCHED)
        self.assertEqual(out_leg.plaid_transaction_id, "pl-chase-2")
        self.assertEqual(src_imp.import_match_status, Transaction.ImportMatchStatus.DUPLICATE)

    def test_transfer_group_completed_after_both_legs_match(self):
        out_leg, in_leg = self._create_payment()
        tg_id = out_leg.transfer_group_id
        match_imported_transaction(
            self._plaid_import(account=self.savor, amount=self.amount, plaid_id="pl-in-both")
        )
        tg = TransferGroup.objects.get(pk=tg_id)
        self.assertEqual(tg.status, TransferGroup.Status.PARTIALLY_MATCHED)
        match_imported_transaction(
            self._plaid_import(account=self.checking, amount=-self.amount, plaid_id="pl-out-both")
        )
        tg.refresh_from_db()
        self.assertEqual(tg.status, TransferGroup.Status.MATCHED)

    def test_different_account_does_not_match(self):
        self._create_payment()
        imp = self._plaid_import(
            account=self.other, amount=self.amount, plaid_id="pl-wrong-acct"
        )
        self.assertIsNone(find_transfer_payment_leg_for_import(imp))
        self.assertFalse(match_imported_transaction(imp))

    def test_opposite_leg_does_not_match(self):
        out_leg, in_leg = self._create_payment()
        # Negative import on Savor must not match the positive destination leg.
        imp = self._plaid_import(
            account=self.savor, amount=-self.amount, plaid_id="pl-wrong-sign"
        )
        self.assertIsNone(find_transfer_payment_leg_for_import(imp))

    def test_different_amount_does_not_match(self):
        out_leg, in_leg = self._create_payment()
        imp = self._plaid_import(
            account=self.savor, amount=Decimal("999.00"), plaid_id="pl-wrong-amt"
        )
        self.assertIsNone(find_transfer_payment_leg_for_import(imp))

    def test_duplicate_hidden_rows_do_not_affect_balance(self):
        out_leg, in_leg = self._create_payment()
        imp = self._plaid_import(account=self.savor, amount=self.amount, plaid_id="pl-bal")
        match_imported_transaction(imp)
        visible_savor = ledger_visible_transactions(Transaction.objects.filter(account=self.savor))
        total = sum(t.amount for t in visible_savor if t.amount == self.amount)
        self.assertEqual(total, self.amount)
        self.assertNotIn(imp.pk, set(visible_savor.values_list("pk", flat=True)))

    def test_date_outside_three_day_window_does_not_match(self):
        out_leg, in_leg = self._create_payment()
        imp = self._plaid_import(
            account=self.savor,
            amount=self.amount,
            plaid_id="pl-late",
            on_date=self.pay_date + timedelta(days=4),
        )
        self.assertIsNone(find_transfer_payment_leg_for_import(imp))

    def test_repair_merges_legacy_duplicate(self):
        out_leg, in_leg = self._create_payment()
        imp = self._plaid_import(account=self.savor, amount=self.amount, plaid_id="pl-repair")
        summary = repair_transfer_leg_duplicates(user_id=self.user.id)
        self.assertEqual(summary["merged"], 1)
        imp.refresh_from_db()
        in_leg.refresh_from_db()
        self.assertEqual(imp.import_match_status, Transaction.ImportMatchStatus.DUPLICATE)
        self.assertEqual(in_leg.plaid_transaction_id, "pl-repair")
        visible = ledger_visible_transactions(Transaction.objects.filter(account=self.savor))
        self.assertEqual(visible.filter(amount=self.amount).count(), 1)
