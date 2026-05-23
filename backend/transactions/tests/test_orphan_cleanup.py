"""Bulk cleanup of orphaned rule materializations (source=RULE, rule_id=NULL)."""
from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Account
from categories.models import Category
from core.models import Household, HouseholdMembership
from transactions.models import Transaction

User = get_user_model()


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def user(db):
    return User.objects.create_user(username="orphan_u", password="pass12345")


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="H")
    HouseholdMembership.objects.create(household=h, user=user, role=HouseholdMembership.Role.OWNER)
    return h


@pytest.mark.django_db
def test_cleanup_orphaned_rule_rows_endpoint(api_client, user, household):
    api_client.force_authenticate(user=user)
    acct = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Checking",
        currency="USD",
    )
    cat = Category.objects.create(
        household=household,
        name="Ins",
        category_type=Category.CategoryType.EXPENSE,
        sort_order=1,
    )
    today = timezone.localdate()
    orphan = Transaction.objects.create(
        account=acct,
        date=today + timedelta(days=10),
        payee="Progressive",
        amount=Decimal("-300.00"),
        category=cat,
        source=Transaction.Source.RULE,
        rule_id=None,
    )
    keep_past = Transaction.objects.create(
        account=acct,
        date=today - timedelta(days=1),
        payee="Progressive",
        amount=Decimal("-300.00"),
        category=cat,
        source=Transaction.Source.RULE,
        rule_id=None,
    )
    r = api_client.post("/api/transactions/cleanup-orphaned-rule-rows/")
    assert r.status_code == 200
    assert r.data["deleted"] >= 1
    assert not Transaction.objects.filter(pk=orphan.pk).exists()
    assert Transaction.objects.filter(pk=keep_past.pk).exists()
