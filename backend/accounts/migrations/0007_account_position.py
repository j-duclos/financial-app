# Add position for account sort order (per household)

from django.db import migrations, models


def set_initial_positions(apps, schema_editor):
    Account = apps.get_model("accounts", "Account")
    for household_id in Account.objects.values_list("household_id", flat=True).distinct():
        for idx, acc in enumerate(Account.objects.filter(household_id=household_id).order_by("id")):
            acc.position = idx
            acc.save(update_fields=["position"])


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0006_add_interest_cycle_end_day"),
    ]

    operations = [
        migrations.AddField(
            model_name="account",
            name="position",
            field=models.PositiveIntegerField(
                default=0,
                help_text="Display order within the account list (lower = higher in list).",
            ),
        ),
        migrations.RunPython(set_initial_positions, migrations.RunPython.noop),
    ]
