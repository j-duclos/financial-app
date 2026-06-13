import uuid
from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models

from accounts.models import Account
from categories.models import Category


class Reconciliation(models.Model):
    """Completed bank reconciliation session for an account (audit record)."""

    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Draft"
        COMPLETED = "COMPLETED", "Completed"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="reconciliations",
    )
    account = models.ForeignKey(Account, on_delete=models.CASCADE, related_name="reconciliations")
    bank_current_balance = models.DecimalField(max_digits=15, decimal_places=2)
    app_current_balance = models.DecimalField(max_digits=15, decimal_places=2)
    last_reconciled_balance = models.DecimalField(max_digits=15, decimal_places=2)
    final_reconciled_balance = models.DecimalField(max_digits=15, decimal_places=2)
    difference = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0"))
    period_start_date = models.DateField(null=True, blank=True)
    period_end_date = models.DateField(null=True, blank=True)
    transaction_count = models.PositiveIntegerField(default=0)
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.DRAFT,
    )
    notes = models.TextField(blank=True, default="")
    is_active = models.BooleanField(default=True)
    undone_at = models.DateTimeField(null=True, blank=True)
    undone_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="reconciliations_undone",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "transactions_reconciliation"
        ordering = ["-completed_at", "-created_at"]
        indexes = [
            models.Index(fields=["account", "-completed_at"]),
            models.Index(fields=["account", "is_active", "-completed_at"]),
        ]

    def clean(self):
        super().clean()
        if not self.period_start_date or not self.period_end_date:
            return
        if self.period_start_date > self.period_end_date:
            raise ValidationError("Period start must be on or before period end.")
        if not self.is_active or self.status != self.Status.COMPLETED:
            return
        overlapping = (
            Reconciliation.objects.filter(
                account=self.account,
                is_active=True,
                status=self.Status.COMPLETED,
                period_start_date__lte=self.period_end_date,
                period_end_date__gte=self.period_start_date,
            )
            .exclude(pk=self.pk)
        )
        if overlapping.exists():
            raise ValidationError(
                "An active reconciliation session already exists for an overlapping period."
            )


class ReconciliationEntry(models.Model):
    """Ledger row included in a completed reconciliation session."""

    session = models.ForeignKey(
        Reconciliation,
        on_delete=models.CASCADE,
        related_name="entries",
    )
    transaction = models.ForeignKey(
        "transactions.Transaction",
        on_delete=models.CASCADE,
        related_name="reconciliation_entries",
    )
    reconciled_balance = models.DecimalField(max_digits=15, decimal_places=2, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "transactions_reconciliation_entry"
        constraints = [
            models.UniqueConstraint(
                fields=["session", "transaction"],
                name="uniq_reconciliation_entry_session_txn",
            ),
        ]
        ordering = ["transaction__date", "transaction__id"]


class TransferGroup(models.Model):
    """Logical transfer/payment plan linking two account legs (forecast-first; Plaid matches later)."""

    class Status(models.TextChoices):
        PLANNED = "PLANNED", "Planned"
        PARTIALLY_MATCHED = "PARTIALLY_MATCHED", "Partially matched"
        MATCHED = "MATCHED", "Matched"
        CLEARED = "CLEARED", "Cleared"
        CANCELED = "CANCELED", "Canceled"

    household = models.ForeignKey(
        "core.Household",
        on_delete=models.CASCADE,
        related_name="transfer_groups",
    )
    from_account = models.ForeignKey(
        Account,
        on_delete=models.CASCADE,
        related_name="transfer_groups_from",
    )
    to_account = models.ForeignKey(
        Account,
        on_delete=models.CASCADE,
        related_name="transfer_groups_to",
    )
    amount = models.DecimalField(max_digits=15, decimal_places=2, help_text="Positive payment/transfer amount.")
    scheduled_date = models.DateField()
    status = models.CharField(
        max_length=24,
        choices=Status.choices,
        default=Status.PLANNED,
    )
    notes = models.TextField(blank=True)
    relationship = models.ForeignKey(
        "accounts.AccountRelationship",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="transfer_groups",
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="transfer_groups_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "transactions_transfer_group"
        indexes = [
            models.Index(fields=["household", "scheduled_date"]),
            models.Index(fields=["from_account", "to_account", "scheduled_date"]),
        ]


class Transaction(models.Model):
    """Single transaction. amount is signed: positive = inflow, negative = outflow."""

    class TransactionType(models.TextChoices):
        OTHER = "other", "Other"
        CREDIT_CARD_PURCHASE = "credit_card_purchase", "Credit card purchase"
        CREDIT_CARD_PAYMENT = "credit_card_payment", "Credit card payment"
        CREDIT_CARD_REFUND = "credit_card_refund", "Credit card refund"
        INTEREST_CHARGE = "interest_charge", "Interest charge"
        FEE = "fee", "Fee"
        BALANCE_ADJUSTMENT = "balance_adjustment", "Balance adjustment"
        TRANSFER = "transfer", "Transfer"

    class Status(models.TextChoices):
        PLANNED = "PLANNED", "Planned"
        CLEARED = "CLEARED", "Cleared"
        RECONCILED = "RECONCILED", "Reconciled"

    class Source(models.TextChoices):
        ACTUAL = "ACTUAL", "Actual"
        RULE = "RULE", "From rule"
        ONE_TIME = "ONE_TIME", "One-time planned"
        INTEREST = "INTEREST", "Projected interest"
        PLAID = "PLAID", "Imported from Plaid"
        SYSTEM = "SYSTEM", "System"

    class ImportMatchStatus(models.TextChoices):
        NONE = "NONE", "Not applicable"
        UNMATCHED = "UNMATCHED", "Imported, unmatched"
        SUGGESTED = "SUGGESTED", "Suggestions pending"
        MATCHED = "MATCHED", "Matched to planned"
        IGNORED = "IGNORED", "Ignored import"
        DUPLICATE = "DUPLICATE", "Duplicate import"

    account = models.ForeignKey(Account, on_delete=models.CASCADE, related_name="transactions")
    transaction_type = models.CharField(
        max_length=32,
        choices=TransactionType.choices,
        default=TransactionType.OTHER,
        db_index=True,
    )
    date = models.DateField()
    payee = models.CharField(max_length=255)
    memo = models.TextField(blank=True)
    amount = models.DecimalField(max_digits=15, decimal_places=2, help_text="Positive=inflow, negative=outflow")
    category = models.ForeignKey(
        Category, on_delete=models.SET_NULL, null=True, blank=True, related_name="transactions"
    )
    cleared = models.BooleanField(default=False)
    reconciled = models.BooleanField(default=False)
    reconciled_at = models.DateTimeField(null=True, blank=True)
    reconciliation = models.ForeignKey(
        "transactions.Reconciliation",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="transactions",
    )
    tags = models.JSONField(default=list, blank=True)  # list of strings
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.CLEARED
    )
    source = models.CharField(
        max_length=20, choices=Source.choices, default=Source.ACTUAL
    )
    rule = models.ForeignKey(
        "timeline.RecurringRule", on_delete=models.SET_NULL, null=True, blank=True, related_name="transactions"
    )
    scenario = models.ForeignKey(
        "timeline.Scenario", on_delete=models.SET_NULL, null=True, blank=True, related_name="transactions"
    )
    # Billing cycle this interest row belongs to; user may change ``date`` for display/reconcile.
    interest_cycle_end_date = models.DateField(null=True, blank=True)
    # Plaid transaction_id; unique for dedupe and sync remove/modify.
    plaid_transaction_id = models.CharField(max_length=128, null=True, blank=True, unique=True, db_index=True)
    transfer_group = models.ForeignKey(
        TransferGroup,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="transactions",
    )
    posted_date = models.DateField(
        null=True,
        blank=True,
        help_text="Bank posted date when known (e.g. from Plaid); defaults to date for display.",
    )
    planned_date = models.DateField(
        null=True,
        blank=True,
        help_text="User-intended date for planned rows; falls back to date.",
    )
    imported_description = models.TextField(
        blank=True,
        default="",
        help_text="Raw bank/import description (e.g. Plaid name).",
    )
    normalized_payee = models.CharField(max_length=512, blank=True, default="")
    import_match_status = models.CharField(
        max_length=20,
        choices=ImportMatchStatus.choices,
        default=ImportMatchStatus.NONE,
        db_index=True,
    )
    is_bill = models.BooleanField(
        default=False,
        help_text="Treat this transaction as a bill on the monthly checklist.",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "transactions_transaction"
        ordering = ["-date", "-id"]
        indexes = [
            models.Index(fields=["account", "date"]),
            models.Index(fields=["account", "date", "id"]),
            models.Index(fields=["category", "date"]),
            models.Index(fields=["account", "interest_cycle_end_date"]),
            models.Index(fields=["import_match_status", "account"]),
            # Rule materialization: bulk preload + per-occurrence idempotency (rule, account, date).
            models.Index(
                fields=["rule", "account", "date"],
                name="txn_rule_acct_date_idx",
            ),
            models.Index(
                fields=["rule", "date", "source"],
                name="txn_rule_date_src_idx",
            ),
            models.Index(
                fields=["account", "source", "date"],
                name="txn_acct_src_date_idx",
            ),
            models.Index(
                fields=["account", "reconciled", "date"],
                name="txn_acct_recon_date_idx",
            ),
            models.Index(
                fields=["account", "source", "import_match_status"],
                name="txn_acct_src_match_idx",
            ),
        ]


class TransactionMatch(models.Model):
    """Links a forecast/planned ledger row to the bank-confirmed Plaid import (no duplicate ledger effect)."""

    class MatchType(models.TextChoices):
        SAME_ACCOUNT = "SAME_ACCOUNT", "Same account"
        TRANSFER_SOURCE = "TRANSFER_SOURCE", "Transfer source leg"
        TRANSFER_DEST = "TRANSFER_DEST", "Transfer destination leg"
        MANUAL = "MANUAL", "Manual link"

    class Confidence(models.TextChoices):
        AUTO = "AUTO", "Auto-matched"
        SUGGESTED = "SUGGESTED", "User confirmed suggestion"
        MANUAL = "MANUAL", "User manual match"

    planned_transaction = models.OneToOneField(
        Transaction,
        on_delete=models.CASCADE,
        related_name="match_as_planned",
    )
    imported_transaction = models.OneToOneField(
        Transaction,
        on_delete=models.CASCADE,
        related_name="match_as_imported",
    )
    match_type = models.CharField(
        max_length=32,
        choices=MatchType.choices,
        default=MatchType.SAME_ACCOUNT,
    )
    score = models.PositiveSmallIntegerField(default=0)
    confidence = models.CharField(
        max_length=16,
        choices=Confidence.choices,
        default=Confidence.AUTO,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "transactions_transaction_match"
        constraints = [
            models.UniqueConstraint(fields=["planned_transaction"], name="uniq_txn_match_planned"),
            models.UniqueConstraint(fields=["imported_transaction"], name="uniq_txn_match_imported"),
        ]


class MatchSuggestion(models.Model):
    """Low-confidence candidate pairs (score between suggest threshold and auto threshold)."""

    imported_transaction = models.ForeignKey(
        Transaction,
        on_delete=models.CASCADE,
        related_name="match_suggestions",
    )
    planned_transaction = models.ForeignKey(
        Transaction,
        on_delete=models.CASCADE,
        related_name="suggested_import_matches",
    )
    score = models.PositiveSmallIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "transactions_match_suggestion"
        constraints = [
            models.UniqueConstraint(
                fields=["imported_transaction", "planned_transaction"],
                name="uniq_match_suggestion_pair",
            ),
        ]


class Transfer(models.Model):
    """Links two transactions (outgoing and incoming) with a shared transfer_id."""

    transfer_id = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    from_transaction = models.OneToOneField(
        Transaction, on_delete=models.CASCADE, related_name="transfer_out"
    )
    to_transaction = models.OneToOneField(
        Transaction, on_delete=models.CASCADE, related_name="transfer_in"
    )
    amount = models.DecimalField(max_digits=15, decimal_places=2)  # positive
    date = models.DateField()
    memo = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "transactions_transfer"
