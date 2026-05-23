# Generated manually

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ("accounts", "0012_account_archived"),
        ("core", "0002_add_default_account"),
    ]

    operations = [
        migrations.CreateModel(
            name="PlaidItem",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("item_id", models.CharField(max_length=64, unique=True)),
                ("access_token_cipher", models.TextField(help_text="Fernet-encrypted Plaid access_token")),
                ("transactions_cursor", models.CharField(blank=True, default="", max_length=768)),
                ("institution_id", models.CharField(blank=True, max_length=64)),
                ("institution_name", models.CharField(blank=True, max_length=255)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "household",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="plaid_items",
                        to="core.household",
                    ),
                ),
            ],
            options={
                "db_table": "plaid_link_plaiditem",
                "ordering": ["-created_at"],
            },
        ),
        migrations.CreateModel(
            name="PlaidLinkedAccount",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("plaid_account_id", models.CharField(max_length=64)),
                (
                    "account",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="plaid_link",
                        to="accounts.account",
                    ),
                ),
                (
                    "item",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="linked_accounts",
                        to="plaid_link.plaiditem",
                    ),
                ),
            ],
            options={
                "db_table": "plaid_link_plaidlinkedaccount",
            },
        ),
        migrations.AddIndex(
            model_name="plaiditem",
            index=models.Index(fields=["household"], name="plaid_link_p_househo_idx"),
        ),
        migrations.AddConstraint(
            model_name="plaidlinkedaccount",
            constraint=models.UniqueConstraint(fields=("item", "plaid_account_id"), name="uniq_plaid_item_plaid_account"),
        ),
    ]
