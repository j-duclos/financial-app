from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0025_account_minimum_payment_source_fields"),
    ]

    operations = [
        migrations.AddField(
            model_name="account",
            name="pinned_to_home",
            field=models.BooleanField(
                default=False,
                help_text="When true, this account is pinned to the Home preview (household-wide).",
            ),
        ),
        migrations.AddField(
            model_name="account",
            name="home_pin_order",
            field=models.PositiveSmallIntegerField(
                blank=True,
                help_text="Home pin slot 1–4 when pinned; null when unpinned.",
                null=True,
            ),
        ),
    ]
