from decimal import Decimal

from django.db import models
from django.core.validators import MaxValueValidator, MinValueValidator

from accounts.models import Account
from categories.models import Category
from core.models import Household


class SpendingTarget(models.Model):
    """Forecast-aware spending guidance per category — not cash envelopes."""

    class Period(models.TextChoices):
        WEEKLY = "weekly", "Weekly"
        MONTHLY = "monthly", "Monthly"
        QUARTERLY = "quarterly", "Quarterly"
        YEARLY = "yearly", "Yearly"

    class TargetType(models.TextChoices):
        FIXED = "fixed", "Fixed / scheduled"
        VARIABLE = "variable", "Variable"

    household = models.ForeignKey(
        Household, on_delete=models.CASCADE, related_name="spending_targets"
    )
    category = models.ForeignKey(
        Category, on_delete=models.CASCADE, related_name="spending_targets"
    )
    name = models.CharField(max_length=255, blank=True, default="")
    target_amount = models.DecimalField(max_digits=15, decimal_places=2)
    period = models.CharField(
        max_length=20, choices=Period.choices, default=Period.MONTHLY
    )
    target_type = models.CharField(
        max_length=20,
        choices=TargetType.choices,
        default=TargetType.VARIABLE,
    )
    account = models.ForeignKey(
        Account,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="spending_targets",
    )
    active = models.BooleanField(default=True)
    warning_threshold_percent = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=Decimal("80"),
        validators=[MinValueValidator(Decimal("0")), MaxValueValidator(Decimal("100"))],
    )
    hard_limit = models.BooleanField(default=False)
    notes = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "budgets_spendingtarget"
        constraints = [
            models.UniqueConstraint(
                fields=["household", "category", "period", "account"],
                name="uniq_spending_target_household_cat_period_acct",
            )
        ]
        indexes = [
            models.Index(fields=["household", "active"]),
            models.Index(fields=["household", "category"]),
        ]
        ordering = ["category__name"]

    def __str__(self) -> str:
        label = self.name or self.category.name
        return f"{label} ({self.period})"


class Budget(models.Model):
    household = models.ForeignKey(Household, on_delete=models.CASCADE, related_name="budgets")
    category = models.ForeignKey(Category, on_delete=models.CASCADE, related_name="budgets")
    year = models.IntegerField()
    month = models.IntegerField()  # 1-12
    planned_amount = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0"))
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "budgets_budget"
        constraints = [
            models.UniqueConstraint(
                fields=["household", "category", "year", "month"],
                name="uniq_household_category_year_month",
            )
        ]
        indexes = [
            models.Index(fields=["household", "year", "month"]),
        ]
        ordering = ["year", "month", "category"]
