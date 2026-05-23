# Generated migration for interest_cycle_end_day (savings accounts)

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0005_add_interest_rate_savings"),
    ]

    operations = [
        migrations.AddField(
            model_name="account",
            name="interest_cycle_end_day",
            field=models.PositiveSmallIntegerField(
                blank=True,
                help_text="Day of month (1-31) when interest is credited; for savings accounts.",
                null=True,
            ),
        ),
    ]
