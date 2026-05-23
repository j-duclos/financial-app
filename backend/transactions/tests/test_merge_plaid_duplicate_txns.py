"""merge_plaid_duplicate_txns: Plaid vs shadow and ACTUAL vs RULE pairing."""
from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase

from accounts.models import Account
from core.models import Household, HouseholdMembership
from transactions.management.commands.merge_plaid_duplicate_txns import (
    _find_actual_vs_rule_pairs,
    _find_pairs,
)
from transactions.models import Transaction
from timeline.models import RecurringRule

User = get_user_model()


class TestMergePlaidDuplicatePairs(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="u_merge", password="p")
        self.h = Household.objects.create(name="H")
        HouseholdMembership.objects.create(household=self.h, user=self.user, role=HouseholdMembership.Role.OWNER)
        self.acc = Account.objects.create(
            household=self.h, account_type=Account.AccountType.CHECKING, name="Checking", currency="USD"
        )

    def test_find_actual_vs_rule_pair_different_dates(self):
        rule = RecurringRule.objects.create(
            household=self.h,
            name="Medical Insurance",
            account=self.acc,
            direction=RecurringRule.Direction.EXPENSE,
            amount=Decimal("619.20"),
            frequency=RecurringRule.Frequency.MONTHLY_DAY,
            day_of_month=1,
            start_date=date(2026, 4, 1),
            active=True,
        )
        shadow = Transaction.objects.create(
            account=self.acc,
            date=date(2026, 4, 1),
            payee="Medical Insurance",
            memo="",
            amount=Decimal("-619.20"),
            source=Transaction.Source.RULE,
            status=Transaction.Status.CLEARED,
            rule=rule,
        )
        actual = Transaction.objects.create(
            account=self.acc,
            date=date(2026, 4, 2),
            payee="Myuhc",
            memo="",
            amount=Decimal("-619.20"),
            source=Transaction.Source.ACTUAL,
            status=Transaction.Status.CLEARED,
        )
        pairs = _find_actual_vs_rule_pairs(self.acc, set())
        self.assertEqual(len(pairs), 1)
        a, r = pairs[0]
        self.assertEqual(a.pk, actual.pk)
        self.assertEqual(r.pk, shadow.pk)

    def test_find_pairs_prefers_actual_over_rule_for_same_plaid(self):
        d = date(2026, 4, 2)
        amt = Decimal("-250.00")
        rule = RecurringRule.objects.create(
            household=self.h,
            name="Savor pay",
            account=self.acc,
            direction=RecurringRule.Direction.EXPENSE,
            amount=Decimal("250.00"),
            frequency=RecurringRule.Frequency.MONTHLY_DAY,
            day_of_month=2,
            start_date=d,
            active=True,
        )
        rule_row = Transaction.objects.create(
            account=self.acc,
            date=d,
            payee="Savor",
            memo="",
            amount=amt,
            source=Transaction.Source.RULE,
            status=Transaction.Status.CLEARED,
            rule=rule,
        )
        manual = Transaction.objects.create(
            account=self.acc,
            date=d,
            payee="Other",
            memo="",
            amount=amt,
            source=Transaction.Source.ACTUAL,
            status=Transaction.Status.CLEARED,
        )
        plaid = Transaction.objects.create(
            account=self.acc,
            date=d,
            payee="CAPITAL ONE ONLINE PYMT",
            memo="",
            amount=amt,
            source=Transaction.Source.PLAID,
            status=Transaction.Status.CLEARED,
            plaid_transaction_id="plaid-1",
        )
        pairs = _find_pairs(self.acc)
        self.assertEqual(len(pairs), 1)
        p, m = pairs[0]
        self.assertEqual(p.pk, plaid.pk)
        self.assertEqual(m.pk, manual.pk)
        self.assertNotEqual(m.pk, rule_row.pk)
