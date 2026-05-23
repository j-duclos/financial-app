# Generated migration for billing_cycle_end_day

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0002_add_starting_balance_apr"),
    ]

    operations = [
        migrations.AddField(
            model_name="account",
            name="billing_cycle_end_day",
            field=models.PositiveSmallIntegerField(
                blank=True,
                help_text="Day of month (1-31) when the billing cycle ends; used for interest calculation. Credit cards only.",
                null=True,
            ),
        ),
    ]
