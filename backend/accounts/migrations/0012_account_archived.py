# Add archived boolean for Active/Archived checkbox

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0011_account_nickname"),
    ]

    operations = [
        migrations.AddField(
            model_name="account",
            name="archived",
            field=models.BooleanField(
                default=False,
                help_text="When True, account is archived (inactive). Used for Active/Archived checkbox.",
            ),
        ),
    ]
