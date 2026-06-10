"""Plaid sync-all and auto-sync throttle."""
from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Account
from core.models import Household, HouseholdMembership
from plaid_link.models import PlaidItem, PlaidLinkedAccount
from plaid_link.services import (
    plaid_sync_min_interval_seconds,
    should_skip_plaid_item_sync,
    sync_all_plaid_items_for_user,
)

User = get_user_model()


class TestPlaidSyncThrottle(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="plaid_sync_user", password="p1")
        self.h = Household.objects.create(name="H1")
        HouseholdMembership.objects.create(
            household=self.h, user=self.user, role=HouseholdMembership.Role.OWNER
        )
        self.acc = Account.objects.create(
            household=self.h,
            account_type=Account.AccountType.CHECKING,
            name="Checking",
            currency="USD",
        )
        self.item = PlaidItem.objects.create(
            household=self.h,
            item_id="item-sync-test",
            access_token_cipher="cipher",
            institution_name="Test Bank",
            last_sync_at=timezone.now(),
        )
        PlaidLinkedAccount.objects.create(
            item=self.item,
            plaid_account_id="pa-1",
            mask="1234",
            account=self.acc,
        )

    def test_should_skip_recent_sync(self):
        self.assertTrue(should_skip_plaid_item_sync(self.item, force=False))

    def test_force_never_skips(self):
        self.assertFalse(should_skip_plaid_item_sync(self.item, force=True))

    def test_old_sync_not_skipped(self):
        self.item.last_sync_at = timezone.now() - timedelta(
            seconds=plaid_sync_min_interval_seconds() + 10
        )
        self.item.save(update_fields=["last_sync_at"])
        self.assertFalse(should_skip_plaid_item_sync(self.item, force=False))

    @patch("plaid_link.services.sync_transactions_for_item")
    def test_sync_all_skips_recent_without_force(self, mock_sync):
        result = sync_all_plaid_items_for_user(self.user, household_id=self.h.id, force=False)
        mock_sync.assert_not_called()
        self.assertEqual(result["totals"]["skipped_items"], 1)
        self.assertEqual(result["items"][0]["reason"], "recently_synced")

    @patch("plaid_link.services.sync_transactions_for_item", return_value={"added": 2, "modified": 0, "removed": 0, "merged": 0})
    def test_sync_all_runs_with_force(self, mock_sync):
        result = sync_all_plaid_items_for_user(self.user, household_id=self.h.id, force=True)
        mock_sync.assert_called_once()
        self.assertEqual(result["totals"]["synced_items"], 1)
        self.assertEqual(result["totals"]["added"], 2)


class TestPlaidSyncAllView(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="plaid_api_user", password="p1")
        self.h = Household.objects.create(name="H1")
        HouseholdMembership.objects.create(
            household=self.h, user=self.user, role=HouseholdMembership.Role.OWNER
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    @patch("plaid_link.views.plaid_configured", return_value=True)
    @patch("plaid_link.views.sync_all_plaid_items_for_user", return_value={"items": [], "totals": {"added": 0, "modified": 0, "removed": 0, "merged": 0, "skipped_items": 0, "synced_items": 0, "failed_items": 0}})
    def test_sync_all_endpoint(self, mock_sync_all, _configured):
        resp = self.client.post(f"/api/plaid/sync-all/?household={self.h.id}&force=false")
        self.assertEqual(resp.status_code, 200)
        mock_sync_all.assert_called_once()
        _, kwargs = mock_sync_all.call_args
        self.assertEqual(kwargs["household_id"], self.h.id)
        self.assertFalse(kwargs["force"])
