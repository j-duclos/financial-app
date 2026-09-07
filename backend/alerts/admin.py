from django.contrib import admin

from alerts.models import ProjectedFundsAlert, PushDevice


@admin.register(ProjectedFundsAlert)
class ProjectedFundsAlertAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "household",
        "account",
        "alert_type",
        "severity",
        "occurrence_date",
        "shortfall",
        "resolved_at",
        "dismissed_at",
    )
    list_filter = ("alert_type", "severity")
    search_fields = ("fingerprint", "payee")
    readonly_fields = ("fingerprint", "first_detected_at", "last_evaluated_at")


@admin.register(PushDevice)
class PushDeviceAdmin(admin.ModelAdmin):
    list_display = ("id", "user", "platform", "enabled", "last_seen_at")
    list_filter = ("platform", "enabled")
    search_fields = ("expo_push_token", "device_id")
