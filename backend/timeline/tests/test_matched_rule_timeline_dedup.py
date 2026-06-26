"""Timeline must not double-count rule rows already matched to a Plaid import."""
from datetime import date
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model

from accounts.models import Account
from categories.models import Category
from core.models import Household, HouseholdMembership
from timeline.models import RecurringRule
from timeline.services.ledger import build_timeline
from transactions.models import Transaction, TransactionMatch
from transactions.services.matching import _create_match_record

User = get_user_model()


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="Payroll HH")
    HouseholdMembership.objects.create(household=h, user=user, role=HouseholdMembership.Role.OWNER)
    return h


@pytest.fixture
def chase(db, household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Chase",
        currency="USD",
        starting_balance=Decimal("1000.00"),
    )


@pytest.mark.django_db
def test_matched_rule_not_re_emitted_on_scheduled_occurrence_date(user, chase):
    """Bank import on Thu + rule occurrence Fri must not produce two payroll rows."""
    cat, _ = Category.objects.get_or_create(
        household=chase.household,
        name="Paycheck / Salary",
        category_type=Category.CategoryType.INCOME,
        defaults={"sort_order": 1},
    )
    rule = RecurringRule.objects.create(
        household=chase.household,
        name="Payroll",
        account=chase,
        category=cat,
        direction=RecurringRule.Direction.INCOME,
        amount=Decimal("1835.52"),
        currency="USD",
        frequency=RecurringRule.Frequency.WEEKLY,
        interval=1,
        day_of_week=4,
        start_date=date(2026, 1, 1),
        active=True,
    )
    pay_thu = date(2026, 6, 25)
    pay_fri = date(2026, 6, 26)
    planned = Transaction.objects.create(
        account=chase,
        date=pay_thu,
        payee="Payroll",
        amount=Decimal("1835.52"),
        category=cat,
        rule=rule,
        source=Transaction.Source.RULE,
        status=Transaction.Status.PLANNED,
    )
    imported = Transaction.objects.create(
        account=chase,
        date=pay_thu,
        payee="Payroll",
        amount=Decimal("1835.52"),
        source=Transaction.Source.PLAID,
        plaid_transaction_id="plaid-payroll-test-1",
        import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        status=Transaction.Status.CLEARED,
    )
    _create_match_record(
        planned=planned,
        imported=imported,
        match_type=TransactionMatch.MatchType.SAME_ACCOUNT,
        score=100,
        confidence=TransactionMatch.Confidence.AUTO,
    )
    planned.refresh_from_db()
    imported.refresh_from_db()
    assert planned.import_match_status == Transaction.ImportMatchStatus.MATCHED

    rows = build_timeline(
        user,
        pay_thu,
        pay_fri,
        account_id=chase.id,
    )
    payroll = [r for r in rows if r.get("rule_id") == rule.id or r.get("transaction_id") == imported.pk]
    assert len(payroll) == 1
    assert payroll[0]["transaction_id"] == imported.pk
    assert payroll[0]["date"] == pay_thu
