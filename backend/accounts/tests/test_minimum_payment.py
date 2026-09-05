"""Canonical credit-card minimum-payment policy."""
from datetime import timedelta
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from django.utils import timezone

from accounts.models import Account
from accounts.services.minimum_payment import (
    MODE_AUTOMATIC,
    MODE_MANUAL,
    SOURCE_MANUAL,
    SOURCE_PLAID,
    apply_plaid_credit_liability,
    apply_user_minimum_settings,
    is_provider_zero_usable,
    resolve_effective_minimum_payment,
)


@pytest.fixture
def credit_card(household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        name="Visa",
        currency="USD",
        current_balance=Decimal("500.00"),
        statement_balance=Decimal("400.00"),
        minimum_payment_mode=MODE_AUTOMATIC,
    )


def _liability(**kwargs):
    defaults = {
        "account_id": "plaid-card-1",
        "minimum_payment_amount": 86.0,
        "last_statement_balance": 400.0,
        "last_statement_issue_date": None,
        "next_payment_due_date": None,
    }
    defaults.update(kwargs)
    return SimpleNamespace(**defaults)


@pytest.mark.django_db
def test_provider_zero_usable_when_paid_off():
    assert is_provider_zero_usable(
        provider_minimum=Decimal("0.00"),
        statement_balance=Decimal("0"),
        current_owed=Decimal("0"),
    )
    assert not is_provider_zero_usable(
        provider_minimum=Decimal("0.00"),
        statement_balance=Decimal("100.00"),
        current_owed=Decimal("100.00"),
    )
    assert not is_provider_zero_usable(provider_minimum=None, statement_balance=Decimal("0"))
    assert is_provider_zero_usable(provider_minimum=Decimal("25.00"), current_owed=Decimal("400"))


@pytest.mark.django_db
def test_automatic_mode_uses_valid_provider_minimum(credit_card):
    apply_plaid_credit_liability(
        credit_card, _liability(minimum_payment_amount=86.0), observed_at=timezone.now()
    )
    credit_card.refresh_from_db()
    resolved = resolve_effective_minimum_payment(credit_card)
    assert resolved.amount == Decimal("86.00")
    assert resolved.source == SOURCE_PLAID
    assert isinstance(credit_card.provider_minimum_payment_amount, Decimal)


@pytest.mark.django_db
def test_manual_mode_preserves_effective_during_plaid_update(credit_card):
    apply_plaid_credit_liability(
        credit_card, _liability(minimum_payment_amount=86.0), observed_at=timezone.now()
    )
    apply_user_minimum_settings(
        credit_card, mode=MODE_MANUAL, manual_amount=Decimal("100.00"), set_manual=True
    )
    apply_plaid_credit_liability(
        credit_card, _liability(minimum_payment_amount=72.0), observed_at=timezone.now()
    )
    credit_card.refresh_from_db()
    resolved = resolve_effective_minimum_payment(credit_card)
    assert credit_card.provider_minimum_payment_amount == Decimal("72.00")
    assert resolved.amount == Decimal("100.00")
    assert resolved.source == SOURCE_MANUAL
    apply_user_minimum_settings(credit_card, mode=MODE_AUTOMATIC)
    credit_card.refresh_from_db()
    resolved = resolve_effective_minimum_payment(credit_card)
    assert resolved.amount == Decimal("72.00")
    assert resolved.source == SOURCE_PLAID


@pytest.mark.django_db
def test_null_plaid_minimum_does_not_erase_previous(credit_card):
    apply_plaid_credit_liability(
        credit_card, _liability(minimum_payment_amount=86.0), observed_at=timezone.now()
    )
    apply_plaid_credit_liability(
        credit_card, _liability(minimum_payment_amount=None), observed_at=timezone.now()
    )
    credit_card.refresh_from_db()
    assert credit_card.provider_minimum_payment_amount == Decimal("86.00")
    assert resolve_effective_minimum_payment(credit_card).amount == Decimal("86.00")


@pytest.mark.django_db
def test_zero_with_balance_preserves_last_usable_and_warns(credit_card):
    apply_plaid_credit_liability(
        credit_card, _liability(minimum_payment_amount=86.0), observed_at=timezone.now()
    )
    result = apply_plaid_credit_liability(
        credit_card,
        _liability(minimum_payment_amount=0.0, last_statement_balance=400.0),
        observed_at=timezone.now(),
        current_owed=Decimal("400.00"),
    )
    credit_card.refresh_from_db()
    assert credit_card.provider_minimum_payment_amount == Decimal("86.00")
    assert result["warning"]["code"] == "provider_minimum_zero_with_balance"
    assert resolve_effective_minimum_payment(credit_card).amount == Decimal("86.00")


@pytest.mark.django_db
def test_explicit_zero_on_paid_off_card_is_effective(household):
    card = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        name="Paid off",
        currency="USD",
        current_balance=Decimal("0.00"),
        statement_balance=Decimal("0.00"),
        minimum_payment_mode=MODE_AUTOMATIC,
    )
    apply_plaid_credit_liability(
        card,
        _liability(minimum_payment_amount=0.0, last_statement_balance=0.0),
        observed_at=timezone.now(),
        current_owed=Decimal("0.00"),
    )
    card.refresh_from_db()
    resolved = resolve_effective_minimum_payment(card, current_owed=Decimal("0.00"))
    assert resolved.amount == Decimal("0.00")
    assert resolved.source == SOURCE_PLAID


@pytest.mark.django_db
def test_missing_effective_minimum_is_not_usable_zero(credit_card):
    resolved = resolve_effective_minimum_payment(credit_card)
    assert resolved.amount is None
    assert not resolved.usable


@pytest.mark.django_db
def test_stale_provider_value_remains_usable(credit_card, settings):
    settings.MINIMUM_PAYMENT_FRESHNESS_DAYS = 45
    observed = timezone.now() - timedelta(days=60)
    apply_plaid_credit_liability(
        credit_card, _liability(minimum_payment_amount=86.0), observed_at=observed
    )
    credit_card.refresh_from_db()
    resolved = resolve_effective_minimum_payment(credit_card)
    assert resolved.amount == Decimal("86.00")
    assert resolved.freshness == "stale"
    assert resolved.warning_code == "provider_minimum_stale"


@pytest.mark.django_db
@pytest.mark.django_db(transaction=True)
def test_metadata_change_without_effective_change_skips_financial_invalidation(credit_card):
    apply_plaid_credit_liability(
        credit_card, _liability(minimum_payment_amount=86.0), observed_at=timezone.now()
    )
    with patch("common.services.cache.invalidate_financial_cache_for_household") as mock_inv:
        apply_plaid_credit_liability(
            credit_card, _liability(minimum_payment_amount=86.0), observed_at=timezone.now()
        )
        mock_inv.assert_not_called()


@pytest.mark.django_db
@pytest.mark.django_db(transaction=True)
def test_effective_change_invalidates_after_commit(credit_card):
    with patch("common.services.cache.invalidate_financial_cache_for_household") as mock_inv:
        apply_plaid_credit_liability(
            credit_card, _liability(minimum_payment_amount=86.0), observed_at=timezone.now()
        )
        mock_inv.assert_called_once_with(credit_card.household_id)
