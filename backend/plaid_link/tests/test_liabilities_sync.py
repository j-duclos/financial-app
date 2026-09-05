"""Plaid credit liability sync: identity matching, one call per Item, structured errors."""
from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from django.test import override_settings
from plaid import ApiException
from rest_framework.test import APIClient

from accounts.models import Account
from accounts.services.minimum_payment import MODE_AUTOMATIC, MODE_MANUAL
from core.models import Household, HouseholdMembership
from plaid_link.crypto import encrypt_secret
from plaid_link.liabilities import (
    classify_liabilities_error,
    sync_credit_card_liabilities_for_item,
)
from plaid_link.models import PlaidItem, PlaidLinkedAccount
from django.contrib.auth import get_user_model

User = get_user_model()


@pytest.fixture
def auth_client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _api_exc(code: str, message: str = "err") -> ApiException:
    exc = ApiException.__new__(ApiException)
    exc.body = f'{{"error_code":"{code}","error_message":"{message}"}}'
    exc.status = 400
    return exc


def _liability(account_id, minimum, statement=400.0):
    return SimpleNamespace(
        account_id=account_id,
        minimum_payment_amount=minimum,
        last_statement_balance=statement,
        last_statement_issue_date=date(2026, 8, 22),
        next_payment_due_date=date(2026, 9, 18),
    )


def _account_base(account_id, currency="USD"):
    return SimpleNamespace(
        account_id=account_id,
        balances=SimpleNamespace(iso_currency_code=currency),
        name="SHOULD-NOT-MATCH-BY-NAME",
        mask="9999",
    )


@pytest.fixture
def plaid_setup(household):
    card_a = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        name="Alpha",
        last_four="1111",
        currency="USD",
        current_balance=Decimal("400.00"),
        statement_balance=Decimal("400.00"),
        minimum_payment_mode=MODE_AUTOMATIC,
    )
    card_b = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        name="Beta",
        last_four="2222",
        currency="USD",
        current_balance=Decimal("800.00"),
        statement_balance=Decimal("800.00"),
        minimum_payment_mode=MODE_AUTOMATIC,
    )
    checking = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Checking",
        currency="USD",
    )
    item = PlaidItem.objects.create(
        household=household,
        item_id="item-liab-1",
        access_token_cipher=encrypt_secret("access-sandbox-secret-token"),
        institution_name="Test Bank",
    )
    PlaidLinkedAccount.objects.create(
        item=item, plaid_account_id="plaid-a", mask="1111", account=card_a
    )
    PlaidLinkedAccount.objects.create(
        item=item, plaid_account_id="plaid-b", mask="2222", account=card_b
    )
    PlaidLinkedAccount.objects.create(
        item=item, plaid_account_id="plaid-checking", mask="0000", account=checking
    )
    return item, card_a, card_b, checking


def _mock_client(liabilities, accounts=None):
    client = MagicMock()
    client.liabilities_get.return_value = SimpleNamespace(
        liabilities=SimpleNamespace(credit=liabilities),
        accounts=accounts or [],
    )
    return client


@override_settings(PLAID_ENABLE_LIABILITIES=True)
@pytest.mark.django_db
def test_maps_by_immutable_plaid_account_id(plaid_setup):
    item, card_a, card_b, _checking = plaid_setup
    client = _mock_client(
        [
            _liability("plaid-b", 72.0, 800.0),
            _liability("plaid-a", 86.0, 400.0),
        ],
        accounts=[
            _account_base("plaid-a", "USD"),
            _account_base("plaid-b", "USD"),
        ],
    )
    result = sync_credit_card_liabilities_for_item(item, client=client)
    client.liabilities_get.assert_called_once()
    card_a.refresh_from_db()
    card_b.refresh_from_db()
    assert card_a.minimum_payment_amount == Decimal("86.00")
    assert card_b.minimum_payment_amount == Decimal("72.00")
    assert result["accounts_updated"] == 2
    assert result["status"] == "success"


@override_settings(PLAID_ENABLE_LIABILITIES=True)
@pytest.mark.django_db
def test_does_not_match_by_name_mask_or_order(plaid_setup):
    item, card_a, card_b, _checking = plaid_setup
    # Returned in reverse order, names match the other card, masks swapped.
    client = _mock_client(
        [
            SimpleNamespace(
                account_id="plaid-b",
                minimum_payment_amount=55.0,
                last_statement_balance=800.0,
                last_statement_issue_date=None,
                next_payment_due_date=None,
            ),
            SimpleNamespace(
                account_id="plaid-a",
                minimum_payment_amount=99.0,
                last_statement_balance=400.0,
                last_statement_issue_date=None,
                next_payment_due_date=None,
            ),
        ],
        accounts=[
            SimpleNamespace(
                account_id="plaid-b",
                name="Alpha",
                mask="1111",
                balances=SimpleNamespace(iso_currency_code="USD"),
            ),
            SimpleNamespace(
                account_id="plaid-a",
                name="Beta",
                mask="2222",
                balances=SimpleNamespace(iso_currency_code="USD"),
            ),
        ],
    )
    sync_credit_card_liabilities_for_item(item, client=client)
    card_a.refresh_from_db()
    card_b.refresh_from_db()
    assert card_a.minimum_payment_amount == Decimal("99.00")
    assert card_b.minimum_payment_amount == Decimal("55.00")


@override_settings(PLAID_ENABLE_LIABILITIES=True)
@pytest.mark.django_db
def test_omitted_liability_does_not_zero_minimum(plaid_setup):
    item, card_a, card_b, _checking = plaid_setup
    card_a.provider_minimum_payment_amount = Decimal("86.00")
    card_a.minimum_payment_amount = Decimal("86.00")
    card_a.save()
    client = _mock_client([_liability("plaid-b", 40.0, 800.0)])
    result = sync_credit_card_liabilities_for_item(item, client=client)
    card_a.refresh_from_db()
    assert card_a.minimum_payment_amount == Decimal("86.00")
    assert result["accounts_missing_liability"] == 1
    assert card_a.minimum_payment_amount != Decimal("0")


@override_settings(PLAID_ENABLE_LIABILITIES=True)
@pytest.mark.django_db
def test_archived_and_closed_accounts_are_not_updated(household):
    archived = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        name="Old",
        status=Account.Status.ARCHIVED,
        is_active=False,
        minimum_payment_mode=MODE_AUTOMATIC,
        current_balance=Decimal("100.00"),
    )
    item = PlaidItem.objects.create(
        household=household,
        item_id="item-arch",
        access_token_cipher=encrypt_secret("access-sandbox-secret-token"),
    )
    PlaidLinkedAccount.objects.create(
        item=item, plaid_account_id="plaid-old", account=archived
    )
    client = _mock_client([_liability("plaid-old", 40.0)])
    result = sync_credit_card_liabilities_for_item(item, client=client)
    archived.refresh_from_db()
    assert archived.provider_minimum_payment_amount is None
    assert result["status"] == "no_eligible_accounts"


@override_settings(PLAID_ENABLE_LIABILITIES=True)
@pytest.mark.django_db
def test_unsupported_institution_structured_status(plaid_setup):
    item, card_a, _card_b, _checking = plaid_setup
    client = MagicMock()
    client.liabilities_get.side_effect = _api_exc("PRODUCTS_NOT_SUPPORTED", "not supported")
    result = sync_credit_card_liabilities_for_item(item, client=client)
    assert result["status"] == "unsupported"
    card_a.refresh_from_db()
    assert card_a.provider_minimum_payment_sync_status == "unsupported"


@override_settings(PLAID_ENABLE_LIABILITIES=True)
@pytest.mark.django_db
def test_reauthorization_structured_status(plaid_setup):
    item, card_a, _card_b, _checking = plaid_setup
    client = MagicMock()
    client.liabilities_get.side_effect = _api_exc("ADDITIONAL_CONSENT_REQUIRED", "consent")
    result = sync_credit_card_liabilities_for_item(item, client=client)
    assert result["status"] == "reauthorization_required"
    card_a.refresh_from_db()
    assert card_a.provider_minimum_payment_sync_status == "reauthorization_required"


def test_classify_product_not_enabled():
    exc = MagicMock(spec=ApiException)
    exc.body = '{"error_code":"INVALID_PRODUCT","error_message":"not enabled"}'
    status, _message = classify_liabilities_error(exc)
    assert status == "product_not_enabled"


@override_settings(PLAID_ENABLE_LIABILITIES=True)
@pytest.mark.django_db
def test_liability_sync_does_not_mutate_financial_records(plaid_setup):
    from timeline.models import RecurringRule
    from transactions.models import Transaction, Transfer
    from affordability.models import DtiDebtItem
    from timeline.models import Scenario

    item, _card_a, _card_b, _checking = plaid_setup
    client = _mock_client([_liability("plaid-a", 86.0)])
    txn_count = Transaction.objects.count()
    xfer_count = Transfer.objects.count()
    rule_count = RecurringRule.objects.count()
    scenario_count = Scenario.objects.count()
    dti_count = DtiDebtItem.objects.count()
    sync_credit_card_liabilities_for_item(item, client=client)
    assert Transaction.objects.count() == txn_count
    assert Transfer.objects.count() == xfer_count
    assert RecurringRule.objects.count() == rule_count
    assert Scenario.objects.count() == scenario_count
    assert DtiDebtItem.objects.count() == dti_count


@override_settings(PLAID_ENABLE_LIABILITIES=True)
@pytest.mark.django_db
def test_unauthorized_user_cannot_sync_other_household_item(plaid_setup, user):
    item, _a, _b, _c = plaid_setup
    other = User.objects.create_user(username="other", password="p1")
    other_hh = Household.objects.create(name="Other")
    HouseholdMembership.objects.create(
        household=other_hh, user=other, role=HouseholdMembership.Role.OWNER
    )
    client = APIClient()
    client.force_authenticate(user=other)
    with patch("plaid_link.views.plaid_configured", return_value=True):
        response = client.post(f"/api/plaid/items/{item.pk}/sync-liabilities/")
    assert response.status_code in (403, 404)


@override_settings(PLAID_ENABLE_LIABILITIES=True)
@pytest.mark.django_db
def test_api_response_does_not_include_access_token(plaid_setup, auth_client):
    item, _a, _b, _c = plaid_setup
    client = _mock_client([_liability("plaid-a", 86.0)])
    with (
        patch("plaid_link.views.plaid_configured", return_value=True),
        patch("plaid_link.liabilities.get_plaid_client", return_value=client),
    ):
        response = auth_client.post(f"/api/plaid/items/{item.pk}/sync-liabilities/")
    assert response.status_code == 200
    body = str(response.json())
    assert "access-sandbox-secret-token" not in body
    assert "access_token" not in body.lower() or "access_token" not in str(response.json().keys())


@override_settings(PLAID_ENABLE_LIABILITIES=True)
@pytest.mark.django_db
def test_transaction_sync_continues_when_liabilities_fail(plaid_setup):
    from plaid_link.liabilities import maybe_sync_credit_card_liabilities_for_item as maybe_sync

    item, _a, _b, _c = plaid_setup
    with patch(
        "plaid_link.liabilities.sync_credit_card_liabilities_for_item",
        side_effect=RuntimeError("liabilities boom"),
    ):
        result = maybe_sync(item, force=True)
    assert result["status"] == "failed"
    assert "transaction" in result["message"].lower()
