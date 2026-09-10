"""Transfer preview must reuse the Transactions canonical ledger walk.

Regression: Edit-transfer preview used an independent 90-day reconstruction that
loaded an older reconciliation checkpoint (Chase Savings 2026-06-13 $3,221.57)
instead of the canonical latest checkpoint (2026-06-26 $3,901.59). The $680.02
bank-verified delta never entered preview, so Savings showed $2,811.64 / $480.64
instead of the Transactions Upcoming $2,131.64 / −$199.36.
"""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone

from accounts.models import Account
from core.models import Household, HouseholdMembership
from timeline.models import RecurringRule
from timeline.services.ledger import build_forecast_projection_timeline
from timeline.services.ledger_section_balances import (
    signed_timeline_ledger_amount,
    transactions_ledger_walk_rows,
)
from transactions.models import Reconciliation, Transaction
from transactions.services.posting import create_transfer
from transactions.services.reconciliation import ledger_today_balance_before_pending
from transactions.services.transfer_balance_preview import preview_transfer_balances

User = get_user_model()

TODAY = date(2026, 9, 10)
TRANSFER_DATE = date(2026, 9, 17)
TRANSFER_AMT = Decimal("2331.00")
CHECKPOINT_DELTA = Decimal("680.02")
OLD_CHECKPOINT = Decimal("3221.57")
NEW_CHECKPOINT = Decimal("3901.59")  # 3221.57 + 680.02
# Unreconciled posted activity after the later checkpoint so today = 2131.64
POSTED_AFTER_NEW = Decimal("-1769.95")
CANONICAL_TODAY = Decimal("2131.64")  # 3901.59 - 1769.95
CANONICAL_AFTER_TRANSFER = Decimal("-199.36")  # 2131.64 - 2331.00


def _completed_recon(account, user, *, balance: Decimal, period_end: date) -> Reconciliation:
    return Reconciliation.objects.create(
        user=user,
        account=account,
        bank_current_balance=balance,
        app_current_balance=balance,
        last_reconciled_balance=balance,
        final_reconciled_balance=balance,
        difference=Decimal("0"),
        status=Reconciliation.Status.COMPLETED,
        is_active=True,
        completed_at=timezone.now(),
        period_start_date=period_end.replace(day=1) if period_end.day >= 1 else period_end,
        period_end_date=period_end,
    )


class TransferPreviewCanonicalLedgerTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(username="xfer_canon_prev", password="p")
        self.household = Household.objects.create(name="XferCanonHH")
        HouseholdMembership.objects.create(
            household=self.household, user=self.user, role=HouseholdMembership.Role.OWNER
        )
        self.main = Account.objects.create(
            household=self.household,
            name="Main",
            account_type=Account.AccountType.CHECKING,
            starting_balance=Decimal("1845.61"),
        )
        self.savings = Account.objects.create(
            household=self.household,
            name="Chase Savings",
            account_type=Account.AccountType.SAVINGS,
            starting_balance=OLD_CHECKPOINT,
        )

    def tearDown(self):
        cache.clear()

    def _freeze_today(self):
        from unittest.mock import patch

        return patch("django.utils.timezone.localdate", return_value=TODAY)

    def _seed_savings_checkpoint_gap(self):
        """Reproduce the live $680 recon-checkpoint miss.

        Preview's old 90-day floor (transfer_date - 90 = 2026-06-19) loaded the
        2026-06-13 checkpoint and never applied the 2026-06-26 bank-verified
        $680.02 increase.
        """
        _completed_recon(
            self.savings, self.user, balance=OLD_CHECKPOINT, period_end=date(2026, 6, 13)
        )
        _completed_recon(
            self.savings, self.user, balance=NEW_CHECKPOINT, period_end=date(2026, 6, 26)
        )
        Transaction.objects.create(
            account=self.savings,
            date=date(2026, 8, 1),
            payee="Posted after later checkpoint",
            amount=POSTED_AFTER_NEW,
            status=Transaction.Status.CLEARED,
            source=Transaction.Source.ACTUAL,
            cleared=True,
        )

    def _create_planning_transfer(self):
        return create_transfer(
            user=self.user,
            from_account_id=self.savings.pk,
            to_account_id=self.main.pk,
            amount=TRANSFER_AMT,
            transfer_date=TRANSFER_DATE.isoformat(),
            payee="Transfer for Planning (Chase Savings)",
        )

    def _canonical_walk(self, account: Account):
        rows = build_forecast_projection_timeline(
            self.user,
            today=TODAY,
            end_date=TODAY + timedelta(days=30),
            household_id=self.household.pk,
            caller="test_xfer_preview_canonical",
            account_id=account.pk,
        )
        return transactions_ledger_walk_rows(rows, account_id=account.pk, today=TODAY)

    def _canonical_before_after_for_txn(self, account: Account, txn: Transaction):
        walk = self._canonical_walk(account)
        anchor = ledger_today_balance_before_pending(account, TODAY).quantize(Decimal("0.01"))
        running = anchor
        before = None
        after = None
        for row in walk:
            if row.get("transaction_id") == txn.pk:
                before = running
                after = (running + signed_timeline_ledger_amount(row)).quantize(Decimal("0.01"))
                break
            running = (running + signed_timeline_ledger_amount(row)).quantize(Decimal("0.01"))
        if before is None:
            raise AssertionError(f"canonical walk missing txn {txn.pk}")
        return before, after

    def test_c_checkpoint_delta_matches_transactions_upcoming(self):
        """$680-equivalent recon delta is included identically by preview and Transactions."""
        self._seed_savings_checkpoint_gap()
        transfer = self._create_planning_transfer()
        savings_leg = transfer.from_transaction
        main_leg = transfer.to_transaction
        self.assertEqual(savings_leg.account_id, self.savings.pk)
        self.assertEqual(savings_leg.amount, -TRANSFER_AMT)

        with self._freeze_today():
            today_bal = ledger_today_balance_before_pending(self.savings, TODAY)
            self.assertEqual(today_bal, CANONICAL_TODAY)

            can_before, can_after = self._canonical_before_after_for_txn(self.savings, savings_leg)
            self.assertEqual(can_before, CANONICAL_TODAY)
            self.assertEqual(can_after, CANONICAL_AFTER_TRANSFER)

            preview = preview_transfer_balances(
                self.user,
                from_account_id=self.savings.pk,
                to_account_id=self.main.pk,
                amount=TRANSFER_AMT,
                transfer_date=TRANSFER_DATE,
                exclude_transaction_ids=[savings_leg.pk, main_leg.pk],
            )

        self.assertEqual(Decimal(preview["source_balance_before"]), CANONICAL_TODAY)
        self.assertEqual(Decimal(preview["source_balance_after"]), CANONICAL_AFTER_TRANSFER)
        self.assertNotEqual(Decimal(preview["source_balance_before"]), Decimal("2811.64"))
        self.assertNotEqual(Decimal(preview["source_balance_after"]), Decimal("480.64"))
        self.assertEqual(CHECKPOINT_DELTA, NEW_CHECKPOINT - OLD_CHECKPOINT)

    def test_a_future_manual_before_transfer_is_included(self):
        self.savings.starting_balance = Decimal("3000.00")
        self.savings.save(update_fields=["starting_balance"])
        Transaction.objects.create(
            account=self.savings,
            date=date(2026, 9, 14),
            payee="Scheduled savings fee",
            amount=Decimal("-680.00"),
            status=Transaction.Status.PLANNED,
            source=Transaction.Source.ONE_TIME,
        )
        transfer = self._create_planning_transfer()
        with self._freeze_today():
            can_before, can_after = self._canonical_before_after_for_txn(
                self.savings, transfer.from_transaction
            )
            preview = preview_transfer_balances(
                self.user,
                from_account_id=self.savings.pk,
                to_account_id=self.main.pk,
                amount=TRANSFER_AMT,
                transfer_date=TRANSFER_DATE,
                exclude_transaction_ids=[
                    transfer.from_transaction_id,
                    transfer.to_transaction_id,
                ],
            )
        self.assertEqual(Decimal(preview["source_balance_before"]), can_before)
        self.assertEqual(Decimal(preview["source_balance_after"]), can_after)
        self.assertEqual(can_before, Decimal("2320.00"))  # 3000 - 680
        self.assertEqual(can_after, Decimal("-11.00"))  # 2320 - 2331

    def test_b_recurring_rule_before_transfer_is_included(self):
        self.savings.starting_balance = Decimal("3000.00")
        self.savings.save(update_fields=["starting_balance"])
        rule = RecurringRule.objects.create(
            household=self.household,
            name="Savings fee",
            account=self.savings,
            direction=RecurringRule.Direction.EXPENSE,
            amount=Decimal("680.00"),
            currency="USD",
            frequency=RecurringRule.Frequency.MONTHLY_DAY,
            interval=1,
            day_of_month=14,
            start_date=date(2026, 1, 1),
            active=True,
        )
        Transaction.objects.create(
            account=self.savings,
            date=date(2026, 9, 14),
            payee="Savings fee",
            amount=Decimal("-680.00"),
            status=Transaction.Status.PLANNED,
            source=Transaction.Source.RULE,
            rule=rule,
        )
        transfer = self._create_planning_transfer()
        with self._freeze_today():
            can_before, can_after = self._canonical_before_after_for_txn(
                self.savings, transfer.from_transaction
            )
            preview = preview_transfer_balances(
                self.user,
                from_account_id=self.savings.pk,
                to_account_id=self.main.pk,
                amount=TRANSFER_AMT,
                transfer_date=TRANSFER_DATE,
                exclude_transaction_ids=[
                    transfer.from_transaction_id,
                    transfer.to_transaction_id,
                ],
            )
        self.assertEqual(Decimal(preview["source_balance_before"]), can_before)
        self.assertEqual(Decimal(preview["source_balance_after"]), can_after)

    def test_d_edited_transfer_does_not_count_itself(self):
        self.savings.starting_balance = CANONICAL_TODAY
        self.savings.save(update_fields=["starting_balance"])
        transfer = self._create_planning_transfer()
        with self._freeze_today():
            preview = preview_transfer_balances(
                self.user,
                from_account_id=self.savings.pk,
                to_account_id=self.main.pk,
                amount=TRANSFER_AMT,
                transfer_date=TRANSFER_DATE,
                exclude_transaction_ids=[
                    transfer.from_transaction_id,
                    transfer.to_transaction_id,
                ],
            )
        self.assertEqual(Decimal(preview["source_balance_before"]), CANONICAL_TODAY)
        self.assertEqual(
            Decimal(preview["source_balance_after"]),
            CANONICAL_TODAY - TRANSFER_AMT,
        )

    def test_e_same_day_later_txn_is_not_in_before(self):
        self.savings.starting_balance = Decimal("2500.00")
        self.savings.save(update_fields=["starting_balance"])
        transfer = self._create_planning_transfer()
        Transaction.objects.create(
            account=self.savings,
            date=TRANSFER_DATE,
            payee="Later same-day credit",
            amount=Decimal("100.00"),
            status=Transaction.Status.PLANNED,
            source=Transaction.Source.ONE_TIME,
        )
        with self._freeze_today():
            can_before, can_after = self._canonical_before_after_for_txn(
                self.savings, transfer.from_transaction
            )
            preview = preview_transfer_balances(
                self.user,
                from_account_id=self.savings.pk,
                to_account_id=self.main.pk,
                amount=TRANSFER_AMT,
                transfer_date=TRANSFER_DATE,
                exclude_transaction_ids=[
                    transfer.from_transaction_id,
                    transfer.to_transaction_id,
                ],
            )
        self.assertEqual(Decimal(preview["source_balance_before"]), can_before)
        self.assertEqual(Decimal(preview["source_balance_after"]), can_after)
        self.assertEqual(can_before, Decimal("2500.00"))

    def test_f_reconciled_account_uses_same_anchor_as_transactions(self):
        self._seed_savings_checkpoint_gap()
        with self._freeze_today():
            self.assertEqual(
                ledger_today_balance_before_pending(self.savings, TODAY),
                CANONICAL_TODAY,
            )
            preview = preview_transfer_balances(
                self.user,
                from_account_id=self.savings.pk,
                to_account_id=self.main.pk,
                amount=TRANSFER_AMT,
                transfer_date=TRANSFER_DATE,
            )
        self.assertEqual(Decimal(preview["source_balance_before"]), CANONICAL_TODAY)

    def test_g_main_and_savings_legs_are_opposite_and_net_zero(self):
        self.savings.starting_balance = CANONICAL_TODAY
        self.savings.save(update_fields=["starting_balance"])
        transfer = self._create_planning_transfer()
        with self._freeze_today():
            preview = preview_transfer_balances(
                self.user,
                from_account_id=self.savings.pk,
                to_account_id=self.main.pk,
                amount=TRANSFER_AMT,
                transfer_date=TRANSFER_DATE,
                exclude_transaction_ids=[
                    transfer.from_transaction_id,
                    transfer.to_transaction_id,
                ],
            )
        sav_delta = Decimal(preview["source_balance_after"]) - Decimal(
            preview["source_balance_before"]
        )
        main_delta = Decimal(preview["destination_balance_after"]) - Decimal(
            preview["destination_balance_before"]
        )
        self.assertEqual(sav_delta, -TRANSFER_AMT)
        self.assertEqual(main_delta, TRANSFER_AMT)
        self.assertEqual(sav_delta + main_delta, Decimal("0.00"))

        swapped = preview_transfer_balances(
            self.user,
            from_account_id=self.main.pk,
            to_account_id=self.savings.pk,
            amount=TRANSFER_AMT,
            transfer_date=TRANSFER_DATE,
            exclude_transaction_ids=[
                transfer.from_transaction_id,
                transfer.to_transaction_id,
            ],
        )
        self.assertEqual(
            Decimal(swapped["source_balance_after"]) - Decimal(swapped["source_balance_before"]),
            -TRANSFER_AMT,
        )
        self.assertEqual(
            Decimal(swapped["destination_balance_after"])
            - Decimal(swapped["destination_balance_before"]),
            TRANSFER_AMT,
        )

    def test_h_amount_change_does_not_change_starting_balance(self):
        self.savings.starting_balance = CANONICAL_TODAY
        self.savings.save(update_fields=["starting_balance"])
        transfer = self._create_planning_transfer()
        ids = [transfer.from_transaction_id, transfer.to_transaction_id]
        with self._freeze_today():
            p1 = preview_transfer_balances(
                self.user,
                from_account_id=self.savings.pk,
                to_account_id=self.main.pk,
                amount=TRANSFER_AMT,
                transfer_date=TRANSFER_DATE,
                exclude_transaction_ids=ids,
            )
            p2 = preview_transfer_balances(
                self.user,
                from_account_id=self.savings.pk,
                to_account_id=self.main.pk,
                amount=Decimal("100.00"),
                transfer_date=TRANSFER_DATE,
                exclude_transaction_ids=ids,
            )
        self.assertEqual(p1["source_balance_before"], p2["source_balance_before"])
        self.assertEqual(
            Decimal(p2["source_balance_after"]),
            Decimal(p2["source_balance_before"]) - Decimal("100.00"),
        )
        self.assertNotEqual(p1["source_balance_after"], p2["source_balance_after"])
