from django.db import migrations, models
from django.utils import timezone


def complete_established_users(apps, schema_editor):
    UserProfile = apps.get_model("core", "UserProfile")
    HouseholdMembership = apps.get_model("core", "HouseholdMembership")
    Account = apps.get_model("accounts", "Account")
    Transaction = apps.get_model("transactions", "Transaction")
    RecurringRule = apps.get_model("timeline", "RecurringRule")

    now = timezone.now()
    for profile in UserProfile.objects.filter(onboarding_completed_at__isnull=True).iterator():
        household_ids = list(
            HouseholdMembership.objects.filter(user_id=profile.user_id).values_list(
                "household_id", flat=True
            )
        )
        if not household_ids:
            continue
        has_account = Account.objects.filter(household_id__in=household_ids).exists()
        if not has_account:
            continue
        has_transaction = Transaction.objects.filter(account__household_id__in=household_ids).exists()
        has_recurring = RecurringRule.objects.filter(household_id__in=household_ids).exists()
        if has_transaction or has_recurring:
            profile.onboarding_completed_at = now
            profile.save(update_fields=["onboarding_completed_at"])


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0007_userprofile_email_verification"),
        ("accounts", "0001_initial"),
        ("transactions", "0001_initial"),
        ("timeline", "0001_timeline_models"),
    ]

    operations = [
        migrations.AddField(
            model_name="userprofile",
            name="onboarding_completed_at",
            field=models.DateTimeField(
                blank=True,
                help_text="When first-run onboarding was completed (automatically or explicitly).",
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="userprofile",
            name="onboarding_dismissed_at",
            field=models.DateTimeField(
                blank=True,
                help_text="When the user skipped the first-run welcome. Empty-state copy can still appear.",
                null=True,
            ),
        ),
        migrations.RunPython(complete_established_users, noop_reverse),
    ]
