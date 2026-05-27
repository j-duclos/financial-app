from decimal import Decimal

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0021_rename_accounts_ac_househo_status_idx_accounts_ac_househo_fc1084_idx_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="account",
            name="target_utilization_percent",
            field=models.DecimalField(
                decimal_places=2,
                default=Decimal("10"),
                help_text=(
                    "Target credit utilization percent for health scoring (e.g. 10). "
                    "At or below this is healthy; higher utilization escalates watch/risk/critical."
                ),
                max_digits=5,
            ),
        ),
    ]
