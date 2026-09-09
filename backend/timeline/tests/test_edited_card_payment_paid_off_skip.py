"""Paid-off credit-card payment skip must hide edited 'this transaction only' amounts.

Rule default $25, occurrence edited to $100, destination card owed $0 on that date:
the pair must not appear on the canonical / Transactions Upcoming forecast.
"""
from datetime import date
from decimal import Decimal

import pytest
from rest_framework.test import APIClient

from accounts.models import Account
from categories.models import Category
from timeline.models import RecurringRule
from timeline.services.canonical_timeline_cache import get_or_build_canonical_forecast_timeline
from timeline.services.ledger import (
    _link_rule_transfer_pair_transactions,
    _materialize_rule_occurrence,
    _occurrence_locked_from_paid_off_skip,
    build_forecast_projection_timeline,
    build_timeline,
    generate_rule_occurrences,
)
from transactions.models import Transaction, TransactionMatch, TransferGroup
from transactions.services.transfer_balance_preview import preview_transfer_balances

AS_OF = date(2026, 9, 9)
PAY_DATE = date(2026, 10, 25)
LATER_DATE = date(2026, 11, 25)


def _cc_payment_category(household):
    return Category.objects.get_or_create(
        household=household,
        name="Credit Card Payment",
        category_type=Category.CategoryType.EXPENSE,
        defaults={"sort_order": 100},
    )[0]


def _checking_and_card(household, *, card_starting: Decimal):
    bank = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Chase",
        currency="USD",
        starting_balance=Decimal("5000.00"),
    )
    card = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        name="Savor",
        currency="USD",
        starting_balance=card_starting,
    )
    return bank, card


def _monthly_card_payment_rule(household, bank, card, cat, *, amount=Decimal("25.00")):
    return RecurringRule.objects.create(
        household=household,
        name="Savor C/C Payment",
        account=bank,
        transfer_to_account=card,
        category=cat,
        direction=RecurringRule.Direction.EXPENSE,
        amount=amount,
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=25,
        start_date=AS_OF,
        active=True,
    )


def _materialize_window(user, *, end=None):
    return build_timeline(
        user,
        AS_OF,
        end or date(2026, 12, 31),
        as_of_date=AS_OF,
    )


def _canonical_and_upcoming(user, household):
    canonical, _ = get_or_build_canonical_forecast_timeline(
        user,
        today=AS_OF,
        forecast_days=(date(2026, 12, 31) - AS_OF).days,
        household_id=household.id,
        caller="test_edited_card_payment_paid_off_skip",
    )
    forecast = build_forecast_projection_timeline(
        user,
        today=AS_OF,
        end_date=date(2026, 12, 31),
        household_id=household.id,
        caller="test_edited_card_payment_paid_off_skip_forecast",
    )
    return canonical, forecast


def _occurrence_rows(rows, *, rule_id, on_date, bank_id, card_id):
    day = [
        r
        for r in rows
        if r.get("date") == on_date
        and r.get("account_id") in (bank_id, card_id)
        and (
            r.get("rule_id") == rule_id
            or (r.get("amount") is not None and abs(Decimal(str(r["amount"]))) == Decimal("100.00"))
        )
    ]
    bank = [r for r in day if r.get("account_id") == bank_id]
    card = [r for r in day if r.get("account_id") == card_id]
    return bank, card


def _assert_pair_absent(rows, *, rule_id, on_date, bank_id, card_id, label):
    bank, card = _occurrence_rows(rows, rule_id=rule_id, on_date=on_date, bank_id=bank_id, card_id=card_id)
    hundred = [
        r
        for r in rows
        if r.get("date") == on_date
        and r.get("account_id") in (bank_id, card_id)
        and r.get("amount") is not None
        and abs(Decimal(str(r["amount"]))) == Decimal("100.00")
    ]
    assert bank == [], f"{label}: checking outflow still present {bank}"
    assert card == [], f"{label}: card inflow still present {card}"
    assert hundred == [], f"{label}: $100 pair still present {hundred}"


def _assert_balances_unchanged_by_occurrence(rows, *, on_date, bank_id, card_id):
    """Running/canonical balances on the payment date must not move by the suppressed $100."""
    for aid in (bank_id, card_id):
        day_rows = [r for r in rows if r.get("date") == on_date and r.get("account_id") == aid]
        for r in day_rows:
            if r.get("amount") is not None:
                assert abs(Decimal(str(r["amount"]))) != Decimal("100.00")


def _patch_this_occurrence_only(user, txn, *, amount: str, transfer_to_account_id: int, category_id: int):
    client = APIClient()
    client.force_authenticate(user=user)
    res = client.patch(
        f"/api/transactions/{txn.pk}/",
        {
            "payee": txn.payee,
            "category_id": category_id,
            "date": txn.date.isoformat(),
            "amount": amount,
            "transfer_to_account_id": transfer_to_account_id,
        },
        format="json",
    )
    assert res.status_code == 200, res.data
    return res


def _bank_leg_on(rule, on_date):
    return (
        Transaction.objects.filter(rule=rule, date=on_date, account=rule.account)
        .order_by("pk")
        .first()
    )


def _force_materialize_occurrence(rule, *, on_date, amount=Decimal("25.00")):
    """Create the RULE pair the way the ledger does, even if skip would hide it later.

    Matches a future occurrence that already exists because it was materialized (or
    opened in Edit Transaction) before the card's projected owed hit $0.
    """
    out_amount = -abs(amount)
    in_amount = abs(amount)
    txn_from = _materialize_rule_occurrence(
        rule, on_date, rule.account_id, out_amount, rule.name, rule.category_id
    )
    txn_to = _materialize_rule_occurrence(
        rule, on_date, rule.transfer_to_account_id, in_amount, rule.name, None
    )
    assert txn_from is not None and txn_to is not None
    _link_rule_transfer_pair_transactions(
        rule=rule,
        d=on_date,
        txn_from=txn_from,
        txn_to=txn_to,
        from_acc_id=rule.account_id,
        to_acc_id=rule.transfer_to_account_id,
        in_amount=in_amount,
    )
    return txn_from


@pytest.mark.django_db
class TestEditedCardPaymentPaidOffSkip:
    def test_a_unedited_rule_hidden_when_card_owes_zero(self, user, household):
        bank, card = _checking_and_card(household, card_starting=Decimal("0"))
        cat = _cc_payment_category(household)
        rule = _monthly_card_payment_rule(household, bank, card, cat)
        _materialize_window(user)
        canonical, forecast = _canonical_and_upcoming(user, household)
        _assert_pair_absent(
            canonical, rule_id=rule.id, on_date=PAY_DATE, bank_id=bank.id, card_id=card.id, label="canonical A"
        )
        _assert_pair_absent(
            forecast, rule_id=rule.id, on_date=PAY_DATE, bank_id=bank.id, card_id=card.id, label="forecast A"
        )
        rule.refresh_from_db()
        assert rule.active is True

    def test_b_edited_this_transaction_only_hidden_when_card_owes_zero(self, user, household):
        """Materialize $25, PATCH this occurrence to $100, card owed $0 → both legs absent."""
        bank, card = _checking_and_card(household, card_starting=Decimal("0"))
        cat = _cc_payment_category(household)
        rule = _monthly_card_payment_rule(household, bank, card, cat)
        bank_leg = _force_materialize_occurrence(rule, on_date=PAY_DATE)
        assert bank_leg.amount == Decimal("-25.00")

        _patch_this_occurrence_only(
            user,
            bank_leg,
            amount="-100.00",
            transfer_to_account_id=card.id,
            category_id=cat.id,
        )
        bank_leg.refresh_from_db()

        legs = list(Transaction.objects.filter(date=PAY_DATE, account_id__in=[bank.id, card.id]).order_by("pk"))
        dump = [
            {
                "pk": t.pk,
                "account": t.account_id,
                "amount": str(t.amount),
                "source": t.source,
                "status": t.status,
                "rule_id": t.rule_id,
                "tg": t.transfer_group_id,
                "reconciled": t.reconciled,
            }
            for t in legs
        ]
        assert bank_leg.amount == Decimal("-100.00"), dump
        assert bank_leg.rule_id == rule.id, dump
        assert _occurrence_locked_from_paid_off_skip(rule.id, PAY_DATE) is False, (
            f"amount edit must not lock occurrence; legs={dump}"
        )
        pair_tg_id = bank_leg.transfer_group_id

        preview = preview_transfer_balances(
            user,
            from_account_id=bank.id,
            to_account_id=card.id,
            amount=Decimal("100.00"),
            transfer_date=PAY_DATE,
            exclude_transaction_ids=[
                t.pk for t in Transaction.objects.filter(date=PAY_DATE, account_id__in=[bank.id, card.id])
            ],
        )
        assert Decimal(preview["destination_balance_owed_before"]) == Decimal("0.00"), preview

        canonical, forecast = _canonical_and_upcoming(user, household)
        _assert_pair_absent(
            canonical, rule_id=rule.id, on_date=PAY_DATE, bank_id=bank.id, card_id=card.id, label="canonical B"
        )
        _assert_pair_absent(
            forecast, rule_id=rule.id, on_date=PAY_DATE, bank_id=bank.id, card_id=card.id, label="forecast B"
        )
        _assert_balances_unchanged_by_occurrence(
            canonical, on_date=PAY_DATE, bank_id=bank.id, card_id=card.id
        )
        assert not Transaction.objects.filter(rule=rule, date=PAY_DATE).exists(), (
            "projection-only Upcoming must purge the skipped planned pair so it cannot re-merge"
        )
        if pair_tg_id is not None:
            assert not Transaction.objects.filter(transfer_group_id=pair_tg_id).exists()

        rule.refresh_from_db()
        assert rule.active is True
        later = list(generate_rule_occurrences(rule, LATER_DATE, LATER_DATE))
        assert later == [LATER_DATE], later

        # G: Transactions Upcoming (canonical) agrees with forecast projection
        can_bank, can_card = _occurrence_rows(
            canonical, rule_id=rule.id, on_date=PAY_DATE, bank_id=bank.id, card_id=card.id
        )
        fc_bank, fc_card = _occurrence_rows(
            forecast, rule_id=rule.id, on_date=PAY_DATE, bank_id=bank.id, card_id=card.id
        )
        assert can_bank == fc_bank
        assert can_card == fc_card

    def test_c_edited_occurrence_present_when_card_still_owes(self, user, household):
        bank, card = _checking_and_card(household, card_starting=Decimal("-80.00"))
        cat = _cc_payment_category(household)
        rule = _monthly_card_payment_rule(household, bank, card, cat)
        _materialize_window(user)
        bank_leg = _bank_leg_on(rule, PAY_DATE)
        assert bank_leg is not None
        _patch_this_occurrence_only(
            user,
            bank_leg,
            amount="-100.00",
            transfer_to_account_id=card.id,
            category_id=cat.id,
        )

        canonical, _ = _canonical_and_upcoming(user, household)
        bank_rows, card_rows = _occurrence_rows(
            canonical, rule_id=rule.id, on_date=PAY_DATE, bank_id=bank.id, card_id=card.id
        )
        assert bank_rows, "checking outflow must remain when card still owes $80"
        assert any(Decimal(str(r["amount"])) == Decimal("-100.00") for r in bank_rows), bank_rows
        assert card_rows, "card inflow must remain when card still owes $80"
        assert any(Decimal(str(r["amount"])) == Decimal("100.00") for r in card_rows), card_rows

    def test_d_plaid_matched_real_payment_remains(self, user, household):
        bank, card = _checking_and_card(household, card_starting=Decimal("0"))
        cat = _cc_payment_category(household)
        rule = _monthly_card_payment_rule(household, bank, card, cat)
        tg = TransferGroup.objects.create(
            household=household,
            from_account=bank,
            to_account=card,
            amount=Decimal("100.00"),
            scheduled_date=PAY_DATE,
            status=TransferGroup.Status.PLANNED,
        )
        planned = Transaction.objects.create(
            account=bank,
            date=PAY_DATE,
            payee=rule.name,
            amount=Decimal("-100.00"),
            category=cat,
            status=Transaction.Status.PLANNED,
            source=Transaction.Source.RULE,
            rule=rule,
            transfer_group=tg,
            import_match_status=Transaction.ImportMatchStatus.MATCHED,
        )
        imported = Transaction.objects.create(
            account=bank,
            date=PAY_DATE,
            payee="SAVOR PAYMENT",
            amount=Decimal("-100.00"),
            category=cat,
            status=Transaction.Status.CLEARED,
            source=Transaction.Source.PLAID,
            plaid_transaction_id="plaid-savor-pay-1",
            import_match_status=Transaction.ImportMatchStatus.MATCHED,
            cleared=True,
        )
        Transaction.objects.create(
            account=card,
            date=PAY_DATE,
            payee=rule.name,
            amount=Decimal("100.00"),
            category=cat,
            status=Transaction.Status.PLANNED,
            source=Transaction.Source.RULE,
            rule=rule,
            transfer_group=tg,
        )
        TransactionMatch.objects.create(
            planned_transaction=planned,
            imported_transaction=imported,
            match_type=TransactionMatch.MatchType.SAME_ACCOUNT,
            score=90,
            confidence=TransactionMatch.Confidence.AUTO,
        )

        canonical, _ = _canonical_and_upcoming(user, household)
        visible = [
            r
            for r in canonical
            if r.get("date") == PAY_DATE
            and r.get("account_id") == bank.id
            and r.get("amount") is not None
            and Decimal(str(r["amount"])) == Decimal("-100.00")
        ]
        assert visible, "Plaid-matched real payment must remain on the forecast/ledger"
        assert any(r.get("transaction_id") == imported.pk for r in visible) or any(
            r.get("transaction_id") == planned.pk for r in visible
        ), visible
        assert Transaction.objects.filter(pk=imported.pk).exists()
        rule.refresh_from_db()
        assert rule.active is True

    def test_e_skip_hides_both_transfer_legs(self, user, household):
        bank, card = _checking_and_card(household, card_starting=Decimal("0"))
        cat = _cc_payment_category(household)
        rule = _monthly_card_payment_rule(household, bank, card, cat)
        bank_leg = _force_materialize_occurrence(rule, on_date=PAY_DATE)
        _patch_this_occurrence_only(
            user,
            bank_leg,
            amount="-100.00",
            transfer_to_account_id=card.id,
            category_id=cat.id,
        )
        canonical, _ = _canonical_and_upcoming(user, household)
        bank_rows, card_rows = _occurrence_rows(
            canonical, rule_id=rule.id, on_date=PAY_DATE, bank_id=bank.id, card_id=card.id
        )
        assert bank_rows == []
        assert card_rows == []

    def test_f_skipping_one_month_does_not_pause_or_delete_rule(self, user, household):
        bank, card = _checking_and_card(household, card_starting=Decimal("0"))
        cat = _cc_payment_category(household)
        rule = _monthly_card_payment_rule(household, bank, card, cat)
        bank_leg = _force_materialize_occurrence(rule, on_date=PAY_DATE)
        _patch_this_occurrence_only(
            user,
            bank_leg,
            amount="-100.00",
            transfer_to_account_id=card.id,
            category_id=cat.id,
        )
        build_forecast_projection_timeline(
            user,
            today=AS_OF,
            end_date=date(2026, 12, 31),
            household_id=household.id,
            caller="test_f",
        )
        rule.refresh_from_db()
        assert RecurringRule.objects.filter(pk=rule.id).exists()
        assert rule.active is True
        assert rule.paused_at is None
        occ = list(generate_rule_occurrences(rule, PAY_DATE, date(2026, 12, 31)))
        assert PAY_DATE in occ
        assert LATER_DATE in occ

    def test_g_transactions_upcoming_agrees_with_canonical_timeline(self, user, household):
        bank, card = _checking_and_card(household, card_starting=Decimal("0"))
        cat = _cc_payment_category(household)
        rule = _monthly_card_payment_rule(household, bank, card, cat)
        bank_leg = _force_materialize_occurrence(rule, on_date=PAY_DATE)
        _patch_this_occurrence_only(
            user,
            bank_leg,
            amount="-100.00",
            transfer_to_account_id=card.id,
            category_id=cat.id,
        )
        canonical, forecast = _canonical_and_upcoming(user, household)
        page = build_timeline(
            user,
            AS_OF,
            date(2026, 12, 31),
            as_of_date=AS_OF,
            household_id=household.id,
            projection_only=True,
            exclude_reconciled_past=True,
            caller="timeline_page",
        )
        for rows, label in ((canonical, "canonical"), (forecast, "forecast"), (page, "timeline_page")):
            _assert_pair_absent(
                rows, rule_id=rule.id, on_date=PAY_DATE, bank_id=bank.id, card_id=card.id, label=label
            )
