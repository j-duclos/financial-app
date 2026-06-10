"""Plaid import matching to forecast rows (replaces in-place merge onto one row)."""
from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase

from accounts.models import Account
from categories.models import Category
from core.models import Household, HouseholdMembership
from timeline.models import RecurringRule
from transactions.models import Transaction, TransactionMatch
from transactions.services import create_transfer
from transactions.services.matching import (
    ledger_visible_transactions,
    manual_match_transactions,
    match_imported_transaction,
    reconcile_orphan_matched_plaid_imports,
    try_match_rule_to_pending_imports,
)

User = get_user_model()


class TestPlaidMatching(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="u1", password="p1")
        self.h = Household.objects.create(name="H1")
        HouseholdMembership.objects.create(household=self.h, user=self.user, role=HouseholdMembership.Role.OWNER)
        self.acc = Account.objects.create(
            household=self.h, account_type=Account.AccountType.CHECKING, name="Checking", currency="USD"
        )

    def test_auto_match_manual_same_account(self):
        d_user = date(2026, 4, 25)
        d_bank = date(2026, 4, 28)
        amt = Decimal("-42.50")
        manual = Transaction.objects.create(
            account=self.acc,
            date=d_user,
            payee="Coffee",
            memo="",
            amount=amt,
            source=Transaction.Source.ACTUAL,
            status=Transaction.Status.CLEARED,
        )
        imp = Transaction.objects.create(
            account=self.acc,
            date=d_bank,
            payee="STARBUCKS STORE 123",
            amount=amt,
            source=Transaction.Source.PLAID,
            plaid_transaction_id="plaid-1",
            imported_description="STARBUCKS",
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        )
        m = match_imported_transaction(imp)
        self.assertIsNotNone(m)
        self.assertEqual(m.planned_transaction_id, manual.pk)
        imp.refresh_from_db()
        manual.refresh_from_db()
        self.assertEqual(imp.import_match_status, Transaction.ImportMatchStatus.MATCHED)
        self.assertEqual(manual.date, d_bank)
        self.assertEqual(manual.payee, "STARBUCKS STORE 123")

    def test_no_match_wrong_account(self):
        other = Account.objects.create(household=self.h, account_type=Account.AccountType.SAVINGS, name="Sav", currency="USD")
        amt = Decimal("-10.00")
        Transaction.objects.create(
            account=other,
            date=date(2026, 5, 1),
            payee="X",
            amount=amt,
            source=Transaction.Source.ACTUAL,
        )
        imp = Transaction.objects.create(
            account=self.acc,
            date=date(2026, 5, 1),
            payee="Y",
            amount=amt,
            source=Transaction.Source.PLAID,
            plaid_transaction_id="plaid-2",
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        )
        self.assertIsNone(match_imported_transaction(imp))

    def test_transfer_group_leg_matches_plaid(self):
        other = Account.objects.create(
            household=self.h, account_type=Account.AccountType.CREDIT, name="Card", currency="USD"
        )
        d = date(2026, 6, 1)
        create_transfer(
            user=self.user,
            from_account_id=self.acc.id,
            to_account_id=other.id,
            amount=Decimal("200.00"),
            transfer_date=d.isoformat(),
            memo="pay card",
        )
        out_leg = Transaction.objects.filter(account=self.acc, amount=Decimal("-200.00")).first()
        self.assertIsNotNone(out_leg)
        self.assertIsNotNone(out_leg.transfer_group_id)
        imp = Transaction.objects.create(
            account=self.acc,
            date=d,
            payee="CAPITAL ONE ONLINE PMT",
            amount=Decimal("-200.00"),
            source=Transaction.Source.PLAID,
            plaid_transaction_id="plaid-tg",
            imported_description="CAPITAL ONE ONLINE PMT",
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        )
        m = match_imported_transaction(imp)
        self.assertIsNotNone(m)
        self.assertEqual(m.planned_transaction_id, out_leg.pk)

    def test_matched_import_hidden_from_ledger_sum(self):
        planned = Transaction.objects.create(
            account=self.acc,
            date=date(2026, 1, 10),
            payee="Coffee",
            amount=Decimal("-5.00"),
            source=Transaction.Source.ACTUAL,
        )
        imp = Transaction.objects.create(
            account=self.acc,
            date=date(2026, 1, 11),
            payee="SBUX",
            amount=Decimal("-5.00"),
            source=Transaction.Source.PLAID,
            plaid_transaction_id="plaid-x",
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        )
        match_imported_transaction(imp)
        qs = ledger_visible_transactions(Transaction.objects.filter(account=self.acc))
        pks = set(qs.values_list("pk", flat=True))
        self.assertIn(planned.pk, pks)
        self.assertNotIn(imp.pk, pks)

    def test_transfer_payee_generic_matches_plaid_using_destination_account_name(self):
        amazon = Account.objects.create(
            household=self.h,
            account_type=Account.AccountType.CREDIT,
            name="Amazon Credit",
            institution="Synchrony Bank",
            currency="USD",
        )
        create_transfer(
            user=self.user,
            from_account_id=self.acc.id,
            to_account_id=amazon.id,
            amount=Decimal("300.00"),
            transfer_date="2026-03-23",
            payee="Transfer",
        )
        out_leg = Transaction.objects.get(account=self.acc, amount=Decimal("-300.00"))
        imp = Transaction.objects.create(
            account=self.acc,
            date=date(2026, 3, 23),
            payee="AMAZON",
            amount=Decimal("-300.00"),
            source=Transaction.Source.PLAID,
            plaid_transaction_id="plaid-amz-pay",
            imported_description="AMAZON.COM",
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        )
        m = match_imported_transaction(imp)
        self.assertIsNotNone(m)
        self.assertEqual(m.planned_transaction_id, out_leg.pk)

    def test_orphan_inflow_leg_restores_checking_out_then_matches(self):
        card = Account.objects.create(
            household=self.h,
            account_type=Account.AccountType.CREDIT,
            name="Savor",
            institution="Capital One",
            currency="USD",
        )
        in_leg = Transaction.objects.create(
            account=card,
            date=date(2026, 3, 26),
            payee="Payment",
            amount=Decimal("250.00"),
            source=Transaction.Source.ACTUAL,
            status=Transaction.Status.CLEARED,
        )
        imp = Transaction.objects.create(
            account=self.acc,
            date=date(2026, 3, 26),
            payee="CAPITAL ONE ONLINE PMT",
            amount=Decimal("-250.00"),
            source=Transaction.Source.PLAID,
            plaid_transaction_id="plaid-cap1",
            imported_description="CAPITAL ONE ONLINE PMT CA0F652823B8B44 WEB ID",
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        )
        m = match_imported_transaction(imp)
        self.assertIsNotNone(m)
        out = Transaction.objects.get(account=self.acc, amount=Decimal("-250.00"), pk=m.planned_transaction_id)
        self.assertIsNotNone(out.transfer_group_id)
        in_leg.refresh_from_db()
        self.assertEqual(in_leg.transfer_group_id, out.transfer_group_id)

    def test_no_orphan_repair_when_multiple_same_amount_cards_ambiguous(self):
        for name in ("Savor", "Venture", "Platinum"):
            c = Account.objects.create(
                household=self.h,
                account_type=Account.AccountType.CREDIT,
                name=name,
                institution="Capital One",
                currency="USD",
            )
            Transaction.objects.create(
                account=c,
                date=date(2026, 3, 26),
                payee="Payment",
                amount=Decimal("250.00"),
                source=Transaction.Source.ACTUAL,
                status=Transaction.Status.CLEARED,
            )
        imp = Transaction.objects.create(
            account=self.acc,
            date=date(2026, 3, 26),
            payee="CAPITAL ONE ONLINE PMT",
            amount=Decimal("-250.00"),
            source=Transaction.Source.PLAID,
            plaid_transaction_id="plaid-cap-amb",
            imported_description="CAPITAL ONE ONLINE PMT",
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        )
        self.assertIsNone(match_imported_transaction(imp))
        self.assertEqual(Transaction.objects.filter(account=self.acc, amount=Decimal("-250.00")).count(), 1)

    def test_rule_row_matches_plaid_that_synced_first(self):
        """When Plaid imported before the rule occurrence existed, match from the planned side."""
        cat = Category.objects.create(
            household=self.h,
            name="Salary",
            category_type=Category.CategoryType.INCOME,
            sort_order=1,
        )
        rule = RecurringRule.objects.create(
            household=self.h,
            name="Payroll",
            account=self.acc,
            category=cat,
            direction=RecurringRule.Direction.INCOME,
            amount=Decimal("1835.52"),
            currency="USD",
            frequency=RecurringRule.Frequency.MONTHLY_DAY,
            interval=1,
            day_of_month=1,
            start_date=date(2026, 1, 1),
            end_date=None,
            active=True,
        )
        amt = Decimal("1835.52")
        imp = Transaction.objects.create(
            account=self.acc,
            date=date(2026, 4, 30),
            payee="Payroll",
            memo="",
            amount=amt,
            source=Transaction.Source.PLAID,
            plaid_transaction_id="pl-payroll-first",
            imported_description="2930 JOHN GALT S PAYROLL PPD ID: 14409866",
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
            cleared=True,
            status=Transaction.Status.CLEARED,
        )
        self.assertIsNone(match_imported_transaction(imp))

        planned = Transaction.objects.create(
            account=self.acc,
            date=date(2026, 5, 1),
            payee="2930 JOHN GALT S PAYROLL PPD ID: 14409866",
            memo="",
            amount=amt,
            category_id=cat.id,
            source=Transaction.Source.RULE,
            rule=rule,
            status=Transaction.Status.PLANNED,
        )
        m = try_match_rule_to_pending_imports(planned)
        self.assertIsNotNone(m)
        self.assertEqual(m.planned_transaction_id, planned.pk)
        self.assertEqual(m.imported_transaction_id, imp.pk)
        imp.refresh_from_db()
        planned.refresh_from_db()
        self.assertEqual(imp.import_match_status, Transaction.ImportMatchStatus.MATCHED)
        self.assertEqual(planned.import_match_status, Transaction.ImportMatchStatus.MATCHED)

    def test_materialize_rule_occurrence_links_prior_plaid_import(self):
        from timeline.services.ledger import _materialize_rule_occurrence

        cat = Category.objects.create(
            household=self.h,
            name="Salary",
            category_type=Category.CategoryType.INCOME,
            sort_order=2,
        )
        rule = RecurringRule.objects.create(
            household=self.h,
            name="Payroll",
            account=self.acc,
            category=cat,
            direction=RecurringRule.Direction.INCOME,
            amount=Decimal("1835.52"),
            currency="USD",
            frequency=RecurringRule.Frequency.MONTHLY_DAY,
            interval=1,
            day_of_month=1,
            start_date=date(2026, 1, 1),
            end_date=None,
            active=True,
        )
        amt = Decimal("1835.52")
        Transaction.objects.create(
            account=self.acc,
            date=date(2026, 4, 30),
            payee="Payroll",
            amount=amt,
            source=Transaction.Source.PLAID,
            plaid_transaction_id="pl-payroll-mat",
            imported_description="2930 JOHN GALT S PAYROLL PPD ID: 14409866",
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
            cleared=True,
            status=Transaction.Status.CLEARED,
        )
        planned = _materialize_rule_occurrence(rule, date(2026, 5, 1), self.acc.id, amt, rule.name, cat.id)
        imp = Transaction.objects.get(plaid_transaction_id="pl-payroll-mat")
        self.assertTrue(
            TransactionMatch.objects.filter(planned_transaction=planned, imported_transaction=imp).exists()
        )

    def test_second_plaid_import_marked_duplicate_when_planned_already_matched(self):
        card = Account.objects.create(
            household=self.h,
            account_type=Account.AccountType.CREDIT,
            name="Savor",
            institution="Capital One",
            currency="USD",
        )
        d = date(2026, 5, 13)
        amt = Decimal("-550.00")
        create_transfer(
            user=self.user,
            from_account_id=self.acc.id,
            to_account_id=card.id,
            amount=Decimal("550.00"),
            transfer_date=d.isoformat(),
            payee="Credit Card Pmt (Savor)",
        )
        out_leg = Transaction.objects.get(account=self.acc, amount=amt)
        first = Transaction.objects.create(
            account=self.acc,
            date=d,
            payee="CAPITAL ONE ONLINE PMT CA0AEF56A9B3CBE",
            amount=amt,
            source=Transaction.Source.PLAID,
            plaid_transaction_id="plaid-savor-1",
            imported_description="CAPITAL ONE ONLINE PMT",
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        )
        m = match_imported_transaction(first)
        self.assertIsNotNone(m)
        self.assertEqual(m.planned_transaction_id, out_leg.pk)

        second = Transaction.objects.create(
            account=self.acc,
            date=d,
            payee="CAPITAL ONE ONLINE PMT CA005B47444F1E0",
            amount=amt,
            source=Transaction.Source.PLAID,
            plaid_transaction_id="plaid-savor-2",
            imported_description="CAPITAL ONE ONLINE PMT",
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        )
        self.assertIsNone(match_imported_transaction(second))
        second.refresh_from_db()
        self.assertEqual(second.import_match_status, Transaction.ImportMatchStatus.DUPLICATE)

        visible = set(
            ledger_visible_transactions(Transaction.objects.filter(account=self.acc, date=d)).values_list(
                "pk", flat=True
            )
        )
        self.assertIn(out_leg.pk, visible)
        self.assertNotIn(first.pk, visible)
        self.assertNotIn(second.pk, visible)

    def test_reconcile_orphan_matched_plaid_import(self):
        d = date(2026, 5, 13)
        amt = Decimal("-99.00")
        planned = Transaction.objects.create(
            account=self.acc,
            date=d,
            payee="Test",
            amount=amt,
            source=Transaction.Source.ACTUAL,
        )
        anchor = Transaction.objects.create(
            account=self.acc,
            date=d,
            payee="BANK",
            amount=amt,
            source=Transaction.Source.PLAID,
            plaid_transaction_id="plaid-anchor",
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        )
        match_imported_transaction(anchor)
        orphan = Transaction.objects.create(
            account=self.acc,
            date=d,
            payee="BANK 2",
            amount=amt,
            source=Transaction.Source.PLAID,
            plaid_transaction_id="plaid-orphan",
            import_match_status=Transaction.ImportMatchStatus.MATCHED,
        )
        n = reconcile_orphan_matched_plaid_imports(account_id=self.acc.id)
        self.assertGreaterEqual(n, 1)
        orphan.refresh_from_db()
        self.assertEqual(orphan.import_match_status, Transaction.ImportMatchStatus.DUPLICATE)

    def test_three_capital_one_payments_same_day_match_correct_card(self):
        savor = Account.objects.create(
            household=self.h,
            account_type=Account.AccountType.CREDIT,
            name="Savor",
            currency="USD",
        )
        venture = Account.objects.create(
            household=self.h,
            account_type=Account.AccountType.CREDIT,
            name="Venture",
            currency="USD",
        )
        d = date(2026, 5, 13)
        create_transfer(
            user=self.user,
            from_account_id=self.acc.id,
            to_account_id=venture.id,
            amount=Decimal("250.00"),
            transfer_date=d.isoformat(),
            payee="Credit Card Pmt (Venture)",
        )
        create_transfer(
            user=self.user,
            from_account_id=self.acc.id,
            to_account_id=savor.id,
            amount=Decimal("550.00"),
            transfer_date=d.isoformat(),
            payee="Credit Card Pmt (Savor)",
        )
        savor_out = Transaction.objects.get(account=self.acc, amount=Decimal("-550.00"))
        imp = Transaction.objects.create(
            account=self.acc,
            date=d,
            payee="CAPITAL ONE ONLINE PMT",
            amount=Decimal("-550.00"),
            source=Transaction.Source.PLAID,
            plaid_transaction_id="plaid-550",
            imported_description="CAPITAL ONE ONLINE PMT",
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        )
        m = match_imported_transaction(imp)
        self.assertEqual(m.planned_transaction_id, savor_out.pk)

    def test_manual_cross_account_match_creates_checking_leg(self):
        card = Account.objects.create(
            household=self.h,
            account_type=Account.AccountType.CREDIT,
            name="Venture",
            institution="Capital One",
            currency="USD",
        )
        in_leg = Transaction.objects.create(
            account=card,
            date=date(2026, 3, 27),
            payee="Payment",
            amount=Decimal("25.00"),
            source=Transaction.Source.ACTUAL,
            status=Transaction.Status.CLEARED,
        )
        imp = Transaction.objects.create(
            account=self.acc,
            date=date(2026, 3, 27),
            payee="CAPITAL ONE CRCARDPMT",
            amount=Decimal("-25.00"),
            source=Transaction.Source.PLAID,
            plaid_transaction_id="plaid-man-x",
            imported_description="CAPITAL ONE CRCARDPMT CA01EFA28B1C8B9",
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        )
        m = manual_match_transactions(planned_id=in_leg.pk, imported_id=imp.pk, user=self.user)
        self.assertIsNotNone(m)
        out = Transaction.objects.get(pk=m.planned_transaction_id, account=self.acc)
        self.assertEqual(out.amount, Decimal("-25.00"))
        in_leg.refresh_from_db()
        self.assertEqual(in_leg.transfer_group_id, out.transfer_group_id)

    def test_multiple_same_amount_actual_imports_match_one_to_one(self):
        """Four bank posts of the same amount must not collapse into one visible row."""
        d_manual = date(2026, 6, 1)
        d_bank = date(2026, 6, 2)
        amt = Decimal("-20.00")
        manuals = [
            Transaction.objects.create(
                account=self.acc,
                date=d_manual,
                payee="POS DEBIT ARIZONA HUMANE SOCIETY PHOENIX AZ",
                amount=amt,
                source=Transaction.Source.ACTUAL,
            )
            for _ in range(3)
        ]
        imports = []
        for i in range(4):
            imp = Transaction.objects.create(
                account=self.acc,
                date=d_bank,
                payee="ARIZONA HUMANE SOCIET",
                amount=amt,
                source=Transaction.Source.PLAID,
                plaid_transaction_id=f"plaid-humane-{i}",
                imported_description="ARIZONA HUMANE SOCIET 602-997-7585 AZ 06/01 (...2404)",
                import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
            )
            imports.append(imp)
            match_imported_transaction(imp)

        for imp in imports[:3]:
            imp.refresh_from_db()
            self.assertEqual(imp.import_match_status, Transaction.ImportMatchStatus.MATCHED)

        imports[3].refresh_from_db()
        self.assertEqual(imports[3].import_match_status, Transaction.ImportMatchStatus.UNMATCHED)

        visible = ledger_visible_transactions(
            Transaction.objects.filter(account=self.acc, amount=amt, date__gte=d_manual)
        )
        visible_pks = set(visible.values_list("pk", flat=True))
        self.assertEqual(len(visible_pks), 4)
        for manual in manuals:
            self.assertIn(manual.pk, visible_pks)
        self.assertIn(imports[3].pk, visible_pks)
        self.assertEqual(TransactionMatch.objects.filter(imported_transaction__in=imports).count(), 3)
