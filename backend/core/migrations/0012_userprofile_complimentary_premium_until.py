from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0011_userprofile_test_plan_override"),
    ]

    operations = [
        migrations.AddField(
            model_name="userprofile",
            name="complimentary_premium_until",
            field=models.DateTimeField(
                blank=True,
                default=None,
                help_text=(
                    "Admin-granted complimentary Premium for beta testers. A future "
                    "timestamp grants Premium without Stripe. Clear the field to revoke. "
                    "Expired timestamps do not grant Premium. Does not change Stripe IDs."
                ),
                null=True,
            ),
        ),
    ]
