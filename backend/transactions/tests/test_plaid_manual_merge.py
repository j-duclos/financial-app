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
from transactions.services.posting import post_transaction
from transactions.services.matching import (
    ledger_visible_transactions,
    manual_match_transactions,
    match_imported_transaction,
    reconcile_orphan_matched_plaid_imports,
    repair_invalid_transaction_matches,
    repair_materialized_plaid_resync_duplicates,
    try_mark_plaid_import_as_duplicate_of_existing_match,
    try_mark_resync_import_duplicate,
    try_match_pending_imports_to_manual,
    try_match_rule_to_pending_imports,
    rematch_unmatched_manual_actuals,
    score_candidate,
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

    def test_manual_entered_after_plaid_import_links_and_hides_import(self):
        d = date(2026, 6, 10)
        amt = Decimal("-77.65")
        imp = Transaction.objects.create(
            account=self.acc,
            date=d,
            payee="Chewy",
            amount=amt,
            source=Transaction.Source.PLAID,
            plaid_transaction_id="pl-chewy-jun10",
            imported_description="CHEWY INC",
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        )
        manual = post_transaction(
            user=self.user,
            account_id=self.acc.id,
            date=d,
            payee="POS DEBIT PAYPAL *CHEWY INC DANIA BEACH FL",
            amount=amt,
        )
        imp.refresh_from_db()
        manual.refresh_from_db()
        self.assertEqual(manual.import_match_status, Transaction.ImportMatchStatus.MATCHED)
        self.assertEqual(imp.import_match_status, Transaction.ImportMatchStatus.MATCHED)
        visible = set(
            ledger_visible_transactions(Transaction.objects.filter(account=self.acc, date=d)).values_list(
                "pk", flat=True
            )
        )
        self.assertIn(manual.pk, visible)
        self.assertNotIn(imp.pk, visible)

    def test_post_transaction_accepts_iso_date_string_with_pending_plaid(self):
        """Regression: JSON date strings must not break auto-match after create."""
        d = date(2026, 6, 11)
        amt = Decimal("-12.34")
        Transaction.objects.create(
            account=self.acc,
            date=d,
            payee="Store",
            amount=amt,
            source=Transaction.Source.PLAID,
            plaid_transaction_id="pl-str-jun11",
            imported_description="STORE",
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        )
        manual = post_transaction(
            user=self.user,
            account_id=self.acc.id,
            date="2026-06-11",
            payee="Store purchase",
            amount=amt,
        )
        self.assertIsNotNone(manual.pk)
        self.assertEqual(manual.date, d)

    def test_rematch_unmatched_manual_actuals_links_existing_rows(self):
        d = date(2026, 6, 10)
        amt = Decimal("-24.42")
        imp = Transaction.objects.create(
            account=self.acc,
            date=d,
            payee="Fry's Food and Drug",
            amount=amt,
            source=Transaction.Source.PLAID,
            plaid_transaction_id="pl-frys-jun10",
            imported_description="FRYS FOOD AND DRUG",
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        )
        manual = Transaction.objects.create(
            account=self.acc,
            date=d,
            payee="POS DEBIT FRYS-FOOD-DRG #0672 MARICOPA AZ",
            amount=amt,
            source=Transaction.Source.ACTUAL,
        )
        self.assertEqual(rematch_unmatched_manual_actuals(account_id=self.acc.id), 1)
        imp.refresh_from_db()
        manual.refresh_from_db()
        self.assertTrue(TransactionMatch.objects.filter(planned_transaction=manual, imported_transaction=imp).exists())
        self.assertEqual(manual.payee, "Fry's Food and Drug")

    def test_collapse_materialized_actual_duplicate_does_not_merge(self):
        """Each unique plaid_transaction_id keeps its own row — no fuzzy collapse onto manual twins."""
        d = date(2026, 6, 10)
        amt = Decimal("-77.65")
        manual = Transaction.objects.create(
            account=self.acc,
            date=d,
            payee="POS DEBIT PAYPAL *CHEWY INC DANIA BEACH FL",
            amount=amt,
            source=Transaction.Source.ACTUAL,
        )
        materialized = Transaction.objects.create(
            account=self.acc,
            date=d,
            payee="Chewy",
            amount=amt,
            source=Transaction.Source.ACTUAL,
            plaid_transaction_id="pl-chewy-mat",
            imported_description="CHEWY INC",
            import_match_status=Transaction.ImportMatchStatus.NONE,
        )
        from transactions.services.matching import collapse_materialized_actual_duplicates

        self.assertEqual(collapse_materialized_actual_duplicates(account_id=self.acc.id), 0)
        self.assertTrue(Transaction.objects.filter(pk=materialized.pk).exists())
        visible = set(
            ledger_visible_transactions(Transaction.objects.filter(account=self.acc, date=d)).values_list(
                "pk", flat=True
            )
        )
        self.assertEqual(visible, {manual.pk, materialized.pk})

    def test_materialize_skips_when_manual_twin_exists(self):
        d = date(2026, 6, 10)
        amt = Decimal("-24.42")
        manual = Transaction.objects.create(
            account=self.acc,
            date=d,
            payee="POS DEBIT FRYS-FOOD-DRG #0672 MARICOPA AZ",
            amount=amt,
            source=Transaction.Source.ACTUAL,
        )
        imp = Transaction.objects.create(
            account=self.acc,
            date=d,
            payee="Fry's Food and Drug",
            amount=amt,
            source=Transaction.Source.PLAID,
            plaid_transaction_id="pl-frys-skip-mat",
            imported_description="FRYS FOOD AND DRUG",
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        )
        from transactions.services.matching import materialize_unmatched_plaid_imports

        materialize_unmatched_plaid_imports(account_id=self.acc.id)
        imp.refresh_from_db()
        manual.refresh_from_db()
        self.assertEqual(imp.source, Transaction.Source.PLAID)
        self.assertEqual(imp.import_match_status, Transaction.ImportMatchStatus.MATCHED)
        self.assertTrue(TransactionMatch.objects.filter(planned_transaction=manual, imported_transaction=imp).exists())
        visible = set(
            ledger_visible_transactions(Transaction.objects.filter(account=self.acc, date=d)).values_list(
                "pk", flat=True
            )
        )
        self.assertEqual(visible, {manual.pk})

    def test_merchant_token_overlap_scores_long_manual_payee(self):
        d = date(2026, 6, 10)
        amt = Decimal("-77.65")
        manual = Transaction.objects.create(
            account=self.acc,
            date=d,
            payee="POS DEBIT PAYPAL *CHEWY INC DANIA BEACH FL",
            amount=amt,
            source=Transaction.Source.ACTUAL,
        )
        imp = Transaction.objects.create(
            account=self.acc,
            date=d,
            payee="Chewy",
            amount=amt,
            source=Transaction.Source.PLAID,
            plaid_transaction_id="pl-score-chewy",
            imported_description="CHEWY INC",
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        )
        score, parts = score_candidate(imp, manual)
        self.assertGreaterEqual(score, 85)
        self.assertGreater(parts.get("merchant_token", 0), 0)

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

    def test_second_plaid_import_stays_unmatched_when_planned_already_matched(self):
        """A second Plaid id with a different transaction_id is kept — not fuzzy-marked duplicate."""
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
        self.assertNotEqual(second.import_match_status, Transaction.ImportMatchStatus.DUPLICATE)
        self.assertEqual(second.import_match_status, Transaction.ImportMatchStatus.UNMATCHED)

        visible = set(
            ledger_visible_transactions(Transaction.objects.filter(account=self.acc, date=d)).values_list(
                "pk", flat=True
            )
        )
        self.assertIn(out_leg.pk, visible)
        self.assertNotIn(first.pk, visible)
        self.assertIn(second.pk, visible)

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
        self.assertEqual(orphan.import_match_status, Transaction.ImportMatchStatus.UNMATCHED)

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

    def test_orphan_plaid_import_materialized_when_no_manual_row(self):
        """Fourth bank charge with no manual entry must still appear in the ledger."""
        d_bank = date(2026, 6, 2)
        amt = Decimal("-20.00")
        for i in range(3):
            Transaction.objects.create(
                account=self.acc,
                date=d_bank,
                payee="Manual",
                amount=amt,
                source=Transaction.Source.ACTUAL,
            )
        imports = []
        for i in range(4):
            imp = Transaction.objects.create(
                account=self.acc,
                date=d_bank,
                payee="ARIZONA HUMANE SOCIET",
                amount=amt,
                source=Transaction.Source.PLAID,
                plaid_transaction_id=f"pl-orphan-{i}",
                imported_description="ARIZONA HUMANE SOCIET",
                import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
            )
            imports.append(imp)
            match_imported_transaction(imp)

        from transactions.services.matching import materialize_unmatched_plaid_imports

        materialize_unmatched_plaid_imports(account_id=self.acc.id)
        imports[3].refresh_from_db()
        self.assertEqual(imports[3].source, Transaction.Source.ACTUAL)
        self.assertEqual(imports[3].import_match_status, Transaction.ImportMatchStatus.NONE)

        visible = ledger_visible_transactions(
            Transaction.objects.filter(account=self.acc, amount=amt, date=d_bank)
        )
        self.assertEqual(visible.count(), 4)

    def test_same_amount_zelle_not_marked_duplicate_of_card_payment(self):
        """A $25 Zelle charge must not disappear when a $25 card payment is matched."""
        d = date(2026, 3, 26)
        amt = Decimal("-25.00")
        from accounts.models import Account
        from transactions.services.posting import create_transfer

        card = Account.objects.create(
            household=self.h,
            account_type=Account.AccountType.CREDIT,
            name="Venture",
            currency="USD",
        )
        create_transfer(
            user=self.user,
            from_account_id=self.acc.id,
            to_account_id=card.id,
            amount=Decimal("25.00"),
            transfer_date=d.isoformat(),
            payee="Credit Card Pmt",
        )
        out_leg = Transaction.objects.get(account=self.acc, amount=amt, date=d)
        card_pmt = Transaction.objects.create(
            account=self.acc,
            date=d,
            payee="CAPITAL ONE CRCARDPMT CA01EFA28B1C8B9",
            amount=amt,
            source=Transaction.Source.PLAID,
            plaid_transaction_id="pl-crcard",
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        )
        match_imported_transaction(card_pmt)
        out_leg.refresh_from_db()
        self.assertEqual(out_leg.import_match_status, Transaction.ImportMatchStatus.MATCHED)

        zelle_a = Transaction.objects.create(
            account=self.acc,
            date=d,
            payee="Zelle payment to T JPM99cak2hnj",
            amount=amt,
            source=Transaction.Source.PLAID,
            plaid_transaction_id="pl-zelle-a",
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        )
        zelle_b = Transaction.objects.create(
            account=self.acc,
            date=d,
            payee="Zelle payment to T JPM99cak3yn2",
            amount=amt,
            source=Transaction.Source.PLAID,
            plaid_transaction_id="pl-zelle-b",
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        )
        match_imported_transaction(zelle_a)
        match_imported_transaction(zelle_b)
        zelle_a.refresh_from_db()
        zelle_b.refresh_from_db()
        self.assertNotEqual(zelle_a.import_match_status, Transaction.ImportMatchStatus.DUPLICATE)
        self.assertNotEqual(zelle_b.import_match_status, Transaction.ImportMatchStatus.DUPLICATE)

        from transactions.services.matching import release_excess_duplicate_plaid_imports

        release_excess_duplicate_plaid_imports(account_id=self.acc.id)
        zelle_a.refresh_from_db()
        zelle_b.refresh_from_db()
        self.assertNotEqual(zelle_a.import_match_status, Transaction.ImportMatchStatus.DUPLICATE)

        visible = ledger_visible_transactions(
            Transaction.objects.filter(account=self.acc, date=d, amount=amt)
        )
        self.assertGreaterEqual(visible.count(), 3)

    def test_two_zelle_same_amount_same_day_both_visible(self):
        """Two distinct Zelle payments must not collapse when descriptions only differ by recipient id."""
        d = date(2026, 3, 26)
        amt = Decimal("-25.00")
        zelle_a = Transaction.objects.create(
            account=self.acc,
            date=d,
            payee="Zelle payment to T JPM99cak2hnj",
            amount=amt,
            source=Transaction.Source.PLAID,
            plaid_transaction_id="pl-zelle-a",
            imported_description="Zelle payment to T JPM99cak2hnj",
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        )
        zelle_b = Transaction.objects.create(
            account=self.acc,
            date=d,
            payee="Zelle payment to T JPM99cak3yn2",
            amount=amt,
            source=Transaction.Source.PLAID,
            plaid_transaction_id="pl-zelle-b",
            imported_description="Zelle payment to T JPM99cak3yn2",
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        )
        match_imported_transaction(zelle_a)
        match_imported_transaction(zelle_b)
        zelle_a.refresh_from_db()
        zelle_b.refresh_from_db()
        self.assertNotEqual(zelle_a.import_match_status, Transaction.ImportMatchStatus.DUPLICATE)
        self.assertNotEqual(zelle_b.import_match_status, Transaction.ImportMatchStatus.DUPLICATE)

        from transactions.services.matching import materialize_unmatched_plaid_imports

        materialize_unmatched_plaid_imports(account_id=self.acc.id)
        visible = ledger_visible_transactions(
            Transaction.objects.filter(account=self.acc, date=d, amount=amt)
        )
        self.assertEqual(visible.count(), 2)

    def test_two_capital_one_online_pmt_same_amount_same_day_both_visible(self):
        """Two Capital One ACH payments with different confirmation codes are separate charges."""
        d = date(2026, 3, 26)
        amt = Decimal("-250.00")
        pmt_a = Transaction.objects.create(
            account=self.acc,
            date=d,
            payee="CAPITAL ONE ONLINE PMT CA0F652823B8B44",
            amount=amt,
            source=Transaction.Source.PLAID,
            plaid_transaction_id="pl-cap-a",
            imported_description="CAPITAL ONE ONLINE PMT CA0F652823B8B44 WEB ID: 9279744391",
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        )
        pmt_b = Transaction.objects.create(
            account=self.acc,
            date=d,
            payee="CAPITAL ONE ONLINE PMT CA0F613177D0164",
            amount=amt,
            source=Transaction.Source.PLAID,
            plaid_transaction_id="pl-cap-b",
            imported_description="CAPITAL ONE ONLINE PMT CA0F613177D0164 WEB ID: 9279744391",
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        )
        match_imported_transaction(pmt_a)
        match_imported_transaction(pmt_b)
        pmt_a.refresh_from_db()
        pmt_b.refresh_from_db()
        self.assertNotEqual(pmt_a.import_match_status, Transaction.ImportMatchStatus.DUPLICATE)
        self.assertNotEqual(pmt_b.import_match_status, Transaction.ImportMatchStatus.DUPLICATE)

        from transactions.services.matching import materialize_unmatched_plaid_imports

        materialize_unmatched_plaid_imports(account_id=self.acc.id)
        visible = ledger_visible_transactions(
            Transaction.objects.filter(account=self.acc, date=d, amount=amt)
        )
        self.assertEqual(visible.count(), 2)

    def test_same_amount_different_payees_not_blocked_by_prior_reconciled_match(self):
        """Exeter car payment must import even when a reconciled Synchrony row shares the amount."""
        d_march = date(2026, 3, 30)
        d_april = date(2026, 4, 3)
        amt = Decimal("-393.79")
        sync_planned = Transaction.objects.create(
            account=self.acc,
            date=d_march,
            payee="Synchrony",
            amount=amt,
            source=Transaction.Source.ACTUAL,
            reconciled=True,
            imported_description="EXETERFINA LOAN PMNT PPD ID: 5221907813",
        )
        sync_import = Transaction.objects.create(
            account=self.acc,
            date=d_march,
            payee="Synchrony",
            amount=amt,
            source=Transaction.Source.PLAID,
            plaid_transaction_id="pl-sync-march",
            imported_description="Synchrony Bank CC PYMT 601918247228591 WEB ID: 9856794001",
            import_match_status=Transaction.ImportMatchStatus.MATCHED,
        )
        TransactionMatch.objects.create(
            planned_transaction=sync_planned,
            imported_transaction=sync_import,
            match_type=TransactionMatch.MatchType.SAME_ACCOUNT,
            score=90,
            confidence=TransactionMatch.Confidence.AUTO,
        )
        from transactions.services.matching import bank_movement_already_on_ledger, materialize_unmatched_plaid_imports

        self.assertFalse(
            bank_movement_already_on_ledger(
                account_id=self.acc.id,
                txn_date=d_april,
                amount=amt,
                payee="EXETERFINA LOAN PMNT",
                imported_description="EXETERFINA LOAN PMNT PPD ID: 5221907813",
            )
        )
        exeter = Transaction.objects.create(
            account=self.acc,
            date=d_april,
            payee="EXETERFINA LOAN PMNT",
            amount=amt,
            source=Transaction.Source.PLAID,
            plaid_transaction_id="pl-exeter-april",
            imported_description="EXETERFINA LOAN PMNT PPD ID: 5221907813",
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        )
        match_imported_transaction(exeter)
        exeter.refresh_from_db()
        self.assertNotEqual(exeter.import_match_status, Transaction.ImportMatchStatus.DUPLICATE)
        materialize_unmatched_plaid_imports(account_id=self.acc.id)
        visible = ledger_visible_transactions(
            Transaction.objects.filter(account=self.acc, date=d_april, amount=amt)
        )
        self.assertEqual(visible.count(), 1)
        self.assertIn("EXETER", visible.first().payee.upper())

    def test_exeter_import_never_matches_synchrony_at_same_amount(self):
        """Exeter car loan and Synchrony CC payment must not auto-match on amount alone."""
        d = date(2026, 3, 30)
        amt = Decimal("-393.79")
        synchrony = Transaction.objects.create(
            account=self.acc,
            date=d,
            payee="Synchrony",
            amount=amt,
            source=Transaction.Source.ACTUAL,
        )
        exeter = Transaction(
            account=self.acc,
            date=d,
            amount=amt,
            payee="EXETERFINA LOAN PMNT",
            imported_description="EXETERFINA LOAN PMNT PPD ID: 5221907813",
            source=Transaction.Source.PLAID,
            plaid_transaction_id="pl-exeter-test",
        )
        sc, parts = score_candidate(exeter, synchrony)
        self.assertEqual(sc, 0)
        self.assertEqual(parts.get("reject"), "merchant_family_mismatch")

    def test_invalid_match_with_actual_import_leg_stays_visible(self):
        """ACTUAL rows wrongly linked as import leg must not disappear from the ledger."""
        d = date(2026, 2, 2)
        amt = Decimal("-10.00")
        rows = []
        for i, payee in enumerate(
            [
                "CASH APP*ANDREW DUCLOS",
                "CASH APP*JOSEPH DUCLOS",
                "CASH APP*ELIJAH DUCLOS",
                "Credit Karma Transfer",
            ]
        ):
            rows.append(
                Transaction.objects.create(
                    account=self.acc,
                    date=d,
                    payee=payee,
                    amount=amt,
                    source=Transaction.Source.ACTUAL,
                    import_match_status=Transaction.ImportMatchStatus.MATCHED,
                )
            )
        # Simulate bad data: circular matches with ACTUAL on both legs.
        TransactionMatch.objects.create(
            planned_transaction=rows[0],
            imported_transaction=rows[1],
            score=100,
        )
        TransactionMatch.objects.create(
            planned_transaction=rows[1],
            imported_transaction=rows[2],
            score=100,
        )
        TransactionMatch.objects.create(
            planned_transaction=rows[2],
            imported_transaction=rows[3],
            score=100,
        )
        TransactionMatch.objects.create(
            planned_transaction=rows[3],
            imported_transaction=rows[0],
            score=100,
        )
        before = ledger_visible_transactions(
            Transaction.objects.filter(account=self.acc, date=d, amount=amt)
        )
        self.assertEqual(before.count(), 0)

        removed = repair_invalid_transaction_matches(account_id=self.acc.id)
        self.assertEqual(removed, 4)

        after = ledger_visible_transactions(
            Transaction.objects.filter(account=self.acc, date=d, amount=amt)
        )
        self.assertEqual(after.count(), 4)

    def test_resync_import_with_new_plaid_id_stays_unmatched(self):
        """A second Plaid transaction_id for the same charge is kept — only exact id dedupes."""
        d = date(2026, 4, 29)
        amt = Decimal("-49.25")
        planned = Transaction.objects.create(
            account=self.acc,
            date=d,
            payee="Lowe's",
            amount=amt,
            source=Transaction.Source.ACTUAL,
            reconciled=True,
        )
        first = Transaction.objects.create(
            account=self.acc,
            date=d,
            payee="Lowe's",
            amount=amt,
            source=Transaction.Source.PLAID,
            plaid_transaction_id="pl-lowes-1",
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        )
        match_imported_transaction(first)
        planned.refresh_from_db()
        self.assertEqual(planned.import_match_status, Transaction.ImportMatchStatus.MATCHED)

        resync = Transaction.objects.create(
            account=self.acc,
            date=d,
            payee="Lowe's",
            amount=amt,
            source=Transaction.Source.PLAID,
            plaid_transaction_id="pl-lowes-2",
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        )
        self.assertFalse(try_mark_plaid_import_as_duplicate_of_existing_match(resync))
        resync.refresh_from_db()
        self.assertEqual(resync.import_match_status, Transaction.ImportMatchStatus.UNMATCHED)

        visible = ledger_visible_transactions(
            Transaction.objects.filter(account=self.acc, date=d, amount=amt)
        )
        self.assertEqual(visible.count(), 2)
        self.assertIn(planned.pk, set(visible.values_list("pk", flat=True)))
        self.assertIn(resync.pk, set(visible.values_list("pk", flat=True)))

    def test_resync_import_not_matched_to_orphan_when_transfer_already_matched(self):
        """Re-sync must not latch onto a ghost ACTUAL row when the transfer leg is already matched."""
        from accounts.models import Account
        from transactions.services.posting import create_transfer

        d = date(2026, 5, 5)
        amt = Decimal("-200.00")
        payee = "CAPITAL ONE ONLINE PMT CA0492F731BBFFE WEB ID: 9279744391"
        card = Account.objects.create(
            household=self.h,
            account_type=Account.AccountType.CREDIT,
            name="Amazon",
            institution="Capital One",
            currency="USD",
        )
        create_transfer(
            user=self.user,
            from_account_id=self.acc.id,
            to_account_id=card.id,
            amount=Decimal("200.00"),
            transfer_date=d.isoformat(),
            payee=payee,
        )
        transfer_out = Transaction.objects.get(account=self.acc, amount=amt, date=d)
        transfer_out.reconciled = True
        transfer_out.save(update_fields=["reconciled", "updated_at"])

        first = Transaction.objects.create(
            account=self.acc,
            date=d,
            payee=payee,
            amount=amt,
            source=Transaction.Source.PLAID,
            plaid_transaction_id="pl-cap1-1",
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        )
        match_imported_transaction(first)
        transfer_out.refresh_from_db()
        self.assertEqual(transfer_out.import_match_status, Transaction.ImportMatchStatus.MATCHED)

        ghost = Transaction.objects.create(
            account=self.acc,
            date=d,
            payee=payee,
            amount=amt,
            source=Transaction.Source.ACTUAL,
        )

        resync = Transaction.objects.create(
            account=self.acc,
            date=d,
            payee=payee,
            amount=amt,
            source=Transaction.Source.PLAID,
            plaid_transaction_id="pl-cap1-2",
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        )
        self.assertFalse(try_mark_resync_import_duplicate(resync))
        resync.refresh_from_db()
        self.assertEqual(resync.import_match_status, Transaction.ImportMatchStatus.UNMATCHED)
        self.assertFalse(TransactionMatch.objects.filter(imported_transaction_id=resync.pk).exists())

        visible = ledger_visible_transactions(
            Transaction.objects.filter(account=self.acc, date=d, amount=amt)
        )
        self.assertGreaterEqual(visible.count(), 2)
        self.assertIn(transfer_out.pk, set(visible.values_list("pk", flat=True)))
        self.assertIn(resync.pk, set(visible.values_list("pk", flat=True)))
        ghost.delete()


class TestPlaidImportDeduplicationRules(TestCase):
    """Plaid imports are authoritative — dedupe only on exact plaid_transaction_id."""

    def setUp(self):
        self.user = User.objects.create_user(username="dedupe", password="p1")
        self.h = Household.objects.create(name="DedupeH")
        HouseholdMembership.objects.create(household=self.h, user=self.user, role=HouseholdMembership.Role.OWNER)
        self.acc = Account.objects.create(
            household=self.h, account_type=Account.AccountType.CHECKING, name="Checking", currency="USD"
        )

    def test_three_cash_app_same_day_same_amount_all_saved(self):
        """Test 1: three distinct Plaid ids on the same day must all import and stay visible."""
        d = date(2026, 6, 13)
        amt = Decimal("-10.00")
        descriptions = [
            "Cash App Payment John",
            "Cash App Payment Mike",
            "Cash App Payment Sarah",
        ]
        imports = []
        for i, desc in enumerate(descriptions):
            imports.append(
                Transaction.objects.create(
                    account=self.acc,
                    date=d,
                    payee=desc,
                    amount=amt,
                    source=Transaction.Source.PLAID,
                    plaid_transaction_id=f"pl-cash-{i}",
                    imported_description=desc,
                    import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
                )
            )
        for imp in imports:
            match_imported_transaction(imp)
            imp.refresh_from_db()
            self.assertNotEqual(imp.import_match_status, Transaction.ImportMatchStatus.DUPLICATE)

        from transactions.services.matching import materialize_unmatched_plaid_imports

        materialize_unmatched_plaid_imports(account_id=self.acc.id)
        visible = ledger_visible_transactions(
            Transaction.objects.filter(account=self.acc, date=d, amount=amt)
        )
        self.assertEqual(visible.count(), 3)

    def test_one_manual_matches_closest_cash_app_only(self):
        """Test 2: one manual row absorbs only the closest Plaid import; others stay unmatched."""
        d = date(2026, 6, 13)
        amt = Decimal("-10.00")
        manual = Transaction.objects.create(
            account=self.acc,
            date=d,
            payee="Cash App Payment John",
            amount=amt,
            source=Transaction.Source.ACTUAL,
        )
        john = Transaction.objects.create(
            account=self.acc,
            date=d,
            payee="Cash App Payment John",
            amount=amt,
            source=Transaction.Source.PLAID,
            plaid_transaction_id="pl-cash-john",
            imported_description="Cash App Payment John",
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        )
        mike = Transaction.objects.create(
            account=self.acc,
            date=d,
            payee="Cash App Payment Mike",
            amount=amt,
            source=Transaction.Source.PLAID,
            plaid_transaction_id="pl-cash-mike",
            imported_description="Cash App Payment Mike",
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        )
        sarah = Transaction.objects.create(
            account=self.acc,
            date=d,
            payee="Cash App Payment Sarah",
            amount=amt,
            source=Transaction.Source.PLAID,
            plaid_transaction_id="pl-cash-sarah",
            imported_description="Cash App Payment Sarah",
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        )
        for imp in (john, mike, sarah):
            match_imported_transaction(imp)

        john.refresh_from_db()
        mike.refresh_from_db()
        sarah.refresh_from_db()
        self.assertTrue(TransactionMatch.objects.filter(planned_transaction=manual, imported_transaction=john).exists())
        self.assertFalse(TransactionMatch.objects.filter(imported_transaction=mike).exists())
        self.assertFalse(TransactionMatch.objects.filter(imported_transaction=sarah).exists())
        self.assertNotEqual(mike.import_match_status, Transaction.ImportMatchStatus.DUPLICATE)
        self.assertNotEqual(sarah.import_match_status, Transaction.ImportMatchStatus.DUPLICATE)
        self.assertTrue(Transaction.objects.filter(pk=mike.pk).exists())
        self.assertTrue(Transaction.objects.filter(pk=sarah.pk).exists())

        visible = ledger_visible_transactions(
            Transaction.objects.filter(account=self.acc, date=d, amount=amt)
        )
        self.assertEqual(visible.count(), 3)

    def test_same_plaid_transaction_id_updates_existing_row(self):
        """Test 3: re-importing the same plaid_transaction_id updates — no second row."""
        d = date(2026, 6, 13)
        amt = Decimal("-10.00")
        original = Transaction.objects.create(
            account=self.acc,
            date=d,
            payee="Store",
            amount=amt,
            source=Transaction.Source.PLAID,
            plaid_transaction_id="pl-same-id",
            imported_description="STORE A",
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        )
        existing = Transaction.objects.filter(plaid_transaction_id="pl-same-id").first()
        self.assertEqual(existing.pk, original.pk)
        existing.payee = "Store Updated"
        existing.imported_description = "STORE B"
        existing.save(update_fields=["payee", "imported_description", "updated_at"])
        self.assertEqual(Transaction.objects.filter(plaid_transaction_id="pl-same-id").count(), 1)

    def test_same_amount_date_description_different_ids_not_duplicate(self):
        """Test 4: identical amount/date/description but different plaid_transaction_id — both kept."""
        d = date(2026, 6, 13)
        amt = Decimal("-10.00")
        desc = "Cash App Payment"
        a = Transaction.objects.create(
            account=self.acc,
            date=d,
            payee=desc,
            amount=amt,
            source=Transaction.Source.PLAID,
            plaid_transaction_id="pl-dup-a",
            imported_description=desc,
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        )
        b = Transaction.objects.create(
            account=self.acc,
            date=d,
            payee=desc,
            amount=amt,
            source=Transaction.Source.PLAID,
            plaid_transaction_id="pl-dup-b",
            imported_description=desc,
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        )
        match_imported_transaction(a)
        match_imported_transaction(b)
        a.refresh_from_db()
        b.refresh_from_db()
        self.assertNotEqual(a.import_match_status, Transaction.ImportMatchStatus.DUPLICATE)
        self.assertNotEqual(b.import_match_status, Transaction.ImportMatchStatus.DUPLICATE)

        from transactions.services.matching import materialize_unmatched_plaid_imports

        materialize_unmatched_plaid_imports(account_id=self.acc.id)
        visible = ledger_visible_transactions(
            Transaction.objects.filter(account=self.acc, date=d, amount=amt)
        )
        self.assertEqual(visible.count(), 2)
