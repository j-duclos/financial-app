from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0006_userprofile_default_forecast_days"),
    ]

    operations = [
        migrations.AddField(
            model_name="userprofile",
            name="email_verified_at",
            field=models.DateTimeField(
                blank=True,
                help_text="When the user confirmed the email currently stored on Django User.",
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="userprofile",
            name="email_verification_sent_at",
            field=models.DateTimeField(
                blank=True,
                help_text="Last time a verification email was sent. Used for UX, not as the token store.",
                null=True,
            ),
        ),
    ]
