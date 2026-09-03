"""Tests for scheduled transaction lifecycle: forecast → expected → actual / matched / skipped."""
from datetime import date, timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Account
from core.models import Household, HouseholdMembership
from timeline.models import RecurringRule, RecurringRuleSkip
from timeline.services.ledger import build_timeline
from transactions.models import Transaction, TransactionMatch, Transfer, TransferGroup
from transactions.services import (
    confirm_expected_transaction,
    find_import_candidates_for_planned,
    is_expected_eligible,
    is_planned_scheduled_eligible,
    ledger_visible_transactions,
    manual_match_transactions,
    match_expected_to_import,
    move_scheduled_date,
    resolve_expected_as_imported,
    skip_scheduled_transaction,
)
from transactions.services.expected_lifecycle import (
    AmbiguousImportResolution,
    ImportResolutionError,
)

User = get_user_model()


def _coerce_row_date(value) -> date:
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value)[:10])


class ExpectedLifecycleFixture(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="lifecycle", password="p1")
        self.h = Household.objects.create(name="H-Lifecycle")
        HouseholdMembership.objects.create(
            household=self.h, user=self.user, role=HouseholdMembership.Role.OWNER
        )
        self.acc = Account.objects.create(
            household=self.h,
            account_type=Account.AccountType.CHECKING,
            name="Checking",
            currency="USD",
        )
        self.rule = RecurringRule.objects.create(
            household=self.h,
            account=self.acc,
            name="Rent",
            direction=RecurringRule.Direction.EXPENSE,
            amount=Decimal("1200.00"),
            frequency=RecurringRule.Frequency.MONTHLY_DAY,
            day_of_month=1,
            start_date=date(2026, 1, 1),
            active=True,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _planned_rule_row(self, d: date, **kwargs) -> Transaction:
        defaults = dict(
            account=self.acc,
            date=d,
            payee="Rent",
            amount=Decimal("-1200.00"),
            source=Transaction.Source.RULE,
            status=Transaction.Status.PLANNED,
            rule=self.rule,
        )
        defaults.update(kwargs)
        return Transaction.objects.create(**defaults)

    def _future_planned(self) -> Transaction:
        return self._planned_rule_row(date.today() + timedelta(days=14))

    def _expected_planned(self) -> Transaction:
        return self._planned_rule_row(date.today() - timedelta(days=2))


class TestEligibility(ExpectedLifecycleFixture):
    def test_future_scheduled_is_not_expected(self):
        txn = self._future_planned()
        self.assertTrue(is_planned_scheduled_eligible(txn))
        self.assertFalse(is_expected_eligible(txn))

    def test_due_scheduled_is_expected(self):
        txn = self._expected_planned()
        self.assertTrue(is_expected_eligible(txn))

    def test_cleared_is_not_expected(self):
        txn = self._expected_planned()
        txn.status = Transaction.Status.CLEARED
        txn.save()
        self.assertFalse(is_expected_eligible(txn))


class TestConfirm(ExpectedLifecycleFixture):
    def test_confirm_moves_to_cleared(self):
        txn = self._expected_planned()
        confirm_expected_transaction(txn, user=self.user)
        txn.refresh_from_db()
        self.assertEqual(txn.status, Transaction.Status.CLEARED)
        self.assertTrue(txn.cleared)
        self.assertEqual(txn.rule_id, self.rule.id)

    def test_confirm_api(self):
        txn = self._expected_planned()
        resp = self.client.post(f"/api/transactions/{txn.pk}/confirm/")
        self.assertEqual(resp.status_code, 200)
        txn.refresh_from_db()
        self.assertEqual(txn.status, Transaction.Status.CLEARED)


class TestSkip(ExpectedLifecycleFixture):
    def test_skip_records_rule_skip_and_removes_row(self):
        txn = self._expected_planned()
        txn_id = txn.pk
        skip_scheduled_transaction(txn, user=self.user)
        self.assertFalse(Transaction.objects.filter(pk=txn_id).exists())
        self.assertTrue(
            RecurringRuleSkip.objects.filter(rule=self.rule, date=txn.date).exists()
        )

    def test_skip_due_occurrence_api(self):
        txn = self._expected_planned()
        resp = self.client.post(f"/api/transactions/{txn.pk}/skip/")
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(Transaction.objects.filter(pk=txn.pk).exists())
        self.assertTrue(RecurringRuleSkip.objects.filter(rule=self.rule).exists())

    def test_skip_future_forecast(self):
        txn = self._future_planned()
        skip_scheduled_transaction(txn, user=self.user)
        self.assertTrue(RecurringRuleSkip.objects.filter(rule=self.rule, date=txn.date).exists())


class TestSkipTransferPair(ExpectedLifecycleFixture):
    def setUp(self):
        super().setUp()
        self.savor = Account.objects.create(
            household=self.h,
            account_type=Account.AccountType.SAVINGS,
            name="Savor",
            currency="USD",
        )
        self.transfer_rule = RecurringRule.objects.create(
            household=self.h,
            account=self.acc,
            transfer_to_account=self.savor,
            name="Med Ins - Move to Savor",
            direction=RecurringRule.Direction.EXPENSE,
            amount=Decimal("620.00"),
            frequency=RecurringRule.Frequency.MONTHLY_DAY,
            day_of_month=29,
            start_date=date(2026, 1, 1),
            active=True,
        )
        self.occ_date = date(2026, 6, 29)

    def test_skip_outflow_removes_orphan_inflow_leg(self):
        outflow = Transaction.objects.create(
            account=self.acc,
            date=self.occ_date,
            payee=self.transfer_rule.name,
            amount=Decimal("-620.00"),
            source=Transaction.Source.RULE,
            status=Transaction.Status.PLANNED,
            rule=self.transfer_rule,
        )
        inflow = Transaction.objects.create(
            account=self.savor,
            date=self.occ_date,
            payee=self.transfer_rule.name,
            amount=Decimal("620.00"),
            source=Transaction.Source.RULE,
            status=Transaction.Status.PLANNED,
            rule=self.transfer_rule,
        )
        skip_scheduled_transaction(outflow, user=self.user)
        self.assertFalse(Transaction.objects.filter(pk=outflow.pk).exists())
        self.assertFalse(Transaction.objects.filter(pk=inflow.pk).exists())
        self.assertTrue(
            RecurringRuleSkip.objects.filter(
                rule=self.transfer_rule, date=self.occ_date
            ).exists()
        )

    def test_heal_removes_orphan_inflow_when_skip_already_recorded(self):
        inflow = Transaction.objects.create(
            account=self.savor,
            date=self.occ_date,
            payee=self.transfer_rule.name,
            amount=Decimal("620.00"),
            source=Transaction.Source.RULE,
            status=Transaction.Status.PLANNED,
            rule=self.transfer_rule,
        )
        RecurringRuleSkip.objects.create(rule=self.transfer_rule, date=self.occ_date)
        from transactions.services.expected_lifecycle import purge_planned_rule_occurrence

        purge_planned_rule_occurrence(self.transfer_rule.id, self.occ_date)
        self.assertFalse(Transaction.objects.filter(pk=inflow.pk).exists())


class TestMoveDate(ExpectedLifecycleFixture):
    def test_move_to_future_keeps_planned(self):
        txn = self._expected_planned()
        new_date = date.today() + timedelta(days=10)
        move_scheduled_date(txn, new_date, user=self.user)
        txn.refresh_from_db()
        self.assertEqual(txn.date, new_date)
        self.assertEqual(txn.status, Transaction.Status.PLANNED)
        self.assertTrue(
            RecurringRuleSkip.objects.filter(rule=self.rule, date=date.today() - timedelta(days=2)).exists()
        )

    def test_move_date_api(self):
        txn = self._expected_planned()
        new_date = (date.today() + timedelta(days=7)).isoformat()
        resp = self.client.post(
            f"/api/transactions/{txn.pk}/move-date/",
            {"date": new_date},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        txn.refresh_from_db()
        self.assertEqual(txn.date.isoformat(), new_date)


class TestPlaidMatch(ExpectedLifecycleFixture):
    def test_manual_match_resolves_expected(self):
        planned = self._expected_planned()
        imported = Transaction.objects.create(
            account=self.acc,
            date=date.today(),
            payee="Rent ACH",
            amount=Decimal("-1200.00"),
            source=Transaction.Source.PLAID,
            plaid_transaction_id="plaid-rent-1",
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        )
        match_expected_to_import(planned, imported_id=imported.pk, user=self.user)
        self.assertTrue(TransactionMatch.objects.filter(planned_transaction=planned).exists())
        planned.refresh_from_db()
        imported.refresh_from_db()
        self.assertEqual(planned.import_match_status, Transaction.ImportMatchStatus.MATCHED)
        self.assertEqual(imported.import_match_status, Transaction.ImportMatchStatus.MATCHED)

    def test_import_candidates_for_planned(self):
        planned = self._expected_planned()
        Transaction.objects.create(
            account=self.acc,
            date=date.today(),
            payee="Rent ACH",
            amount=Decimal("-1200.00"),
            source=Transaction.Source.PLAID,
            plaid_transaction_id="plaid-rent-2",
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        )
        candidates = find_import_candidates_for_planned(planned)
        self.assertEqual(len(candidates), 1)

    def test_import_candidates_include_sibling_matched_plaid_import(self):
        """Payroll imported 07-02 matched to scheduled 07-02 — 07-03 expected still offers that import."""
        early = self._expected_planned()
        early.date = date(2026, 7, 2)
        early.save(update_fields=["date"])
        imported = Transaction.objects.create(
            account=self.acc,
            date=date(2026, 7, 2),
            payee="2930 JOHN GALT S PAYROLL PPD ID: 14409866",
            amount=Decimal("1835.52"),
            source=Transaction.Source.PLAID,
            plaid_transaction_id="plaid-payroll-sibling",
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        )
        manual_match_transactions(planned_id=early.pk, imported_id=imported.pk, user=self.user)

        late = Transaction.objects.create(
            account=self.acc,
            date=date(2026, 7, 3),
            payee="2930 JOHN GALT S PAYROLL PPD ID: 14409866",
            amount=Decimal("1835.52"),
            status=Transaction.Status.PLANNED,
            source=Transaction.Source.RULE,
            rule=self.rule,
        )
        candidates = find_import_candidates_for_planned(late)
        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0][0].pk, imported.pk)

    def test_shadow_hides_duplicate_when_matched_sibling_not_in_visible_set(self):
        """Matched planned twin hidden from ledger must still shadow the next-day duplicate."""
        from transactions.services.matching import ledger_visible_transactions, shadowed_rule_occurrence_ids

        early = self._expected_planned()
        early.date = date(2026, 7, 2)
        early.save(update_fields=["date"])
        imported = Transaction.objects.create(
            account=self.acc,
            date=date(2026, 7, 2),
            payee="2930 JOHN GALT S PAYROLL PPD ID: 14409866",
            amount=Decimal("1835.52"),
            source=Transaction.Source.PLAID,
            plaid_transaction_id="plaid-payroll-shadow",
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        )
        manual_match_transactions(planned_id=early.pk, imported_id=imported.pk, user=self.user)
        late = Transaction.objects.create(
            account=self.acc,
            date=date(2026, 7, 3),
            payee="2930 JOHN GALT S PAYROLL PPD ID: 14409866",
            amount=Decimal("1835.52"),
            status=Transaction.Status.PLANNED,
            source=Transaction.Source.RULE,
            rule=self.rule,
        )
        visible = list(
            ledger_visible_transactions(
                Transaction.objects.filter(account=self.acc, date__gte=date(2026, 7, 1))
            )
        )
        self.assertNotIn(early.pk, {t.pk for t in visible})
        self.assertIn(late.pk, {t.pk for t in visible})
        self.assertIn(late.pk, shadowed_rule_occurrence_ids(visible))

    def test_match_api(self):
        planned = self._expected_planned()
        imported = Transaction.objects.create(
            account=self.acc,
            date=date.today(),
            payee="Rent ACH",
            amount=Decimal("-1200.00"),
            source=Transaction.Source.PLAID,
            plaid_transaction_id="plaid-rent-3",
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        )
        resp = self.client.post(
            f"/api/transactions/{planned.pk}/match/",
            {"imported_transaction_id": imported.pk},
            format="json",
        )
        self.assertEqual(resp.status_code, 201)


class TestSectionClassification(ExpectedLifecycleFixture):
    def test_due_planned_not_in_past_timeline_as_actual(self):
        txn = self._expected_planned()
        today = timezone.localdate()
        rows = build_timeline(
            user=self.user,
            start_date=today - timedelta(days=30),
            end_date=today + timedelta(days=30),
            account_id=self.acc.id,
        )
        txn_rows = [r for r in rows if r.get("transaction_id") == txn.pk]
        self.assertEqual(len(txn_rows), 1)
        self.assertEqual((txn_rows[0].get("status") or "").upper(), "PLANNED")
        self.assertLessEqual(_coerce_row_date(txn_rows[0]["date"]), today)

    def test_confirmed_appears_as_cleared_in_timeline(self):
        txn = self._expected_planned()
        confirm_expected_transaction(txn, user=self.user)
        today = timezone.localdate()
        rows = build_timeline(
            user=self.user,
            start_date=today - timedelta(days=30),
            end_date=today + timedelta(days=30),
            account_id=self.acc.id,
        )
        cleared = [
            r
            for r in rows
            if r.get("transaction_id") == txn.pk
            and (r.get("status") or "").upper() == "CLEARED"
        ]
        self.assertEqual(len(cleared), 1)

    def test_non_plaid_account_confirm_workflow(self):
        """Manual-only account: confirm is the primary resolution path."""
        manual_acc = Account.objects.create(
            household=self.h,
            account_type=Account.AccountType.CHECKING,
            name="Manual Cash",
            currency="USD",
        )
        rule = RecurringRule.objects.create(
            household=self.h,
            account=manual_acc,
            name="Allowance",
            direction=RecurringRule.Direction.INCOME,
            amount=Decimal("100.00"),
            frequency=RecurringRule.Frequency.MONTHLY_DAY,
            day_of_month=15,
            start_date=date(2026, 1, 1),
            active=True,
        )
        txn = Transaction.objects.create(
            account=manual_acc,
            date=date.today() - timedelta(days=1),
            payee="Allowance",
            amount=Decimal("100.00"),
            source=Transaction.Source.RULE,
            status=Transaction.Status.PLANNED,
            rule=rule,
        )
        confirm_expected_transaction(txn, user=self.user)
        txn.refresh_from_db()
        self.assertEqual(txn.status, Transaction.Status.CLEARED)
        self.assertIsNone(
            TransactionMatch.objects.filter(planned_transaction=txn).first()
        )


def _next_month_on_day(anchor: date, day: int) -> date:
    if anchor.month == 12:
        return date(anchor.year + 1, 1, day)
    return date(anchor.year, anchor.month + 1, day)


class TestResolveExpectedAsImported(ExpectedLifecycleFixture):
    def _plaid_import(self, **kwargs) -> Transaction:
        defaults = dict(
            account=self.acc,
            date=date.today(),
            payee="Rent ACH",
            amount=Decimal("-1200.00"),
            source=Transaction.Source.PLAID,
            plaid_transaction_id="plaid-resolve-1",
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        )
        defaults.update(kwargs)
        return Transaction.objects.create(**defaults)

    def test_ordinary_scheduled_expense_keeps_import_and_deletes_planned(self):
        planned = self._expected_planned()
        imported = self._plaid_import()
        result = resolve_expected_as_imported(planned, user=self.user)
        self.assertTrue(result["resolved"])
        self.assertEqual(result["imported_transaction_id"], imported.pk)
        self.assertEqual(result["removed_planned_transaction_id"], planned.pk)
        self.assertIsNone(result["preserved_counterpart_transaction_id"])
        self.assertFalse(Transaction.objects.filter(pk=planned.pk).exists())
        imported.refresh_from_db()
        self.assertEqual(imported.source, Transaction.Source.PLAID)
        self.assertEqual(imported.plaid_transaction_id, "plaid-resolve-1")
        self.assertNotEqual(imported.import_match_status, Transaction.ImportMatchStatus.DUPLICATE)
        self.assertNotEqual(imported.import_match_status, Transaction.ImportMatchStatus.IGNORED)
        visible = list(ledger_visible_transactions(Transaction.objects.filter(account=self.acc)))
        self.assertIn(imported.pk, {t.pk for t in visible})
        self.assertNotIn(planned.pk, {t.pk for t in visible})

    def test_materialized_actual_with_plaid_id_is_recognized(self):
        planned = self._expected_planned()
        imported = Transaction.objects.create(
            account=self.acc,
            date=date.today(),
            payee="Rent ACH",
            amount=Decimal("-1200.00"),
            source=Transaction.Source.ACTUAL,
            status=Transaction.Status.CLEARED,
            plaid_transaction_id="plaid-materialized-actual",
            import_match_status=Transaction.ImportMatchStatus.NONE,
        )
        result = resolve_expected_as_imported(planned, user=self.user)
        self.assertEqual(result["imported_transaction_id"], imported.pk)
        self.assertFalse(Transaction.objects.filter(pk=planned.pk).exists())
        imported.refresh_from_db()
        self.assertEqual(imported.source, Transaction.Source.ACTUAL)
        self.assertEqual(imported.plaid_transaction_id, "plaid-materialized-actual")
        self.assertNotEqual(imported.import_match_status, Transaction.ImportMatchStatus.DUPLICATE)

    def test_unique_bank_post_matches_even_when_payee_text_differs(self):
        """User-initiated resolve must not require auto-match payee similarity."""
        planned = self._expected_planned()
        imported = Transaction.objects.create(
            account=self.acc,
            date=planned.date + timedelta(days=4),
            payee="Zelle payment to LANDLORD JPMabc12xyz9",
            imported_description="Zelle payment to LANDLORD JPMabc12xyz9",
            amount=Decimal("-1200.00"),
            source=Transaction.Source.ACTUAL,
            status=Transaction.Status.CLEARED,
            plaid_transaction_id="plaid-zelle-unlike-payee",
            import_match_status=Transaction.ImportMatchStatus.NONE,
        )
        result = resolve_expected_as_imported(planned, user=self.user)
        self.assertEqual(result["imported_transaction_id"], imported.pk)
        self.assertFalse(Transaction.objects.filter(pk=planned.pk).exists())
        imported.refresh_from_db()
        self.assertEqual(imported.plaid_transaction_id, "plaid-zelle-unlike-payee")
        self.assertNotEqual(imported.import_match_status, Transaction.ImportMatchStatus.DUPLICATE)

    def test_imported_date_within_window_stays_canonical(self):
        planned = self._expected_planned()
        bank_date = planned.date + timedelta(days=2)
        imported = self._plaid_import(date=bank_date, plaid_transaction_id="plaid-date-window")
        resolve_expected_as_imported(planned, user=self.user)
        imported.refresh_from_db()
        self.assertEqual(imported.date, bank_date)
        self.assertFalse(Transaction.objects.filter(pk=planned.pk).exists())

    def test_occurrence_is_not_recreated_on_next_materialization(self):
        from timeline.services.ledger import _materialize_rule_occurrence

        planned = self._expected_planned()
        occ_date = planned.date
        imported = self._plaid_import(date=occ_date + timedelta(days=1), plaid_transaction_id="plaid-no-recreate")
        resolve_expected_as_imported(planned, user=self.user)
        again = _materialize_rule_occurrence(
            self.rule,
            occ_date,
            self.acc.id,
            Decimal("-1200.00"),
            self.rule.name,
            None,
        )
        self.assertFalse(
            Transaction.objects.filter(
                account=self.acc,
                rule=self.rule,
                date=occ_date,
                source=Transaction.Source.RULE,
                status=Transaction.Status.PLANNED,
            ).exists()
        )
        if again is not None:
            self.assertEqual(again.pk, imported.pk)

    def test_later_occurrences_still_generate(self):
        from timeline.services.ledger import _materialize_rule_occurrence

        planned = self._expected_planned()
        imported = self._plaid_import(plaid_transaction_id="plaid-later-occ")
        resolve_expected_as_imported(planned, user=self.user)
        later = _next_month_on_day(date.today().replace(day=1), 1)
        created = _materialize_rule_occurrence(
            self.rule,
            later,
            self.acc.id,
            Decimal("-1200.00"),
            self.rule.name,
            None,
        )
        self.assertIsNotNone(created)
        self.assertNotEqual(created.pk, imported.pk)
        self.assertEqual(created.source, Transaction.Source.RULE)
        self.assertEqual(created.status, Transaction.Status.PLANNED)
        self.assertEqual(created.date, later)

    def test_ambiguous_imports_return_409_and_delete_nothing(self):
        planned = self._expected_planned()
        first = self._plaid_import(plaid_transaction_id="plaid-amb-1", payee="Rent ACH")
        second = self._plaid_import(plaid_transaction_id="plaid-amb-2", payee="Rent ACH")
        with self.assertRaises(AmbiguousImportResolution):
            resolve_expected_as_imported(planned, user=self.user)
        self.assertTrue(Transaction.objects.filter(pk=planned.pk).exists())
        self.assertTrue(Transaction.objects.filter(pk=first.pk).exists())
        self.assertTrue(Transaction.objects.filter(pk=second.pk).exists())
        resp = self.client.post(f"/api/transactions/{planned.pk}/resolve-as-imported/")
        self.assertEqual(resp.status_code, 409)
        self.assertTrue(Transaction.objects.filter(pk=planned.pk).exists())

    def test_no_matching_import_returns_error_and_deletes_nothing(self):
        planned = self._expected_planned()
        with self.assertRaises(ImportResolutionError):
            resolve_expected_as_imported(planned, user=self.user)
        self.assertTrue(Transaction.objects.filter(pk=planned.pk).exists())
        resp = self.client.post(f"/api/transactions/{planned.pk}/resolve-as-imported/")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("No matching imported bank transaction", resp.json()["detail"])
        self.assertTrue(Transaction.objects.filter(pk=planned.pk).exists())

    def test_reconciled_planned_cannot_be_changed(self):
        planned = self._expected_planned()
        planned.reconciled = True
        planned.save(update_fields=["reconciled"])
        self._plaid_import(plaid_transaction_id="plaid-recon")
        resp = self.client.post(f"/api/transactions/{planned.pk}/resolve-as-imported/")
        self.assertEqual(resp.status_code, 400)
        self.assertTrue(Transaction.objects.filter(pk=planned.pk).exists())

    def test_api_response_ordinary_never_requires_match_pk(self):
        planned = self._expected_planned()
        imported = self._plaid_import(plaid_transaction_id="plaid-api-ord")
        resp = self.client.post(f"/api/transactions/{planned.pk}/resolve-as-imported/")
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertTrue(body["resolved"])
        self.assertEqual(body["imported_transaction_id"], imported.pk)
        self.assertEqual(body["removed_planned_transaction_id"], planned.pk)
        self.assertIsNone(body["preserved_counterpart_transaction_id"])
        self.assertNotIn("match_id", body)


class TestResolveExpectedAsImportedTransfers(ExpectedLifecycleFixture):
    def setUp(self):
        super().setUp()
        self.card = Account.objects.create(
            household=self.h,
            account_type=Account.AccountType.CREDIT,
            name="Card",
            currency="USD",
        )
        self.payment_rule = RecurringRule.objects.create(
            household=self.h,
            account=self.acc,
            transfer_to_account=self.card,
            name="Card Payment",
            direction=RecurringRule.Direction.EXPENSE,
            amount=Decimal("100.00"),
            frequency=RecurringRule.Frequency.MONTHLY_DAY,
            day_of_month=15,
            start_date=date(2026, 1, 1),
            active=True,
        )
        self.pay_date = date.today() - timedelta(days=1)

    def _payment_legs(self):
        tg = TransferGroup.objects.create(
            household=self.h,
            from_account=self.acc,
            to_account=self.card,
            amount=Decimal("100.00"),
            scheduled_date=self.pay_date,
            status=TransferGroup.Status.PLANNED,
        )
        checking_leg = Transaction.objects.create(
            account=self.acc,
            date=self.pay_date,
            payee=self.payment_rule.name,
            amount=Decimal("-100.00"),
            source=Transaction.Source.RULE,
            status=Transaction.Status.PLANNED,
            rule=self.payment_rule,
            transfer_group=tg,
            transaction_type=Transaction.TransactionType.TRANSFER,
        )
        card_leg = Transaction.objects.create(
            account=self.card,
            date=self.pay_date,
            payee=self.payment_rule.name,
            amount=Decimal("100.00"),
            source=Transaction.Source.RULE,
            status=Transaction.Status.PLANNED,
            rule=self.payment_rule,
            transfer_group=tg,
            transaction_type=Transaction.TransactionType.CREDIT_CARD_PAYMENT,
        )
        Transfer.objects.create(
            from_transaction=checking_leg,
            to_transaction=card_leg,
            amount=Decimal("100.00"),
            date=self.pay_date,
        )
        return checking_leg, card_leg, tg

    def test_checking_side_import_preserves_card_leg(self):
        checking_leg, card_leg, tg = self._payment_legs()
        imported = Transaction.objects.create(
            account=self.acc,
            date=self.pay_date,
            payee="AUTOPAY PAYMENT",
            amount=Decimal("-100.00"),
            source=Transaction.Source.PLAID,
            plaid_transaction_id="plaid-cc-checking",
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        )
        result = resolve_expected_as_imported(checking_leg, user=self.user)
        self.assertEqual(result["imported_transaction_id"], imported.pk)
        self.assertEqual(result["removed_planned_transaction_id"], checking_leg.pk)
        self.assertEqual(result["preserved_counterpart_transaction_id"], card_leg.pk)
        self.assertFalse(Transaction.objects.filter(pk=checking_leg.pk).exists())
        self.assertTrue(Transaction.objects.filter(pk=card_leg.pk).exists())
        imported.refresh_from_db()
        card_leg.refresh_from_db()
        self.assertEqual(imported.import_match_status, Transaction.ImportMatchStatus.MATCHED)
        self.assertNotEqual(imported.import_match_status, Transaction.ImportMatchStatus.DUPLICATE)
        self.assertEqual(imported.plaid_transaction_id, "plaid-cc-checking")
        self.assertEqual(imported.transfer_group_id, tg.pk)
        self.assertEqual(card_leg.transfer_group_id, tg.pk)
        xfer = Transfer.objects.get(to_transaction=card_leg)
        self.assertEqual(xfer.from_transaction_id, imported.pk)
        visible_checking = list(
            ledger_visible_transactions(Transaction.objects.filter(account=self.acc, amount=Decimal("-100.00")))
        )
        visible_card = list(
            ledger_visible_transactions(Transaction.objects.filter(account=self.card, amount=Decimal("100.00")))
        )
        self.assertEqual({t.pk for t in visible_checking}, {imported.pk})
        self.assertEqual({t.pk for t in visible_card}, {card_leg.pk})

    def test_card_side_import_preserves_checking_leg(self):
        checking_leg, card_leg, tg = self._payment_legs()
        imported = Transaction.objects.create(
            account=self.card,
            date=self.pay_date,
            payee="AUTOPAY PAYMENT",
            amount=Decimal("100.00"),
            source=Transaction.Source.PLAID,
            plaid_transaction_id="plaid-cc-card",
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        )
        result = resolve_expected_as_imported(card_leg, user=self.user)
        self.assertEqual(result["imported_transaction_id"], imported.pk)
        self.assertEqual(result["removed_planned_transaction_id"], card_leg.pk)
        self.assertEqual(result["preserved_counterpart_transaction_id"], checking_leg.pk)
        self.assertFalse(Transaction.objects.filter(pk=card_leg.pk).exists())
        self.assertTrue(Transaction.objects.filter(pk=checking_leg.pk).exists())
        imported.refresh_from_db()
        checking_leg.refresh_from_db()
        self.assertEqual(imported.plaid_transaction_id, "plaid-cc-card")
        self.assertNotEqual(imported.import_match_status, Transaction.ImportMatchStatus.DUPLICATE)
        self.assertEqual(imported.transfer_group_id, tg.pk)
        self.assertEqual(checking_leg.transfer_group_id, tg.pk)
        xfer = Transfer.objects.get(from_transaction=checking_leg)
        self.assertEqual(xfer.to_transaction_id, imported.pk)
        visible_checking = list(
            ledger_visible_transactions(Transaction.objects.filter(account=self.acc, amount=Decimal("-100.00")))
        )
        visible_card = list(
            ledger_visible_transactions(Transaction.objects.filter(account=self.card, amount=Decimal("100.00")))
        )
        self.assertEqual({t.pk for t in visible_checking}, {checking_leg.pk})
        self.assertEqual({t.pk for t in visible_card}, {imported.pk})

    def test_transfer_api_response_never_requires_match_pk(self):
        checking_leg, card_leg, _tg = self._payment_legs()
        imported = Transaction.objects.create(
            account=self.acc,
            date=self.pay_date,
            payee="AUTOPAY PAYMENT",
            amount=Decimal("-100.00"),
            source=Transaction.Source.PLAID,
            plaid_transaction_id="plaid-cc-api",
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        )
        resp = self.client.post(f"/api/transactions/{checking_leg.pk}/resolve-as-imported/")
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertTrue(body["resolved"])
        self.assertEqual(body["imported_transaction_id"], imported.pk)
        self.assertEqual(body["removed_planned_transaction_id"], checking_leg.pk)
        self.assertEqual(body["preserved_counterpart_transaction_id"], card_leg.pk)
        self.assertNotIn("match_id", body)

    def test_legacy_match_endpoint_transfer_does_not_dereference_none(self):
        checking_leg, _card_leg, _tg = self._payment_legs()
        imported = Transaction.objects.create(
            account=self.acc,
            date=self.pay_date,
            payee="AUTOPAY PAYMENT",
            amount=Decimal("-100.00"),
            source=Transaction.Source.PLAID,
            plaid_transaction_id="plaid-legacy-match",
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        )
        resp = self.client.post(
            f"/api/transactions/{checking_leg.pk}/match/",
            {"imported_transaction_id": imported.pk},
            format="json",
        )
        self.assertEqual(resp.status_code, 201)
        body = resp.json()
        self.assertTrue(body["resolved"])
        self.assertIsNone(body.get("match_id"))
        self.assertTrue(Transaction.objects.filter(pk=checking_leg.pk).exists())
