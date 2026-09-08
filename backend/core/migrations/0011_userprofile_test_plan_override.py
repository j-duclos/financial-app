from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0010_feedback_review_prompt"),
    ]

    operations = [
        migrations.AddField(
            model_name="userprofile",
            name="test_plan_override",
            field=models.CharField(
                blank=True,
                choices=[("FREE", "Free"), ("PREMIUM", "Premium")],
                default=None,
                help_text=(
                    "Development-only plan simulation. Ignored unless DEBUG and "
                    "ALLOW_PLAN_TEST_OVERRIDE are both true. Does not change Stripe."
                ),
                max_length=16,
                null=True,
            ),
        ),
    ]
