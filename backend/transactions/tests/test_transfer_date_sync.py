"""Date edits on one leg of a rule-based transfer must update the paired leg even when dates were out of sync."""
from datetime import date
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from accounts.models import Account
from categories.models import Category
from core.models import Household, HouseholdMembership
from timeline.models import RecurringRule
from transactions.models import Transaction, TransactionMatch, Transfer
from transactions.rule_transfer_pairs import find_rule_transfer_counterpart_txn

User = get_user_model()


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def user(db):
    return User.objects.create_user(username="tuser", password="tpass123")


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="H")
    HouseholdMembership.objects.create(household=h, user=user, role=HouseholdMembership.Role.OWNER)
    return h


@pytest.fixture
def auth_client(api_client, user):
    api_client.force_authenticate(user=user)
    return api_client


@pytest.mark.django_db
def test_find_counterpart_helper_misaligned_dates(household):
    bank = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Chase",
        currency="USD",
    )
    card = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        name="Venture",
        currency="USD",
    )
    cat = Category.objects.create(
        household=household,
        name="Credit Card Payment",
        category_type=Category.CategoryType.EXPENSE,
        sort_order=1,
    )
    rule = RecurringRule.objects.create(
        household=household,
        name="ATT - Move to CC",
        account=bank,
        transfer_to_account=card,
        category=cat,
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("250.00"),
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=16,
        start_date=date(2026, 1, 1),
        active=True,
    )
    from_leg = Transaction.objects.create(
        account=bank,
        date=date(2026, 3, 16),
        payee="x",
        amount=Decimal("-250.00"),
        category=cat,
        rule=rule,
    )
    to_leg = Transaction.objects.create(
        account=card,
        date=date(2026, 3, 17),
        payee="x",
        amount=Decimal("250.00"),
        rule=rule,
    )
    found = find_rule_transfer_counterpart_txn(
        rule_id=rule.id,
        exclude_txn_pk=from_leg.pk,
        old_date=date(2026, 3, 16),
        old_amount=Decimal("-250.00"),
        old_account_id=bank.id,
    )
    assert found is not None and found.pk == to_leg.pk


@pytest.mark.django_db
def test_patch_date_syncs_rule_transfer_when_legs_have_different_dates(auth_client, household):
    bank = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Chase",
        currency="USD",
    )
    card = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        name="Venture",
        currency="USD",
    )
    cat = Category.objects.get_or_create(
        household=household,
        name="Credit Card Payment",
        category_type=Category.CategoryType.EXPENSE,
        defaults={"sort_order": 1},
    )[0]
    rule = RecurringRule.objects.create(
        household=household,
        name="ATT - Move to CC",
        account=bank,
        transfer_to_account=card,
        category=cat,
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("250.00"),
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=16,
        start_date=date(2026, 1, 1),
        active=True,
    )
    from_leg = Transaction.objects.create(
        account=bank,
        date=date(2026, 3, 16),
        payee="ATT - Move to CC (Venture)",
        amount=Decimal("-250.00"),
        category=cat,
        rule=rule,
    )
    to_leg = Transaction.objects.create(
        account=card,
        date=date(2026, 3, 17),
        payee="ATT - Move to CC (Venture)",
        amount=Decimal("250.00"),
        rule=rule,
    )

    assert Transfer.objects.count() == 0
    r = auth_client.patch(
        f"/api/transactions/{from_leg.id}/",
        {"date": "2026-03-23"},
        format="json",
    )
    assert r.status_code == 200, r.data
    assert r.data.get("synced_to_account_id") == card.id

    from_leg.refresh_from_db()
    to_leg.refresh_from_db()
    assert from_leg.rule_id == rule.id
    assert from_leg.date == date(2026, 3, 23)
    assert to_leg.date == date(2026, 3, 23)


@pytest.mark.django_db
def test_patch_date_does_not_pair_distant_opposite_leg(auth_client, household):
    """Editing April's from leg must sync April's to leg only — not a different month's to leg."""
    bank = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Chase",
        currency="USD",
    )
    card = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        name="Venture",
        currency="USD",
    )
    cat = Category.objects.get_or_create(
        household=household,
        name="Credit Card Payment",
        category_type=Category.CategoryType.EXPENSE,
        defaults={"sort_order": 1},
    )[0]
    rule = RecurringRule.objects.create(
        household=household,
        name="Pay card",
        account=bank,
        transfer_to_account=card,
        category=cat,
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("70.00"),
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=10,
        start_date=date(2026, 1, 1),
        active=True,
    )
    april_from = Transaction.objects.create(
        account=bank,
        date=date(2026, 4, 10),
        payee="Pay card",
        amount=Decimal("-70.00"),
        category=cat,
        rule=rule,
    )
    april_to = Transaction.objects.create(
        account=card,
        date=date(2026, 4, 10),
        payee="Pay card",
        amount=Decimal("70.00"),
        rule=rule,
    )
    may_to = Transaction.objects.create(
        account=card,
        date=date(2026, 5, 10),
        payee="Pay card",
        amount=Decimal("70.00"),
        rule=rule,
    )

    r = auth_client.patch(
        f"/api/transactions/{april_from.id}/",
        {"date": "2026-04-15"},
        format="json",
    )
    assert r.status_code == 200, r.data

    may_to.refresh_from_db()
    april_from.refresh_from_db()
    april_to.refresh_from_db()
    assert april_from.date == date(2026, 4, 15)
    assert april_to.date == date(2026, 4, 15)
    assert may_to.date == date(2026, 5, 10)


@pytest.mark.django_db
def test_patch_date_materializes_missing_counterparty_leg(auth_client, household):
    """When the bank leg exists but the card inflow was never saved, PATCH date creates the pair."""
    bank = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Chase",
        currency="USD",
    )
    card = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        name="Care Credit",
        currency="USD",
    )
    cat = Category.objects.get_or_create(
        household=household,
        name="Credit Card Payment",
        category_type=Category.CategoryType.EXPENSE,
        defaults={"sort_order": 1},
    )[0]
    rule = RecurringRule.objects.create(
        household=household,
        name="Care Credit (Care Credit)",
        account=bank,
        transfer_to_account=card,
        category=cat,
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("393.79"),
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=28,
        start_date=date(2026, 1, 1),
        active=True,
    )
    from_leg = Transaction.objects.create(
        account=bank,
        date=date(2026, 3, 28),
        payee="Care Credit (Care Credit)",
        amount=Decimal("-393.79"),
        category=cat,
        rule=rule,
    )
    later_to = Transaction.objects.create(
        account=card,
        date=date(2026, 4, 28),
        payee="Care Credit (Care Credit)",
        amount=Decimal("393.79"),
        rule=rule,
    )

    r = auth_client.patch(
        f"/api/transactions/{from_leg.id}/",
        {"date": "2026-03-26"},
        format="json",
    )
    assert r.status_code == 200, r.data
    assert r.data.get("synced_to_account_id") == card.id

    from_leg.refresh_from_db()
    later_to.refresh_from_db()
    assert from_leg.date == date(2026, 3, 26)
    assert later_to.date == date(2026, 4, 28)

    new_to = Transaction.objects.get(
        rule=rule,
        account=card,
        date=date(2026, 3, 26),
        amount=Decimal("393.79"),
    )
    assert new_to.pk != later_to.pk


@pytest.mark.django_db
def test_patch_date_deletes_extra_counterparty_rows_on_old_date(auth_client, household):
    """Only one leg pair is synced; duplicate +amount rows on the old date must be removed."""
    bank = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Chase",
        currency="USD",
    )
    card = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        name="Savor",
        currency="USD",
    )
    cat = Category.objects.get_or_create(
        household=household,
        name="Credit Card Payment",
        category_type=Category.CategoryType.EXPENSE,
        defaults={"sort_order": 1},
    )[0]
    rule = RecurringRule.objects.create(
        household=household,
        name="Savor Pmt for Med Ins",
        account=bank,
        transfer_to_account=card,
        category=cat,
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("620.00"),
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=29,
        start_date=date(2026, 1, 1),
        active=True,
    )
    from_leg = Transaction.objects.create(
        account=bank,
        date=date(2026, 3, 29),
        payee="Savor Pmt for Med Ins (Savor)",
        amount=Decimal("-620.00"),
        category=cat,
        rule=rule,
    )
    Transaction.objects.create(
        account=card,
        date=date(2026, 3, 29),
        payee="Savor Pmt for Med Ins",
        amount=Decimal("620.00"),
        rule=rule,
    )
    Transaction.objects.create(
        account=card,
        date=date(2026, 3, 29),
        payee="Savor Pmt for Med Ins",
        amount=Decimal("620.00"),
        rule=rule,
    )

    r = auth_client.patch(
        f"/api/transactions/{from_leg.id}/",
        {"date": "2026-03-26"},
        format="json",
    )
    assert r.status_code == 200, r.data

    assert not Transaction.objects.filter(rule=rule, date=date(2026, 3, 29)).exists()
    assert Transaction.objects.filter(rule=rule, account=bank, date=date(2026, 3, 26), amount=Decimal("-620.00")).count() == 1
    assert Transaction.objects.filter(rule=rule, account=card, date=date(2026, 3, 26), amount=Decimal("620.00")).count() == 1


@pytest.mark.django_db
def test_patch_imported_date_moves_matched_planned_row_same_account(auth_client, household):
    """Editing the Plaid row's date must not delete the matched forecast row on Chase (same account)."""
    bank = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Chase",
        currency="USD",
    )
    card = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        name="Care Credit",
        currency="USD",
    )
    cat = Category.objects.create(
        household=household,
        name="Credit Card Payment",
        category_type=Category.CategoryType.EXPENSE,
        sort_order=1,
    )
    rule = RecurringRule.objects.create(
        household=household,
        name="Care payment",
        account=bank,
        transfer_to_account=card,
        category=cat,
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("393.79"),
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=28,
        start_date=date(2026, 1, 1),
        active=True,
    )
    planned = Transaction.objects.create(
        account=bank,
        date=date(2026, 7, 28),
        payee="Care Credit (Care Credit)",
        amount=Decimal("-393.79"),
        category=cat,
        rule=rule,
        source=Transaction.Source.RULE,
    )
    imported = Transaction.objects.create(
        account=bank,
        date=date(2026, 7, 28),
        payee="SYNCHRONY PAYMENT",
        amount=Decimal("-393.79"),
        category=cat,
        rule=rule,
        source=Transaction.Source.PLAID,
        plaid_transaction_id="plaid-care-sync-test",
        import_match_status=Transaction.ImportMatchStatus.MATCHED,
    )
    TransactionMatch.objects.create(
        planned_transaction=planned,
        imported_transaction=imported,
        match_type=TransactionMatch.MatchType.MANUAL,
        score=100,
        confidence=TransactionMatch.Confidence.MANUAL,
    )
    Transaction.objects.create(
        account=card,
        date=date(2026, 7, 28),
        payee="Care Credit",
        amount=Decimal("393.79"),
        category=cat,
        rule=rule,
        source=Transaction.Source.RULE,
    )

    r = auth_client.patch(
        f"/api/transactions/{imported.id}/",
        {"date": "2026-07-29"},
        format="json",
    )
    assert r.status_code == 200, getattr(r, "data", r.content)
    planned.refresh_from_db()
    imported.refresh_from_db()
    assert planned.date == date(2026, 7, 29)
    assert imported.date == date(2026, 7, 29)
    assert Transaction.objects.filter(pk=planned.pk).exists()
