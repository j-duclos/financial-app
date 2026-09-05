from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("plaid_link", "0004_plaid_item_last_sync_at"),
    ]

    operations = [
        migrations.AddField(
            model_name="plaiditem",
            name="liabilities_last_sync_at",
            field=models.DateTimeField(
                blank=True,
                help_text="When credit liabilities were last requested from Plaid for this login.",
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="plaiditem",
            name="liabilities_sync_status",
            field=models.CharField(
                blank=True,
                default="",
                help_text="Last liabilities sync status for this Item (ok, unsupported, reauthorization_required, ...).",
                max_length=32,
            ),
        ),
    ]
