"""inspect_transfer_cleanup reports RULE shadows and does not write unless --apply."""
import json
from datetime import date, timedelta
from decimal import Decimal
from io import StringIO

import pytest
from django.core.management import call_command
from django.utils import timezone

from accounts.models import Account
from timeline.models import RecurringRule
from transactions.models import Transaction, TransactionMatch
from transactions.management.commands.inspect_transfer_cleanup import (
    list_matched_rule_shadow_candidates,
)


@pytest.mark.django_db
def test_inspect_transfer_cleanup_dry_run_does_not_delete(household):
    bank = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Operating",
        currency="USD",
    )
    rule = RecurringRule.objects.create(
        household=household,
        name="Pay",
        account=bank,
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("20.00"),
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=1,
        start_date=date(2026, 1, 1),
        active=True,
    )
    today = timezone.localdate()
    planned = Transaction.objects.create(
        account=bank,
        date=today,
        payee="Pay",
        amount=Decimal("-20.00"),
        source=Transaction.Source.RULE,
        rule=rule,
        status=Transaction.Status.PLANNED,
        import_match_status=Transaction.ImportMatchStatus.MATCHED,
    )
    imported = Transaction.objects.create(
        account=bank,
        date=today,
        payee="Pay",
        amount=Decimal("-20.00"),
        source=Transaction.Source.PLAID,
        plaid_transaction_id="plaid-pay-1",
        import_match_status=Transaction.ImportMatchStatus.MATCHED,
    )
    TransactionMatch.objects.create(
        planned_transaction=planned,
        imported_transaction=imported,
        match_type=TransactionMatch.MatchType.MANUAL,
        score=100,
        confidence=TransactionMatch.Confidence.MANUAL,
    )
    shadow = Transaction.objects.create(
        account=bank,
        date=today + timedelta(days=1),
        payee="Pay",
        amount=Decimal("-20.00"),
        source=Transaction.Source.RULE,
        rule=rule,
        status=Transaction.Status.PLANNED,
    )
    manual = Transaction.objects.create(
        account=bank,
        date=today,
        payee="Keep me",
        amount=Decimal("-20.00"),
        source=Transaction.Source.ACTUAL,
    )
    candidates = list_matched_rule_shadow_candidates(account_ids=[bank.id])
    assert any(c["id"] == shadow.pk for c in candidates)
    assert all(c["id"] != manual.pk for c in candidates)
    assert all(c["id"] != imported.pk for c in candidates)

    out = StringIO()
    call_command("inspect_transfer_cleanup", "--account-id", str(bank.id), stdout=out)
    payload = json.loads(out.getvalue())
    assert payload["dry_run"] is True
    assert payload["deleted"] == 0
    assert Transaction.objects.filter(pk=shadow.pk).exists()
    assert Transaction.objects.filter(pk=manual.pk).exists()
    assert Transaction.objects.filter(pk=imported.pk).exists()
