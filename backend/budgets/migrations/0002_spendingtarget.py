# Generated manually for SpendingTarget model

import django.core.validators
from decimal import Decimal
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0001_initial"),
        ("categories", "0001_initial"),
        ("core", "0001_initial"),
        ("budgets", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="SpendingTarget",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(blank=True, default="", max_length=255)),
                ("target_amount", models.DecimalField(decimal_places=2, max_digits=15)),
                (
                    "period",
                    models.CharField(
                        choices=[
                            ("weekly", "Weekly"),
                            ("monthly", "Monthly"),
                            ("quarterly", "Quarterly"),
                            ("yearly", "Yearly"),
                        ],
                        default="monthly",
                        max_length=20,
                    ),
                ),
                ("active", models.BooleanField(default=True)),
                (
                    "warning_threshold_percent",
                    models.DecimalField(
                        decimal_places=2,
                        default=Decimal("80"),
                        max_digits=5,
                        validators=[
                            django.core.validators.MinValueValidator(Decimal("0")),
                            django.core.validators.MaxValueValidator(Decimal("100")),
                        ],
                    ),
                ),
                ("hard_limit", models.BooleanField(default=False)),
                ("notes", models.TextField(blank=True, default="")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "account",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="spending_targets",
                        to="accounts.account",
                    ),
                ),
                (
                    "category",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="spending_targets",
                        to="categories.category",
                    ),
                ),
                (
                    "household",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="spending_targets",
                        to="core.household",
                    ),
                ),
            ],
            options={
                "db_table": "budgets_spendingtarget",
                "ordering": ["category__name"],
            },
        ),
        migrations.AddIndex(
            model_name="spendingtarget",
            index=models.Index(fields=["household", "active"], name="budgets_spe_househo_idx"),
        ),
        migrations.AddIndex(
            model_name="spendingtarget",
            index=models.Index(fields=["household", "category"], name="budgets_spe_househo_cat_idx"),
        ),
        migrations.AddConstraint(
            model_name="spendingtarget",
            constraint=models.UniqueConstraint(
                fields=("household", "category", "period", "account"),
                name="uniq_spending_target_household_cat_period_acct",
            ),
        ),
    ]
