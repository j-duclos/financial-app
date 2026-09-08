from django.conf import settings
from django.db import models


class Household(models.Model):
    name = models.CharField(max_length=255)
    financial_revision = models.PositiveIntegerField(
        default=0,
        help_text="Incremented on mutations that change balances or forecasts.",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "core_household"
        ordering = ["name"]


class HouseholdMembership(models.Model):
    class Role(models.TextChoices):
        OWNER = "OWNER", "Owner"
        MEMBER = "MEMBER", "Member"

    household = models.ForeignKey(Household, on_delete=models.CASCADE, related_name="memberships")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="household_memberships")
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.MEMBER)
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "core_household_membership"
        constraints = [
            models.UniqueConstraint(fields=["household", "user"], name="uniq_household_user"),
        ]
        indexes = [
            models.Index(fields=["user"]),
            models.Index(fields=["household"]),
        ]


class UserProfile(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="profile")
    display_name = models.CharField(max_length=255, blank=True)
    phone_e164 = models.CharField(
        max_length=20,
        blank=True,
        default="",
        help_text="Mobile E.164 for Plaid Link (e.g. +15204615387).",
    )
    default_household = models.ForeignKey(
        Household, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    default_account = models.ForeignKey(
        "accounts.Account", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    default_forecast_days = models.PositiveSmallIntegerField(
        default=30,
        choices=[
            (30, "30 days"),
            (60, "60 days"),
            (90, "90 days"),
            (180, "6 months"),
        ],
        help_text="Default Forecast Window for Dashboard, Action Center, and Transactions.",
    )
    email_verified_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="When the user confirmed the email currently stored on Django User.",
    )
    email_verification_sent_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="Last time a verification email was sent. Used for UX, not as the token store.",
    )
    onboarding_completed_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="When first-run onboarding was completed (automatically or explicitly).",
    )
    onboarding_dismissed_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="When the user skipped the first-run welcome. Empty-state copy can still appear.",
    )
    projected_funds_alerts_enabled = models.BooleanField(
        default=True,
        help_text="Master switch for projected low-balance / over-limit alerts.",
    )
    projected_funds_web_alerts = models.BooleanField(
        default=True,
        help_text="Show projected-funds warnings in the web app.",
    )
    projected_funds_push_enabled = models.BooleanField(
        default=True,
        help_text="Allow Expo push for projected-funds alerts when the OS permits it.",
    )
    notify_3_days_before = models.BooleanField(default=True)
    notify_1_day_before = models.BooleanField(default=True)
    notify_day_of = models.BooleanField(default=True)

    class TestPlanOverride(models.TextChoices):
        FREE = "FREE", "Free"
        PREMIUM = "PREMIUM", "Premium"

    test_plan_override = models.CharField(
        max_length=16,
        choices=TestPlanOverride.choices,
        null=True,
        blank=True,
        default=None,
        help_text=(
            "Development-only plan simulation. Ignored unless DEBUG and "
            "ALLOW_PLAN_TEST_OVERRIDE are both true. Does not change Stripe."
        ),
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "core_user_profile"


class ReviewPromptState(models.Model):
    """Mobile review-prompt timing. No financial data."""

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="review_prompt_state",
    )
    first_eligible_use_at = models.DateTimeField(null=True, blank=True)
    session_count = models.PositiveIntegerField(default=0)
    last_session_at = models.DateTimeField(null=True, blank=True)
    last_prompted_at = models.DateTimeField(null=True, blank=True)
    enjoyment_prompt_ats = models.JSONField(
        default=list,
        blank=True,
        help_text="ISO timestamps of enjoyment prompts shown.",
    )
    enjoyment_response = models.CharField(max_length=16, blank=True, default="")
    review_asked_at = models.DateTimeField(null=True, blank=True)
    feedback_submitted_at = models.DateTimeField(null=True, blank=True)
    dismissed_until = models.DateTimeField(null=True, blank=True)
    review_flow_completed = models.BooleanField(default=False)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "core_review_prompt_state"


class Feedback(models.Model):
    """In-app product feedback. Persist before emailing so SMTP failure cannot drop it."""

    class Source(models.TextChoices):
        MOBILE = "mobile", "Mobile"
        WEB = "web", "Web"

    class Platform(models.TextChoices):
        IOS = "ios", "iOS"
        ANDROID = "android", "Android"
        WEB = "web", "Web"
        UNKNOWN = "unknown", "Unknown"

    class Category(models.TextChoices):
        HARD_TO_USE = "hard_to_use", "Hard to use"
        MISSING_FEATURE = "missing_feature", "Missing feature"
        SOMETHING_BROKEN = "something_broken", "Something is broken"
        PERFORMANCE = "performance", "Performance"
        ACCOUNT_SYNC = "account_sync", "Account / sync issue"
        OTHER = "other", "Other"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="feedback_submissions",
    )
    source = models.CharField(max_length=16, choices=Source.choices, default=Source.MOBILE)
    platform = models.CharField(max_length=16, choices=Platform.choices, default=Platform.UNKNOWN)
    category = models.CharField(max_length=32, choices=Category.choices, blank=True, default="")
    message = models.TextField()
    allow_contact = models.BooleanField(default=False)
    app_version = models.CharField(max_length=32, blank=True, default="")
    build_number = models.CharField(max_length=32, blank=True, default="")
    device_os_version = models.CharField(max_length=32, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    email_sent_at = models.DateTimeField(null=True, blank=True)
    email_error = models.CharField(max_length=500, blank=True, default="")

    class Meta:
        db_table = "core_feedback"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["user", "-created_at"], name="core_fb_user_created_idx"),
        ]
