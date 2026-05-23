from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0012_account_archived"),
    ]

    operations = [
        migrations.AddField(
            model_name="account",
            name="last_four",
            field=models.CharField(
                blank=True,
                default="",
                help_text="Last four digits of the account or card (digits only). Used to attach Plaid to this row without matching by name.",
                max_length=4,
            ),
        ),
    ]
