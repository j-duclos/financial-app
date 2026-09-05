from decimal import Decimal

from django.db import migrations, models


def backfill_existing_credit_minimums(apps, schema_editor):
    Account = apps.get_model("accounts", "Account")
    credit_accounts = Account.objects.filter(account_type="CREDIT")
    for account in credit_accounts.iterator(chunk_size=200):
        amount = account.minimum_payment_amount
        if amount is None:
            continue
        if amount > Decimal("0"):
            Account.objects.filter(pk=account.pk).update(
                minimum_payment_mode="manual",
                manual_minimum_payment_amount=amount,
            )


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0024_alter_account_include_in_available_credit"),
    ]

    operations = [
        migrations.AddField(
            model_name="account",
            name="minimum_payment_mode",
            field=models.CharField(
                choices=[
                    ("automatic", "Automatically sync from institution"),
                    ("manual", "Enter manually"),
                ],
                default="manual",
                help_text="Whether the effective minimum follows Plaid or a user-entered value.",
                max_length=16,
            ),
        ),
        migrations.AddField(
            model_name="account",
            name="manual_minimum_payment_amount",
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                help_text="User-entered minimum. Preserved as fallback when automatic mode has no provider value.",
                max_digits=12,
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="account",
            name="provider_minimum_payment_amount",
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                help_text="Last valid minimum observed from Plaid liabilities.",
                max_digits=12,
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="account",
            name="provider_minimum_payment_source",
            field=models.CharField(
                blank=True,
                default="",
                help_text="Provenance of provider_minimum_payment_amount (e.g. plaid).",
                max_length=16,
            ),
        ),
        migrations.AddField(
            model_name="account",
            name="provider_minimum_payment_observed_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="account",
            name="provider_minimum_payment_statement_date",
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="account",
            name="provider_minimum_payment_due_date",
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="account",
            name="provider_minimum_payment_sync_status",
            field=models.CharField(
                blank=True,
                default="",
                help_text="Last liabilities sync status for this account.",
                max_length=32,
            ),
        ),
        migrations.AddField(
            model_name="account",
            name="provider_minimum_payment_sync_message",
            field=models.CharField(blank=True, default="", max_length=255),
        ),
        migrations.AlterField(
            model_name="account",
            name="minimum_payment_amount",
            field=models.DecimalField(
                decimal_places=2,
                default=Decimal("0"),
                help_text="Resolved effective minimum used by DTI, Payment Planner, autopay, and health.",
                max_digits=12,
            ),
        ),
        migrations.RunPython(backfill_existing_credit_minimums, noop_reverse),
    ]
