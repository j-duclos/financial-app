# Generated manually for recurring rule schedule segments

from django.db import migrations, models
import django.db.models.deletion


def backfill_schedules(apps, schema_editor):
    RecurringRule = apps.get_model("timeline", "RecurringRule")
    RecurringRuleSchedule = apps.get_model("timeline", "RecurringRuleSchedule")
    for rule in RecurringRule.objects.all().iterator():
        if RecurringRuleSchedule.objects.filter(rule_id=rule.pk).exists():
            continue
        RecurringRuleSchedule.objects.create(
            rule_id=rule.pk,
            effective_from=rule.start_date,
            account_id=rule.account_id,
            transfer_to_account_id=rule.transfer_to_account_id,
            category_id=rule.category_id,
            direction=rule.direction,
            amount=rule.amount,
            currency=rule.currency or "USD",
            frequency=rule.frequency,
            interval=rule.interval or 1,
            day_of_week=rule.day_of_week,
            day_of_month=rule.day_of_month,
            nth_week=rule.nth_week,
            start_date=rule.start_date,
            end_date=rule.end_date,
        )


class Migration(migrations.Migration):

    dependencies = [
        ("timeline", "0016_scenario_added_recurring_transfer_to"),
        ("accounts", "0001_initial"),
        ("categories", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="RecurringRuleSchedule",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("effective_from", models.DateField()),
                ("direction", models.CharField(max_length=20)),
                ("amount", models.DecimalField(decimal_places=2, max_digits=15)),
                ("currency", models.CharField(default="USD", max_length=3)),
                ("frequency", models.CharField(max_length=30)),
                ("interval", models.PositiveIntegerField(default=1)),
                ("day_of_week", models.PositiveSmallIntegerField(blank=True, null=True)),
                ("day_of_month", models.PositiveSmallIntegerField(blank=True, null=True)),
                ("nth_week", models.PositiveSmallIntegerField(blank=True, null=True)),
                ("start_date", models.DateField()),
                ("end_date", models.DateField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "account",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="recurring_rule_schedules",
                        to="accounts.account",
                    ),
                ),
                (
                    "category",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="recurring_rule_schedules",
                        to="categories.category",
                    ),
                ),
                (
                    "rule",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="schedules",
                        to="timeline.recurringrule",
                    ),
                ),
                (
                    "transfer_to_account",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="recurring_rule_schedule_destinations",
                        to="accounts.account",
                    ),
                ),
            ],
            options={
                "db_table": "timeline_recurring_rule_schedule",
                "ordering": ["effective_from", "id"],
            },
        ),
        migrations.AddIndex(
            model_name="recurringruleschedule",
            index=models.Index(fields=["rule", "effective_from"], name="timeline_ru_rule_id_eff_idx"),
        ),
        migrations.AddConstraint(
            model_name="recurringruleschedule",
            constraint=models.UniqueConstraint(
                fields=("rule", "effective_from"),
                name="uniq_rule_schedule_rule_effective_from",
            ),
        ),
        migrations.RunPython(backfill_schedules, migrations.RunPython.noop),
    ]
