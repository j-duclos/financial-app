"""Canonical ledger matching / suppression — one financial effect per real-world event."""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model

from accounts.models import Account
from core.models import Household, HouseholdMembership
from timeline.models import RecurringRule
from timeline.services.canonical_ledger import (
    SuppressionReason,
    build_canonical_ledger_with_balances,
    resolve_canonical_financial_state,
    resolve_canonical_ledger_entries,
    row_participates_financially,
)
from timeline.services.ledger import build_forecast_projection_timeline
from timeline.services.ledger_section_balances import (
    assign_canonical_ledger_balance_after,
    signed_timeline_ledger_amount,
    transactions_ledger_walk_rows,
)
from transactions.models import Transaction, TransactionMatch
from transactions.services.matching import (
    match_imported_transaction,
    manual_match_transactions,
    unmatch_transaction,
)
from transactions.services.reconciliation import filter_superseded_planned_transactions

User = get_user_model()

MATCH_AMOUNT = Decimal("-182.32")
INCOME_AMOUNT = Decimal("1835.52")
SHADOW_AMOUNT = Decimal("-503.43")
POSTED_ANCHOR = Decimal("2360.64")
AS_OF = date(2026, 8, 28)


@pytest.fixture
def user(db):
    return User.objects.create_user(username="canon_match_user", password="testpass123")


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="Canon Match HH")
    HouseholdMembership.objects.create(
        household=h, user=user, role=HouseholdMembership.Role.OWNER
    )
    return h


@pytest.fixture
def checking(household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        name="Checking",
        starting_balance=POSTED_ANCHOR,
        currency="USD",
        include_in_forecast=True,
    )


def _row(**kwargs):
    base = {
        "account_id": 1,
        "type": "OUTFLOW",
        "status": "PLANNED",
        "source": "rule",
        "txn_source": "rule",
        "running_balance": "0",
    }
    base.update(kwargs)
    return base


class TestResolveCanonicalFinancialState:
    pytestmark = pytest.mark.django_db

    def test_matched_expense_one_effect(self):
        """Planned electric -182.32 + imported -182.32 → exactly one -182.32 active."""
        planned_tid = 10
        import_tid = 11
        rows = [
            _row(
                date=date(2026, 8, 27),
                description="Electric",
                amount=str(MATCH_AMOUNT),
                transaction_id=planned_tid,
                rule_id=5,
                import_match_status="matched",
            ),
            _row(
                date=date(2026, 8, 27),
                description="ELECTRIC CO",
                amount=str(MATCH_AMOUNT),
                transaction_id=import_tid,
                rule_id=None,
                status="CLEARED",
                source="actual",
                txn_source="plaid",
                import_match_status="matched",
                plaid_transaction_id="plaid-elec",
            ),
        ]
        resolve_canonical_financial_state(rows)
        active = resolve_canonical_ledger_entries(rows, resolve=False)
        assert len(active) == 1
        assert active[0]["transaction_id"] == import_tid
        assert rows[0]["financially_active"] is False
        assert rows[0]["suppression_reason"] == SuppressionReason.IMPORT_MATCH_FULFILLED
        assert Decimal(str(active[0]["amount"])) == MATCH_AMOUNT

    def test_matched_income_one_effect(self):
        planned_tid = 20
        import_tid = 21
        rows = [
            _row(
                date=date(2026, 8, 27),
                description="Paycheck",
                amount=str(INCOME_AMOUNT),
                type="INFLOW",
                transaction_id=planned_tid,
                rule_id=46,
                import_match_status="matched",
            ),
            _row(
                date=date(2026, 8, 27),
                description="PAYROLL ACH",
                amount=str(INCOME_AMOUNT),
                type="INFLOW",
                transaction_id=import_tid,
                status="CLEARED",
                source="actual",
                txn_source="plaid",
                import_match_status="matched",
                plaid_transaction_id="plaid-pay",
            ),
        ]
        resolve_canonical_financial_state(rows)
        active = resolve_canonical_ledger_entries(rows, resolve=False)
        assert len(active) == 1
        assert active[0]["transaction_id"] == import_tid
        assert Decimal(str(active[0]["amount"])) == INCOME_AMOUNT

    def test_shadow_sibling_suppressed(self):
        matched_tid = 101
        shadow_tid = 102
        rows = [
            _row(
                date=date(2026, 8, 30),
                description="Shadow bill",
                amount=str(SHADOW_AMOUNT),
                transaction_id=matched_tid,
                rule_id=42,
                status="CLEARED",
                source="actual",
                txn_source="plaid",
                import_match_status="matched",
                plaid_transaction_id="plaid-shadow",
            ),
            _row(
                date=date(2026, 8, 27),
                description="Shadow bill",
                amount=str(SHADOW_AMOUNT),
                transaction_id=shadow_tid,
                rule_id=42,
            ),
        ]
        resolve_canonical_financial_state(rows)
        shadow = rows[1]
        assert shadow["financially_active"] is False
        assert shadow["suppression_reason"] == SuppressionReason.SHADOW_RULE_SIBLING
        assert shadow["canonical_transaction_id"] == matched_tid
        active = resolve_canonical_ledger_entries(rows, resolve=False)
        assert len(active) == 1
        assert active[0]["transaction_id"] == matched_tid

    def test_superseded_by_posting(self):
        planned_tid = 30
        cleared_tid = 31
        rows = [
            _row(
                date=AS_OF,
                description="Geico",
                amount="-403.43",
                transaction_id=planned_tid,
                rule_id=40,
            ),
            _row(
                date=AS_OF,
                description="GEICO",
                amount="-403.40",
                transaction_id=cleared_tid,
                status="CLEARED",
                source="actual",
                txn_source="plaid",
            ),
        ]
        resolve_canonical_financial_state(rows)
        assert rows[0]["financially_active"] is False
        assert rows[0]["suppression_reason"] == SuppressionReason.SUPSERSED_BY_POSTING
        assert rows[0]["fulfilled_by_transaction_id"] == cleared_tid


@pytest.mark.django_db
class TestMatchOperations:
    def test_manual_match_produces_one_canonical_effect(self, user, checking):
        rule = RecurringRule.objects.create(
            household=checking.household,
            account=checking,
            name="Electric",
            direction=RecurringRule.Direction.EXPENSE,
            amount=abs(MATCH_AMOUNT),
            frequency=RecurringRule.Frequency.MONTHLY_DAY,
            day_of_month=1,
            start_date=date(2026, 1, 1),
            active=True,
        )
        planned = Transaction.objects.create(
            account=checking,
            date=AS_OF,
            payee="Electric",
            amount=MATCH_AMOUNT,
            source=Transaction.Source.RULE,
            status=Transaction.Status.PLANNED,
            rule=rule,
        )
        imported = Transaction.objects.create(
            account=checking,
            date=AS_OF,
            payee="ELECTRIC CO",
            amount=MATCH_AMOUNT,
            source=Transaction.Source.PLAID,
            plaid_transaction_id="plaid-manual-182",
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        )
        manual_match_transactions(planned_id=planned.pk, imported_id=imported.pk, user=user)
        planned.refresh_from_db()
        imported.refresh_from_db()
        assert planned.import_match_status == Transaction.ImportMatchStatus.MATCHED
        assert imported.import_match_status == Transaction.ImportMatchStatus.MATCHED

        end = AS_OF + timedelta(days=30)
        rows = build_forecast_projection_timeline(
            user,
            today=AS_OF,
            end_date=end,
            caller="test_manual_match",
            account_id=checking.pk,
        )
        active_amounts = [
            Decimal(str(r["amount"]))
            for r in rows
            if r.get("account_id") == checking.pk
            and row_participates_financially(r, rows)
            and str(r.get("date"))[:10] == AS_OF.isoformat()
        ]
        assert active_amounts.count(MATCH_AMOUNT) == 1

    def test_auto_match_same_canonical_as_manual(self, user, checking):
        rule = RecurringRule.objects.create(
            household=checking.household,
            account=checking,
            name="Electric Auto",
            direction=RecurringRule.Direction.EXPENSE,
            amount=abs(MATCH_AMOUNT),
            frequency=RecurringRule.Frequency.MONTHLY_DAY,
            day_of_month=1,
            start_date=date(2026, 1, 1),
            active=True,
        )
        planned = Transaction.objects.create(
            account=checking,
            date=AS_OF,
            payee="Electric Auto",
            amount=MATCH_AMOUNT,
            source=Transaction.Source.RULE,
            status=Transaction.Status.PLANNED,
            rule=rule,
        )
        imported = Transaction.objects.create(
            account=checking,
            date=AS_OF,
            payee="Electric Auto",
            amount=MATCH_AMOUNT,
            source=Transaction.Source.PLAID,
            plaid_transaction_id="plaid-auto-182",
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        )
        match = match_imported_transaction(imported)
        assert match is not None
        end = AS_OF + timedelta(days=30)
        rows = build_forecast_projection_timeline(
            user,
            today=AS_OF,
            end_date=end,
            caller="test_auto_match",
            account_id=checking.pk,
        )
        active = [
            r
            for r in rows
            if r.get("account_id") == checking.pk and row_participates_financially(r, rows)
        ]
        electric_rows = [r for r in active if "Electric" in (r.get("description") or "")]
        assert len(electric_rows) == 1
        assert electric_rows[0].get("txn_source") == "plaid"

    def test_pending_before_match_then_one_effect_after(self, user, checking):
        rule = RecurringRule.objects.create(
            household=checking.household,
            account=checking,
            name="Water",
            direction=RecurringRule.Direction.EXPENSE,
            amount=Decimal("50.00"),
            frequency=RecurringRule.Frequency.MONTHLY_DAY,
            day_of_month=1,
            start_date=date(2026, 1, 1),
            active=True,
        )
        planned = Transaction.objects.create(
            account=checking,
            date=AS_OF,
            payee="Water",
            amount=Decimal("-50.00"),
            source=Transaction.Source.RULE,
            status=Transaction.Status.PLANNED,
            rule=rule,
        )
        end = AS_OF + timedelta(days=30)
        before = build_forecast_projection_timeline(
            user,
            today=AS_OF,
            end_date=end,
            caller="test_before_match",
            account_id=checking.pk,
        )
        walk_before = transactions_ledger_walk_rows(before, account_id=checking.pk, today=AS_OF)
        assert any(r.get("transaction_id") == planned.pk for r in walk_before)

        imported = Transaction.objects.create(
            account=checking,
            date=AS_OF,
            payee="Water",
            amount=Decimal("-50.00"),
            source=Transaction.Source.PLAID,
            plaid_transaction_id="plaid-water",
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        )
        manual_match_transactions(planned_id=planned.pk, imported_id=imported.pk, user=user)

        after = build_forecast_projection_timeline(
            user,
            today=AS_OF,
            end_date=end,
            caller="test_after_match",
            account_id=checking.pk,
        )
        active_after = [
            r
            for r in after
            if r.get("account_id") == checking.pk and row_participates_financially(r, after)
        ]
        water = [r for r in active_after if "Water" in (r.get("description") or "")]
        assert len(water) == 1
        assert water[0].get("txn_source") == "plaid"

    def test_unmatch_restores_both_rows(self, user, checking):
        rule = RecurringRule.objects.create(
            household=checking.household,
            account=checking,
            name="Misc",
            direction=RecurringRule.Direction.EXPENSE,
            amount=Decimal("25.00"),
            frequency=RecurringRule.Frequency.MONTHLY_DAY,
            day_of_month=1,
            start_date=date(2026, 1, 1),
            active=True,
        )
        planned = Transaction.objects.create(
            account=checking,
            date=AS_OF,
            payee="Misc",
            amount=Decimal("-25.00"),
            source=Transaction.Source.RULE,
            status=Transaction.Status.PLANNED,
            rule=rule,
        )
        imported = Transaction.objects.create(
            account=checking,
            date=AS_OF,
            payee="Misc",
            amount=Decimal("-25.00"),
            source=Transaction.Source.PLAID,
            plaid_transaction_id="plaid-misc",
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        )
        match = manual_match_transactions(
            planned_id=planned.pk, imported_id=imported.pk, user=user
        )
        assert match is not None
        unmatch_transaction(match)
        planned.refresh_from_db()
        imported.refresh_from_db()
        assert planned.import_match_status == Transaction.ImportMatchStatus.NONE
        assert imported.import_match_status == Transaction.ImportMatchStatus.UNMATCHED

        end = AS_OF + timedelta(days=30)
        rows = build_forecast_projection_timeline(
            user,
            today=AS_OF,
            end_date=end,
            caller="test_unmatch",
            account_id=checking.pk,
        )
        active = [
            r
            for r in rows
            if r.get("account_id") == checking.pk and row_participates_financially(r, rows)
        ]
        misc_ids = {
            r.get("transaction_id")
            for r in active
            if "Misc" in (r.get("description") or "")
        }
        assert planned.pk in misc_ids
        assert imported.pk in misc_ids


@pytest.mark.django_db
class TestBalanceWalkInput:
    def test_assign_input_equals_financially_active_set(self, user, checking):
        """assign_canonical_ledger_balance_after walk == resolve_canonical_ledger_entries."""
        Transaction.objects.create(
            account=checking,
            date=AS_OF,
            payee="Gen's Rent",
            amount=Decimal("1500.00"),
            source=Transaction.Source.ONE_TIME,
            status=Transaction.Status.PLANNED,
        )
        end = AS_OF + timedelta(days=30)
        rows = build_forecast_projection_timeline(
            user,
            today=AS_OF,
            end_date=end,
            caller="test_walk_input",
            account_id=checking.pk,
        )
        canonical = resolve_canonical_ledger_entries(rows, account_id=checking.pk, resolve=False)
        walk = transactions_ledger_walk_rows(rows, account_id=checking.pk, today=AS_OF)
        assert {r.get("transaction_id") for r in walk} == {
            r.get("transaction_id") for r in canonical
            if is_pending_or_forecast(r, AS_OF)
        }


def is_pending_or_forecast(row, today):
    from timeline.services.ledger_section_balances import (
        is_forecast_timeline_row,
        is_pending_expected_timeline_row,
    )

    return is_pending_expected_timeline_row(row, today) or is_forecast_timeline_row(row, today)


@pytest.mark.django_db
class TestReconciliationUsesCanonicalSuppression:
    def test_superseded_planned_excluded_from_reconcile_walk(self, checking):
        planned = Transaction.objects.create(
            account=checking,
            date=AS_OF,
            payee="Geico",
            amount=Decimal("-403.43"),
            source=Transaction.Source.RULE,
            status=Transaction.Status.PLANNED,
            rule=RecurringRule.objects.create(
                household=checking.household,
                account=checking,
                name="Geico",
                direction=RecurringRule.Direction.EXPENSE,
                amount=Decimal("403.43"),
                frequency=RecurringRule.Frequency.MONTHLY_DAY,
                day_of_month=1,
                start_date=date(2026, 1, 1),
                active=True,
            ),
        )
        cleared = Transaction.objects.create(
            account=checking,
            date=AS_OF,
            payee="GEICO",
            amount=Decimal("-403.40"),
            source=Transaction.Source.PLAID,
            status=Transaction.Status.CLEARED,
            plaid_transaction_id="plaid-geico",
        )
        filtered = filter_superseded_planned_transactions([planned, cleared])
        assert planned not in filtered
        assert cleared in filtered


@pytest.mark.django_db
class TestRecurrenceAfterMatch:
    def test_future_occurrence_still_generates(self, user, checking):
        rule = RecurringRule.objects.create(
            household=checking.household,
            account=checking,
            name="Rent",
            direction=RecurringRule.Direction.EXPENSE,
            amount=Decimal("1200.00"),
            frequency=RecurringRule.Frequency.MONTHLY_DAY,
            day_of_month=1,
            start_date=date(2026, 8, 1),
            active=True,
        )
        august = Transaction.objects.create(
            account=checking,
            date=date(2026, 8, 1),
            payee="Rent",
            amount=Decimal("-1200.00"),
            source=Transaction.Source.RULE,
            status=Transaction.Status.PLANNED,
            rule=rule,
        )
        imported = Transaction.objects.create(
            account=checking,
            date=date(2026, 8, 1),
            payee="Rent",
            amount=Decimal("-1200.00"),
            source=Transaction.Source.PLAID,
            plaid_transaction_id="plaid-rent-aug",
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        )
        manual_match_transactions(planned_id=august.pk, imported_id=imported.pk, user=user)

        september = date(2026, 9, 1)
        end = september + timedelta(days=30)
        rows = build_forecast_projection_timeline(
            user,
            today=AS_OF,
            end_date=end,
            caller="test_recurrence",
            account_id=checking.pk,
        )
        sep_rent = [
            r
            for r in rows
            if r.get("account_id") == checking.pk
            and str(r.get("date"))[:10] == september.isoformat()
            and "Rent" in (r.get("description") or "")
            and row_participates_financially(r, rows)
        ]
        assert len(sep_rent) >= 1
