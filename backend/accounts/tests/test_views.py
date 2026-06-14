"""Tests for account API saving interest_rate and interest_cycle_end_day."""
from decimal import Decimal

import pytest
from rest_framework.test import APIClient

from core.models import Household, HouseholdMembership
from accounts.models import Account

from django.contrib.auth import get_user_model

User = get_user_model()


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def user(db):
    return User.objects.create_user(username="testuser", password="testpass123")


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="Test Household")
    HouseholdMembership.objects.create(household=h, user=user, role=HouseholdMembership.Role.OWNER)
    return h


@pytest.fixture
def auth_client(api_client, user):
    api_client.force_authenticate(user=user)
    return api_client


def test_create_savings_account_saves_interest_rate_and_cycle_day(auth_client, household):
    """POST with interest_rate and interest_cycle_end_day must persist them."""
    payload = {
        "household": household.id,
        "name": "My Savings",
        "account_type": "SAVINGS",
        "currency": "USD",
        "interest_rate": "4.50",
        "interest_cycle_end_day": 15,
    }
    r = auth_client.post("/api/accounts/", payload, format="json")
    assert r.status_code == 201, r.data
    data = r.json()
    assert data.get("interest_rate") is not None
    assert float(data["interest_rate"]) == 4.5
    assert data.get("interest_cycle_end_day") == 15

    # Refetch and verify persisted
    acc_id = data["id"]
    r2 = auth_client.get(f"/api/accounts/{acc_id}/")
    assert r2.status_code == 200
    data2 = r2.json()
    assert float(data2["interest_rate"]) == 4.5
    assert data2["interest_cycle_end_day"] == 15


def test_patch_savings_account_updates_interest_rate_and_cycle_day(auth_client, household):
    """PATCH with interest_rate and interest_cycle_end_day must update them."""
    acc = Account.objects.create(
        household=household,
        account_type=Account.AccountType.SAVINGS,
        name="Savings",
        currency="USD",
    )
    payload = {
        "interest_rate": "5.25",
        "interest_cycle_end_day": 1,
    }
    r = auth_client.patch(f"/api/accounts/{acc.id}/", payload, format="json")
    assert r.status_code == 200, r.data
    data = r.json()
    assert float(data["interest_rate"]) == 5.25
    assert data["interest_cycle_end_day"] == 1

    acc.refresh_from_db()
    assert float(acc.interest_rate) == 5.25
    assert acc.interest_cycle_end_day == 1


def test_create_checking_account_accepts_null_credit_card_amounts(auth_client, household):
    """Frontend sends null for credit-only balance fields on non-credit creates."""
    payload = {
        "household": household.id,
        "name": "Main Checking",
        "account_type": "CHECKING",
        "currency": "USD",
        "role": "spending",
        "minimum_buffer": "0",
        "current_balance": None,
        "statement_balance": None,
        "minimum_payment_amount": None,
        "autopay_fixed_amount": None,
        "autopay_enabled": False,
        "autopay_type": "",
    }
    r = auth_client.post("/api/accounts/", payload, format="json")
    assert r.status_code == 201, r.data


def test_create_checking_account_infers_spending_role(auth_client, household):
    payload = {
        "household": household.id,
        "name": "Main Checking",
        "account_type": "CHECKING",
        "currency": "USD",
    }
    r = auth_client.post("/api/accounts/", payload, format="json")
    assert r.status_code == 201, r.data
    data = r.json()
    assert data["role"] == "spending"
    assert data["role_display"] == "Spending"
    assert data["minimum_buffer"] == "0"


def test_create_account_with_explicit_role_and_minimum_buffer(auth_client, household):
    payload = {
        "household": household.id,
        "name": "Emergency",
        "account_type": "SAVINGS",
        "currency": "USD",
        "role": "emergency_fund",
        "minimum_buffer": "500.00",
    }
    r = auth_client.post("/api/accounts/", payload, format="json")
    assert r.status_code == 201, r.data
    data = r.json()
    assert data["role"] == "emergency_fund"
    assert data["role_display"] == "Emergency Fund"
    assert float(data["minimum_buffer"]) == 500.0


def test_patch_account_updates_role(auth_client, household):
    acc = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Checking",
        currency="USD",
        role=Account.AccountRole.SPENDING,
    )
    r = auth_client.patch(
        f"/api/accounts/{acc.id}/",
        {"role": "bills", "minimum_buffer": "100.00"},
        format="json",
    )
    assert r.status_code == 200, r.data
    data = r.json()
    assert data["role"] == "bills"
    assert data["role_display"] == "Bills"
    assert float(data["minimum_buffer"]) == 100.0

    acc.refresh_from_db()
    assert acc.role == Account.AccountRole.BILLS
    assert float(acc.minimum_buffer) == 100.0


def test_patch_checking_account_with_null_credit_fields(auth_client, household):
    """Edit payload for non-credit accounts may send null credit-only fields."""
    acc = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Checking",
        currency="USD",
    )
    payload = {
        "name": "Checking",
        "account_type": "CHECKING",
        "role": "spending",
        "minimum_buffer": "0",
        "currency": "USD",
        "target_utilization_percent": None,
        "credit_limit": None,
        "apr": None,
        "interest_rate": None,
        "interest_cycle_end_day": None,
        "billing_cycle_end_day": None,
        "statement_closing_day": None,
        "payment_due_day": None,
        "promotional_apr": None,
        "promotional_end_date": None,
    }
    r = auth_client.patch(f"/api/accounts/{acc.id}/", payload, format="json")
    assert r.status_code == 200, r.data


def test_patch_include_in_forecast_only(auth_client, household):
    acc = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Checking",
        currency="USD",
    )
    r = auth_client.patch(
        f"/api/accounts/{acc.id}/",
        {"include_in_forecast": False},
        format="json",
    )
    assert r.status_code == 200, r.data
    acc.refresh_from_db()
    assert acc.include_in_forecast is False


def test_patch_credit_toggle_forecast_ignores_stale_invalid_autopay(auth_client, household):
    """Partial toggles must not fail when stored autopay_account is invalid."""
    card = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        name="Visa",
        currency="USD",
    )
    card.autopay_account = card
    card.save(update_fields=["autopay_account"])
    r = auth_client.patch(
        f"/api/accounts/{card.id}/",
        {"include_in_forecast": False},
        format="json",
    )
    assert r.status_code == 200, r.data


def test_patch_credit_full_edit_clears_stale_invalid_autopay(auth_client, household):
    """Full account edit (Save modal) must succeed when clearing a bad autopay_account."""
    card = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        name="Savor",
        currency="USD",
    )
    card.autopay_account = card
    card.save(update_fields=["autopay_account"])
    payload = {
        "name": "Savor",
        "display_name": "",
        "purpose": "",
        "notes": "",
        "account_type": "CREDIT",
        "role": "credit_card",
        "minimum_buffer": "0",
        "institution": "",
        "last_four": "",
        "currency": "USD",
        "starting_balance": "500.00",
        "apr": None,
        "interest_rate": None,
        "interest_cycle_end_day": None,
        "credit_limit": None,
        "target_utilization_percent": "10",
        "billing_cycle_end_day": None,
        "statement_closing_day": None,
        "payment_due_day": None,
        "autopay_enabled": False,
        "autopay_account": None,
        "autopay_type": "minimum_payment",
        "promotional_apr": None,
        "promotional_end_date": None,
        "preserve_partner_transfer_legs": False,
        "include_in_available_credit": True,
    }
    r = auth_client.patch(f"/api/accounts/{card.id}/", payload, format="json")
    assert r.status_code == 200, r.data
    card.refresh_from_db()
    assert card.starting_balance == Decimal("500.00")
    assert card.autopay_account_id is None


def test_create_credit_account_infers_credit_card_role(auth_client, household):
    payload = {
        "household": household.id,
        "name": "Visa",
        "account_type": "CREDIT",
        "currency": "USD",
    }
    r = auth_client.post("/api/accounts/", payload, format="json")
    assert r.status_code == 201, r.data
    assert r.json()["role"] == "credit_card"


def test_infer_role_from_account_type():
    assert Account.infer_role_from_account_type(Account.AccountType.CHECKING) == Account.AccountRole.SPENDING
    assert Account.infer_role_from_account_type(Account.AccountType.SAVINGS) == Account.AccountRole.SAVINGS
    assert Account.infer_role_from_account_type(Account.AccountType.CREDIT) == Account.AccountRole.CREDIT_CARD
    assert Account.infer_role_from_account_type(Account.AccountType.CASH) == Account.AccountRole.OTHER


def test_retrieve_account_includes_balance_when_requested(auth_client, household):
    from decimal import Decimal
    from transactions.models import Transaction

    acc = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Checking",
        currency="USD",
        starting_balance=Decimal("1000.00"),
    )
    Transaction.objects.create(
        account=acc,
        date="2026-01-15",
        payee="Deposit",
        amount=Decimal("250.50"),
    )
    r = auth_client.get(f"/api/accounts/{acc.id}/?balance=true")
    assert r.status_code == 200, r.data
    data = r.json()
    assert float(data["balance"]) == 1250.50
    assert float(data["available_balance"]) == 1250.50


def test_balance_excludes_superseded_planned_duplicate(auth_client, household):
    """Planned row hidden when same-day cleared posting exists — matches ledger UI."""
    from decimal import Decimal
    from datetime import date
    from transactions.models import Transaction

    acc = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Main",
        currency="USD",
        starting_balance=Decimal("500.00"),
    )
    pay_date = date.today().isoformat()
    Transaction.objects.create(
        account=acc,
        date=pay_date,
        payee="Amazon",
        amount=Decimal("-100.00"),
        status=Transaction.Status.CLEARED,
    )
    Transaction.objects.create(
        account=acc,
        date=pay_date,
        payee="Amazon (Amazon)",
        amount=Decimal("-100.00"),
        status=Transaction.Status.PLANNED,
    )
    r = auth_client.get(f"/api/accounts/{acc.id}/?balance=true")
    assert r.status_code == 200, r.data
    assert float(r.json()["balance"]) == 400.00


def test_credit_balance_owed_uses_ledger_when_db_stale(auth_client, household, user):
    """Accounts list owed/utilization must match transaction ledger, not stale current_balance."""
    from decimal import Decimal
    from datetime import date

    from transactions.services.posting import post_transaction

    card = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        name="Test Card",
        credit_limit=Decimal("1000.00"),
        current_balance=Decimal("0"),
    )
    post_transaction(
        user,
        card.id,
        date.today(),
        "Purchase",
        Decimal("-200.00"),
    )
    card.refresh_from_db()
    assert card.current_balance == Decimal("200.00")

    Account.objects.filter(pk=card.pk).update(current_balance=Decimal("800.00"))

    r = auth_client.get(f"/api/accounts/{card.id}/?balance=true")
    assert r.status_code == 200, r.data
    data = r.json()
    assert float(data["balance_owed"]) == 200.00
    assert float(data["utilization_percent"]) == 20.00
    assert float(data["available_credit"]) == 800.00
