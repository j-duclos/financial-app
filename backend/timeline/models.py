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
    paused_at = models.DateField(
        null=True,
        blank=True,
        help_text="When set with active=False, no occurrences on or after this date are projected or materialized.",
    )
    notes = models.TextField(blank=True, null=True)
    is_bill = models.BooleanField(
        default=False,
        help_text="Include this rule on the monthly bill checklist (also inferred from direction/category).",
    )
    payment_flexibility_days = models.PositiveSmallIntegerField(
        default=0,
        help_text="Max days this bill may be delayed without penalty (0 = not flexible).",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "timeline_recurring_rule"
        ordering = ["name"]
        indexes = [
            models.Index(fields=["household", "active"]),
            models.Index(fields=["account"]),
        ]


class RecurringRuleSchedule(models.Model):
    """
    Schedule segment for a recurring rule: parameters effective from effective_from (inclusive).
    Projections pick the latest segment where effective_from <= occurrence date.
    """

    rule = models.ForeignKey(RecurringRule, on_delete=models.CASCADE, related_name="schedules")
    effective_from = models.DateField()
    account = models.ForeignKey(Account, on_delete=models.CASCADE, related_name="recurring_rule_schedules")
    transfer_to_account = models.ForeignKey(
        Account,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="recurring_rule_schedule_destinations",
    )
    category = models.ForeignKey(
        Category, on_delete=models.SET_NULL, null=True, blank=True, related_name="recurring_rule_schedules"
    )
    direction = models.CharField(max_length=20, choices=RecurringRule.Direction.choices)
    amount = models.DecimalField(max_digits=15, decimal_places=2)
    currency = models.CharField(max_length=3, default="USD")
    frequency = models.CharField(max_length=30, choices=RecurringRule.Frequency.choices)
    interval = models.PositiveIntegerField(default=1)
    day_of_week = models.PositiveSmallIntegerField(null=True, blank=True)
    day_of_month = models.PositiveSmallIntegerField(null=True, blank=True)
    nth_week = models.PositiveSmallIntegerField(null=True, blank=True)
    start_date = models.DateField()
    end_date = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "timeline_recurring_rule_schedule"
        ordering = ["effective_from", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["rule", "effective_from"],
                name="uniq_rule_schedule_rule_effective_from",
            ),
        ]
        indexes = [models.Index(fields=["rule", "effective_from"])]


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
    class Template(models.TextChoices):
        BLANK = "blank", "Blank"
        BUY_HOUSE = "buy_house", "Buy house"
        LOSE_JOB = "lose_job", "Lose job"
        MOVE = "move", "Move"
        RAISE_INCOME = "raise_income", "Raise income"
        PAY_OFF_DEBT = "pay_off_debt", "Pay off debt"
        NEW_CAR = "new_car", "New car"
        CUSTOM = "custom", "Custom"

    household = models.ForeignKey(Household, on_delete=models.CASCADE, related_name="scenarios")
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True, default="")
    template = models.CharField(
        max_length=32,
        choices=Template.choices,
        default=Template.BLANK,
    )
    horizon_months = models.PositiveSmallIntegerField(
        default=12,
        help_text="Default comparison horizon in months for this scenario.",
    )
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
    notes = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "timeline_scenario_rule_override"
        constraints = [
            models.UniqueConstraint(fields=["scenario", "rule"], name="uniq_scenario_rule"),
        ]


class ScenarioOneTimeEvent(models.Model):
    """Scenario-only one-time cash event; never creates a real Transaction row."""

    class Direction(models.TextChoices):
        INCOME = "INCOME", "Income"
        EXPENSE = "EXPENSE", "Expense"
        TRANSFER = "TRANSFER", "Transfer"

    scenario = models.ForeignKey(Scenario, on_delete=models.CASCADE, related_name="one_time_events")
    date = models.DateField()
    account = models.ForeignKey(Account, on_delete=models.CASCADE, related_name="scenario_one_time_events")
    transfer_to_account = models.ForeignKey(
        Account,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="scenario_one_time_transfer_destinations",
        help_text="Required for TRANSFER direction — destination account.",
    )
    description = models.CharField(max_length=512)
    category = models.ForeignKey(
        Category, on_delete=models.SET_NULL, null=True, blank=True, related_name="scenario_one_time_events"
    )
    direction = models.CharField(max_length=20, choices=Direction.choices)
    amount = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        help_text="Positive magnitude; sign derived from direction when projecting.",
    )
    notes = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "timeline_scenario_one_time_event"
        ordering = ["date", "id"]
        indexes = [models.Index(fields=["scenario", "date"])]


class ScenarioAddedRecurring(models.Model):
    """
    Recurring income/expense that exists only in a what-if scenario.
    Never creates a household RecurringRule or materialized Transaction rows.
    """

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

    scenario = models.ForeignKey(Scenario, on_delete=models.CASCADE, related_name="added_recurring")
    name = models.CharField(max_length=255)
    account = models.ForeignKey(Account, on_delete=models.CASCADE, related_name="scenario_added_recurring")
    transfer_to_account = models.ForeignKey(
        Account,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="scenario_added_recurring_destinations",
        help_text="Destination for scenario-only transfer payments (e.g. extra debt payment).",
    )
    category = models.ForeignKey(
        Category, on_delete=models.SET_NULL, null=True, blank=True, related_name="scenario_added_recurring"
    )
    direction = models.CharField(max_length=20, choices=Direction.choices)
    amount = models.DecimalField(max_digits=15, decimal_places=2)
    currency = models.CharField(max_length=3, default="USD")
    frequency = models.CharField(max_length=30, choices=Frequency.choices)
    interval = models.PositiveIntegerField(default=1)
    day_of_week = models.PositiveSmallIntegerField(null=True, blank=True)
    day_of_month = models.PositiveSmallIntegerField(null=True, blank=True)
    nth_week = models.PositiveSmallIntegerField(null=True, blank=True)
    start_date = models.DateField()
    end_date = models.DateField(null=True, blank=True)
    notes = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "timeline_scenario_added_recurring"
        ordering = ["name", "id"]
        indexes = [models.Index(fields=["scenario", "start_date"])]


class ScenarioCategoryShock(models.Model):
    """
    Future-ready category expense shock for what-if projections.
    Applied as a percent multiplier on projected rows in the category during the window.
    """

    scenario = models.ForeignKey(Scenario, on_delete=models.CASCADE, related_name="category_shocks")
    category = models.ForeignKey(Category, on_delete=models.CASCADE, related_name="scenario_category_shocks")
    percent_change = models.DecimalField(
        max_digits=8,
        decimal_places=2,
        help_text="Percent change applied to projected expenses (e.g. 40 = +40%).",
    )
    start_date = models.DateField()
    end_date = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "timeline_scenario_category_shock"
        ordering = ["start_date", "id"]


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
