from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("timeline", "0010_scenario_sandbox"),
    ]

    operations = [
        migrations.AddField(
            model_name="recurringrule",
            name="payment_flexibility_days",
            field=models.PositiveSmallIntegerField(
                default=0,
                help_text="Max days this bill may be delayed without penalty (0 = not flexible).",
            ),
        ),
    ]
