from decimal import Decimal

from rest_framework import serializers

from accounts.models import Account
from affordability.models import DtiDebtItem, DtiIncomeSource, DtiProfile
from affordability.services.dti import (
    as_decimal,
    debt_input_from_model,
    enrich_debt,
    serialize_debt_item,
    snapshot_from_account,
)
from core.models import Household
from core.utils import get_households_for_user

MONEY_ZERO = Decimal("0")
PERCENT_MAX = Decimal("100")


def _decimal_field(**kwargs):
    return serializers.DecimalField(
        max_digits=12, decimal_places=2, coerce_to_string=True, **kwargs
    )


def _percent_field(**kwargs):
    return serializers.DecimalField(
        max_digits=5, decimal_places=2, coerce_to_string=True, **kwargs
    )


class HouseholdScopedSerializer(serializers.ModelSerializer):
    def _request_households(self):
        request = self.context.get("request")
        if not request or not getattr(request.user, "is_authenticated", False):
            return Household.objects.none()
        return get_households_for_user(request.user)

    def validate_household(self, household: Household) -> Household:
        if household not in self._request_households():
            raise serializers.ValidationError("Not a member of this household.")
        return household


class DtiProfileSerializer(HouseholdScopedSerializer):
    household_id = serializers.PrimaryKeyRelatedField(
        source="household", queryset=Household.objects.all(), required=False
    )
    target_back_end_dti_percent = _percent_field(required=False)
    target_front_end_dti_percent = _percent_field(allow_null=True, required=False)
    current_housing_payment = _decimal_field(min_value=MONEY_ZERO, required=False)
    include_current_housing_in_current_dti = serializers.BooleanField(required=False)
    is_saved = serializers.SerializerMethodField()

    class Meta:
        model = DtiProfile
        fields = [
            "id",
            "household_id",
            "target_back_end_dti_percent",
            "target_front_end_dti_percent",
            "current_housing_payment",
            "current_housing_label",
            "include_current_housing_in_current_dti",
            "is_saved",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "is_saved", "created_at", "updated_at"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        if request and getattr(request.user, "is_authenticated", False):
            self.fields["household_id"].queryset = get_households_for_user(request.user)

    def get_is_saved(self, obj) -> bool:
        return bool(getattr(obj, "pk", None))

    def validate_target_back_end_dti_percent(self, value: Decimal) -> Decimal:
        return _validate_target_percent(value, allow_null=False)

    def validate_target_front_end_dti_percent(self, value: Decimal | None) -> Decimal | None:
        return _validate_target_percent(value, allow_null=True)

    def validate_current_housing_payment(self, value: Decimal) -> Decimal:
        if value < MONEY_ZERO:
            raise serializers.ValidationError("Current housing payment cannot be negative.")
        return value

    def validate(self, attrs):
        request = self.context.get("request")
        household = attrs.get("household") or getattr(self.instance, "household", None)
        if request and household:
            households = get_households_for_user(request.user)
            if household not in households:
                raise serializers.ValidationError({"household_id": "Not a member of this household."})
        locked = self.context.get("household")
        if locked is not None and household is not None and household.id != locked.id:
            raise serializers.ValidationError(
                {"household_id": "Household must match the requested household."}
            )
        if locked is not None:
            attrs["household"] = locked
        return attrs


class DtiIncomeSourceSerializer(HouseholdScopedSerializer):
    household_id = serializers.PrimaryKeyRelatedField(
        source="household", queryset=Household.objects.all()
    )
    gross_monthly_amount = _decimal_field(min_value=MONEY_ZERO)

    class Meta:
        model = DtiIncomeSource
        fields = [
            "id",
            "household_id",
            "name",
            "gross_monthly_amount",
            "income_type",
            "included",
            "notes",
            "position",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        if request and getattr(request.user, "is_authenticated", False):
            self.fields["household_id"].queryset = get_households_for_user(request.user)
        if self.instance is not None:
            self.fields["household_id"].required = False

    def validate_name(self, value: str) -> str:
        name = (value or "").strip()
        if not name:
            raise serializers.ValidationError("Name cannot be blank.")
        return name

    def validate_gross_monthly_amount(self, value: Decimal) -> Decimal:
        if value < MONEY_ZERO:
            raise serializers.ValidationError("Gross monthly income cannot be negative.")
        return value

    def validate(self, attrs):
        if self.instance is not None and "household" in attrs:
            if attrs["household"].id != self.instance.household_id:
                raise serializers.ValidationError(
                    {"household_id": "Cannot move an income source to another household."}
                )
        household = attrs.get("household") or getattr(self.instance, "household", None)
        request = self.context.get("request")
        if request and household and household not in get_households_for_user(request.user):
            raise serializers.ValidationError({"household_id": "Not a member of this household."})
        return attrs

    def create(self, validated_data):
        if "position" not in self.initial_data:
            household = validated_data["household"]
            last = (
                DtiIncomeSource.objects.filter(household=household)
                .order_by("-position")
                .values_list("position", flat=True)
                .first()
            )
            validated_data["position"] = (last or 0) + 1
        return super().create(validated_data)


class DtiDebtItemSerializer(HouseholdScopedSerializer):
    household_id = serializers.PrimaryKeyRelatedField(
        source="household", queryset=Household.objects.all()
    )
    monthly_payment = _decimal_field(min_value=MONEY_ZERO, required=False)
    outstanding_balance = _decimal_field(min_value=MONEY_ZERO, allow_null=True, required=False)
    linked_account_id = serializers.PrimaryKeyRelatedField(
        source="linked_account",
        queryset=Account.all_objects.all(),
        allow_null=True,
        required=False,
    )
    effective_monthly_payment = serializers.SerializerMethodField()
    linked_account = serializers.SerializerMethodField()
    warnings = serializers.SerializerMethodField()

    class Meta:
        model = DtiDebtItem
        fields = [
            "id",
            "household_id",
            "name",
            "debt_type",
            "monthly_payment",
            "outstanding_balance",
            "linked_account_id",
            "linked_account",
            "payment_source",
            "effective_monthly_payment",
            "included",
            "months_remaining",
            "notes",
            "position",
            "warnings",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "effective_monthly_payment",
            "linked_account",
            "warnings",
            "created_at",
            "updated_at",
        ]
        validators = []

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        households = Household.objects.none()
        if request and getattr(request.user, "is_authenticated", False):
            households = get_households_for_user(request.user)
            self.fields["household_id"].queryset = households
        self.fields["linked_account_id"].queryset = Account.all_objects.filter(
            household__in=households
        )
        if self.instance is not None:
            self.fields["household_id"].required = False

    def validate_name(self, value: str) -> str:
        name = (value or "").strip()
        if not name:
            raise serializers.ValidationError("Name cannot be blank.")
        return name

    def validate_monthly_payment(self, value: Decimal) -> Decimal:
        if value < MONEY_ZERO:
            raise serializers.ValidationError("Monthly debt payment cannot be negative.")
        return value

    def validate_outstanding_balance(self, value: Decimal | None) -> Decimal | None:
        if value is not None and value < MONEY_ZERO:
            raise serializers.ValidationError("Outstanding balance cannot be negative.")
        return value

    def validate_months_remaining(self, value: int | None) -> int | None:
        if value is not None and value <= 0:
            raise serializers.ValidationError("months_remaining must be positive when supplied.")
        return value

    def validate(self, attrs):
        if self.instance is not None and "household" in attrs:
            if attrs["household"].id != self.instance.household_id:
                raise serializers.ValidationError(
                    {"household_id": "Cannot move a debt item to another household."}
                )
        household = attrs.get("household") or getattr(self.instance, "household", None)
        request = self.context.get("request")
        if request and household and household not in get_households_for_user(request.user):
            raise serializers.ValidationError({"household_id": "Not a member of this household."})

        linked = attrs["linked_account"] if "linked_account" in attrs else getattr(
            self.instance, "linked_account", None
        )
        payment_source = attrs.get("payment_source")
        if payment_source is None:
            payment_source = getattr(
                self.instance, "payment_source", DtiDebtItem.PaymentSource.MANUAL
            )

        if linked is not None and household is not None and linked.household_id != household.id:
            raise serializers.ValidationError(
                {"linked_account_id": "Linked account must belong to the same household."}
            )

        if payment_source == DtiDebtItem.PaymentSource.LINKED_ACCOUNT_MINIMUM:
            if linked is None:
                raise serializers.ValidationError(
                    {
                        "payment_source": (
                            "linked_account_minimum is valid only when a linked account is supplied."
                        )
                    }
                )
            if not _is_eligible_active_credit_card(linked):
                raise serializers.ValidationError(
                    {
                        "linked_account_id": (
                            "linked_account_minimum may only use an eligible active credit-card account."
                        )
                    }
                )

        if linked is not None and household is not None:
            qs = DtiDebtItem.objects.filter(household=household, linked_account=linked)
            if self.instance is not None:
                qs = qs.exclude(pk=self.instance.pk)
            if qs.exists():
                raise serializers.ValidationError(
                    {"linked_account_id": "This account is already linked to a DTI debt item."}
                )
        return attrs

    def create(self, validated_data):
        if "position" not in self.initial_data:
            household = validated_data["household"]
            last = (
                DtiDebtItem.objects.filter(household=household)
                .order_by("-position")
                .values_list("position", flat=True)
                .first()
            )
            validated_data["position"] = (last or 0) + 1
        return super().create(validated_data)

    def get_effective_monthly_payment(self, obj: DtiDebtItem) -> str:
        return serialize_debt_item(enrich_debt(debt_input_from_model(obj)))[
            "effective_monthly_payment"
        ]

    def get_linked_account(self, obj: DtiDebtItem):
        if not obj.linked_account_id:
            return None
        account = getattr(obj, "linked_account", None)
        if account is None:
            return None
        snap = snapshot_from_account(account)
        return {
            "id": snap.id,
            "name": snap.name,
            "effective_display_name": snap.effective_display_name,
            "account_type": snap.account_type,
            "status": snap.status,
            "minimum_payment_amount": (
                str(snap.minimum_payment_amount.quantize(Decimal("0.01")))
                if snap.minimum_payment_amount is not None
                else None
            ),
        }

    def get_warnings(self, obj: DtiDebtItem):
        return [w.to_dict() for w in enrich_debt(debt_input_from_model(obj)).warnings]


class ProposedHousingSerializer(serializers.Serializer):
    principal_and_interest = _decimal_field(min_value=MONEY_ZERO, required=False, default=MONEY_ZERO)
    property_taxes = _decimal_field(min_value=MONEY_ZERO, required=False, default=MONEY_ZERO)
    homeowners_insurance = _decimal_field(min_value=MONEY_ZERO, required=False, default=MONEY_ZERO)
    mortgage_insurance = _decimal_field(min_value=MONEY_ZERO, required=False, default=MONEY_ZERO)
    hoa_dues = _decimal_field(min_value=MONEY_ZERO, required=False, default=MONEY_ZERO)
    other_required_housing_costs = _decimal_field(
        min_value=MONEY_ZERO, required=False, default=MONEY_ZERO
    )


class DtiCalculateSerializer(serializers.Serializer):
    household_id = serializers.IntegerField()
    proposed_housing = ProposedHousingSerializer(required=False, allow_null=True)
    target_back_end_dti_percent = _percent_field(required=False)
    target_front_end_dti_percent = _percent_field(required=False, allow_null=True)
    excluded_debt_item_ids = serializers.ListField(
        child=serializers.IntegerField(), required=False, default=list
    )

    def validate_target_back_end_dti_percent(self, value: Decimal) -> Decimal:
        return _validate_target_percent(value, allow_null=False)

    def validate_target_front_end_dti_percent(self, value: Decimal | None) -> Decimal | None:
        return _validate_target_percent(value, allow_null=True)

    def validate_household_id(self, value: int) -> int:
        request = self.context.get("request")
        if not request:
            return value
        household = get_households_for_user(request.user).filter(pk=value).first()
        if household is None:
            raise serializers.ValidationError("Not a member of this household.")
        return value


def _validate_target_percent(value: Decimal | None, *, allow_null: bool) -> Decimal | None:
    if value is None:
        if allow_null:
            return None
        raise serializers.ValidationError("Target DTI percent is required.")
    if value <= MONEY_ZERO or value > PERCENT_MAX:
        raise serializers.ValidationError("Target DTI percent must be greater than 0 and no more than 100.")
    return value


def _is_eligible_active_credit_card(account: Account) -> bool:
    return (
        account.account_type == Account.AccountType.CREDIT
        and account.status == Account.Status.ACTIVE
        and bool(account.is_active)
        and not account.is_hidden
    )


def proposed_housing_from_validated(data: dict | None):
    from affordability.services.dti import ProposedHousingInput, ZERO

    if not data:
        return None
    return ProposedHousingInput(
        principal_and_interest=as_decimal(data.get("principal_and_interest"), ZERO),
        property_taxes=as_decimal(data.get("property_taxes"), ZERO),
        homeowners_insurance=as_decimal(data.get("homeowners_insurance"), ZERO),
        mortgage_insurance=as_decimal(data.get("mortgage_insurance"), ZERO),
        hoa_dues=as_decimal(data.get("hoa_dues"), ZERO),
        other_required_housing_costs=as_decimal(data.get("other_required_housing_costs"), ZERO),
    )
