from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0013_account_last_four"),
    ]

    operations = [
        migrations.AddField(
            model_name="account",
            name="preserve_partner_transfer_legs",
            field=models.BooleanField(
                default=False,
                help_text=(
                    "When True, deleting or clearing the other account's side of a linked transfer "
                    "removes only that side; this account's row stays as a standalone entry (link removed). "
                    "Use for institutions that cannot sync via Plaid."
                ),
            ),
        ),
    ]
