# Add include_in_forecast to control which accounts appear in timeline scenarios

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0008_promotional_apr"),
    ]

    operations = [
        migrations.AddField(
            model_name="account",
            name="include_in_forecast",
            field=models.BooleanField(
                default=True,
                help_text="When true, this account is included in timeline scenarios.",
            ),
        ),
    ]
