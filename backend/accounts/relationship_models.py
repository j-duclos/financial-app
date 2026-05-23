"""Explicit links between accounts for forecasting, autopay, and Plaid matching."""
from decimal import Decimal

from django.db import models

from core.models import Household

from .models import Account


class AccountRelationship(models.Model):
    class RelationshipType(models.TextChoices):
        AUTOPAY = "autopay", "Autopay"
        TRANSFER = "transfer", "Transfer"
        SAVINGS_FUNDING = "savings_funding", "Savings funding"
        DEBT_PAYMENT = "debt_payment", "Debt payment"
        CREDIT_CARD_PAYMENT = "credit_card_payment", "Credit card payment"
        LOAN_PAYMENT = "loan_payment", "Loan payment"
        INVESTMENT_CONTRIBUTION = "investment_contribution", "Investment contribution"
        BILL_FUNDING = "bill_funding", "Bill funding"
        PAYCHECK_DEPOSIT = "paycheck_deposit", "Paycheck deposit"
        OTHER = "other", "Other"

    class Frequency(models.TextChoices):
        ONE_TIME = "one_time", "One time"
        WEEKLY = "weekly", "Weekly"
        BIWEEKLY = "biweekly", "Biweekly"
        MONTHLY = "monthly", "Monthly"
        TWICE_MONTHLY = "twice_monthly", "Twice monthly"
        QUARTERLY = "quarterly", "Quarterly"
        YEARLY = "yearly", "Yearly"
        CUSTOM = "custom", "Custom"

    household = models.ForeignKey(
        Household,
        on_delete=models.CASCADE,
        related_name="account_relationships",
    )
    source_account = models.ForeignKey(
        Account,
        on_delete=models.CASCADE,
        related_name="outgoing_relationships",
        help_text="Account money comes FROM.",
    )
    destination_account = models.ForeignKey(
        Account,
        on_delete=models.CASCADE,
        related_name="incoming_relationships",
        help_text="Account money goes TO.",
    )
    relationship_type = models.CharField(
        max_length=32,
        choices=RelationshipType.choices,
        db_index=True,
    )
    default_amount = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        null=True,
        blank=True,
    )
    default_day = models.PositiveSmallIntegerField(null=True, blank=True)
    frequency = models.CharField(
        max_length=20,
        choices=Frequency.choices,
        default=Frequency.MONTHLY,
    )
    is_active = models.BooleanField(default=True)
    notes = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "accounts_account_relationship"
        ordering = ["household", "source_account", "destination_account"]
        indexes = [
            models.Index(fields=["household", "is_active"]),
            models.Index(fields=["source_account", "destination_account"]),
        ]

    def clean(self):
        from django.core.exceptions import ValidationError

        errors = {}
        if self.source_account_id and self.destination_account_id:
            if self.source_account_id == self.destination_account_id:
                errors["destination_account"] = "Source and destination cannot be the same account."
            elif (
                self.source_account.household_id != self.destination_account.household_id
            ):
                errors["destination_account"] = "Both accounts must belong to the same household."
        if self.default_day is not None and not (1 <= self.default_day <= 31):
            errors["default_day"] = "Day must be between 1 and 31."
        if self.default_amount is not None and self.default_amount <= 0:
            errors["default_amount"] = "Amount must be positive when provided."
        dest = self.destination_account if self.destination_account_id else None
        if dest and self.relationship_type == self.RelationshipType.CREDIT_CARD_PAYMENT:
            if not dest.is_credit_card() and dest.role != Account.AccountRole.CREDIT_CARD:
                errors["destination_account"] = (
                    "Credit card payment requires a credit card destination account."
                )
        if dest and self.relationship_type == self.RelationshipType.LOAN_PAYMENT:
            if dest.role != Account.AccountRole.LOAN:
                errors["destination_account"] = (
                    "Loan payment requires a loan destination account."
                )
        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        if self.source_account_id and not self.household_id:
            self.household_id = self.source_account.household_id
        self.full_clean()
        super().save(*args, **kwargs)
