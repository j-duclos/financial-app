# Generated manually for reconciliation history support

from decimal import Decimal

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("transactions", "0010_account_relationships"),
    ]

    operations = [
        migrations.AddField(
            model_name="reconciliation",
            name="is_active",
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name="reconciliation",
            name="notes",
            field=models.TextField(blank=True, default=""),
        ),
        migrations.AddField(
            model_name="reconciliation",
            name="transaction_count",
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="reconciliation",
            name="undone_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="reconciliation",
            name="undone_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="reconciliations_undone",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="reconciliation",
            name="updated_at",
            field=models.DateTimeField(auto_now=True),
        ),
        migrations.AlterField(
            model_name="reconciliation",
            name="difference",
            field=models.DecimalField(decimal_places=2, default=Decimal("0"), max_digits=15),
        ),
        migrations.AddIndex(
            model_name="reconciliation",
            index=models.Index(
                fields=["account", "is_active", "-completed_at"],
                name="transaction_account_8a1f0d_idx",
            ),
        ),
        migrations.CreateModel(
            name="ReconciliationEntry",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                (
                    "reconciled_balance",
                    models.DecimalField(blank=True, decimal_places=2, max_digits=15, null=True),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "session",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="entries",
                        to="transactions.reconciliation",
                    ),
                ),
                (
                    "transaction",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="reconciliation_entries",
                        to="transactions.transaction",
                    ),
                ),
            ],
            options={
                "db_table": "transactions_reconciliation_entry",
                "ordering": ["transaction__date", "transaction__id"],
            },
        ),
        migrations.AddConstraint(
            model_name="reconciliationentry",
            constraint=models.UniqueConstraint(
                fields=("session", "transaction"),
                name="uniq_reconciliation_entry_session_txn",
            ),
        ),
    ]
