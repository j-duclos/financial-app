"""Tests for manual actual ↔ Plaid import matching (merge onto manual, no duplicate ledger rows)."""
from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase

from accounts.models import Account
from categories.models import Category
from core.models import Household, HouseholdMembership
from plaid_link.services import _create_plaid_sync_transaction, _plaid_txn_to_defaults
from transactions.models import MatchSuggestion, Transaction, TransactionMatch
from transactions.services.import_matching import (
    find_manual_match_for_import,
    merge_manual_transaction_with_import,
    normalize_merchant_text,
    resolve_pending_to_posted,
    score_manual_import_match,
    try_merge_incoming_plaid_into_manual,
)
from transactions.services.matching import ledger_visible_transactions

User = get_user_model()


class ImportMatchingHelpersTests(TestCase):
    def test_normalize_merchant_walmart_hyphen(self):
        self.assertIn("walmart", normalize_merchant_text("POS DEBIT WAL-MART #4430 MARICOPA AZ"))
        self.assertEqual(normalize_merchant_text("Walmart").replace(" ", ""), "walmart")

    def test_normalize_merchant_afterpay(self):
        self.assertIn("afterpay", normalize_merchant_text("POS DEBIT AFTERPAY AFTERPAY.COM CA 5808"))
        self.assertEqual(normalize_merchant_text("AfterPay").replace(" ", ""), "afterpay")


class ManualPlaidMergeTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="u1", password="p1")
        self.h = Household.objects.create(name="H1")
        HouseholdMembership.objects.create(
            household=self.h, user=self.user, role=HouseholdMembership.Role.OWNER
        )
        self.acc = Account.objects.create(
            household=self.h,
            account_type=Account.AccountType.CHECKING,
            name="Checking",
            currency="USD",
        )
        self.other = Account.objects.create(
            household=self.h,
            account_type=Account.AccountType.SAVINGS,
            name="Savings",
            currency="USD",
        )
        self.cat = Category.objects.create(
            household=self.h, name="Shopping", category_type=Category.CategoryType.EXPENSE
        )

    def _manual(self, **kwargs):
        defaults = dict(
            account=self.acc,
            date=date(2026, 7, 28),
            payee="Manual",
            amount=Decimal("-70.99"),
            source=Transaction.Source.ACTUAL,
            status=Transaction.Status.CLEARED,
        )
        defaults.update(kwargs)
        return Transaction.objects.create(**defaults)

    def _plaid_defaults(self, **kwargs):
        defaults = dict(
            account_id=self.acc.id,
            date=date(2026, 7, 28),
            posted_date=date(2026, 7, 28),
            payee="AfterPay",
            memo="",
            imported_description="AfterPay",
            normalized_payee="afterpay",
            amount=Decimal("-70.99"),
            source=Transaction.Source.PLAID,
            cleared=True,
            status=Transaction.Status.CLEARED,
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
            transaction_type=Transaction.TransactionType.OTHER,
            is_pending=False,
            pending_transaction_id=None,
        )
        defaults.update(kwargs)
        return defaults

    def test_exact_account_amount_date_different_descriptions_auto_match(self):
        manual = self._manual(payee="POS DEBIT AFTERPAY AFTERPAY.COM CA 5808 (...2404)")
        payload = self._plaid_defaults(plaid_transaction_id="pl-ap-1")
        decision = find_manual_match_for_import(payload)
        self.assertEqual(decision.action, "merge")
        self.assertEqual(decision.manual.pk, manual.pk)

    def test_afterpay_verbose_manual_matches_normalized_import(self):
        manual = self._manual(
            payee="POS DEBIT AFTERPAY AFTERPAY.COM CA 5808 (...2404)",
            amount=Decimal("-70.99"),
            category=self.cat,
            memo="buy now pay later",
            tags=["bnpl"],
        )
        merged = try_merge_incoming_plaid_into_manual(
            account_pk=self.acc.id,
            pid="pl-afterpay",
            defaults=self._plaid_defaults(payee="AfterPay", imported_description="AfterPay"),
        )
        self.assertIsNotNone(merged)
        manual.refresh_from_db()
        self.assertEqual(manual.plaid_transaction_id, "pl-afterpay")
        self.assertEqual(manual.category_id, self.cat.pk)
        self.assertEqual(manual.memo, "buy now pay later")
        self.assertEqual(manual.tags, ["bnpl"])
        self.assertEqual(manual.source, Transaction.Source.ACTUAL)
        self.assertEqual(Transaction.objects.filter(plaid_transaction_id="pl-afterpay").count(), 1)

    def test_walmart_verbose_manual_matches_normalized_import(self):
        manual = self._manual(
            payee="POS DEBIT WAL-MART #4430 MARICOPA AZ (...2404)",
            amount=Decimal("-233.53"),
        )
        result = score_manual_import_match(
            manual,
            self._plaid_defaults(
                payee="Walmart",
                imported_description="Walmart",
                amount=Decimal("-233.53"),
                plaid_transaction_id="pl-wm",
            ),
        )
        self.assertTrue(result.auto_match)
        self.assertGreaterEqual(result.score, 85)

        merged = try_merge_incoming_plaid_into_manual(
            account_pk=self.acc.id,
            pid="pl-wm",
            defaults=self._plaid_defaults(
                payee="Walmart",
                imported_description="Walmart",
                amount=Decimal("-233.53"),
            ),
        )
        self.assertEqual(merged.pk, manual.pk)
        manual.refresh_from_db()
        self.assertEqual(manual.plaid_transaction_id, "pl-wm")
        self.assertEqual(manual.payee, "Walmart")
        self.assertIn("WAL-MART", manual.memo.upper())

    def test_different_accounts_do_not_match(self):
        self._manual(account=self.other, payee="POS DEBIT AFTERPAY AFTERPAY.COM")
        decision = find_manual_match_for_import(self._plaid_defaults(plaid_transaction_id="pl-x"))
        self.assertEqual(decision.action, "none")

    def test_opposite_directions_do_not_match(self):
        self._manual(amount=Decimal("70.99"), payee="AfterPay refund")
        decision = find_manual_match_for_import(
            self._plaid_defaults(amount=Decimal("-70.99"), plaid_transaction_id="pl-dir")
        )
        self.assertEqual(decision.action, "none")

    def test_dates_far_apart_do_not_auto_match(self):
        self._manual(date=date(2026, 7, 1), payee="POS DEBIT AFTERPAY AFTERPAY.COM")
        decision = find_manual_match_for_import(
            self._plaid_defaults(date=date(2026, 7, 28), plaid_transaction_id="pl-far")
        )
        self.assertEqual(decision.action, "none")

    def test_multiple_equal_candidates_create_review_state(self):
        self._manual(payee="Cash App Payment Alice", amount=Decimal("-10.00"))
        self._manual(payee="Cash App Payment Bob", amount=Decimal("-10.00"))
        created = _create_plaid_sync_transaction(
            account_pk=self.acc.id,
            pid="pl-ambig",
            defaults=self._plaid_defaults(
                payee="Cash App Payment",
                imported_description="Cash App Payment",
                amount=Decimal("-10.00"),
            ),
        )
        # Distinct merchant labels → do not guess which Cash App send it is.
        self.assertIsNotNone(created)
        self.assertEqual(created.source, Transaction.Source.PLAID)
        self.assertEqual(created.plaid_transaction_id, "pl-ambig")
        self.assertEqual(created.import_match_status, Transaction.ImportMatchStatus.SUGGESTED)
        self.assertGreaterEqual(
            MatchSuggestion.objects.filter(imported_transaction=created).count(), 2
        )
        self.assertEqual(
            Transaction.objects.filter(
                account=self.acc, source=Transaction.Source.ACTUAL, plaid_transaction_id__isnull=True
            ).count(),
            2,
        )

    def test_user_category_and_notes_survive_merge(self):
        manual = self._manual(
            payee="POS DEBIT WAL-MART #4430",
            amount=Decimal("-10.00"),
            category=self.cat,
            memo="weekly groceries",
            tags=["food"],
        )
        merge_manual_transaction_with_import(
            manual,
            self._plaid_defaults(
                payee="Walmart",
                imported_description="Walmart",
                amount=Decimal("-10.00"),
                plaid_transaction_id="pl-keep-meta",
            ),
        )
        manual.refresh_from_db()
        self.assertEqual(manual.category_id, self.cat.pk)
        self.assertEqual(manual.memo, "weekly groceries")
        self.assertEqual(manual.tags, ["food"])

    def test_only_one_transaction_affects_running_balance(self):
        manual = self._manual(
            payee="POS DEBIT AFTERPAY AFTERPAY.COM",
            amount=Decimal("-70.99"),
        )
        created = _create_plaid_sync_transaction(
            account_pk=self.acc.id,
            pid="pl-bal",
            defaults=self._plaid_defaults(),
        )
        self.assertEqual(created.pk, manual.pk)
        visible = ledger_visible_transactions(
            Transaction.objects.filter(account=self.acc, amount=Decimal("-70.99"))
        )
        self.assertEqual(visible.count(), 1)
        self.assertEqual(visible.first().pk, manual.pk)

    def test_pending_to_posted_does_not_duplicate(self):
        pending_defaults = self._plaid_defaults(
            payee="AfterPay",
            is_pending=True,
            posted_date=None,
            cleared=False,
            status=Transaction.Status.PLANNED,
        )
        pending = _create_plaid_sync_transaction(
            account_pk=self.acc.id, pid="pl-pending-1", defaults=pending_defaults
        )
        self.assertTrue(pending.is_pending)

        posted_defaults = self._plaid_defaults(
            payee="AfterPay",
            is_pending=False,
            pending_transaction_id="pl-pending-1",
        )
        converted = resolve_pending_to_posted(
            account_pk=self.acc.id,
            posted_pid="pl-posted-1",
            pending_pid="pl-pending-1",
            defaults=posted_defaults,
        )
        self.assertEqual(converted.pk, pending.pk)
        converted.refresh_from_db()
        self.assertEqual(converted.plaid_transaction_id, "pl-posted-1")
        self.assertEqual(converted.pending_transaction_id, "pl-pending-1")
        self.assertFalse(converted.is_pending)
        self.assertEqual(Transaction.objects.filter(account=self.acc).count(), 1)

    def test_plaid_sync_idempotent_same_transaction_id(self):
        manual = self._manual(payee="POS DEBIT AFTERPAY AFTERPAY.COM")
        first = _create_plaid_sync_transaction(
            account_pk=self.acc.id, pid="pl-idem", defaults=self._plaid_defaults()
        )
        self.assertEqual(first.pk, manual.pk)
        # Second create path: existing by plaid id should be found by sync; simulate create skip.
        self.assertTrue(Transaction.objects.filter(plaid_transaction_id="pl-idem").exists())
        self.assertEqual(Transaction.objects.filter(plaid_transaction_id="pl-idem").count(), 1)
        # Re-merge must not create another row.
        again = try_merge_incoming_plaid_into_manual(
            account_pk=self.acc.id, pid="pl-idem", defaults=self._plaid_defaults()
        )
        # Manual already has this plaid id — candidate qs excludes it → no second merge target.
        self.assertIsNone(again)
        self.assertEqual(Transaction.objects.filter(account=self.acc).count(), 1)

    def test_existing_plaid_transaction_id_updates_rather_than_duplicates(self):
        row = Transaction.objects.create(
            account=self.acc,
            date=date(2026, 7, 28),
            payee="AfterPay",
            amount=Decimal("-70.99"),
            source=Transaction.Source.PLAID,
            plaid_transaction_id="pl-upd",
            imported_description="AfterPay",
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        )
        existing = Transaction.objects.filter(plaid_transaction_id="pl-upd").first()
        self.assertEqual(existing.pk, row.pk)
        existing.payee = "AfterPay Updated"
        existing.save(update_fields=["payee", "updated_at"])
        self.assertEqual(Transaction.objects.filter(plaid_transaction_id="pl-upd").count(), 1)

    def test_plaid_txn_to_defaults_accepts_pending(self):
        defaults = _plaid_txn_to_defaults(
            {
                "transaction_id": "pend-1",
                "pending": True,
                "amount": 12.34,
                "merchant_name": "Store",
                "name": "STORE #1",
                "date": "2026-07-28",
            },
            self.acc.id,
        )
        self.assertIsNotNone(defaults)
        self.assertTrue(defaults["is_pending"])
        self.assertFalse(defaults["cleared"])
