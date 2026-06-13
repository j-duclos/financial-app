from datetime import date
from decimal import Decimal

import pytest

from accounts.models import Account
from transactions.models import Transaction
from transactions.services.posting import post_transaction
from transactions.services.reconciliation import (
    complete_reconciliation,
    import_locked_through_date,
    is_import_date_locked,
    last_reconcile_period_end,
)
from transactions.services.matching import materialize_unmatched_plaid_imports


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
