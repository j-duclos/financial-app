# Generated migration for credit_limit (credit cards)

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0003_billing_cycle_end_day"),
    ]

    operations = [
        migrations.AddField(
            model_name="account",
            name="credit_limit",
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                help_text="Credit limit for credit cards; used to show available credit.",
                max_digits=15,
                null=True,
            ),
        ),
    ]
