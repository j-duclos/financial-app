import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0009_userprofile_projected_funds_prefs"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="ReviewPromptState",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True, primary_key=True, serialize=False, verbose_name="ID"
                    ),
                ),
                ("first_eligible_use_at", models.DateTimeField(blank=True, null=True)),
                ("session_count", models.PositiveIntegerField(default=0)),
                ("last_session_at", models.DateTimeField(blank=True, null=True)),
                ("last_prompted_at", models.DateTimeField(blank=True, null=True)),
                (
                    "enjoyment_prompt_ats",
                    models.JSONField(
                        blank=True,
                        default=list,
                        help_text="ISO timestamps of enjoyment prompts shown.",
                    ),
                ),
                ("enjoyment_response", models.CharField(blank=True, default="", max_length=16)),
                ("review_asked_at", models.DateTimeField(blank=True, null=True)),
                ("feedback_submitted_at", models.DateTimeField(blank=True, null=True)),
                ("dismissed_until", models.DateTimeField(blank=True, null=True)),
                ("review_flow_completed", models.BooleanField(default=False)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "user",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="review_prompt_state",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "db_table": "core_review_prompt_state",
            },
        ),
        migrations.CreateModel(
            name="Feedback",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True, primary_key=True, serialize=False, verbose_name="ID"
                    ),
                ),
                (
                    "source",
                    models.CharField(
                        choices=[("mobile", "Mobile"), ("web", "Web")],
                        default="mobile",
                        max_length=16,
                    ),
                ),
                (
                    "platform",
                    models.CharField(
                        choices=[
                            ("ios", "iOS"),
                            ("android", "Android"),
                            ("web", "Web"),
                            ("unknown", "Unknown"),
                        ],
                        default="unknown",
                        max_length=16,
                    ),
                ),
                (
                    "category",
                    models.CharField(
                        blank=True,
                        choices=[
                            ("hard_to_use", "Hard to use"),
                            ("missing_feature", "Missing feature"),
                            ("something_broken", "Something is broken"),
                            ("performance", "Performance"),
                            ("account_sync", "Account / sync issue"),
                            ("other", "Other"),
                        ],
                        default="",
                        max_length=32,
                    ),
                ),
                ("message", models.TextField()),
                ("allow_contact", models.BooleanField(default=False)),
                ("app_version", models.CharField(blank=True, default="", max_length=32)),
                ("build_number", models.CharField(blank=True, default="", max_length=32)),
                ("device_os_version", models.CharField(blank=True, default="", max_length=32)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("email_sent_at", models.DateTimeField(blank=True, null=True)),
                ("email_error", models.CharField(blank=True, default="", max_length=500)),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="feedback_submissions",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "db_table": "core_feedback",
                "ordering": ["-created_at"],
            },
        ),
        migrations.AddIndex(
            model_name="feedback",
            index=models.Index(fields=["user", "-created_at"], name="core_fb_user_created_idx"),
        ),
    ]
