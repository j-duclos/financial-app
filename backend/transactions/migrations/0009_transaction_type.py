from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("transactions", "0008_reconciliation_period_dates"),
    ]

    operations = [
        migrations.AddField(
            model_name="transaction",
            name="transaction_type",
            field=models.CharField(
                choices=[
                    ("other", "Other"),
                    ("credit_card_purchase", "Credit card purchase"),
                    ("credit_card_payment", "Credit card payment"),
                    ("credit_card_refund", "Credit card refund"),
                    ("interest_charge", "Interest charge"),
                    ("fee", "Fee"),
                    ("balance_adjustment", "Balance adjustment"),
                    ("transfer", "Transfer"),
                ],
                db_index=True,
                default="other",
                max_length=32,
            ),
        ),
    ]
