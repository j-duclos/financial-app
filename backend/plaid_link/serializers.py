from rest_framework import serializers

from core.models import HouseholdMembership
from core.phone_e164 import normalize_to_e164
from .models import PlaidItem, PlaidLinkedAccount
from .services import normalize_browser_plaid_redirect_uri


class PlaidLinkedAccountSerializer(serializers.ModelSerializer):
    account_id = serializers.IntegerField(read_only=True)
    account_name = serializers.SerializerMethodField()

    def get_account_name(self, obj):
        return obj.account.effective_display_name

    class Meta:
        model = PlaidLinkedAccount
        fields = ["id", "plaid_account_id", "mask", "account_id", "account_name"]


class PlaidItemSerializer(serializers.ModelSerializer):
    linked_accounts = PlaidLinkedAccountSerializer(many=True, read_only=True)

    class Meta:
        model = PlaidItem
        fields = [
            "id",
            "household",
            "item_id",
            "institution_id",
            "institution_name",
            "linked_accounts",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


class PlaidLinkTokenRequestSerializer(serializers.Serializer):
    household_id = serializers.IntegerField()
    phone_number = serializers.CharField(required=False, allow_blank=True, max_length=32)
    redirect_uri = serializers.CharField(required=False, allow_blank=True, max_length=512)

    def validate_redirect_uri(self, value):
        v = (value or "").strip()
        if not v:
            return ""
        try:
            return normalize_browser_plaid_redirect_uri(v)
        except RuntimeError as e:
            raise serializers.ValidationError(str(e)) from e

    def validate_phone_number(self, value):
        if not value or not str(value).strip():
            return ""
        n = normalize_to_e164(str(value).strip())
        if not n:
            raise serializers.ValidationError("Invalid phone number; use 10-digit US or E.164 with +country.")
        return n

    def validate_household_id(self, value):
        request = self.context.get("request")
        if not request or not request.user.is_authenticated:
            raise serializers.ValidationError("Authentication required.")
        if not HouseholdMembership.objects.filter(household_id=value, user=request.user).exists():
            raise serializers.ValidationError("Not a member of this household.")
        return value


class PlaidExchangeRequestSerializer(serializers.Serializer):
    public_token = serializers.CharField()
    household_id = serializers.IntegerField()

    def validate_household_id(self, value):
        request = self.context.get("request")
        if not request or not request.user.is_authenticated:
            raise serializers.ValidationError("Authentication required.")
        if not HouseholdMembership.objects.filter(household_id=value, user=request.user).exists():
            raise serializers.ValidationError("Not a member of this household.")
        return value

    def validate(self, attrs):
        if not attrs.get("public_token", "").strip():
            raise serializers.ValidationError({"public_token": "This field is required."})
        return attrs
