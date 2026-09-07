from django.conf import settings
from django.db import models


class ProjectedFundsAlert(models.Model):
    """Persistent projected overdraft / credit-limit risk for one canonical occurrence."""

    class AlertType(models.TextChoices):
        INSUFFICIENT_FUNDS = "INSUFFICIENT_FUNDS", "Insufficient funds"
        CREDIT_LIMIT_RISK = "CREDIT_LIMIT_RISK", "Credit limit risk"

    class Severity(models.TextChoices):
        WATCH = "WATCH", "Watch"
        AT_RISK = "AT_RISK", "At risk"
        CRITICAL = "CRITICAL", "Critical"

    household = models.ForeignKey(
        "core.Household",
        on_delete=models.CASCADE,
        related_name="projected_funds_alerts",
    )
    account = models.ForeignKey(
        "accounts.Account",
        on_delete=models.CASCADE,
        related_name="projected_funds_alerts",
    )
    transaction = models.ForeignKey(
        "transactions.Transaction",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="projected_funds_alerts",
    )
    rule = models.ForeignKey(
        "timeline.RecurringRule",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="projected_funds_alerts",
    )
    occurrence_date = models.DateField()
    fingerprint = models.CharField(max_length=220, unique=True, db_index=True)
    alert_type = models.CharField(max_length=32, choices=AlertType.choices)
    severity = models.CharField(max_length=16, choices=Severity.choices)
    amount = models.DecimalField(max_digits=15, decimal_places=2)
    projected_balance_before = models.DecimalField(max_digits=15, decimal_places=2)
    projected_balance_after = models.DecimalField(max_digits=15, decimal_places=2)
    shortfall = models.DecimalField(max_digits=15, decimal_places=2)
    payee = models.CharField(max_length=255, blank=True, default="")
    first_detected_at = models.DateTimeField(auto_now_add=True)
    last_evaluated_at = models.DateTimeField(auto_now=True)
    resolved_at = models.DateTimeField(null=True, blank=True)
    dismissed_at = models.DateTimeField(null=True, blank=True)
    read_at = models.DateTimeField(null=True, blank=True)
    notified_3d_at = models.DateTimeField(null=True, blank=True)
    notified_1d_at = models.DateTimeField(null=True, blank=True)
    notified_day_of_at = models.DateTimeField(null=True, blank=True)
    last_notified_shortfall = models.DecimalField(
        max_digits=15, decimal_places=2, null=True, blank=True
    )

    class Meta:
        db_table = "alerts_projected_funds_alert"
        ordering = ["occurrence_date", "id"]
        indexes = [
            models.Index(fields=["household", "resolved_at", "dismissed_at"]),
            models.Index(fields=["account", "occurrence_date"]),
        ]

    def __str__(self) -> str:
        return f"{self.alert_type} {self.account_id} {self.occurrence_date}"


class PushDevice(models.Model):
    """Expo push token registered to one user (multiple devices allowed)."""

    class Platform(models.TextChoices):
        IOS = "ios", "iOS"
        ANDROID = "android", "Android"
        WEB = "web", "Web"
        UNKNOWN = "unknown", "Unknown"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="push_devices",
    )
    expo_push_token = models.CharField(max_length=255, unique=True)
    platform = models.CharField(max_length=16, choices=Platform.choices, default=Platform.UNKNOWN)
    device_id = models.CharField(max_length=128, blank=True, default="")
    enabled = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    last_seen_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "alerts_push_device"
        indexes = [
            models.Index(fields=["user", "enabled"]),
        ]

    def __str__(self) -> str:
        return f"{self.user_id} {self.platform} {self.expo_push_token[-8:]}"
