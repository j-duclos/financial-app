# Account lifecycle: status, timestamps, plaid_sync, net worth preservation

from django.db import migrations, models
from django.utils import timezone


def forwards_sync_status(apps, schema_editor):
    Account = apps.get_model("accounts", "Account")
    now = timezone.now()
    for acct in Account.objects.all():
        if acct.archived:
            acct.status = "archived"
            acct.archived_at = acct.archived_at or now
            acct.is_active = False
            acct.include_in_forecast = False
        elif not acct.is_active:
            acct.status = "closed"
            acct.closed_at = acct.closed_at or now.date()
            acct.include_in_forecast = False
        else:
            acct.status = "active"
        acct.save(
            update_fields=[
                "status",
                "archived_at",
                "closed_at",
                "is_active",
                "include_in_forecast",
            ]
        )


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0019_account_display_identity"),
    ]

    operations = [
        migrations.AddField(
            model_name="account",
            name="status",
            field=models.CharField(
                choices=[
                    ("active", "Active"),
                    ("archived", "Archived"),
                    ("closed", "Closed"),
                    ("deleted", "Deleted"),
                ],
                db_index=True,
                default="active",
                max_length=16,
            ),
        ),
        migrations.AddField(
            model_name="account",
            name="archived_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="account",
            name="closed_at",
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="account",
            name="deleted_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="account",
            name="is_hidden",
            field=models.BooleanField(
                default=False,
                help_text="When True, account is hidden from default UI lists.",
            ),
        ),
        migrations.AddField(
            model_name="account",
            name="close_reason",
            field=models.CharField(blank=True, default="", max_length=255),
        ),
        migrations.AddField(
            model_name="account",
            name="archive_reason",
            field=models.CharField(blank=True, default="", max_length=255),
        ),
        migrations.AddField(
            model_name="account",
            name="preserve_in_net_worth",
            field=models.BooleanField(
                default=True,
                help_text="When True, balance still counts in net-worth views after lifecycle change.",
            ),
        ),
        migrations.AddField(
            model_name="account",
            name="plaid_sync_enabled",
            field=models.BooleanField(
                default=True,
                help_text="When False, Plaid will not import new transactions for this account.",
            ),
        ),
        migrations.RunPython(forwards_sync_status, migrations.RunPython.noop),
        migrations.AddIndex(
            model_name="account",
            index=models.Index(fields=["household", "status"], name="accounts_ac_househo_status_idx"),
        ),
    ]
