"""Models for Financial Timeline OS: rules, scenarios, reconciliation."""
from decimal import Decimal

from django.conf import settings
from django.db import models

from accounts.models import Account
from categories.models import Category
from core.models import Household
from transactions.models import Transaction


class RecurringRule(models.Model):
    class Direction(models.TextChoices):
        INCOME = "INCOME", "Income"
        EXPENSE = "EXPENSE", "Expense"
        TRANSFER = "TRANSFER", "Transfer"

    class Frequency(models.TextChoices):
        WEEKLY = "WEEKLY", "Weekly"
        BIWEEKLY = "BIWEEKLY", "Biweekly"
        MONTHLY_DAY = "MONTHLY_DAY", "Monthly (day of month)"
        MONTHLY_NTH_WEEKDAY = "MONTHLY_NTH_WEEKDAY", "Monthly (nth weekday)"
        YEARLY = "YEARLY", "Yearly"

    household = models.ForeignKey(Household, on_delete=models.CASCADE, related_name="recurring_rules")
    name = models.CharField(max_length=255)
    account = models.ForeignKey(Account, on_delete=models.CASCADE, related_name="recurring_rules")
    transfer_to_account = models.ForeignKey(
        Account,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="recurring_rules_receiving",
        help_text="When set, this rule is a transfer: outflow from account, inflow to this account (e.g. credit card payment).",
    )
    category = models.ForeignKey(
        Category, on_delete=models.SET_NULL, null=True, blank=True, related_name="recurring_rules"
    )
    direction = models.CharField(max_length=20, choices=Direction.choices)
    amount = models.DecimalField(max_digits=15, decimal_places=2)
    currency = models.CharField(max_length=3, default="USD")
    frequency = models.CharField(max_length=30, choices=Frequency.choices)
    interval = models.PositiveIntegerField(default=1)
    day_of_week = models.PositiveSmallIntegerField(
        null=True, blank=True, help_text="0=Monday .. 6=Sunday (ISO weekday - 1)"
    )
    day_of_month = models.PositiveSmallIntegerField(null=True, blank=True)  # 1-31
    nth_week = models.PositiveSmallIntegerField(null=True, blank=True)  # 1-5 for "2nd Tuesday"
    start_date = models.DateField()
    end_date = models.DateField(null=True, blank=True)
    active = models.BooleanField(default=True)
    notes = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "timeline_recurring_rule"
        ordering = ["name"]
        indexes = [
            models.Index(fields=["household", "active"]),
            models.Index(fields=["account"]),
        ]


class RecurringRuleSkip(models.Model):
    """User deleted this rule occurrence; do not re-materialize it when building the timeline."""
    rule = models.ForeignKey(RecurringRule, on_delete=models.CASCADE, related_name="skipped_occurrences")
    date = models.DateField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "timeline_recurring_rule_skip"
        constraints = [
            models.UniqueConstraint(fields=["rule", "date"], name="uniq_rule_skip_rule_date"),
        ]
        indexes = [models.Index(fields=["rule", "date"])]


class InterestCycleSkip(models.Model):
    """User removed projected interest for this billing cycle; do not re-add it when building the timeline."""

    account = models.ForeignKey(Account, on_delete=models.CASCADE, related_name="interest_cycle_skips")
    cycle_end_date = models.DateField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "timeline_interest_cycle_skip"
        constraints = [
            models.UniqueConstraint(
                fields=["account", "cycle_end_date"],
                name="uniq_interest_skip_account_cycle",
            ),
        ]
        indexes = [models.Index(fields=["account", "cycle_end_date"])]


class Scenario(models.Model):
    household = models.ForeignKey(Household, on_delete=models.CASCADE, related_name="scenarios")
    name = models.CharField(max_length=255)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "timeline_scenario"
        ordering = ["name"]


class ScenarioRuleOverride(models.Model):
    scenario = models.ForeignKey(Scenario, on_delete=models.CASCADE, related_name="rule_overrides")
    rule = models.ForeignKey(RecurringRule, on_delete=models.CASCADE, related_name="scenario_overrides")
    override_amount = models.DecimalField(
        max_digits=15, decimal_places=2, null=True, blank=True
    )
    override_active = models.BooleanField(null=True, blank=True)
    override_start_date = models.DateField(null=True, blank=True)
    override_end_date = models.DateField(null=True, blank=True)
    override_account = models.ForeignKey(
        Account, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    override_category = models.ForeignKey(
        Category, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "timeline_scenario_rule_override"
        constraints = [
            models.UniqueConstraint(fields=["scenario", "rule"], name="uniq_scenario_rule"),
        ]


class StatementTransaction(models.Model):
    """Imported bank statement line for manual reconciliation."""

    household = models.ForeignKey(Household, on_delete=models.CASCADE, related_name="statement_transactions")
    account = models.ForeignKey(Account, on_delete=models.CASCADE, related_name="statement_transactions")
    posted_date = models.DateField()
    description = models.CharField(max_length=512)
    amount = models.DecimalField(max_digits=15, decimal_places=2)  # signed
    external_id = models.CharField(max_length=255, null=True, blank=True, db_index=True)
    raw = models.JSONField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "timeline_statement_transaction"
        ordering = ["posted_date", "id"]
        indexes = [
            models.Index(fields=["account", "posted_date"]),
            models.Index(fields=["household"]),
        ]


class ReconciliationMatch(models.Model):
    class Status(models.TextChoices):
        MATCHED = "MATCHED", "Matched"
        UNMATCHED = "UNMATCHED", "Unmatched"

    statement_txn = models.OneToOneField(
        StatementTransaction, on_delete=models.CASCADE, related_name="match"
    )
    matched_transaction = models.ForeignKey(
        Transaction, on_delete=models.SET_NULL, null=True, blank=True, related_name="reconciliation_matches"
    )
    status = models.CharField(max_length=20, choices=Status.choices)
    matched_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "timeline_reconciliation_match"


class UpcomingChargeNotification(models.Model):
    """
    In-app notification for a recurring rule charge due within the next few days.
    Generated by the create_upcoming_charge_notifications management command (run daily).
    """
    household = models.ForeignKey(
        Household, on_delete=models.CASCADE, related_name="upcoming_charge_notifications"
    )
    rule = models.ForeignKey(
        RecurringRule, on_delete=models.CASCADE, related_name="upcoming_notifications"
    )
    due_date = models.DateField(help_text="Date when the charge is scheduled to be paid.")
    created_at = models.DateTimeField(auto_now_add=True)
    read_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "timeline_upcoming_charge_notification"
        ordering = ["due_date", "created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["household", "rule", "due_date"],
                name="uniq_upcoming_charge_household_rule_due",
            ),
        ]
        indexes = [
            models.Index(fields=["household", "read_at"]),
        ]
