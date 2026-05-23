from django.contrib.auth import get_user_model
from rest_framework import serializers

from .models import Household, HouseholdMembership, UserProfile
from .phone_e164 import normalize_to_e164

User = get_user_model()


class UserProfileSerializer(serializers.ModelSerializer):
    username = serializers.CharField(read_only=True, source="user.username")
    phone_e164 = serializers.CharField(required=False, allow_blank=True, max_length=20)

    class Meta:
        model = UserProfile
        fields = ["id", "username", "display_name", "phone_e164", "default_household", "default_account"]
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

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            from .utils import get_households_for_user
            self.fields["default_household"].queryset = get_households_for_user(request.user)
            from accounts.models import Account
            self.fields["default_account"].queryset = Account.objects.filter(
                household__in=get_households_for_user(request.user)
            )


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
    current_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True, min_length=8)
    new_password_confirm = serializers.CharField(write_only=True)

    def validate(self, data):
        if data["new_password"] != data["new_password_confirm"]:
            raise serializers.ValidationError(
                {"new_password_confirm": "New passwords do not match."}
            )
        return data
