"""DELETE /api/accounts/:id/ permanently purges; soft-delete endpoint preserves history."""
from datetime import date
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from accounts.models import Account
from core.models import Household, HouseholdMembership, UserProfile
from transactions.models import Transaction
from transactions.services import create_transfer
from timeline.models import (
    RecurringRule,
    ReconciliationMatch,
    Scenario,
    ScenarioRuleOverride,
    StatementTransaction,
)

User = get_user_model()


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def user(db):
    return User.objects.create_user(username="delacctuser", password="testpass123")


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="Del Acct HH")
    HouseholdMembership.objects.create(household=h, user=user, role=HouseholdMembership.Role.OWNER)
    return h


@pytest.fixture
def auth_client(api_client, user):
    api_client.force_authenticate(user=user)
    return api_client


@pytest.mark.django_db
def test_delete_account_permanently_purges_and_clears_references(
    auth_client, household, user
):
    checking = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Checking",
        currency="USD",
    )
    savings = Account.objects.create(
        household=household,
        account_type=Account.AccountType.SAVINGS,
        name="Savings",
        currency="USD",
    )

    rule = RecurringRule.objects.create(
        household=household,
        account=checking,
        name="Monthly",
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("100.00"),
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        day_of_month=1,
        start_date=date(2024, 1, 1),
    )
    Transaction.objects.create(
        account=checking,
        date=date(2024, 2, 1),
        payee="Bill",
        amount=Decimal("-100.00"),
        rule=rule,
    )

    create_transfer(user, checking.id, savings.id, Decimal("25.00"), date(2024, 2, 5))
    Transaction.objects.create(
        account=savings,
        date=date(2024, 3, 1),
        payee="Savings-only",
        amount=Decimal("-1.00"),
    )

    st = StatementTransaction.objects.create(
        household=household,
        account=checking,
        posted_date=date(2024, 2, 10),
        description="Stmt line",
        amount=Decimal("-5.00"),
    )
    matched_txn = Transaction.objects.create(
        account=checking,
        date=date(2024, 2, 10),
        payee="Stmt line",
        amount=Decimal("-5.00"),
    )
    ReconciliationMatch.objects.create(
        statement_txn=st,
        matched_transaction=matched_txn,
        status=ReconciliationMatch.Status.MATCHED,
    )

    profile, _ = UserProfile.objects.get_or_create(user=user, defaults={"display_name": "U"})
    profile.default_account = checking
    profile.save(update_fields=["default_account"])

    scenario = Scenario.objects.create(household=household, name="What-if")
    rule_on_savings = RecurringRule.objects.create(
        household=household,
        account=savings,
        name="Savings rule",
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("10.00"),
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        day_of_month=20,
        start_date=date(2024, 1, 1),
    )
    ScenarioRuleOverride.objects.create(
        scenario=scenario,
        rule=rule_on_savings,
        override_account=checking,
    )

    other = RecurringRule.objects.create(
        household=household,
        account=savings,
        name="Pay card",
        direction=RecurringRule.Direction.TRANSFER,
        amount=Decimal("50.00"),
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        day_of_month=15,
        start_date=date(2024, 1, 1),
        transfer_to_account=checking,
    )
    assert other.transfer_to_account_id == checking.id

    r = auth_client.delete(f"/api/accounts/{checking.id}/")
    assert r.status_code == 204, r.content

    assert not Account.all_objects.filter(pk=checking.id).exists()
    assert not Transaction.objects.filter(account_id=checking.id).exists()
    assert not RecurringRule.objects.filter(pk=rule.id).exists()
    assert not StatementTransaction.objects.filter(account_id=checking.id).exists()
    other.refresh_from_db()
    assert other.transfer_to_account_id is None

    profile.refresh_from_db()
    assert profile.default_account_id is None

    ovr = ScenarioRuleOverride.objects.get(scenario=scenario, rule=rule_on_savings)
    assert ovr.override_account_id is None

    assert Account.objects.filter(pk=savings.id).exists()
    assert Transaction.objects.filter(account=savings).exists()


@pytest.mark.django_db
def test_permanent_delete_purges_when_staff(auth_client, household, user):
    user.is_staff = True
    user.save(update_fields=["is_staff"])
    checking = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Purge Me",
        currency="USD",
    )
    Transaction.objects.create(
        account=checking,
        date=date(2024, 1, 1),
        payee="X",
        amount=Decimal("-1"),
    )
    r = auth_client.post(
        f"/api/accounts/{checking.id}/permanent-delete/",
        {"confirm": True},
        format="json",
    )
    assert r.status_code == 204
    assert not Account.all_objects.filter(pk=checking.id).exists()
    assert not Transaction.objects.filter(account_id=checking.id).exists()
