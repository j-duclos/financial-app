# Generated manually — autopay mode on recurring rules for bill management

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("bills", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="billoccurrence",
            name="autopay_override",
            field=models.CharField(
                blank=True,
                choices=[
                    ("manual", "Manual"),
                    ("autopay", "Autopay"),
                    ("unknown", "Unknown"),
                ],
                default="",
                help_text="User override for autopay detection on this occurrence.",
                max_length=16,
            ),
        ),
        migrations.AddField(
            model_name="billoccurrence",
            name="warning_snoozed_until",
            field=models.DateField(blank=True, null=True),
        ),
    ]
