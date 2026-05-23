from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("plaid_link", "0002_rename_plaid_link_p_househo_idx_plaid_link__househo_d44a1e_idx"),
    ]

    operations = [
        migrations.AddField(
            model_name="plaidlinkedaccount",
            name="mask",
            field=models.CharField(
                blank=True,
                default="",
                max_length=16,
                help_text="Last digits Plaid reports for this account.",
            ),
        ),
    ]
