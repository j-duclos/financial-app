from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0001_initial"),
        ("categories", "0001_initial"),
        ("timeline", "0013_scenario_one_time_event_transfer_to"),
    ]

    operations = [
        migrations.CreateModel(
            name="ScenarioAddedRecurring",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=255)),
                ("direction", models.CharField(
                    choices=[("INCOME", "Income"), ("EXPENSE", "Expense"), ("TRANSFER", "Transfer")],
                    max_length=20,
                )),
                ("amount", models.DecimalField(decimal_places=2, max_digits=15)),
                ("currency", models.CharField(default="USD", max_length=3)),
                ("frequency", models.CharField(
                    choices=[
                        ("WEEKLY", "Weekly"),
                        ("BIWEEKLY", "Biweekly"),
                        ("MONTHLY_DAY", "Monthly (day of month)"),
                        ("MONTHLY_NTH_WEEKDAY", "Monthly (nth weekday)"),
                        ("YEARLY", "Yearly"),
                    ],
                    max_length=30,
                )),
                ("interval", models.PositiveIntegerField(default=1)),
                ("day_of_week", models.PositiveSmallIntegerField(blank=True, null=True)),
                ("day_of_month", models.PositiveSmallIntegerField(blank=True, null=True)),
                ("nth_week", models.PositiveSmallIntegerField(blank=True, null=True)),
                ("start_date", models.DateField()),
                ("end_date", models.DateField(blank=True, null=True)),
                ("notes", models.TextField(blank=True, default="")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "account",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="scenario_added_recurring",
                        to="accounts.account",
                    ),
                ),
                (
                    "category",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="scenario_added_recurring",
                        to="categories.category",
                    ),
                ),
                (
                    "scenario",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="added_recurring",
                        to="timeline.scenario",
                    ),
                ),
            ],
            options={
                "db_table": "timeline_scenario_added_recurring",
                "ordering": ["name", "id"],
            },
        ),
        migrations.AddIndex(
            model_name="scenarioaddedrecurring",
            index=models.Index(fields=["scenario", "start_date"], name="timeline_sc_scenari_added_idx"),
        ),
    ]
