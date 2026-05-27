from decimal import Decimal

from django.conf import settings
from django.db import models

from accounts.models import Account
from core.models import Household


class FinancialGoal(models.Model):
    """Legacy goals table; migrated to GoalBucket. Kept for rollback references."""

    class GoalType(models.TextChoices):
        SAVINGS = "savings", "Savings"
        DEBT_PAYOFF = "debt_payoff", "Debt payoff"
        EMERGENCY_FUND = "emergency_fund", "Emergency fund"
        HOUSE_DOWN_PAYMENT = "house_down_payment", "House down payment"
        COLLEGE = "college", "College"
        VACATION = "vacation", "Vacation"
        TAXES = "taxes", "Taxes"
        CAR = "car", "Car"
        PURCHASE = "purchase", "Purchase"
        CUSTOM = "custom", "Custom"

    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        PAUSED = "paused", "Paused"
        COMPLETED = "completed", "Completed"
        ARCHIVED = "archived", "Archived"

    household = models.ForeignKey(
        Household, on_delete=models.CASCADE, related_name="financial_goals"
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="financial_goals",
    )
    name = models.CharField(max_length=255)
    goal_type = models.CharField(max_length=32, choices=GoalType.choices, default=GoalType.SAVINGS)
    target_amount = models.DecimalField(max_digits=15, decimal_places=2)
    current_amount = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0"))
    starting_debt_amount = models.DecimalField(
        max_digits=15, decimal_places=2, null=True, blank=True
    )
    target_date = models.DateField(null=True, blank=True)
    linked_account = models.ForeignKey(
        Account, on_delete=models.SET_NULL, null=True, blank=True, related_name="savings_goals"
    )
    linked_credit_account = models.ForeignKey(
        Account, on_delete=models.SET_NULL, null=True, blank=True, related_name="debt_goals"
    )
    monthly_contribution = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0"))
    contribution_rule = models.ForeignKey(
        "timeline.RecurringRule",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="financial_goals",
    )
    priority = models.PositiveSmallIntegerField(default=3)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.ACTIVE, db_index=True)
    notes = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "goals_financial_goal"
        ordering = ["priority", "-created_at"]

    def is_debt_goal(self) -> bool:
        return self.goal_type == self.GoalType.DEBT_PAYOFF


class GoalBucket(models.Model):
    """Reserved allocation on top of a real account — not a separate balance."""

    class BucketType(models.TextChoices):
        EMERGENCY = "emergency", "Emergency"
        PURCHASE = "purchase", "Purchase"
        VACATION = "vacation", "Vacation"
        HOUSE = "house", "House"
        EDUCATION = "education", "Education"
        DEBT_PAYOFF = "debt_payoff", "Debt payoff"
        RETIREMENT = "retirement", "Retirement"
        CUSTOM = "custom", "Custom"

    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        PAUSED = "paused", "Paused"
        COMPLETED = "completed", "Completed"
        ARCHIVED = "archived", "Archived"

    class Priority(models.TextChoices):
        HIGH = "high", "High"
        MEDIUM = "medium", "Medium"
        LOW = "low", "Low"

    household = models.ForeignKey(Household, on_delete=models.CASCADE, related_name="goal_buckets")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="goal_buckets_created",
    )
    legacy_goal = models.OneToOneField(
        FinancialGoal,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="bucket",
    )
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True, default="")
    type = models.CharField(max_length=32, choices=BucketType.choices, default=BucketType.CUSTOM)
    status = models.CharField(
        max_length=16, choices=Status.choices, default=Status.ACTIVE, db_index=True
    )
    priority = models.CharField(
        max_length=16, choices=Priority.choices, default=Priority.MEDIUM, db_index=True
    )
    target_amount = models.DecimalField(max_digits=15, decimal_places=2)
    allocated_amount = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0"))
    start_date = models.DateField(null=True, blank=True)
    target_date = models.DateField(null=True, blank=True)
    linked_account = models.ForeignKey(
        Account,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="goal_buckets",
    )
    monthly_target = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0"))
    auto_fund_enabled = models.BooleanField(default=False)
    forecast_enabled = models.BooleanField(default=True)
    include_in_safe_to_spend = models.BooleanField(
        default=True,
        help_text="When true, allocated amount reduces safe-to-spend on the linked account.",
    )
    notes = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "goals_goal_bucket"
        ordering = ["priority", "-created_at"]
        indexes = [
            models.Index(fields=["household", "status"]),
            models.Index(fields=["linked_account", "status"]),
        ]

    def is_debt_bucket(self) -> bool:
        return self.type == self.BucketType.DEBT_PAYOFF


class GoalContribution(models.Model):
    """Links bucket allocation to a real ledger transaction (no duplicate balance)."""

    class Source(models.TextChoices):
        MANUAL = "manual", "Manual"
        TRANSFER = "transfer", "Transfer"
        RULE = "rule", "Rule"
        AUTO = "auto", "Auto"
        PLAID = "plaid", "Plaid"

    bucket = models.ForeignKey(GoalBucket, on_delete=models.CASCADE, related_name="contributions")
    transaction = models.ForeignKey(
        "transactions.Transaction",
        on_delete=models.CASCADE,
        related_name="goal_contributions",
    )
    account = models.ForeignKey(
        Account,
        on_delete=models.CASCADE,
        related_name="goal_contributions",
    )
    amount = models.DecimalField(max_digits=15, decimal_places=2)
    date = models.DateField(db_index=True)
    source = models.CharField(max_length=16, choices=Source.choices, default=Source.MANUAL)
    notes = models.CharField(max_length=255, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "goals_goal_contribution"
        ordering = ["-date", "-id"]
        indexes = [
            models.Index(fields=["bucket", "date"]),
            models.Index(fields=["account", "date"]),
        ]


class RuleAllocation(models.Model):
    """Slice of a recurring rule inflow allocated to a bucket when the rule fires."""

    rule = models.ForeignKey(
        "timeline.RecurringRule",
        on_delete=models.CASCADE,
        related_name="bucket_allocations",
    )
    bucket = models.ForeignKey(GoalBucket, on_delete=models.CASCADE, related_name="rule_allocations")
    percent = models.DecimalField(
        max_digits=6,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Percent of rule amount (0-100).",
    )
    fixed_amount = models.DecimalField(
        max_digits=15, decimal_places=2, null=True, blank=True
    )
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "goals_rule_allocation"
        unique_together = [("rule", "bucket")]
