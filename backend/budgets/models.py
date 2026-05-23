from decimal import Decimal

from django.db import models

from categories.models import Category
from core.models import Household


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
