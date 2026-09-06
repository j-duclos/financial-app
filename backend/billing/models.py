from django.conf import settings
from django.db import models


class BillingSubscription(models.Model):
    """Local mirror of a user's Stripe subscription. One row per user.

    Stripe IDs are optional: FREE users never need a Stripe Customer.
    Entitlement is derived from ``status``, not from the presence of Stripe IDs.
    """

    class Plan(models.TextChoices):
        FREE = "FREE", "Free"
        PREMIUM = "PREMIUM", "Premium"

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="billing_subscription",
    )
    plan = models.CharField(max_length=16, choices=Plan.choices, default=Plan.FREE)
    status = models.CharField(
        max_length=32,
        default="inactive",
        help_text="Stripe subscription status, or inactive when no subscription exists.",
    )
    stripe_customer_id = models.CharField(max_length=255, blank=True, null=True, unique=True)
    stripe_subscription_id = models.CharField(max_length=255, blank=True, null=True, unique=True)
    stripe_price_id = models.CharField(max_length=255, blank=True, default="")
    current_period_end = models.DateTimeField(null=True, blank=True)
    cancel_at_period_end = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "billing_subscription"
        indexes = [
            models.Index(fields=["plan", "status"]),
            models.Index(fields=["status"]),
        ]

    def save(self, *args, **kwargs):
        if not self.stripe_customer_id:
            self.stripe_customer_id = None
        if not self.stripe_subscription_id:
            self.stripe_subscription_id = None
        super().save(*args, **kwargs)

    def __str__(self) -> str:
        return f"{self.user_id} {self.plan} ({self.status})"


class StripeWebhookEvent(models.Model):
    """Idempotency record for Stripe webhook deliveries. No full payloads."""

    stripe_event_id = models.CharField(max_length=255, unique=True)
    event_type = models.CharField(max_length=128)
    livemode = models.BooleanField(default=False)
    processed_at = models.DateTimeField()

    class Meta:
        db_table = "billing_stripe_webhook_event"
        ordering = ["-processed_at"]
        indexes = [
            models.Index(fields=["event_type", "processed_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.event_type} {self.stripe_event_id}"
