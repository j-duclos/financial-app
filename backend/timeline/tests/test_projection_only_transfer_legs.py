"""projection_only timeline must surface both transfer legs on rescheduled dates."""
from datetime import date
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model

from accounts.models import Account
from categories.models import Category
from core.models import Household, HouseholdMembership
from timeline.models import RecurringRule
from timeline.services.ledger import build_timeline
from transactions.models import Transaction, TransferGroup

User = get_user_model()


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="Transfer HH")
    HouseholdMembership.objects.create(household=h, user=user, role=HouseholdMembership.Role.OWNER)
    return h


@pytest.fixture
def checking(db, household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Main",
        currency="USD",
        starting_balance=Decimal("5000.00"),
    )


@pytest.fixture
def credit_card(db, household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        name="Venture",
        currency="USD",
        starting_balance=Decimal("2000.00"),
    )


@pytest.mark.django_db
def test_projection_only_includes_actual_transfer_destination_on_rescheduled_date(
    user, checking, credit_card
):
    """Destination leg (source=ACTUAL) on a moved date must appear when projection_only=True."""
    cat, _ = Category.objects.get_or_create(
        household=checking.household,
        name="Credit Card Payment",
        category_type=Category.CategoryType.EXPENSE,
        defaults={"sort_order": 1},
    )
    rule = RecurringRule.objects.create(
        household=checking.household,
        name="ATT - Move to Venture",
        account=checking,
        transfer_to_account=credit_card,
        category=cat,
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("250.00"),
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=15,
        start_date=date(2026, 1, 1),
        active=True,
    )
    moved = date(2026, 7, 6)
    today = moved
    tg = TransferGroup.objects.create(
        household=checking.household,
        from_account=checking,
        to_account=credit_card,
        amount=Decimal("316.00"),
        scheduled_date=moved,
        status=TransferGroup.Status.PLANNED,
    )
    Transaction.objects.create(
        account=checking,
        rule=rule,
        transfer_group=tg,
        date=moved,
        amount=Decimal("-316.00"),
        source=Transaction.Source.RULE,
        status=Transaction.Status.PLANNED,
        payee=rule.name,
        category=cat,
    )
    to_leg = Transaction.objects.create(
        account=credit_card,
        rule=rule,
        transfer_group=tg,
        date=moved,
        amount=Decimal("316.00"),
        source=Transaction.Source.ACTUAL,
        status=Transaction.Status.PLANNED,
        payee=rule.name,
    )

    rows = build_timeline(
        user,
        date(2026, 7, 1),
        date(2026, 12, 31),
        account_id=credit_card.id,
        as_of_date=today,
        projection_only=True,
        caller="test",
    )
    dest = [r for r in rows if r.get("transaction_id") == to_leg.pk]
    assert len(dest) == 1
    assert dest[0]["amount"] == Decimal("316.00")
    assert dest[0]["date"] == moved
