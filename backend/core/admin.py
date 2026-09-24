from django.contrib import admin
from django.contrib.auth import get_user_model
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import Feedback, ReviewPromptState, UserProfile

User = get_user_model()


class UserProfileInline(admin.StackedInline):
    model = UserProfile
    can_delete = False
    extra = 0
    fk_name = "user"
    fields = (
        "display_name",
        "phone_e164",
        "complimentary_premium_until",
        "test_plan_override",
        "default_forecast_days",
        "onboarding_completed_at",
        "created_at",
        "updated_at",
    )
    readonly_fields = ("created_at", "updated_at")


class FlowSightUserAdmin(BaseUserAdmin):
    inlines = (UserProfileInline,)


@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "user",
        "display_name",
        "complimentary_premium_until",
        "test_plan_override",
        "updated_at",
    )
    list_filter = ("complimentary_premium_until",)
    search_fields = ("user__username", "user__email", "display_name")
    raw_id_fields = ("user",)
    fields = (
        "user",
        "display_name",
        "phone_e164",
        "complimentary_premium_until",
        "test_plan_override",
        "default_household",
        "default_account",
        "default_forecast_days",
        "created_at",
        "updated_at",
    )
    readonly_fields = ("created_at", "updated_at")
    ordering = ("-updated_at",)


try:
    admin.site.unregister(User)
except admin.sites.NotRegistered:
    pass
admin.site.register(User, FlowSightUserAdmin)


@admin.register(Feedback)
class FeedbackAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "user",
        "source",
        "platform",
        "category",
        "allow_contact",
        "created_at",
        "email_sent_at",
    )
    list_filter = ("source", "platform", "category", "allow_contact")
    search_fields = ("user__username",)
    readonly_fields = (
        "user",
        "source",
        "platform",
        "category",
        "message",
        "allow_contact",
        "app_version",
        "build_number",
        "device_os_version",
        "created_at",
        "email_sent_at",
        "email_error",
    )


@admin.register(ReviewPromptState)
class ReviewPromptStateAdmin(admin.ModelAdmin):
    list_display = (
        "user",
        "session_count",
        "first_eligible_use_at",
        "review_flow_completed",
        "dismissed_until",
    )
    search_fields = ("user__username",)
    readonly_fields = (
        "user",
        "first_eligible_use_at",
        "session_count",
        "last_session_at",
        "last_prompted_at",
        "enjoyment_prompt_ats",
        "enjoyment_response",
        "review_asked_at",
        "feedback_submitted_at",
        "dismissed_until",
        "review_flow_completed",
        "updated_at",
    )
