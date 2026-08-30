from django.db import models

from core.models import Household


class Category(models.Model):
    class CategoryType(models.TextChoices):
        INCOME = "INCOME", "Income"
        EXPENSE = "EXPENSE", "Expense"

    household = models.ForeignKey(Household, on_delete=models.CASCADE, related_name="categories")
    name = models.CharField(max_length=255)
    category_type = models.CharField(max_length=20, choices=CategoryType.choices)
    parent = models.ForeignKey(
        "self", on_delete=models.CASCADE, null=True, blank=True, related_name="children"
    )
    is_system = models.BooleanField(default=False)
    is_archived = models.BooleanField(default=False)
    sort_order = models.IntegerField(default=0)
    #: Machine-readable semantic code (e.g. BANK_TRANSFER). Null for user-created categories.
    system_code = models.CharField(max_length=64, null=True, blank=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "categories_category"
        ordering = ["category_type", "sort_order", "name"]
        indexes = [
            models.Index(fields=["household", "category_type", "is_archived"]),
            models.Index(fields=["household", "name"]),
            models.Index(fields=["household", "system_code"]),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["household", "name", "category_type"],
                condition=models.Q(parent__isnull=True, is_archived=False),
                name="uniq_category_root_active",
            ),
            models.UniqueConstraint(
                fields=["household", "parent", "name", "category_type"],
                condition=models.Q(parent__isnull=False, is_archived=False),
                name="uniq_category_child_active",
            ),
        ]
