# Generated migration for credit card modeling

from decimal import Decimal

from django.db import migrations, models
import django.db.models.deletion


def copy_billing_to_statement_closing(apps, schema_editor):
    Account = apps.get_model("accounts", "Account")
    for acc in Account.objects.filter(account_type="CREDIT"):
        if acc.billing_cycle_end_day and not acc.statement_closing_day:
            acc.statement_closing_day = acc.billing_cycle_end_day
            acc.save(update_fields=["statement_closing_day"])


def sync_credit_balances_from_starting(apps, schema_editor):
    Account = apps.get_model("accounts", "Account")
    for acc in Account.objects.filter(account_type="CREDIT"):
        sb = acc.starting_balance
        if sb is not None and Decimal(str(sb)) > 0:
            acc.current_balance = Decimal(str(sb))
            acc.save(update_fields=["current_balance"])


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0016_account_role_minimum_buffer"),
        ("transactions", "0008_reconciliation_period_dates"),
    ]

    operations = [
        migrations.AddField(
            model_name="account",
            name="statement_closing_day",
            field=models.PositiveSmallIntegerField(
                blank=True,
                help_text="Day of month (1-31) when the statement closes. Credit cards only.",
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="account",
            name="payment_due_day",
            field=models.PositiveSmallIntegerField(
                blank=True,
                help_text="Day of month (1-31) when payment is due. Credit cards only.",
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="account",
            name="current_balance",
            field=models.DecimalField(
                decimal_places=2,
                default=Decimal("0"),
                help_text="Total amount currently owed (positive = debt). Credit cards only.",
                max_digits=12,
            ),
        ),
        migrations.AddField(
            model_name="account",
            name="statement_balance",
            field=models.DecimalField(
                decimal_places=2,
                default=Decimal("0"),
                help_text="Amount from the last closed statement (positive = owed). Credit cards only.",
                max_digits=12,
            ),
        ),
        migrations.AddField(
            model_name="account",
            name="last_statement_date",
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="account",
            name="next_statement_date",
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="account",
            name="next_payment_due_date",
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="account",
            name="minimum_payment_amount",
            field=models.DecimalField(decimal_places=2, default=Decimal("0"), max_digits=12),
        ),
        migrations.AddField(
            model_name="account",
            name="autopay_enabled",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="account",
            name="autopay_type",
            field=models.CharField(
                blank=True,
                choices=[
                    ("minimum_payment", "Minimum payment"),
                    ("statement_balance", "Statement balance"),
                    ("current_balance", "Current balance"),
                    ("fixed_amount", "Fixed amount"),
                    ("custom_amount", "Custom amount"),
                ],
                default="",
                max_length=32,
            ),
        ),
        migrations.AddField(
            model_name="account",
            name="autopay_fixed_amount",
            field=models.DecimalField(decimal_places=2, default=Decimal("0"), max_digits=12),
        ),
        migrations.AddField(
            model_name="account",
            name="autopay_account",
            field=models.ForeignKey(
                blank=True,
                help_text="Checking/savings account that funds autopay.",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="autopay_funded_credit_cards",
                to="accounts.account",
            ),
        ),
        migrations.CreateModel(
            name="CreditCardStatement",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("period_start", models.DateField()),
                ("period_end", models.DateField()),
                ("statement_balance", models.DecimalField(decimal_places=2, max_digits=12)),
                ("minimum_payment", models.DecimalField(decimal_places=2, default=Decimal("0"), max_digits=12)),
                ("payment_due_date", models.DateField()),
                ("amount_paid", models.DecimalField(decimal_places=2, default=Decimal("0"), max_digits=12)),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("open", "Open"),
                            ("closed", "Closed"),
                            ("paid", "Paid"),
                            ("partial", "Partial"),
                            ("late", "Late"),
                        ],
                        default="open",
                        max_length=16,
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "account",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="credit_card_statements",
                        to="accounts.account",
                    ),
                ),
            ],
            options={
                "db_table": "accounts_credit_card_statement",
                "ordering": ["-period_end", "-id"],
            },
        ),
        migrations.AddConstraint(
            model_name="creditcardstatement",
            constraint=models.UniqueConstraint(
                fields=("account", "period_start", "period_end"),
                name="uniq_credit_card_statement_period",
            ),
        ),
        migrations.RunPython(copy_billing_to_statement_closing, migrations.RunPython.noop),
        migrations.RunPython(sync_credit_balances_from_starting, migrations.RunPython.noop),
    ]
