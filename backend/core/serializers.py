from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from .models import Household, HouseholdMembership, UserProfile
from .phone_e164 import normalize_to_e164
from common.services.forecast_horizon import (
    OPERATIONAL_FORECAST_WINDOW_DAYS,
    normalize_operational_forecast_days,
)

User = get_user_model()


class UserProfileSerializer(serializers.ModelSerializer):
    username = serializers.CharField(read_only=True, source="user.username")
    phone_e164 = serializers.CharField(
        required=False, allow_blank=True, allow_null=True, max_length=20
    )
    default_forecast_days = serializers.IntegerField(required=False)

    class Meta:
        model = UserProfile
        fields = [
            "id",
            "username",
            "display_name",
            "phone_e164",
            "default_household",
            "default_account",
            "default_forecast_days",
        ]
        read_only_fields = ["id", "username"]

    def validate_phone_e164(self, value):
        if value is None:
            return ""
        if not str(value).strip():
            return ""
        n = normalize_to_e164(str(value).strip())
        if not n:
            raise serializers.ValidationError(
                "Enter a valid mobile number (10-digit US or full international starting with +)."
            )
        return n

    def validate_default_forecast_days(self, value):
        if value is None:
            return normalize_operational_forecast_days(None)
        try:
            days = int(value)
        except (TypeError, ValueError) as exc:
            raise serializers.ValidationError(
                f"Default Forecast Window must be one of {sorted(OPERATIONAL_FORECAST_WINDOW_DAYS)}."
            ) from exc
        if days not in OPERATIONAL_FORECAST_WINDOW_DAYS:
            raise serializers.ValidationError(
                f"Default Forecast Window must be one of {sorted(OPERATIONAL_FORECAST_WINDOW_DAYS)}."
            )
        return days

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data["default_forecast_days"] = normalize_operational_forecast_days(
            getattr(instance, "default_forecast_days", None)
        )
        return data

    def validate(self, attrs):
        household = attrs["default_household"] if "default_household" in attrs else getattr(
            self.instance, "default_household", None
        )
        account = attrs["default_account"] if "default_account" in attrs else getattr(
            self.instance, "default_account", None
        )
        if account is not None and household is None:
            raise serializers.ValidationError(
                {"default_account": "Select a default household before choosing a default account."}
            )
        if account is not None and household is not None and account.household_id != household.pk:
            raise serializers.ValidationError(
                {"default_account": "Default account must belong to the selected default household."}
            )
        return attrs

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            from .utils import get_households_for_user
            households = get_households_for_user(request.user)
            self.fields["default_household"].queryset = households
            from accounts.models import Account
            self.fields["default_account"].queryset = Account.objects.filter(household__in=households)


class HouseholdMembershipSerializer(serializers.ModelSerializer):
    class Meta:
        model = HouseholdMembership
        fields = ["id", "user", "role", "joined_at"]
        read_only_fields = ["id", "joined_at"]


class HouseholdSerializer(serializers.ModelSerializer):
    class Meta:
        model = Household
        fields = ["id", "name", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]


class HouseholdDetailSerializer(HouseholdSerializer):
    memberships = HouseholdMembershipSerializer(many=True, read_only=True)


class RegisterSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    email = serializers.EmailField(allow_blank=True, required=False)
    password = serializers.CharField(write_only=True, min_length=8)

    def create(self, validated_data):
        return User.objects.create_user(
            username=validated_data["username"],
            email=validated_data.get("email", ""),
            password=validated_data["password"],
        )


class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True, trim_whitespace=False)
    new_password = serializers.CharField(write_only=True, trim_whitespace=False)
    new_password_confirm = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate(self, data):
        if data["new_password"] != data["new_password_confirm"]:
            raise serializers.ValidationError(
                {"new_password_confirm": "New passwords do not match."}
            )
        user = self.context.get("user")
        try:
            validate_password(data["new_password"], user=user)
        except DjangoValidationError as exc:
            raise serializers.ValidationError({"new_password": list(exc.messages)}) from exc
        return data
