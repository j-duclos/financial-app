from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0008_userprofile_onboarding"),
    ]

    operations = [
        migrations.AddField(
            model_name="userprofile",
            name="notify_1_day_before",
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name="userprofile",
            name="notify_3_days_before",
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name="userprofile",
            name="notify_day_of",
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name="userprofile",
            name="projected_funds_alerts_enabled",
            field=models.BooleanField(
                default=True,
                help_text="Master switch for projected low-balance / over-limit alerts.",
            ),
        ),
        migrations.AddField(
            model_name="userprofile",
            name="projected_funds_push_enabled",
            field=models.BooleanField(
                default=True,
                help_text="Allow Expo push for projected-funds alerts when the OS permits it.",
            ),
        ),
        migrations.AddField(
            model_name="userprofile",
            name="projected_funds_web_alerts",
            field=models.BooleanField(
                default=True,
                help_text="Show projected-funds warnings in the web app.",
            ),
        ),
    ]
