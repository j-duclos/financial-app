"""Plaid sync application of /transactions/sync fields onto existing rows."""
from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase

from accounts.models import Account
from core.models import Household, HouseholdMembership
from plaid_link.services import _apply_plaid_defaults_to_existing
from transactions.models import Transaction, TransactionMatch

User = get_user_model()


class TestApplyPlaidDefaultsToExisting(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="u_plaid_apply", password="p1")
        self.h = Household.objects.create(name="H1")
        HouseholdMembership.objects.create(household=self.h, user=self.user, role=HouseholdMembership.Role.OWNER)
        self.acc = Account.objects.create(
            household=self.h, account_type=Account.AccountType.CHECKING, name="Checking", currency="USD"
        )

    def test_preserves_import_match_status_when_matched(self):
        planned = Transaction.objects.create(
            account=self.acc,
            date=date(2026, 3, 23),
            payee="Transfer to card",
            amount=Decimal("-300.00"),
            source=Transaction.Source.ACTUAL,
            import_match_status=Transaction.ImportMatchStatus.NONE,
        )
        imported = Transaction.objects.create(
            account=self.acc,
            date=date(2026, 3, 23),
            payee="Amazon",
            amount=Decimal("-300.00"),
            source=Transaction.Source.PLAID,
            plaid_transaction_id="plaid-amz-pay",
            import_match_status=Transaction.ImportMatchStatus.MATCHED,
        )
        TransactionMatch.objects.create(
            planned_transaction=planned,
            imported_transaction=imported,
            match_type=TransactionMatch.MatchType.MANUAL,
            score=90,
            confidence=TransactionMatch.Confidence.MANUAL,
        )
        defaults = {
            "account_id": self.acc.id,
            "date": date(2026, 3, 24),
            "posted_date": date(2026, 3, 24),
            "payee": "AMAZON.COM",
            "memo": "",
            "imported_description": "AMAZON",
            "normalized_payee": "amazon",
            "amount": Decimal("-300.00"),
            "source": Transaction.Source.PLAID,
            "cleared": True,
            "status": Transaction.Status.CLEARED,
            "import_match_status": Transaction.ImportMatchStatus.UNMATCHED,
        }
        _apply_plaid_defaults_to_existing(imported, defaults)
        imported.save()
        imported.refresh_from_db()
        self.assertEqual(imported.import_match_status, Transaction.ImportMatchStatus.MATCHED)
        self.assertEqual(imported.payee, "AMAZON.COM")

    def test_applies_unmatched_default_when_no_match_record(self):
        imported = Transaction.objects.create(
            account=self.acc,
            date=date(2026, 3, 23),
            payee="Old",
            amount=Decimal("-10.00"),
            source=Transaction.Source.PLAID,
            plaid_transaction_id="plaid-x",
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        )
        defaults = {
            "account_id": self.acc.id,
            "date": date(2026, 3, 23),
            "posted_date": date(2026, 3, 23),
            "payee": "New",
            "memo": "",
            "imported_description": "",
            "normalized_payee": "new",
            "amount": Decimal("-10.00"),
            "source": Transaction.Source.PLAID,
            "cleared": True,
            "status": Transaction.Status.CLEARED,
            "import_match_status": Transaction.ImportMatchStatus.UNMATCHED,
        }
        _apply_plaid_defaults_to_existing(imported, defaults)
        self.assertEqual(imported.import_match_status, Transaction.ImportMatchStatus.UNMATCHED)
