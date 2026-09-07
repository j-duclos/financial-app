from django.utils import timezone
from rest_framework import serializers

from alerts.models import ProjectedFundsAlert, PushDevice
from alerts.services.copy import alert_body, alert_title, banner_message, format_money


class ProjectedFundsAlertSerializer(serializers.ModelSerializer):
    account_name = serializers.SerializerMethodField()
    title = serializers.SerializerMethodField()
    body = serializers.SerializerMethodField()
    banner_message = serializers.SerializerMethodField()
    shortfall_display = serializers.SerializerMethodField()
    active = serializers.SerializerMethodField()

    class Meta:
        model = ProjectedFundsAlert
        fields = [
            "id",
            "household",
            "account",
            "account_name",
            "transaction",
            "rule",
            "occurrence_date",
            "fingerprint",
            "alert_type",
            "severity",
            "amount",
            "projected_balance_before",
            "projected_balance_after",
            "shortfall",
            "shortfall_display",
            "payee",
            "title",
            "body",
            "banner_message",
            "active",
            "first_detected_at",
            "last_evaluated_at",
            "resolved_at",
            "dismissed_at",
            "read_at",
        ]
        read_only_fields = [f for f in fields if f not in ("dismissed_at", "read_at")]

    def get_account_name(self, obj: ProjectedFundsAlert) -> str:
        account = getattr(obj, "account", None)
        if account is None:
            return "Account"
        return account.effective_display_name

    def get_title(self, obj: ProjectedFundsAlert) -> str:
        return alert_title(obj, self.get_account_name(obj))

    def get_body(self, obj: ProjectedFundsAlert) -> str:
        today = timezone.localdate()
        return alert_body(obj, today=today)

    def get_banner_message(self, obj: ProjectedFundsAlert) -> str:
        return banner_message(obj, self.get_account_name(obj))

    def get_shortfall_display(self, obj: ProjectedFundsAlert) -> str:
        return format_money(obj.shortfall)

    def get_active(self, obj: ProjectedFundsAlert) -> bool:
        return obj.resolved_at is None and obj.dismissed_at is None


class PushDeviceSerializer(serializers.ModelSerializer):
    class Meta:
        model = PushDevice
        fields = [
            "id",
            "expo_push_token",
            "platform",
            "device_id",
            "enabled",
            "created_at",
            "last_seen_at",
        ]
        read_only_fields = ["id", "created_at", "last_seen_at"]

    def validate_expo_push_token(self, value: str) -> str:
        token = (value or "").strip()
        if not (
            token.startswith("ExponentPushToken[") or token.startswith("ExpoPushToken[")
        ):
            raise serializers.ValidationError("Enter a valid Expo push token.")
        return token
