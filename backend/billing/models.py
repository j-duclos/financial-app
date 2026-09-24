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


class ComplimentaryPremiumInvitation(models.Model):
    """Admin-issued complimentary Premium invite. Raw tokens are never stored."""

    email = models.EmailField(db_index=True)
    token_hash = models.CharField(max_length=64, unique=True)
    complimentary_premium_until = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    accepted_at = models.DateTimeField(null=True, blank=True)
    accepted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="accepted_complimentary_invitations",
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_complimentary_invitations",
    )
    revoked_at = models.DateTimeField(null=True, blank=True)
    sent_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "billing_complimentary_premium_invitation"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["email", "accepted_at"]),
            models.Index(fields=["expires_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.email} ({self.status_label()})"

    def status_label(self) -> str:
        from django.utils import timezone

        if self.accepted_at:
            return "accepted"
        if self.revoked_at:
            return "revoked"
        if not self.expires_at:
            return "pending"
        if self.expires_at <= timezone.now():
            return "expired"
        return "pending"
