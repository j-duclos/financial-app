from decimal import Decimal

from rest_framework import serializers

from core.utils import get_households_for_user

from .models import Account
from .relationship_models import AccountRelationship


class AccountRelationshipSerializer(serializers.ModelSerializer):
    source_account = serializers.PrimaryKeyRelatedField(queryset=Account.objects.none())
    destination_account = serializers.PrimaryKeyRelatedField(queryset=Account.objects.none())
    source_account_name = serializers.SerializerMethodField()
    destination_account_name = serializers.SerializerMethodField()
    relationship_type_display = serializers.CharField(
        source="get_relationship_type_display", read_only=True,
    )

    def get_source_account_name(self, obj):
        return obj.source_account.effective_display_name

    def get_destination_account_name(self, obj):
        return obj.destination_account.effective_display_name

    class Meta:
        model = AccountRelationship
        fields = [
            "id",
            "household",
            "source_account",
            "source_account_name",
            "destination_account",
            "destination_account_name",
            "relationship_type",
            "relationship_type_display",
            "default_amount",
            "default_day",
            "frequency",
            "is_active",
            "notes",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at", "household"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            hh_ids = list(
                get_households_for_user(request.user).values_list("pk", flat=True)
            )
            qs = Account.objects.filter(household_id__in=hh_ids)
            self.fields["source_account"].queryset = qs
            self.fields["destination_account"].queryset = qs

    def validate_default_amount(self, value):
        if value is not None and Decimal(str(value)) <= 0:
            raise serializers.ValidationError("Amount must be positive when provided.")
        return value

    def validate_default_day(self, value):
        if value is not None and not (1 <= value <= 31):
            raise serializers.ValidationError("Day must be between 1 and 31.")
        return value

    def validate(self, attrs):
        source = attrs.get("source_account") or (
            self.instance.source_account if self.instance else None
        )
        dest = attrs.get("destination_account") or (
            self.instance.destination_account if self.instance else None
        )
        rel_type = attrs.get("relationship_type") or (
            self.instance.relationship_type if self.instance else None
        )
        if source and dest:
            if source.pk == dest.pk:
                raise serializers.ValidationError(
                    {"destination_account": "Source and destination cannot be the same account."}
                )
            if source.household_id != dest.household_id:
                raise serializers.ValidationError(
                    {"destination_account": "Both accounts must belong to the same household."}
                )
        if dest and rel_type == AccountRelationship.RelationshipType.CREDIT_CARD_PAYMENT:
            if not dest.is_credit_card() and dest.role != Account.AccountRole.CREDIT_CARD:
                raise serializers.ValidationError(
                    {
                        "destination_account": (
                            "Credit card payment requires a credit card destination."
                        )
                    }
                )
        if dest and rel_type == AccountRelationship.RelationshipType.LOAN_PAYMENT:
            if dest.role != Account.AccountRole.LOAN:
                raise serializers.ValidationError(
                    {"destination_account": "Loan payment requires a loan destination."}
                )
        return attrs

    def create(self, validated_data):
        from .services.relationships import create_relationship

        request = self.context.get("request")
        user = request.user if request else None
        source = validated_data["source_account"]
        return create_relationship(
            household_id=source.household_id,
            source_account_id=source.pk,
            destination_account_id=validated_data["destination_account"].pk,
            relationship_type=validated_data["relationship_type"],
            default_amount=validated_data.get("default_amount"),
            default_day=validated_data.get("default_day"),
            frequency=validated_data.get(
                "frequency", AccountRelationship.Frequency.MONTHLY,
            ),
            is_active=validated_data.get("is_active", True),
            notes=validated_data.get("notes", ""),
            user=user,
        )

    def update(self, instance, validated_data):
        from .services.relationships import update_relationship

        request = self.context.get("request")
        user = request.user if request else None
        fields = {}
        for key in (
            "source_account",
            "destination_account",
            "relationship_type",
            "default_amount",
            "default_day",
            "frequency",
            "is_active",
            "notes",
        ):
            if key in validated_data:
                val = validated_data[key]
                if key in ("source_account", "destination_account"):
                    fields[f"{key}_id"] = val.pk
                else:
                    fields[key] = val
        return update_relationship(instance, user=user, **fields)


class AccountRelationshipSummarySerializer(serializers.ModelSerializer):
    source_account_name = serializers.SerializerMethodField()
    destination_account_name = serializers.SerializerMethodField()

    def get_source_account_name(self, obj):
        return obj.source_account.effective_display_name

    def get_destination_account_name(self, obj):
        return obj.destination_account.effective_display_name
    relationship_type_display = serializers.CharField(
        source="get_relationship_type_display", read_only=True,
    )

    class Meta:
        model = AccountRelationship
        fields = [
            "id",
            "source_account",
            "source_account_name",
            "destination_account",
            "destination_account_name",
            "relationship_type",
            "relationship_type_display",
            "default_amount",
            "default_day",
            "frequency",
            "is_active",
            "notes",
        ]
