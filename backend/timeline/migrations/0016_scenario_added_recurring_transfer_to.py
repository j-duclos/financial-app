from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("timeline", "0015_rename_timeline_sc_scenari_added_idx_timeline_sc_scenari_e6b5ec_idx"),
    ]

    operations = [
        migrations.AddField(
            model_name="scenarioaddedrecurring",
            name="transfer_to_account",
            field=models.ForeignKey(
                blank=True,
                help_text="Destination for scenario-only transfer payments (e.g. extra debt payment).",
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="scenario_added_recurring_destinations",
                to="accounts.account",
            ),
        ),
    ]
