# Generated manually for Plaid import support

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("transactions", "0004_interest_cycle_anchor"),
    ]

    operations = [
        migrations.AddField(
            model_name="transaction",
            name="plaid_transaction_id",
            field=models.CharField(blank=True, db_index=True, max_length=128, null=True, unique=True),
        ),
        migrations.AlterField(
            model_name="transaction",
            name="source",
            field=models.CharField(
                choices=[
                    ("ACTUAL", "Actual"),
                    ("RULE", "From rule"),
                    ("ONE_TIME", "One-time planned"),
                    ("INTEREST", "Projected interest"),
                    ("PLAID", "Imported from Plaid"),
                ],
                default="ACTUAL",
                max_length=20,
            ),
        ),
    ]
