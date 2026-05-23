from decimal import Decimal

from django.db import migrations, models


def backfill_account_roles(apps, schema_editor):
    Account = apps.get_model("accounts", "Account")
    mapping = {
        "CHECKING": "spending",
        "SAVINGS": "savings",
        "CREDIT": "credit_card",
    }
    for account in Account.objects.all().only("id", "account_type", "role"):
        account.role = mapping.get(account.account_type, "other")
        account.save(update_fields=["role"])


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0015_alter_account_preserve_partner_transfer_legs"),
    ]

    operations = [
        migrations.AddField(
            model_name="account",
            name="minimum_buffer",
            field=models.DecimalField(
                decimal_places=2,
                default=Decimal("0"),
                help_text="Amount to keep untouched in this account for safety.",
                max_digits=12,
            ),
        ),
        migrations.AddField(
            model_name="account",
            name="role",
            field=models.CharField(
                choices=[
                    ("spending", "Spending"),
                    ("bills", "Bills"),
                    ("savings", "Savings"),
                    ("emergency_fund", "Emergency Fund"),
                    ("credit_card", "Credit Card"),
                    ("loan", "Loan"),
                    ("investment", "Investment"),
                    ("cash_reserve", "Cash Reserve"),
                    ("other", "Other"),
                ],
                db_index=True,
                default="other",
                max_length=32,
            ),
        ),
        migrations.RunPython(backfill_account_roles, migrations.RunPython.noop),
    ]
