from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("timeline", "0007_clear_stale_rule_transfer_destinations"),
    ]

    operations = [
        migrations.AddField(
            model_name="recurringrule",
            name="paused_at",
            field=models.DateField(
                blank=True,
                help_text="When set with active=False, no occurrences on or after this date are projected or materialized.",
                null=True,
            ),
        ),
    ]
