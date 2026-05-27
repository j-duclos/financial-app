# Goal Buckets — allocation layer on accounts

import django.db.models.deletion
from decimal import Decimal
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0001_initial"),
        ("transactions", "0001_initial"),
        ("timeline", "0001_timeline_models"),
        ("goals", "0002_add_purchase_goal_type"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="GoalBucket",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=255)),
                ("description", models.TextField(blank=True, default="")),
                (
                    "type",
                    models.CharField(
                        choices=[
                            ("emergency", "Emergency"),
                            ("purchase", "Purchase"),
                            ("vacation", "Vacation"),
                            ("house", "House"),
                            ("education", "Education"),
                            ("debt_payoff", "Debt payoff"),
                            ("retirement", "Retirement"),
                            ("custom", "Custom"),
                        ],
                        default="custom",
                        max_length=32,
                    ),
                ),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("active", "Active"),
                            ("paused", "Paused"),
                            ("completed", "Completed"),
                            ("archived", "Archived"),
                        ],
                        db_index=True,
                        default="active",
                        max_length=16,
                    ),
                ),
                (
                    "priority",
                    models.CharField(
                        choices=[("high", "High"), ("medium", "Medium"), ("low", "Low")],
                        db_index=True,
                        default="medium",
                        max_length=16,
                    ),
                ),
                ("target_amount", models.DecimalField(decimal_places=2, max_digits=15)),
                ("allocated_amount", models.DecimalField(decimal_places=2, default=Decimal("0"), max_digits=15)),
                ("start_date", models.DateField(blank=True, null=True)),
                ("target_date", models.DateField(blank=True, null=True)),
                ("monthly_target", models.DecimalField(decimal_places=2, default=Decimal("0"), max_digits=15)),
                ("auto_fund_enabled", models.BooleanField(default=False)),
                ("forecast_enabled", models.BooleanField(default=True)),
                ("include_in_safe_to_spend", models.BooleanField(default=True)),
                ("notes", models.TextField(blank=True, default="")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("completed_at", models.DateTimeField(blank=True, null=True)),
                (
                    "created_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="goal_buckets_created",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "household",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="goal_buckets",
                        to="core.household",
                    ),
                ),
                (
                    "legacy_goal",
                    models.OneToOneField(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="bucket",
                        to="goals.financialgoal",
                    ),
                ),
                (
                    "linked_account",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="goal_buckets",
                        to="accounts.account",
                    ),
                ),
            ],
            options={
                "db_table": "goals_goal_bucket",
                "ordering": ["priority", "-created_at"],
            },
        ),
        migrations.CreateModel(
            name="GoalContribution",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("amount", models.DecimalField(decimal_places=2, max_digits=15)),
                ("date", models.DateField(db_index=True)),
                (
                    "source",
                    models.CharField(
                        choices=[
                            ("manual", "Manual"),
                            ("transfer", "Transfer"),
                            ("rule", "Rule"),
                            ("auto", "Auto"),
                            ("plaid", "Plaid"),
                        ],
                        default="manual",
                        max_length=16,
                    ),
                ),
                ("notes", models.CharField(blank=True, default="", max_length=255)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "account",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="goal_contributions",
                        to="accounts.account",
                    ),
                ),
                (
                    "bucket",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="contributions",
                        to="goals.goalbucket",
                    ),
                ),
                (
                    "transaction",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="goal_contributions",
                        to="transactions.transaction",
                    ),
                ),
            ],
            options={
                "db_table": "goals_goal_contribution",
                "ordering": ["-date", "-id"],
            },
        ),
        migrations.CreateModel(
            name="RuleAllocation",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("percent", models.DecimalField(blank=True, decimal_places=2, max_digits=6, null=True)),
                ("fixed_amount", models.DecimalField(blank=True, decimal_places=2, max_digits=15, null=True)),
                ("active", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "bucket",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="rule_allocations",
                        to="goals.goalbucket",
                    ),
                ),
                (
                    "rule",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="bucket_allocations",
                        to="timeline.recurringrule",
                    ),
                ),
            ],
            options={
                "db_table": "goals_rule_allocation",
                "unique_together": {("rule", "bucket")},
            },
        ),
        migrations.AddIndex(
            model_name="goalbucket",
            index=models.Index(fields=["household", "status"], name="goals_goal__househo_idx"),
        ),
        migrations.AddIndex(
            model_name="goalbucket",
            index=models.Index(fields=["linked_account", "status"], name="goals_goal__linked__idx"),
        ),
        migrations.AddIndex(
            model_name="goalcontribution",
            index=models.Index(fields=["bucket", "date"], name="goals_goal__bucket__idx"),
        ),
        migrations.AddIndex(
            model_name="goalcontribution",
            index=models.Index(fields=["account", "date"], name="goals_goal__account_idx"),
        ),
    ]
