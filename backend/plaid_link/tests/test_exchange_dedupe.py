"""Plaid re-link must reuse existing accounts (last_four + type), not create duplicates."""
import pytest
from unittest.mock import MagicMock, patch

from accounts.models import Account
from plaid_link.models import PlaidItem, PlaidLinkedAccount
from plaid_link.services import exchange_public_token, find_manual_account_for_plaid


@pytest.mark.django_db
def test_find_manual_account_includes_already_linked(household):
    acct = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Chase · Main",
        institution="Chase",
        last_four="9009",
    )
    item = PlaidItem.objects.create(
        household=household,
        item_id="item-old",
        access_token_cipher="cipher",
        institution_name="Chase",
    )
    PlaidLinkedAccount.objects.create(
        item=item,
        plaid_account_id="plaid-acct-1",
        mask="9009",
        account=acct,
    )

    matched = find_manual_account_for_plaid(
        household.id,
        account_type=Account.AccountType.CHECKING,
        plaid_mask="9009",
        institution_name="Chase",
    )
    assert matched is not None
    assert matched.id == acct.id


@pytest.mark.django_db
@patch("plaid_link.services.get_plaid_client")
def test_exchange_relink_reuses_account_not_duplicate(mock_client, household):
    existing = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Main",
        institution="Chase",
        last_four="9009",
    )
    old_item = PlaidItem.objects.create(
        household=household,
        item_id="old-item",
        access_token_cipher="old-cipher",
        institution_name="Chase",
    )
    PlaidLinkedAccount.objects.create(
        item=old_item,
        plaid_account_id="old-plaid-id",
        mask="9009",
        account=existing,
    )

    client = MagicMock()
    mock_client.return_value = client
    client.item_public_token_exchange.return_value = MagicMock(
        access_token="new-token", item_id="new-item"
    )
    client.accounts_get.return_value = MagicMock(
        to_dict=lambda: {
            "item": {"institution_id": "ins", "institution_name": "Chase"},
            "accounts": [
                {
                    "account_id": "new-plaid-id",
                    "name": "TOTAL CHECKING",
                    "official_name": "Chase · TOTAL CHECKING",
                    "mask": "9009",
                    "type": "depository",
                    "subtype": "checking",
                }
            ],
        }
    )

    with patch("plaid_link.services.encrypt_secret", return_value="enc"):
        exchange_public_token(public_token="pub", household_id=household.id)

    assert Account.objects.filter(household=household).count() == 1
    existing.refresh_from_db()
    link = existing.plaid_link
    assert link.plaid_account_id == "new-plaid-id"
    assert link.item.item_id == "new-item"
    assert not PlaidItem.objects.filter(item_id="old-item").exists()
