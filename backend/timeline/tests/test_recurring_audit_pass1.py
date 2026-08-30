"""Rules summary / occurrences / payment_status contract."""
from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Account
from bills.recurring_payment_status import derive_recurring_payment_status
from categories.models import Category
from categories.semantics import SYSTEM_CODE_BANK_TRANSFER
from core.models import Household, HouseholdMembership
from django.contrib.auth import get_user_model
from timeline.models import RecurringRule

User = get_user_model()


@pytest.fixture
def auth_client(db):
    user = User.objects.create_user(username="rules-audit", password="x")
    household = Household.objects.create(name="Rules Audit")
    HouseholdMembership.objects.create(
        user=user, household=household, role=HouseholdMembership.Role.OWNER
    )
    account = Account.objects.create(
        household=household,
        name="Checking",
        account_type=Account.AccountType.CHECKING,
        currency="USD",
    )
    cat, _ = Category.objects.get_or_create(
        household=household,
        name="Streaming",
        category_type=Category.CategoryType.EXPENSE,
        parent=None,
        defaults={"is_system": True, "sort_order": 180},
    )
    client = APIClient()
    client.force_authenticate(user=user)
    return client, household, account, cat


def test_derive_advances_past_settled_past_due(db, auth_client):
    _client, household, account, cat = auth_client
    today = date(2026, 5, 28)
    rule = RecurringRule.objects.create(
        household=household,
        name="Netflix",
        account=account,
        category=cat,
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("15.99"),
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=1,
        start_date=date(2025, 1, 1),
        active=True,
    )
    occ = {
        "due_date": "2026-05-01",
        "status": "paid",
        "matched_transaction_id": 1,
        "transaction_id": 1,
        "skipped": False,
    }
    status = derive_recurring_payment_status(rule, occ, today=today)
    # Next charge is June 1 — within backend due-soon window from May 28
    assert status == "due_soon"


def test_rules_summary_and_occurrences_endpoints(auth_client):
    client, household, account, cat = auth_client
    RecurringRule.objects.create(
        household=household,
        name="Netflix",
        account=account,
        category=cat,
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("15.99"),
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=timezone.localdate().day,
        start_date=timezone.localdate() - timedelta(days=60),
        active=True,
    )
    summary = client.get("/api/rules/summary/")
    assert summary.status_code == 200
    body = summary.json()
    assert "active_rule_count" in body
    assert "monthly_recurring_obligations" in body
    assert "missed_count" in body
    assert "due_soon_count" in body
    assert "due_soon_days" in body

    rules = client.get("/api/rules/")
    assert rules.status_code == 200
    rule_row = rules.json()["results"][0]
    assert "next_occurrence_date" in rule_row
    assert "payment_status" in rule_row
    assert "estimated_monthly_amount" in rule_row

    rule_id = rule_row["id"]
    occ = client.get(f"/api/rules/{rule_id}/occurrences/", {"limit": 5})
    assert occ.status_code == 200
    payload = occ.json()
    assert "rule" in payload
    assert "upcoming_occurrences" in payload
    assert len(payload["upcoming_occurrences"]) <= 5


def test_scheduled_change_rejects_past_effective_date(auth_client):
    client, household, account, cat = auth_client
    rule = RecurringRule.objects.create(
        household=household,
        name="Gym",
        account=account,
        category=cat,
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("40.00"),
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=10,
        start_date=date(2025, 1, 1),
        active=True,
    )
    yesterday = (timezone.localdate() - timedelta(days=1)).isoformat()
    resp = client.patch(
        f"/api/rules/{rule.id}/",
        {"amount": "50.00", "change_effective_date": yesterday},
        format="json",
    )
    assert resp.status_code == 400
    assert "change_effective_date" in resp.json()


def test_transfer_category_clears_destination_without_system_code(auth_client):
    client, household, account, cat = auth_client
    dest = Account.objects.create(
        household=household,
        name="Savings",
        account_type=Account.AccountType.SAVINGS,
        currency="USD",
    )
    bank, _ = Category.objects.get_or_create(
        household=household,
        name="Bank Transfer",
        category_type=Category.CategoryType.EXPENSE,
        parent=None,
        defaults={
            "system_code": SYSTEM_CODE_BANK_TRANSFER,
            "is_system": True,
            "sort_order": 169,
        },
    )
    if bank.system_code != SYSTEM_CODE_BANK_TRANSFER:
        bank.system_code = SYSTEM_CODE_BANK_TRANSFER
        bank.save(update_fields=["system_code", "updated_at"])
    rule = RecurringRule.objects.create(
        household=household,
        name="Move",
        account=account,
        transfer_to_account=dest,
        category=bank,
        direction=RecurringRule.Direction.TRANSFER,
        amount=Decimal("100.00"),
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=1,
        start_date=date(2025, 1, 1),
        active=True,
    )
    # Switch to shopping — destination must clear
    resp = client.patch(
        f"/api/rules/{rule.id}/",
        {"category_id": cat.id, "direction": "EXPENSE"},
        format="json",
    )
    assert resp.status_code == 200
    assert resp.json()["transfer_to_account"] is None
