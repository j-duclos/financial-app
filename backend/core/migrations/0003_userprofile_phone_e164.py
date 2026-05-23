from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0002_add_default_account"),
    ]

    operations = [
        migrations.AddField(
            model_name="userprofile",
            name="phone_e164",
            field=models.CharField(
                blank=True,
                default="",
                max_length=20,
                help_text="Mobile number E.164 (e.g. +15204615387) for Plaid Link user.phone_number.",
            ),
        ),
    ]
