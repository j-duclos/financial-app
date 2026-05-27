"""Checklist state for monthly bill occurrences (not a duplicate ledger)."""
from decimal import Decimal

from django.db import models

from accounts.models import Account
from categories.models import Category
from core.models import Household
from timeline.models import RecurringRule
from transactions.models import Transaction


class BillOccurrence(models.Model):
    """Per-month checklist row for a bill (rule occurrence or manual bill)."""

    class Status(models.TextChoices):
        PROJECTED = "projected", "Projected"
        PAID = "paid", "Paid"
        RECONCILED = "reconciled", "Reconciled"
        MISSED = "missed", "Missed"

    household = models.ForeignKey(Household, on_delete=models.CASCADE, related_name="bill_occurrences")
    rule = models.ForeignKey(
        RecurringRule,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="bill_occurrences",
    )
    transaction = models.ForeignKey(
        Transaction,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="bill_occurrences",
    )
    month = models.CharField(max_length=7, help_text="YYYY-MM")
    due_date = models.DateField()
    name = models.CharField(max_length=255)
    account = models.ForeignKey(Account, on_delete=models.CASCADE, related_name="bill_occurrences")
    category = models.ForeignKey(
        Category,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="bill_occurrences",
    )
    expected_amount = models.DecimalField(max_digits=15, decimal_places=2)
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.PROJECTED,
    )
    skipped = models.BooleanField(default=False)
    skipped_at = models.DateTimeField(null=True, blank=True)
    paid_at = models.DateTimeField(null=True, blank=True)
    reconciled_at = models.DateTimeField(null=True, blank=True)
    notes = models.TextField(blank=True, default="")
    autopay_override = models.CharField(
        max_length=16,
        blank=True,
        default="",
        help_text="User override: manual, autopay, or unknown.",
    )
    warning_snoozed_until = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "bills_occurrence"
        ordering = ["due_date", "name"]
        constraints = [
            models.UniqueConstraint(
                fields=["household", "rule", "due_date"],
                condition=models.Q(rule__isnull=False),
                name="uniq_bill_occurrence_rule_due",
            ),
        ]
        indexes = [
            models.Index(fields=["household", "month"]),
            models.Index(fields=["household", "due_date"]),
            models.Index(fields=["status"]),
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.month})"
