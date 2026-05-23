# Add optional nickname/purpose for accounts

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0010_alter_account_options"),
    ]

    operations = [
        migrations.AddField(
            model_name="account",
            name="nickname",
            field=models.CharField(
                blank=True,
                help_text="Optional nickname or purpose (e.g. Main Spending, Emergency Savings).",
                max_length=255,
            ),
        ),
    ]
