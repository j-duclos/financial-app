from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0017_credit_card_modeling"),
        ("timeline", "0012_rename_timeline_sc_scenario_0a8f2d_idx_timeline_sc_scenari_22e7a2_idx"),
    ]

    operations = [
        migrations.AddField(
            model_name="scenarioonetimeevent",
            name="transfer_to_account",
            field=models.ForeignKey(
                blank=True,
                help_text="Required for TRANSFER direction — destination account.",
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="scenario_one_time_transfer_destinations",
                to="accounts.account",
            ),
        ),
    ]
