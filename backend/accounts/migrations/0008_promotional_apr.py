# Add promotional APR and end date for credit card intro periods (e.g. 0% for 12 months)

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0007_account_position"),
    ]

    operations = [
        migrations.AddField(
            model_name="account",
            name="promotional_apr",
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                help_text="Promotional APR % (e.g. 0 for interest-free). Used until promotional_end_date; then standard APR applies.",
                max_digits=5,
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="account",
            name="promotional_end_date",
            field=models.DateField(
                blank=True,
                help_text="Last date the promotional APR applies (e.g. end of 0% intro period). After this date, standard APR is used.",
                null=True,
            ),
        ),
    ]
