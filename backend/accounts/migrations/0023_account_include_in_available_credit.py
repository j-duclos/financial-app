from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0022_account_target_utilization_percent"),
    ]

    operations = [
        migrations.AddField(
            model_name="account",
            name="include_in_available_credit",
            field=models.BooleanField(
                default=True,
                help_text=(
                    "When true, this credit card counts toward dashboard Available Credit "
                    "totals and utilization."
                ),
            ),
        ),
    ]
