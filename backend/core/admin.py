from django.contrib import admin

from .models import Feedback, ReviewPromptState


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
