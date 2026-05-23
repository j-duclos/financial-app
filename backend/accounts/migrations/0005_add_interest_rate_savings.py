# Generated migration for interest_rate (savings accounts)

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0004_add_credit_limit"),
    ]

    operations = [
        migrations.AddField(
            model_name="account",
            name="interest_rate",
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                help_text="APY % for savings accounts (interest paid/earned).",
                max_digits=5,
                null=True,
            ),
        ),
    ]
