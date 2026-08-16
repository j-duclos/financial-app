"""Reconciliation checkpoints as the starting point for current ledger balances."""
from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from accounts.models import Account
from accounts.services.balances import bulk_signed_ledger_balances, signed_ledger_balance
from timeline.services.balance_cache import TimelineBalanceCache
from transactions.models import Transaction
from transactions.services.posting import post_transaction
from transactions.services.reconciliation import complete_reconciliation

CHECKPOINT_END = date(2026, 7, 27)
AS_OF = date(2026, 8, 16)


@pytest.fixture
def checking(db, household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Main",
        currency="USD",
        starting_balance=Decimal("10000.00"),
    )


@pytest.mark.django_db
def test_current_balance_equals_checkpoint_plus_post_checkpoint_ledger(checking, user):
    historical = post_transaction(
        user=user,
        account_id=checking.pk,
        date=date(2026, 7, 10),
        payee="Rent",
        amount=Decimal("-2000.00"),
    )
    complete_reconciliation(
        account=checking,
        user=user,
        bank_current_balance=Decimal("8000.00"),
        checked_transaction_ids=[historical.pk],
        period_start=date(2026, 7, 10),
        period_end=CHECKPOINT_END,
        as_of=CHECKPOINT_END,
    )
    post_transaction(
        user=user,
        account_id=checking.pk,
        date=date(2026, 8, 1),
        payee="Groceries",
        amount=Decimal("-50.00"),
    )
    post_transaction(
        user=user,
        account_id=checking.pk,
        date=date(2026, 8, 5),
        payee="Coffee",
        amount=Decimal("-20.00"),
    )
    assert signed_ledger_balance(checking, AS_OF) == Decimal("7930.00")


@pytest.mark.django_db
def test_thousands_of_older_reconciled_rows_are_not_loaded_for_current_balance(checking, user):
    seed = post_transaction(
        user=user,
        account_id=checking.pk,
        date=date(2026, 7, 10),
        payee="Seed",
        amount=Decimal("-100.00"),
    )
    complete_reconciliation(
        account=checking,
        user=user,
        bank_current_balance=Decimal("9900.00"),
        checked_transaction_ids=[seed.pk],
        period_start=date(2026, 7, 10),
        period_end=CHECKPOINT_END,
        as_of=CHECKPOINT_END,
    )
    post_transaction(
        user=user,
        account_id=checking.pk,
        date=date(2026, 8, 2),
        payee="After",
        amount=Decimal("-25.00"),
    )

    cache_before = TimelineBalanceCache()
    cache_before.preload_accounts([checking])
    cache_before.preload_transactions([checking.pk], AS_OF, min_as_of=AS_OF)
    loaded_before = cache_before.loaded_transaction_count(checking.pk)
    full_history_before = Transaction.objects.filter(account=checking, date__lte=AS_OF).count()
    print(
        f"\nBEFORE extra history: transactions loaded for Main balance: {loaded_before} "
        f"(full history through as_of: {full_history_before})"
    )

    old_rows = [
        Transaction(
            account=checking,
            date=date(2024, 1, 1) + timedelta(days=i % 400),
            payee=f"Old {i}",
            amount=Decimal("-1.00"),
            reconciled=True,
            status=Transaction.Status.CLEARED,
            source=Transaction.Source.ACTUAL,
        )
        for i in range(3000)
    ]
    Transaction.objects.bulk_create(old_rows, batch_size=500)

    cache_after = TimelineBalanceCache()
    cache_after.preload_accounts([checking])
    cache_after.preload_transactions([checking.pk], AS_OF, min_as_of=AS_OF)
    loaded_after = cache_after.loaded_transaction_count(checking.pk)
    full_history_after = Transaction.objects.filter(account=checking, date__lte=AS_OF).count()
    checkpoint = cache_after.debug_checkpoint_by_account.get(checking.pk)
    print(
        f"AFTER: checkpoint: {checkpoint} "
        f"post-checkpoint transactions loaded: {loaded_after} "
        f"(full history through as_of: {full_history_after})"
    )

    assert loaded_before == loaded_after
    assert loaded_after < 10
    assert full_history_after >= 3000
    assert signed_ledger_balance(checking, AS_OF) == Decimal("9875.00")
    assert checkpoint == CHECKPOINT_END


@pytest.mark.django_db
def test_no_checkpoint_falls_back_to_opening_plus_full_ledger(checking, user):
    post_transaction(
        user=user,
        account_id=checking.pk,
        date=date(2026, 6, 1),
        payee="Old spend",
        amount=Decimal("-100.00"),
    )
    post_transaction(
        user=user,
        account_id=checking.pk,
        date=date(2026, 8, 1),
        payee="New spend",
        amount=Decimal("-40.00"),
    )
    assert signed_ledger_balance(checking, AS_OF) == Decimal("9860.00")
    cache = TimelineBalanceCache()
    cache.preload_accounts([checking])
    cache.preload_transactions([checking.pk], AS_OF, min_as_of=AS_OF)
    assert cache.loaded_transaction_count(checking.pk) == 2
    assert checking.pk not in cache.debug_checkpoint_by_account


@pytest.mark.django_db
def test_latest_checkpoint_on_or_before_as_of_is_used(checking, user):
    t1 = post_transaction(
        user=user,
        account_id=checking.pk,
        date=date(2026, 6, 15),
        payee="June",
        amount=Decimal("-100.00"),
    )
    complete_reconciliation(
        account=checking,
        user=user,
        bank_current_balance=Decimal("9900.00"),
        checked_transaction_ids=[t1.pk],
        period_start=date(2026, 6, 15),
        period_end=date(2026, 6, 30),
        as_of=date(2026, 6, 30),
    )
    t2 = post_transaction(
        user=user,
        account_id=checking.pk,
        date=date(2026, 7, 10),
        payee="July",
        amount=Decimal("-200.00"),
    )
    complete_reconciliation(
        account=checking,
        user=user,
        bank_current_balance=Decimal("9700.00"),
        checked_transaction_ids=[t2.pk],
        period_start=date(2026, 7, 10),
        period_end=CHECKPOINT_END,
        as_of=CHECKPOINT_END,
    )
    post_transaction(
        user=user,
        account_id=checking.pk,
        date=date(2026, 8, 1),
        payee="August",
        amount=Decimal("-10.00"),
    )
    assert signed_ledger_balance(checking, AS_OF) == Decimal("9690.00")
    # Historical as-of must not use the later checkpoint.
    assert signed_ledger_balance(checking, date(2026, 7, 10)) == Decimal("9700.00")
    assert signed_ledger_balance(checking, date(2026, 6, 30)) == Decimal("9900.00")


@pytest.mark.django_db
def test_bulk_balances_use_checkpoints_without_n_plus_one(checking, household, user):
    other = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Other",
        currency="USD",
        starting_balance=Decimal("500.00"),
    )
    t = post_transaction(
        user=user,
        account_id=checking.pk,
        date=date(2026, 7, 10),
        payee="Seed",
        amount=Decimal("-100.00"),
    )
    complete_reconciliation(
        account=checking,
        user=user,
        bank_current_balance=Decimal("9900.00"),
        checked_transaction_ids=[t.pk],
        period_start=date(2026, 7, 10),
        period_end=CHECKPOINT_END,
        as_of=CHECKPOINT_END,
    )
    with CaptureQueriesContext(connection) as ctx:
        balances = bulk_signed_ledger_balances([checking, other], AS_OF)
    assert balances[checking.pk] == Decimal("9900.00")
    assert balances[other.pk] == Decimal("500.00")
    assert len(ctx.captured_queries) <= 3
