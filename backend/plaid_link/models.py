from django.db import models

from accounts.models import Account
from core.models import Household


class PlaidItem(models.Model):
    """A linked Plaid Item (financial institution connection) for a household."""

    household = models.ForeignKey(Household, on_delete=models.CASCADE, related_name="plaid_items")
    item_id = models.CharField(max_length=64, unique=True)
    access_token_cipher = models.TextField(help_text="Fernet-encrypted Plaid access_token")
    transactions_cursor = models.CharField(max_length=768, blank=True, default="")
    institution_id = models.CharField(max_length=64, blank=True)
    institution_name = models.CharField(max_length=255, blank=True)
    last_sync_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="When transactions were last imported from Plaid for this login.",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "plaid_link_plaiditem"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["household"]),
        ]


class PlaidLinkedAccount(models.Model):
    """Maps a Plaid account_id to an app Account."""

    item = models.ForeignKey(PlaidItem, on_delete=models.CASCADE, related_name="linked_accounts")
    plaid_account_id = models.CharField(max_length=64)
    mask = models.CharField(max_length=16, blank=True, default="", help_text="Last digits Plaid reports for this account.")
    account = models.OneToOneField(Account, on_delete=models.CASCADE, related_name="plaid_link")

    class Meta:
        db_table = "plaid_link_plaidlinkedaccount"
        constraints = [
            models.UniqueConstraint(fields=["item", "plaid_account_id"], name="uniq_plaid_item_plaid_account"),
        ]
