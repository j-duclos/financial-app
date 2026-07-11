"""Transfer rule legs must use correct signs on source vs destination accounts."""
from datetime import date
from decimal import Decimal

import pytest

from accounts.models import Account
from categories.models import Category
from timeline.models import RecurringRule
from timeline.services.ledger import build_timeline, repair_rule_transfer_leg_amounts
from timeline.services.materialization import ensure_planned_occurrence_transaction
from timeline.services.rule_schedule import rule_occurrence_amount_for_account, resolve_rule_params
from transactions.models import Transaction, TransferGroup


@pytest.fixture
def checking_and_card(db, household):
    checking = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Chase",
        currency="USD",
        starting_balance=Decimal("2000.00"),
    )
    card = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        name="Savor",
        currency="USD",
        starting_balance=Decimal("0"),
    )
    cat = Category.objects.get_or_create(
        household=household,
        name="Credit Card Payment",
        category_type=Category.CategoryType.EXPENSE,
        defaults={"sort_order": 100},
    )[0]
    return checking, card, cat


@pytest.mark.django_db
class TestRuleTransferLegAmounts:
    def test_rule_occurrence_amount_for_transfer_legs(self, checking_and_card):
        checking, card, cat = checking_and_card
        rule = RecurringRule.objects.create(
            household=checking.household,
            name="Cox - Move to Savor",
            account=checking,
            transfer_to_account=card,
            category=cat,
            direction=RecurringRule.Direction.EXPENSE,
            amount=Decimal("70.00"),
            currency="USD",
            frequency=RecurringRule.Frequency.MONTHLY_DAY,
            interval=1,
            day_of_month=11,
            start_date=date(2026, 7, 11),
            active=True,
        )
        params = resolve_rule_params(rule, date(2026, 7, 11))
        assert rule_occurrence_amount_for_account(rule, params, checking.id) == Decimal("-70.00")
        assert rule_occurrence_amount_for_account(rule, params, card.id) == Decimal("70.00")

    def test_single_occurrence_materialize_uses_negative_source_leg(self, user, checking_and_card):
        checking, card, cat = checking_and_card
        rule = RecurringRule.objects.create(
            household=checking.household,
            name="Cox - Move to Savor",
            account=checking,
            transfer_to_account=card,
            category=cat,
            direction=RecurringRule.Direction.EXPENSE,
            amount=Decimal("70.00"),
            currency="USD",
            frequency=RecurringRule.Frequency.MONTHLY_DAY,
            interval=1,
            day_of_month=11,
            start_date=date(2026, 7, 11),
            active=True,
        )
        txn = ensure_planned_occurrence_transaction(
            user,
            rule_id=rule.id,
            account_id=checking.id,
            occurrence_date=date(2026, 7, 11),
        )
        assert txn is not None
        assert txn.amount == Decimal("-70.00")

    def test_repair_fixes_wrong_sign_on_linked_transfer_pair(self, checking_and_card):
        checking, card, cat = checking_and_card
        rule = RecurringRule.objects.create(
            household=checking.household,
            name="Cox - Move to Savor",
            account=checking,
            transfer_to_account=card,
            category=cat,
            direction=RecurringRule.Direction.EXPENSE,
            amount=Decimal("70.00"),
            currency="USD",
            frequency=RecurringRule.Frequency.MONTHLY_DAY,
            interval=1,
            day_of_month=11,
            start_date=date(2026, 7, 11),
            active=True,
        )
        tg = TransferGroup.objects.create(
            household=checking.household,
            from_account=checking,
            to_account=card,
            amount=Decimal("70.00"),
            scheduled_date=date(2026, 7, 11),
            status=TransferGroup.Status.PLANNED,
        )
        wrong_from = Transaction.objects.create(
            account=checking,
            date=date(2026, 7, 11),
            payee=rule.name,
            amount=Decimal("70.00"),
            source=Transaction.Source.RULE,
            rule=rule,
            transfer_group=tg,
            category=cat,
            status=Transaction.Status.PLANNED,
        )
        to_leg = Transaction.objects.create(
            account=card,
            date=date(2026, 7, 11),
            payee=rule.name,
            amount=Decimal("70.00"),
            source=Transaction.Source.RULE,
            rule=rule,
            transfer_group=tg,
            status=Transaction.Status.PLANNED,
        )
        assert repair_rule_transfer_leg_amounts([checking.id, card.id]) == 1
        wrong_from.refresh_from_db()
        to_leg.refresh_from_db()
        assert wrong_from.amount == Decimal("-70.00")
        assert to_leg.amount == Decimal("70.00")

    def test_timeline_shows_outflow_on_checking_for_wrong_sign_until_repaired(self, user, checking_and_card):
        checking, card, cat = checking_and_card
        rule = RecurringRule.objects.create(
            household=checking.household,
            name="Cox - Move to Savor",
            account=checking,
            transfer_to_account=card,
            category=cat,
            direction=RecurringRule.Direction.EXPENSE,
            amount=Decimal("70.00"),
            currency="USD",
            frequency=RecurringRule.Frequency.MONTHLY_DAY,
            interval=1,
            day_of_month=11,
            start_date=date(2026, 7, 11),
            active=True,
        )
        tg = TransferGroup.objects.create(
            household=checking.household,
            from_account=checking,
            to_account=card,
            amount=Decimal("70.00"),
            scheduled_date=date(2026, 7, 11),
            status=TransferGroup.Status.PLANNED,
        )
        Transaction.objects.create(
            account=checking,
            date=date(2026, 7, 11),
            payee=rule.name,
            amount=Decimal("70.00"),
            source=Transaction.Source.RULE,
            rule=rule,
            transfer_group=tg,
            category=cat,
            status=Transaction.Status.PLANNED,
        )
        rows = build_timeline(
            user,
            date(2026, 7, 1),
            date(2026, 7, 31),
            account_id=checking.id,
            as_of_date=date(2026, 7, 11),
        )
        cox = next(r for r in rows if r.get("rule_id") == rule.id and r.get("account_id") == checking.id)
        assert cox["type"] == "OUTFLOW"
