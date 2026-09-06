from django.contrib import admin

from billing.models import BillingSubscription, StripeWebhookEvent


@admin.register(BillingSubscription)
class BillingSubscriptionAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "user",
        "plan",
        "status",
        "cancel_at_period_end",
        "current_period_end",
        "stripe_customer_id",
        "stripe_subscription_id",
        "updated_at",
    )
    list_filter = ("plan", "status", "cancel_at_period_end")
    search_fields = (
        "user__username",
        "user__email",
        "stripe_customer_id",
        "stripe_subscription_id",
        "stripe_price_id",
    )
    readonly_fields = (
        "user",
        "stripe_customer_id",
        "stripe_subscription_id",
        "stripe_price_id",
        "created_at",
        "updated_at",
    )
    ordering = ("-updated_at",)


@admin.register(StripeWebhookEvent)
class StripeWebhookEventAdmin(admin.ModelAdmin):
    list_display = ("stripe_event_id", "event_type", "livemode", "processed_at")
    list_filter = ("event_type", "livemode")
    search_fields = ("stripe_event_id", "event_type")
    readonly_fields = ("stripe_event_id", "event_type", "livemode", "processed_at")
    ordering = ("-processed_at",)

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False
