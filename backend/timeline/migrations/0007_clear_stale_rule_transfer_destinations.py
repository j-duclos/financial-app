# Generated manually — clears transfer_to_account_id when category is not a transfer/card-pay rule.

from django.db import migrations


def clear_stale_transfers(apps, schema_editor):
    RecurringRule = apps.get_model("timeline", "RecurringRule")
    Category = apps.get_model("categories", "Category")
    allowed = {"Credit Card Payment", "Bank Transfer"}
    qs = RecurringRule.objects.exclude(transfer_to_account_id__isnull=True).only(
        "id", "category_id", "transfer_to_account_id"
    )
    for rule in qs.iterator():
        name = ""
        if rule.category_id:
            c = Category.objects.filter(pk=rule.category_id).first()
            name = (getattr(c, "name", None) or "").strip() if c else ""
        if name not in allowed:
            RecurringRule.objects.filter(pk=rule.pk).update(transfer_to_account_id=None)


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("timeline", "0006_interest_cycle_skip"),
    ]

    operations = [
        migrations.RunPython(clear_stale_transfers, noop_reverse),
    ]
