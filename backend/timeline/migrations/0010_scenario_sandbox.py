from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0020_account_lifecycle"),
        ("categories", "0001_initial"),
        ("timeline", "0009_recurringrule_is_bill"),
    ]

    operations = [
        migrations.AddField(
            model_name="scenario",
            name="description",
            field=models.TextField(blank=True, default=""),
        ),
        migrations.AddField(
            model_name="scenario",
            name="template",
            field=models.CharField(
                choices=[
                    ("blank", "Blank"),
                    ("buy_house", "Buy house"),
                    ("lose_job", "Lose job"),
                    ("move", "Move"),
                    ("raise_income", "Raise income"),
                    ("pay_off_debt", "Pay off debt"),
                    ("new_car", "New car"),
                    ("custom", "Custom"),
                ],
                default="blank",
                max_length=32,
            ),
        ),
        migrations.AddField(
            model_name="scenario",
            name="horizon_months",
            field=models.PositiveSmallIntegerField(
                default=12,
                help_text="Default comparison horizon in months for this scenario.",
            ),
        ),
        migrations.AddField(
            model_name="scenarioruleoverride",
            name="notes",
            field=models.TextField(blank=True, default=""),
        ),
        migrations.CreateModel(
            name="ScenarioOneTimeEvent",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("date", models.DateField()),
                ("description", models.CharField(max_length=512)),
                (
                    "direction",
                    models.CharField(
                        choices=[("INCOME", "Income"), ("EXPENSE", "Expense"), ("TRANSFER", "Transfer")],
                        max_length=20,
                    ),
                ),
                (
                    "amount",
                    models.DecimalField(
                        decimal_places=2,
                        help_text="Positive magnitude; sign derived from direction when projecting.",
                        max_digits=15,
                    ),
                ),
                ("notes", models.TextField(blank=True, default="")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "account",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="scenario_one_time_events",
                        to="accounts.account",
                    ),
                ),
                (
                    "category",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="scenario_one_time_events",
                        to="categories.category",
                    ),
                ),
                (
                    "scenario",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="one_time_events",
                        to="timeline.scenario",
                    ),
                ),
            ],
            options={
                "db_table": "timeline_scenario_one_time_event",
                "ordering": ["date", "id"],
            },
        ),
        migrations.CreateModel(
            name="ScenarioCategoryShock",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                (
                    "percent_change",
                    models.DecimalField(
                        decimal_places=2,
                        help_text="Percent change applied to projected expenses (e.g. 40 = +40%).",
                        max_digits=8,
                    ),
                ),
                ("start_date", models.DateField()),
                ("end_date", models.DateField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "category",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="scenario_category_shocks",
                        to="categories.category",
                    ),
                ),
                (
                    "scenario",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="category_shocks",
                        to="timeline.scenario",
                    ),
                ),
            ],
            options={
                "db_table": "timeline_scenario_category_shock",
                "ordering": ["start_date", "id"],
            },
        ),
        migrations.AddIndex(
            model_name="scenarioonetimeevent",
            index=models.Index(fields=["scenario", "date"], name="timeline_sc_scenario_0a8f2d_idx"),
        ),
    ]
