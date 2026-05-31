from django.db import migrations


def set_fixed_for_recurring_categories(apps, schema_editor):
    SpendingTarget = apps.get_model("budgets", "SpendingTarget")
    RecurringRule = apps.get_model("timeline", "RecurringRule")

    for target in SpendingTarget.objects.select_related("category").iterator():
        if not target.category_id:
            continue
        has_rule = RecurringRule.objects.filter(
            household_id=target.household_id,
            active=True,
            direction="EXPENSE",
            category_id=target.category_id,
        ).exists()
        if has_rule and target.target_type != "fixed":
            SpendingTarget.objects.filter(pk=target.pk).update(target_type="fixed")


class Migration(migrations.Migration):
    dependencies = [
        ("budgets", "0003_spendingtarget_target_type"),
        ("timeline", "0001_timeline_models"),
    ]

    operations = [
        migrations.RunPython(set_fixed_for_recurring_categories, migrations.RunPython.noop),
    ]
