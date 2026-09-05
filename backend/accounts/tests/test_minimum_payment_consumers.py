"""Account API, migration backfill, and consumer consistency for effective minimums."""
from datetime import date
from decimal import Decimal

import importlib.util
from pathlib import Path

import pytest
from django.apps import apps

from accounts.models import Account
from accounts.services.account_health import _credit_card_health
from accounts.services.account_health_constants import REASON_MINIMUM_PAYMENT_UNAVAILABLE
from accounts.services.autopay import _autopay_amount
from accounts.services.minimum_payment import MODE_AUTOMATIC, MODE_MANUAL, apply_plaid_credit_liability
from affordability.models import DtiDebtItem, DtiIncomeSource, DtiProfile
from affordability.services.dti import (
    enrich_debt,
    load_dti_records,
    resolve_effective_monthly_payment,
    snapshot_from_account,
)
from credit_cards.services.debt_engine import _minimum_payment
from django.utils import timezone
from types import SimpleNamespace


@pytest.fixture
def auth_client(api_client, user):
    api_client.force_authenticate(user=user)
    return api_client


@pytest.mark.django_db
def test_migration_preserves_positive_credit_minimums_as_manual(household):
    card = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        name="Legacy card",
        minimum_payment_amount=Decimal("35.00"),
    )
    checking = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Checking",
        minimum_payment_amount=Decimal("0"),
    )
    Account.objects.filter(pk=card.pk).update(
        manual_minimum_payment_amount=None,
        minimum_payment_mode=MODE_AUTOMATIC,
        provider_minimum_payment_amount=None,
    )
    migration_path = (
        Path(__file__).resolve().parents[1]
        / "migrations"
        / "0025_account_minimum_payment_source_fields.py"
    )
    spec = importlib.util.spec_from_file_location("minpay_migration_0025", migration_path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    mod.backfill_existing_credit_minimums(apps, None)
    card.refresh_from_db()
    checking.refresh_from_db()
    assert card.minimum_payment_amount == Decimal("35.00")
    assert card.manual_minimum_payment_amount == Decimal("35.00")
    assert card.minimum_payment_mode == MODE_MANUAL
    assert card.provider_minimum_payment_amount is None
    assert checking.minimum_payment_mode == MODE_MANUAL
    assert checking.manual_minimum_payment_amount is None


@pytest.mark.django_db
def test_account_serializer_exposes_source_fields(auth_client, household):
    card = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        name="Visa",
        minimum_payment_amount=Decimal("25.00"),
        manual_minimum_payment_amount=Decimal("25.00"),
        minimum_payment_mode=MODE_MANUAL,
    )
    resp = auth_client.get(f"/api/accounts/{card.pk}/")
    assert resp.status_code == 200
    data = resp.json()
    assert data["minimum_payment_amount"] == "25.00"
    assert data["effective_minimum_payment_amount"] == "25.00"
    assert data["minimum_payment_mode"] == "manual"
    assert data["minimum_payment_source"] == "manual"
    assert data["manual_minimum_payment_amount"] == "25.00"


@pytest.mark.django_db
def test_switching_modes_preserves_both_values(auth_client, household):
    card = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        name="Visa",
        current_balance=Decimal("400.00"),
        statement_balance=Decimal("400.00"),
        minimum_payment_mode=MODE_AUTOMATIC,
    )
    apply_plaid_credit_liability(
        card,
        SimpleNamespace(
            minimum_payment_amount=86.0,
            last_statement_balance=400.0,
            last_statement_issue_date=None,
            next_payment_due_date=None,
        ),
        observed_at=timezone.now(),
    )
    resp = auth_client.patch(
        f"/api/accounts/{card.pk}/",
        {
            "minimum_payment_mode": "manual",
            "manual_minimum_payment_amount": "100.00",
        },
        format="json",
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["effective_minimum_payment_amount"] == "100.00"
    assert data["provider_minimum_payment_amount"] == "86.00"
    resp = auth_client.patch(
        f"/api/accounts/{card.pk}/",
        {"minimum_payment_mode": "automatic"},
        format="json",
    )
    data = resp.json()
    assert data["effective_minimum_payment_amount"] == "86.00"
    assert data["manual_minimum_payment_amount"] == "100.00"


@pytest.mark.django_db
def test_dti_planner_autopay_health_share_effective_minimum(household):
    card = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        name="Visa",
        current_balance=Decimal("400.00"),
        statement_balance=Decimal("400.00"),
        minimum_payment_mode=MODE_AUTOMATIC,
        autopay_type=Account.AutopayType.MINIMUM_PAYMENT,
        next_payment_due_date=timezone.localdate(),
    )
    apply_plaid_credit_liability(
        card,
        SimpleNamespace(
            minimum_payment_amount=86.0,
            last_statement_balance=400.0,
            last_statement_issue_date=None,
            next_payment_due_date=None,
        ),
        observed_at=timezone.now(),
    )
    card.refresh_from_db()
    snap = snapshot_from_account(card)
    dti_min = resolve_effective_monthly_payment(
        monthly_payment=Decimal("0"),
        payment_source="linked_account_minimum",
        account=snap,
    )
    planner_min = _minimum_payment(card, Decimal("400.00"))
    autopay_min = _autopay_amount(card)
    _status, _reason, reason_code, _risk, _details = _credit_card_health(
        card,
        date.today(),
        owed_balance=Decimal("400.00"),
        unmatched_import_count=0,
        has_payment_link=True,
        payments_since_statement=Decimal("0"),
    )
    assert dti_min == Decimal("86.00")
    assert planner_min == Decimal("86.00")
    assert autopay_min == Decimal("86.00")
    assert reason_code != REASON_MINIMUM_PAYMENT_UNAVAILABLE


@pytest.mark.django_db
def test_missing_minimum_is_not_silent_zero(household):
    card = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        name="Visa",
        current_balance=Decimal("400.00"),
        statement_balance=Decimal("400.00"),
        minimum_payment_mode=MODE_AUTOMATIC,
        autopay_type=Account.AutopayType.MINIMUM_PAYMENT,
    )
    snap = snapshot_from_account(card)
    dti_min = resolve_effective_monthly_payment(
        monthly_payment=Decimal("0"),
        payment_source="linked_account_minimum",
        account=snap,
    )
    assert dti_min == Decimal("0")
    assert snap.minimum_payment_amount is None
    assert _minimum_payment(card, Decimal("400.00")) == Decimal("0")
    assert _autopay_amount(card) == Decimal("0")
    _status, _reason, reason_code, _risk, _details = _credit_card_health(
        card,
        date.today(),
        owed_balance=Decimal("400.00"),
        unmatched_import_count=0,
        has_payment_link=True,
        payments_since_statement=Decimal("0"),
    )
    assert reason_code == REASON_MINIMUM_PAYMENT_UNAVAILABLE


@pytest.mark.django_db
def test_dti_uses_resolved_minimum_immediately(household, user):
    card = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        name="Visa",
        current_balance=Decimal("400.00"),
        minimum_payment_mode=MODE_AUTOMATIC,
    )
    DtiProfile.objects.create(household=household, current_housing_payment=Decimal("0"))
    DtiIncomeSource.objects.create(
        household=household,
        name="Job",
        gross_monthly_amount=Decimal("5000.00"),
        included=True,
    )
    DtiDebtItem.objects.create(
        household=household,
        name="Visa",
        debt_type="credit_card",
        monthly_payment=Decimal("0"),
        payment_source="linked_account_minimum",
        linked_account=card,
        included=True,
        outstanding_balance=Decimal("400.00"),
    )
    apply_plaid_credit_liability(
        card,
        SimpleNamespace(
            minimum_payment_amount=86.0,
            last_statement_balance=400.0,
            last_statement_issue_date=None,
            next_payment_due_date=None,
        ),
        observed_at=timezone.now(),
    )
    _profile, _income, debts, _suggestions = load_dti_records(household)
    enriched = enrich_debt(debts[0])
    assert enriched.effective_monthly_payment == Decimal("86.00")
    assert enriched.linked_account.minimum_payment_source == "plaid"
