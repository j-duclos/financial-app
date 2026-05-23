from datetime import date
from decimal import Decimal
from django.test import TestCase
from django.contrib.auth import get_user_model

from core.models import Household, HouseholdMembership
from accounts.models import Account
from categories.models import Category
from timeline.models import RecurringRule
from transactions.models import Transaction, Transfer
from transactions.services import (
    clear_all_transactions_for_account,
    create_transfer,
    delete_manual_transactions_for_plaid_reset,
    delete_transaction_respecting_partner_ledger,
    eligible_manual_transactions_queryset,
    post_transaction,
)

User = get_user_model()


class TestPostTransaction(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="u1", password="p1")
        self.h = Household.objects.create(name="H1")
        HouseholdMembership.objects.create(household=self.h, user=self.user, role=HouseholdMembership.Role.OWNER)
        self.acc = Account.objects.create(
            household=self.h, account_type=Account.AccountType.CHECKING, name="Checking", currency="USD"
        )

    def test_post_inflow(self):
        txn = post_transaction(
            user=self.user, account_id=self.acc.id, date="2025-01-15",
            payee="Employer", amount=Decimal("1500.00"),
        )
        self.assertIsNotNone(txn.id)
        self.assertEqual(txn.amount, Decimal("1500.00"))
        from django.db.models import Sum
        balance = Transaction.objects.filter(account=self.acc).aggregate(s=Sum("amount"))["s"]
        self.assertEqual(balance, Decimal("1500.00"))

    def test_post_outflow(self):
        txn = post_transaction(
            user=self.user, account_id=self.acc.id, date="2025-01-16",
            payee="Store", amount=Decimal("-50.25"),
        )
        self.assertEqual(txn.amount, Decimal("-50.25"))
        from django.db.models import Sum
        balance = Transaction.objects.filter(account=self.acc).aggregate(s=Sum("amount"))["s"]
        self.assertEqual(balance, Decimal("-50.25"))

    def test_post_zero_raises(self):
        with self.assertRaises(ValueError):
            post_transaction(
                user=self.user, account_id=self.acc.id, date="2025-01-15",
                payee="X", amount=Decimal("0"),
            )


class TestCreateTransfer(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="u1", password="p1")
        self.h = Household.objects.create(name="H1")
        HouseholdMembership.objects.create(household=self.h, user=self.user, role=HouseholdMembership.Role.OWNER)
        self.from_acc = Account.objects.create(
            household=self.h, account_type=Account.AccountType.CHECKING, name="Checking", currency="USD"
        )
        self.to_acc = Account.objects.create(
            household=self.h, account_type=Account.AccountType.SAVINGS, name="Savings", currency="USD"
        )

    def test_create_transfer(self):
        transfer = create_transfer(
            user=self.user,
            from_account_id=self.from_acc.id,
            to_account_id=self.to_acc.id,
            amount=Decimal("100.00"),
            transfer_date="2025-01-15",
            memo="Move to savings",
        )
        self.assertIsNotNone(transfer.transfer_id)
        self.assertEqual(transfer.from_transaction.amount, Decimal("-100.00"))
        self.assertEqual(transfer.to_transaction.amount, Decimal("100.00"))
        self.assertEqual(Transfer.objects.count(), 1)
        self.assertEqual(Transaction.objects.count(), 2)


class TestManualTransactionsForPlaidReset(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="u_clear", password="p1")
        self.h = Household.objects.create(name="HClear")
        HouseholdMembership.objects.create(household=self.h, user=self.user, role=HouseholdMembership.Role.OWNER)
        self.acc = Account.objects.create(
            household=self.h, account_type=Account.AccountType.CHECKING, name="Checking", currency="USD"
        )

    def test_keeps_plaid_rows_deletes_manual(self):
        manual = Transaction.objects.create(
            account=self.acc,
            date=date(2026, 1, 10),
            payee="Coffee",
            amount=Decimal("-4.50"),
            source=Transaction.Source.ACTUAL,
        )
        plaid_row = Transaction.objects.create(
            account=self.acc,
            date=date(2026, 1, 11),
            payee="Bank",
            amount=Decimal("-10.00"),
            source=Transaction.Source.PLAID,
            plaid_transaction_id="txn-plaid-1",
        )
        self.assertEqual(eligible_manual_transactions_queryset(self.acc).count(), 1)
        n = delete_manual_transactions_for_plaid_reset(self.acc)
        self.assertEqual(n, 1)
        self.assertFalse(Transaction.objects.filter(pk=manual.pk).exists())
        self.assertTrue(Transaction.objects.filter(pk=plaid_row.pk).exists())

    def test_date_filters(self):
        Transaction.objects.create(
            account=self.acc,
            date=date(2026, 1, 5),
            payee="Old",
            amount=Decimal("-1.00"),
            source=Transaction.Source.ACTUAL,
        )
        Transaction.objects.create(
            account=self.acc,
            date=date(2026, 2, 5),
            payee="New",
            amount=Decimal("-2.00"),
            source=Transaction.Source.ACTUAL,
        )
        n = delete_manual_transactions_for_plaid_reset(self.acc, before=date(2026, 1, 31))
        self.assertEqual(n, 1)
        self.assertEqual(Transaction.objects.filter(account=self.acc).count(), 1)


class TestClearAllTransactionsForAccount(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="u_clear_all", password="p1")
        self.h = Household.objects.create(name="HClearAll")
        HouseholdMembership.objects.create(household=self.h, user=self.user, role=HouseholdMembership.Role.OWNER)
        self.checking = Account.objects.create(
            household=self.h, account_type=Account.AccountType.CHECKING, name="Checking", currency="USD"
        )
        self.savings = Account.objects.create(
            household=self.h, account_type=Account.AccountType.SAVINGS, name="Savings", currency="USD"
        )

    def test_clears_account_and_transfer_counterpart(self):
        create_transfer(
            user=self.user,
            from_account_id=self.checking.id,
            to_account_id=self.savings.id,
            amount=Decimal("50.00"),
            transfer_date="2026-03-01",
            memo="move",
        )
        self.assertGreater(Transaction.objects.filter(account=self.checking).count(), 0)
        stats = clear_all_transactions_for_account(self.checking)
        self.assertGreater(stats["transactions_deleted"], 0)
        self.assertEqual(Transaction.objects.filter(account=self.checking).count(), 0)
        self.assertEqual(Transaction.objects.filter(account=self.savings).count(), 0)

    def test_clear_resets_plaid_sync_cursor_for_linked_item(self):
        from plaid_link.models import PlaidItem, PlaidLinkedAccount

        item = PlaidItem.objects.create(
            household_id=self.h.id,
            item_id="item-cursor-reset-test",
            access_token_cipher="cipher-placeholder",
            transactions_cursor="non-empty-cursor",
        )
        PlaidLinkedAccount.objects.create(
            item=item,
            plaid_account_id="plaid-acct-xyz",
            account=self.checking,
        )
        Transaction.objects.create(
            account=self.checking,
            date=date(2026, 1, 1),
            payee="X",
            amount=Decimal("-1.00"),
            source=Transaction.Source.ACTUAL,
        )
        stats = clear_all_transactions_for_account(self.checking)
        self.assertGreaterEqual(stats.get("plaid_items_cursor_reset", 0), 1)
        item.refresh_from_db()
        self.assertEqual(item.transactions_cursor, "")

    def test_clear_preserves_counterparty_when_manual_ledger_flag_set(self):
        self.savings.preserve_partner_transfer_legs = True
        self.savings.save(update_fields=["preserve_partner_transfer_legs"])
        create_transfer(
            user=self.user,
            from_account_id=self.checking.id,
            to_account_id=self.savings.id,
            amount=Decimal("300.00"),
            transfer_date="2026-03-23",
            memo="card pay",
        )
        self.assertEqual(Transaction.objects.filter(account=self.savings).count(), 1)
        stats = clear_all_transactions_for_account(self.checking)
        self.assertGreater(stats["transactions_deleted"], 0)
        self.assertEqual(Transaction.objects.filter(account=self.checking).count(), 0)
        self.assertEqual(Transaction.objects.filter(account=self.savings).count(), 1)
        kept = Transaction.objects.get(account=self.savings)
        self.assertEqual(kept.amount, Decimal("300.00"))
        self.assertIsNone(kept.transfer_group_id)

    def test_delete_from_checking_preserves_flagged_counterparty_via_helper(self):
        self.savings.preserve_partner_transfer_legs = True
        self.savings.save(update_fields=["preserve_partner_transfer_legs"])
        create_transfer(
            user=self.user,
            from_account_id=self.checking.id,
            to_account_id=self.savings.id,
            amount=Decimal("100.00"),
            transfer_date="2026-04-01",
            memo="pay",
        )
        out_leg = Transaction.objects.filter(account=self.checking, amount=Decimal("-100.00")).get()
        delete_transaction_respecting_partner_ledger(out_leg)
        self.assertFalse(Transaction.objects.filter(account=self.checking).exists())
        self.assertEqual(Transaction.objects.filter(account=self.savings).count(), 1)
        self.assertIsNone(Transaction.objects.get(account=self.savings).transfer_group_id)


class TestDeleteRuleTransferPair(TestCase):
    """Rule-scheduled bank transfers use two Transaction rows without a Transfer bridge."""

    def setUp(self):
        self.user = User.objects.create_user(username="u_rule_xfer", password="p1")
        self.h = Household.objects.create(name="HRuleXfer")
        HouseholdMembership.objects.create(household=self.h, user=self.user, role=HouseholdMembership.Role.OWNER)
        self.checking = Account.objects.create(
            household=self.h, account_type=Account.AccountType.CHECKING, name="Chase", currency="USD"
        )
        self.savings = Account.objects.create(
            household=self.h, account_type=Account.AccountType.SAVINGS, name="Chase Savings", currency="USD"
        )
        self.cat = Category.objects.create(
            household=self.h,
            name="Transfer",
            category_type=Category.CategoryType.EXPENSE,
            sort_order=1,
        )

    def test_delete_from_checking_also_deletes_savings_leg(self):
        rule = RecurringRule.objects.create(
            household=self.h,
            name="To savings",
            account=self.checking,
            transfer_to_account=self.savings,
            category=self.cat,
            direction=RecurringRule.Direction.EXPENSE,
            amount=Decimal("200.00"),
            currency="USD",
            frequency=RecurringRule.Frequency.MONTHLY_DAY,
            interval=1,
            day_of_month=2,
            start_date=date(2026, 1, 1),
            active=True,
        )
        from_leg = Transaction.objects.create(
            account=self.checking,
            date=date(2026, 5, 2),
            payee="xfer",
            amount=Decimal("-200.00"),
            source=Transaction.Source.RULE,
            rule=rule,
        )
        to_leg = Transaction.objects.create(
            account=self.savings,
            date=date(2026, 5, 2),
            payee="xfer",
            amount=Decimal("200.00"),
            source=Transaction.Source.RULE,
            rule=rule,
        )
        self.assertEqual(Transfer.objects.count(), 0)
        delete_transaction_respecting_partner_ledger(from_leg)
        self.assertFalse(Transaction.objects.filter(pk=from_leg.pk).exists())
        self.assertFalse(Transaction.objects.filter(pk=to_leg.pk).exists())
