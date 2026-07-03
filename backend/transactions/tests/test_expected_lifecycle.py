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
from transactions.models import Transaction, TransactionMatch
from transactions.services import (
    confirm_expected_transaction,
    find_import_candidates_for_planned,
    is_expected_eligible,
    is_planned_scheduled_eligible,
    manual_match_transactions,
    match_expected_to_import,
    move_scheduled_date,
    skip_scheduled_transaction,
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
