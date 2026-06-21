from datetime import date
from decimal import Decimal

import pytest

from accounts.models import Account
from transactions.models import Transaction
from transactions.services.posting import post_transaction
from transactions.services.matching import (
    ledger_visible_transactions,
    ensure_reconciled_plaid_ledger_visibility,
    materialize_unmatched_plaid_imports,
    restore_all_duplicate_plaid_imports,
)
from transactions.services.reconciliation import (
    complete_reconciliation,
    import_locked_through_date,
    is_import_date_locked,
    last_reconcile_period_end,
    suppress_plaid_imports_in_locked_periods,
)


@pytest.fixture
def account(db, household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Checking",
        currency="USD",
        starting_balance=Decimal("1000.00"),
    )


@pytest.mark.django_db
class TestReconciledPeriodImportLock:
    def test_import_locked_through_last_period_end(self, account, user):
        txn = post_transaction(
            user=user,
            account_id=account.pk,
            date=date(2026, 6, 12),
            payee="Coffee",
            amount=Decimal("-4.00"),
        )
        complete_reconciliation(
            account=account,
            user=user,
            bank_current_balance=Decimal("996.00"),
            checked_transaction_ids=[txn.pk],
            period_start=date(2026, 6, 12),
            period_end=date(2026, 6, 12),
            as_of=date(2026, 6, 12),
        )
        assert last_reconcile_period_end(account) == date(2026, 6, 12)
        assert import_locked_through_date(account) == date(2026, 6, 12)
        assert is_import_date_locked(account, date(2026, 6, 12)) is True
        assert is_import_date_locked(account, date(2026, 3, 18)) is True
        assert is_import_date_locked(account, date(2026, 6, 13)) is False

    def test_materialize_skips_plaid_imports_in_locked_period(self, account, user):
        amazon = post_transaction(
            user=user,
            account_id=account.pk,
            date=date(2026, 3, 18),
            payee="Amazon",
            amount=Decimal("-300.00"),
        )
        complete_reconciliation(
            account=account,
            user=user,
            bank_current_balance=Decimal("700.00"),
            checked_transaction_ids=[amazon.pk],
            period_start=date(2026, 3, 18),
            period_end=date(2026, 6, 12),
            as_of=date(2026, 6, 12),
        )
        locked_import = Transaction.objects.create(
            account=account,
            date=date(2026, 3, 18),
            payee="CAPITAL ONE MOBILE PMT",
            amount=Decimal("-300.00"),
            source=Transaction.Source.PLAID,
            plaid_transaction_id="plaid-cap-one-dup",
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        )
        materialize_unmatched_plaid_imports(account_id=account.pk)
        locked_import.refresh_from_db()
        assert locked_import.source == Transaction.Source.PLAID
        assert locked_import.import_match_status == Transaction.ImportMatchStatus.UNMATCHED

    def test_materialize_allows_plaid_imports_after_locked_period(self, account, user):
        anchor = post_transaction(
            user=user,
            account_id=account.pk,
            date=date(2026, 6, 12),
            payee="Groceries",
            amount=Decimal("-50.00"),
        )
        complete_reconciliation(
            account=account,
            user=user,
            bank_current_balance=Decimal("950.00"),
            checked_transaction_ids=[anchor.pk],
            period_start=date(2026, 6, 12),
            period_end=date(2026, 6, 12),
            as_of=date(2026, 6, 12),
        )
        open_import = Transaction.objects.create(
            account=account,
            date=date(2026, 6, 13),
            payee="New charge",
            amount=Decimal("-25.00"),
            source=Transaction.Source.PLAID,
            plaid_transaction_id="plaid-open-period",
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        )
        materialize_unmatched_plaid_imports(account_id=account.pk)
        open_import.refresh_from_db()
        assert open_import.source == Transaction.Source.ACTUAL
        assert open_import.import_match_status == Transaction.ImportMatchStatus.NONE

    def test_restore_duplicate_skips_when_visible_actual_twin_exists(self, account, user):
        anchor = post_transaction(
            user=user,
            account_id=account.pk,
            date=date(2026, 4, 2),
            payee="CAPITAL ONE ONLINE PMT CA0C044818F6267",
            amount=Decimal("-66.00"),
        )
        hidden_dup = Transaction.objects.create(
            account=account,
            date=date(2026, 4, 2),
            payee="CAPITAL ONE ONLINE PMT CA0C044818F6267",
            amount=Decimal("-66.00"),
            source=Transaction.Source.PLAID,
            plaid_transaction_id="plaid-cap-one-stray",
            import_match_status=Transaction.ImportMatchStatus.DUPLICATE,
        )
        from transactions.services.matching import (
            delete_redundant_plaid_imports_for_accounts,
            repair_wrongly_suppressed_plaid_ledger,
        )

        result = repair_wrongly_suppressed_plaid_ledger(account_id=account.pk)
        hidden_dup.refresh_from_db()
        assert result["restored"] == 0
        assert hidden_dup.import_match_status == Transaction.ImportMatchStatus.DUPLICATE
        assert Transaction.objects.filter(pk=anchor.pk).exists()

        deleted = delete_redundant_plaid_imports_for_accounts([account.pk])
        assert deleted == 1
        assert not Transaction.objects.filter(pk=hidden_dup.pk).exists()
        assert Transaction.objects.filter(pk=anchor.pk).exists()

    def test_restore_duplicate_restores_canonical_locked_period_import(self, account):
        hidden = Transaction.objects.create(
            account=account,
            date=date(2026, 4, 6),
            payee="CAPITAL ONE ONLINE PMT CA043EDBEC632B5",
            amount=Decimal("-320.00"),
            source=Transaction.Source.PLAID,
            plaid_transaction_id="plaid-cap-one-320",
            import_match_status=Transaction.ImportMatchStatus.DUPLICATE,
        )
        restored = restore_all_duplicate_plaid_imports(account_id=account.pk)
        hidden.refresh_from_db()
        assert restored == 1
        assert hidden.import_match_status == Transaction.ImportMatchStatus.UNMATCHED
        assert hidden.pk in set(
            ledger_visible_transactions(Transaction.objects.filter(account=account)).values_list(
                "pk", flat=True
            )
        )

    def test_suppress_never_hides_reconciled_plaid_in_locked_period(self, account, user):
        reconciled_cap_one = Transaction.objects.create(
            account=account,
            date=date(2026, 3, 26),
            payee="CAPITAL ONE ONLINE PMT CA0F652823B8B44",
            amount=Decimal("-250.00"),
            source=Transaction.Source.PLAID,
            plaid_transaction_id="plaid-cap-one-reconciled",
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        )
        anchor = post_transaction(
            user=user,
            account_id=account.pk,
            date=date(2026, 3, 26),
            payee="Circle K",
            amount=Decimal("-4.00"),
        )
        complete_reconciliation(
            account=account,
            user=user,
            bank_current_balance=Decimal("746.00"),
            checked_transaction_ids=[anchor.pk, reconciled_cap_one.pk],
            period_start=date(2026, 3, 26),
            period_end=date(2026, 3, 26),
            as_of=date(2026, 3, 26),
        )
        reconciled_cap_one.refresh_from_db()
        assert reconciled_cap_one.reconciled is True
        stray = Transaction.objects.create(
            account=account,
            date=date(2026, 3, 26),
            payee="CAPITAL ONE ONLINE PMT CA0F613177D0164",
            amount=Decimal("-250.00"),
            source=Transaction.Source.PLAID,
            plaid_transaction_id="plaid-cap-one-stray-resync",
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
            reconciled=False,
        )
        suppressed = suppress_plaid_imports_in_locked_periods(account_id=account.pk)
        reconciled_cap_one.refresh_from_db()
        stray.refresh_from_db()
        assert suppressed == 0
        assert reconciled_cap_one.import_match_status != Transaction.ImportMatchStatus.DUPLICATE
        assert stray.import_match_status == Transaction.ImportMatchStatus.UNMATCHED

    def test_restore_duplicate_restores_reconciled_in_locked_period(self, account, user):
        cap_one = Transaction.objects.create(
            account=account,
            date=date(2026, 3, 26),
            payee="CAPITAL ONE ONLINE PMT",
            amount=Decimal("-250.00"),
            source=Transaction.Source.PLAID,
            plaid_transaction_id="plaid-cap-one-wrongly-hidden",
            import_match_status=Transaction.ImportMatchStatus.DUPLICATE,
            reconciled=True,
        )
        restored = restore_all_duplicate_plaid_imports(account_id=account.pk)
        cap_one.refresh_from_db()
        assert restored == 1
        assert cap_one.import_match_status == Transaction.ImportMatchStatus.UNMATCHED

    def test_ledger_visible_keeps_reconciled_plaid_marked_duplicate(self, account):
        hidden_stray = Transaction.objects.create(
            account=account,
            date=date(2026, 3, 26),
            payee="Stray resync",
            amount=Decimal("-10.00"),
            source=Transaction.Source.PLAID,
            plaid_transaction_id="plaid-stray",
            import_match_status=Transaction.ImportMatchStatus.DUPLICATE,
            reconciled=False,
        )
        reconciled_cap_one = Transaction.objects.create(
            account=account,
            date=date(2026, 3, 26),
            payee="CAPITAL ONE ONLINE PMT",
            amount=Decimal("-250.00"),
            source=Transaction.Source.PLAID,
            plaid_transaction_id="plaid-cap-one-reconciled",
            import_match_status=Transaction.ImportMatchStatus.DUPLICATE,
            reconciled=True,
        )
        visible = set(
            ledger_visible_transactions(Transaction.objects.filter(account=account)).values_list(
                "pk", flat=True
            )
        )
        assert reconciled_cap_one.pk in visible
        assert hidden_stray.pk not in visible

    def test_ensure_reconciled_plaid_ledger_visibility_restores_cap_one_66(self, account):
        cap_one = Transaction.objects.create(
            account=account,
            date=date(2026, 4, 2),
            payee="CAPITAL ONE ONLINE PMT CA0C044818F6267",
            amount=Decimal("-66.00"),
            source=Transaction.Source.PLAID,
            plaid_transaction_id="plaid-cap-one-66",
            import_match_status=Transaction.ImportMatchStatus.DUPLICATE,
            reconciled=True,
        )
        visible_before = set(
            ledger_visible_transactions(Transaction.objects.filter(account=account)).values_list(
                "pk", flat=True
            )
        )
        assert cap_one.pk in visible_before
        restored = ensure_reconciled_plaid_ledger_visibility(account_id=account.pk)
        cap_one.refresh_from_db()
        assert restored == 1
        assert cap_one.import_match_status == Transaction.ImportMatchStatus.UNMATCHED

    def test_suppress_is_disabled(self, account, user):
        anchor = post_transaction(
            user=user,
            account_id=account.pk,
            date=date(2026, 4, 2),
            payee="Burger King",
            amount=Decimal("-4.00"),
        )
        complete_reconciliation(
            account=account,
            user=user,
            bank_current_balance=Decimal("996.00"),
            checked_transaction_ids=[anchor.pk],
            period_start=date(2026, 4, 2),
            period_end=date(2026, 4, 2),
            as_of=date(2026, 4, 2),
        )
        stray = Transaction.objects.create(
            account=account,
            date=date(2026, 4, 2),
            payee="CAPITAL ONE ONLINE PMT",
            amount=Decimal("-66.00"),
            source=Transaction.Source.PLAID,
            plaid_transaction_id="plaid-cap-one-stray",
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        )
        assert suppress_plaid_imports_in_locked_periods(account_id=account.pk) == 0
        stray.refresh_from_db()
        assert stray.import_match_status == Transaction.ImportMatchStatus.UNMATCHED
