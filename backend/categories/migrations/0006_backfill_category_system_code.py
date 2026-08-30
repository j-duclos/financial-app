# Backfill machine-readable system_code for known transfer/payment categories.

from django.db import migrations

# Keep in sync with categories.semantics.SEED_NAME_TO_SYSTEM_CODE at migration time.
_SEED_NAME_TO_SYSTEM_CODE = {
    "Transfer": "TRANSFER",
    "Bank Transfer": "BANK_TRANSFER",
    "Credit Card Payment": "CREDIT_CARD_PAYMENT",
}


def backfill_system_codes(apps, schema_editor):
    Category = apps.get_model("categories", "Category")
    for name, code in _SEED_NAME_TO_SYSTEM_CODE.items():
        Category.objects.filter(name=name, system_code__isnull=True).update(system_code=code)


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("categories", "0005_category_system_code"),
    ]

    operations = [
        migrations.RunPython(backfill_system_codes, noop_reverse),
    ]
