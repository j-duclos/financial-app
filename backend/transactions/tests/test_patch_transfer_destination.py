"""PATCH with transfer_to_account_id must create the destination leg (was ignored by ModelSerializer)."""
from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Account
from categories.models import Category
from core.models import Household, HouseholdMembership
from timeline.models import RecurringRule
from transactions.models import Transaction, TransactionMatch, Transfer, TransferGroup

User = get_user_model()


class TestPatchTransferDestinationCreatesLeg(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="tpay", password="x")
        self.h = Household.objects.create(name="H")
        HouseholdMembership.objects.create(household=self.h, user=self.user, role=HouseholdMembership.Role.OWNER)
        self.chase = Account.objects.create(
            household=self.h, account_type=Account.AccountType.CHECKING, name="Chase", currency="USD"
        )
        self.care = Account.objects.create(
            household=self.h, account_type=Account.AccountType.CREDIT, name="Care Credit", currency="USD"
        )
        self.cat = Category.objects.create(
            household=self.h,
            name="Credit Card Payment",
            category_type=Category.CategoryType.EXPENSE,
            sort_order=1,
        )
        self.client.force_authenticate(user=self.user)

    def test_patch_transfer_to_creates_card_inflow(self):
        txn = Transaction.objects.create(
            account=self.chase,
            date=date(2026, 3, 2),
            payee="SYNCHRONY",
            amount=Decimal("-400.00"),
            source=Transaction.Source.PLAID,
            plaid_transaction_id="plaid-care-1",
            category=self.cat,
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        )
        res = self.client.patch(
            f"/api/transactions/{txn.pk}/",
            {
                "payee": "Synchrony (Care Credit)",
                "category_id": self.cat.id,
                "transfer_to_account_id": self.care.id,
            },
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(Transaction.objects.filter(account=self.care).count(), 1)
        in_leg = Transaction.objects.get(account=self.care)
        self.assertEqual(in_leg.amount, Decimal("400.00"))
        txn.refresh_from_db()
        self.assertIsNotNone(txn.transfer_group_id)
        self.assertEqual(in_leg.transfer_group_id, txn.transfer_group_id)
        Transfer.objects.get(from_transaction=txn, to_transaction=in_leg)

    def test_patch_transfer_to_on_matched_import_links_planned_leg(self):
        planned = Transaction.objects.create(
            account=self.chase,
            date=date(2026, 3, 2),
            payee="Card payment",
            amount=Decimal("-400.00"),
            source=Transaction.Source.ACTUAL,
            category=self.cat,
        )
        imp = Transaction.objects.create(
            account=self.chase,
            date=date(2026, 3, 2),
            payee="SYNCHRONY",
            amount=Decimal("-400.00"),
            source=Transaction.Source.PLAID,
            plaid_transaction_id="plaid-care-2",
            category=self.cat,
            import_match_status=Transaction.ImportMatchStatus.MATCHED,
        )
        TransactionMatch.objects.create(
            planned_transaction=planned,
            imported_transaction=imp,
            match_type=TransactionMatch.MatchType.MANUAL,
            score=90,
            confidence=TransactionMatch.Confidence.MANUAL,
        )
        res = self.client.patch(
            f"/api/transactions/{imp.pk}/",
            {
                "transfer_to_account_id": self.care.id,
            },
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.data)
        planned.refresh_from_db()
        self.assertEqual(Transaction.objects.filter(account=self.care).count(), 1)
        in_leg = Transaction.objects.get(account=self.care)
        Transfer.objects.get(from_transaction=planned, to_transaction=in_leg)

    def test_patch_flip_sign_after_wrong_inflow_with_transfer_in(self):
        """Clear stale incoming Transfer when checking row becomes payer outflow + card payment."""
        other = Account.objects.create(
            household=self.h, account_type=Account.AccountType.CHECKING, name="Other", currency="USD"
        )
        wrong_from = Transaction.objects.create(
            account=other,
            date=date(2026, 5, 1),
            payee="Other pay",
            amount=Decimal("-300.00"),
            source=Transaction.Source.ACTUAL,
        )
        chase_row = Transaction.objects.create(
            account=self.chase,
            date=date(2026, 5, 1),
            payee="Capital One (Care Credit)",
            amount=Decimal("300.00"),
            source=Transaction.Source.ACTUAL,
            category=self.cat,
        )
        Transfer.objects.create(
            from_transaction=wrong_from,
            to_transaction=chase_row,
            amount=Decimal("300.00"),
            date=date(2026, 5, 1),
            memo="",
        )
        res = self.client.patch(
            f"/api/transactions/{chase_row.pk}/",
            {
                "amount": "-300.00",
                "category_id": self.cat.id,
                "transfer_to_account_id": self.care.id,
            },
            format="json",
        )
        self.assertEqual(res.status_code, 200, getattr(res, "data", res.content))
        chase_row.refresh_from_db()
        self.assertLess(chase_row.amount, 0)
        self.assertEqual(Transaction.objects.filter(account=self.care).count(), 1)
        in_leg = Transaction.objects.get(account=self.care)
        self.assertEqual(in_leg.amount, Decimal("300.00"))
        Transfer.objects.get(from_transaction=chase_row, to_transaction=in_leg)

    def test_patch_link_after_orphan_transfer_group(self):
        """Orphan transfer_group_id (no Transfer row) must not block creating the card leg."""
        tg = TransferGroup.objects.create(
            household=self.h,
            from_account=self.chase,
            to_account=self.care,
            amount=Decimal("300.00"),
            scheduled_date=date(2026, 5, 1),
            status=TransferGroup.Status.PLANNED,
        )
        txn = Transaction.objects.create(
            account=self.chase,
            date=date(2026, 5, 1),
            payee="Pay card",
            amount=Decimal("-300.00"),
            source=Transaction.Source.ACTUAL,
            category=self.cat,
            transfer_group=tg,
        )
        res = self.client.patch(
            f"/api/transactions/{txn.pk}/",
            {"transfer_to_account_id": self.care.id},
            format="json",
        )
        self.assertEqual(res.status_code, 200, getattr(res, "data", res.content))
        self.assertEqual(Transaction.objects.filter(account=self.care).count(), 1)
        in_leg = Transaction.objects.get(account=self.care)
        Transfer.objects.get(from_transaction=txn, to_transaction=in_leg)

    def test_patch_rule_forecast_transfer_to_keeps_chase_leg(self):
        """Rule-materialized payment (no Plaid): bank row must survive PATCH that wires Transfer."""
        rule = RecurringRule.objects.create(
            household=self.h,
            name="Care payment",
            account=self.chase,
            transfer_to_account=self.care,
            category=self.cat,
            direction=RecurringRule.Direction.EXPENSE,
            amount=Decimal("393.79"),
            currency="USD",
            frequency=RecurringRule.Frequency.MONTHLY_DAY,
            interval=1,
            day_of_month=28,
            start_date=date(2026, 1, 1),
            active=True,
        )
        chase_leg = Transaction.objects.create(
            account=self.chase,
            date=date(2026, 7, 28),
            payee="Care Credit",
            amount=Decimal("-393.79"),
            category=self.cat,
            rule=rule,
            source=Transaction.Source.RULE,
        )
        Transaction.objects.create(
            account=self.care,
            date=date(2026, 7, 28),
            payee="Care Credit",
            amount=Decimal("393.79"),
            category=self.cat,
            rule=rule,
            source=Transaction.Source.RULE,
        )
        res = self.client.patch(
            f"/api/transactions/{chase_leg.pk}/",
            {"transfer_to_account_id": self.care.id},
            format="json",
        )
        self.assertEqual(res.status_code, 200, getattr(res, "data", res.content))
        self.assertTrue(Transaction.objects.filter(pk=chase_leg.pk).exists())
        chase_leg.refresh_from_db()
        self.assertTrue(
            Transfer.objects.filter(from_transaction_id=chase_leg.pk).exists(),
            "Chase leg should be linked after PATCH",
        )

    def test_patch_chase_amount_does_not_duplicate_care_leg(self):
        """After link exists, amount change on Chase must not add a second Care Credit row."""
        rule = RecurringRule.objects.create(
            household=self.h,
            name="Care payment",
            account=self.chase,
            transfer_to_account=self.care,
            category=self.cat,
            direction=RecurringRule.Direction.EXPENSE,
            amount=Decimal("393.79"),
            currency="USD",
            frequency=RecurringRule.Frequency.MONTHLY_DAY,
            interval=1,
            day_of_month=28,
            start_date=date(2026, 1, 1),
            active=True,
        )
        chase_leg = Transaction.objects.create(
            account=self.chase,
            date=date(2026, 7, 28),
            payee="Care Credit Card Pmt",
            amount=Decimal("-393.79"),
            category=self.cat,
            rule=rule,
            source=Transaction.Source.RULE,
        )
        Transaction.objects.create(
            account=self.care,
            date=date(2026, 7, 28),
            payee="Care Credit Card Pmt",
            amount=Decimal("393.79"),
            category=self.cat,
            rule=rule,
            source=Transaction.Source.RULE,
        )
        r1 = self.client.patch(
            f"/api/transactions/{chase_leg.pk}/",
            {"transfer_to_account_id": self.care.id},
            format="json",
        )
        self.assertEqual(r1.status_code, 200, getattr(r1, "data", r1.content))
        self.assertEqual(Transaction.objects.filter(account=self.care).count(), 1)

        r2 = self.client.patch(
            f"/api/transactions/{chase_leg.pk}/",
            {
                "amount": "-174.47",
                "transfer_to_account_id": self.care.id,
            },
            format="json",
        )
        self.assertEqual(r2.status_code, 200, getattr(r2, "data", r2.content))
        self.assertEqual(
            Transaction.objects.filter(account=self.care).count(),
            1,
            "Must not create a second card leg when changing payment amount",
        )
        card_only = Transaction.objects.get(account=self.care)
        self.assertEqual(card_only.amount, Decimal("174.47"))
