from decimal import Decimal

from rest_framework import serializers

from accounts.models import Account
from affordability.models import DtiDebtItem, DtiIncomeSource, DtiProfile
from affordability.services.dti import (
    FHA_DEFERRED_STUDENT_LOAN_STATUSES,
    STUDENT_LOAN_METHOD_FHA_DEFERRED,
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
    payment_calculation = serializers.SerializerMethodField()
    linked_account = serializers.SerializerMethodField()
    warnings = serializers.SerializerMethodField()
    student_loan_status = serializers.ChoiceField(
        choices=DtiDebtItem.StudentLoanStatus.choices,
        allow_null=True,
        allow_blank=True,
        required=False,
    )
    student_loan_payment_method = serializers.ChoiceField(
        choices=DtiDebtItem.StudentLoanPaymentMethod.choices,
        allow_null=True,
        allow_blank=True,
        required=False,
    )

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
            "student_loan_status",
            "student_loan_payment_method",
            "effective_monthly_payment",
            "payment_calculation",
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
            "payment_calculation",
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

        debt_type = attrs.get("debt_type")
        if debt_type is None:
            debt_type = getattr(self.instance, "debt_type", DtiDebtItem.DebtType.OTHER)
        status = attrs["student_loan_status"] if "student_loan_status" in attrs else getattr(
            self.instance, "student_loan_status", None
        )
        method = (
            attrs["student_loan_payment_method"]
            if "student_loan_payment_method" in attrs
            else getattr(self.instance, "student_loan_payment_method", None)
        )
        if isinstance(status, str) and status.strip() == "":
            status = None
        if isinstance(method, str) and method.strip() == "":
            method = None

        if debt_type != DtiDebtItem.DebtType.STUDENT_LOAN:
            if method == STUDENT_LOAN_METHOD_FHA_DEFERRED:
                raise serializers.ValidationError(
                    {
                        "student_loan_payment_method": (
                            "The FHA deferred estimate can only be used with student-loan debts."
                        )
                    }
                )
            attrs["student_loan_status"] = None
            attrs["student_loan_payment_method"] = None
            return attrs

        attrs["student_loan_status"] = status
        if method is None:
            method = DtiDebtItem.StudentLoanPaymentMethod.MANUAL
        attrs["student_loan_payment_method"] = method

        if method == STUDENT_LOAN_METHOD_FHA_DEFERRED:
            if linked is not None:
                raise serializers.ValidationError(
                    {
                        "linked_account_id": (
                            "The FHA deferred student-loan estimate cannot be used with a linked credit card."
                        )
                    }
                )
            if payment_source == DtiDebtItem.PaymentSource.LINKED_ACCOUNT_MINIMUM:
                raise serializers.ValidationError(
                    {
                        "payment_source": (
                            "The FHA deferred student-loan estimate cannot use a linked-account minimum."
                        )
                    }
                )
            attrs["payment_source"] = DtiDebtItem.PaymentSource.MANUAL
            if status not in FHA_DEFERRED_STUDENT_LOAN_STATUSES:
                raise serializers.ValidationError(
                    {
                        "student_loan_status": (
                            "The FHA 0.5% estimate requires the loan to be deferred or in forbearance."
                        )
                    }
                )
            balance = attrs["outstanding_balance"] if "outstanding_balance" in attrs else getattr(
                self.instance, "outstanding_balance", None
            )
            if balance is None or balance <= MONEY_ZERO:
                raise serializers.ValidationError(
                    {
                        "outstanding_balance": (
                            "A positive outstanding balance is required for the FHA 0.5% estimate."
                        )
                    }
                )
        else:
            monthly = attrs["monthly_payment"] if "monthly_payment" in attrs else getattr(
                self.instance, "monthly_payment", None
            )
            previous_method = getattr(self.instance, "student_loan_payment_method", None)
            switching_from_fha = previous_method == STUDENT_LOAN_METHOD_FHA_DEFERRED
            monthly_in_request = "monthly_payment" in attrs or (
                hasattr(self, "initial_data") and "monthly_payment" in self.initial_data
            )
            if monthly is None or (switching_from_fha and not monthly_in_request):
                raise serializers.ValidationError(
                    {"monthly_payment": "Enter a monthly payment for the manual or reported method."}
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
        from affordability.services.dti import _serialize_linked_account

        return _serialize_linked_account(snap)

    def get_warnings(self, obj: DtiDebtItem):
        return [w.to_dict() for w in enrich_debt(debt_input_from_model(obj)).warnings]

    def get_payment_calculation(self, obj: DtiDebtItem):
        return serialize_debt_item(enrich_debt(debt_input_from_model(obj)))["payment_calculation"]


class ProposedHousingSerializer(serializers.Serializer):
    principal_and_interest = _decimal_field(min_value=MONEY_ZERO, required=False, default=MONEY_ZERO)
    property_taxes = _decimal_field(min_value=MONEY_ZERO, required=False, default=MONEY_ZERO)
    homeowners_insurance = _decimal_field(min_value=MONEY_ZERO, required=False, default=MONEY_ZERO)
    mortgage_insurance = _decimal_field(min_value=MONEY_ZERO, required=False, default=MONEY_ZERO)
    hoa_dues = _decimal_field(min_value=MONEY_ZERO, required=False, default=MONEY_ZERO)
    other_required_housing_costs = _decimal_field(
        min_value=MONEY_ZERO, required=False, default=MONEY_ZERO
    )


class ProposedPurchaseSerializer(serializers.Serializer):
    purchase_price = _decimal_field(min_value=MONEY_ZERO)
    down_payment_type = serializers.ChoiceField(choices=["dollars", "percent"])
    down_payment_value = _decimal_field(min_value=MONEY_ZERO)
    annual_interest_rate = _percent_field(min_value=MONEY_ZERO)
    loan_term_years = serializers.IntegerField(min_value=1, max_value=50)
    annual_property_taxes = _decimal_field(min_value=MONEY_ZERO, required=False, default=MONEY_ZERO)
    annual_homeowners_insurance = _decimal_field(
        min_value=MONEY_ZERO, required=False, default=MONEY_ZERO
    )
    monthly_mortgage_insurance = _decimal_field(
        min_value=MONEY_ZERO, required=False, default=MONEY_ZERO
    )
    monthly_hoa_dues = _decimal_field(min_value=MONEY_ZERO, required=False, default=MONEY_ZERO)
    other_required_monthly_housing_costs = _decimal_field(
        min_value=MONEY_ZERO, required=False, default=MONEY_ZERO
    )

    def validate_purchase_price(self, value: Decimal) -> Decimal:
        amount = as_decimal(value)
        if amount <= MONEY_ZERO:
            raise serializers.ValidationError("Home purchase price must be greater than zero.")
        return value

    def validate_annual_interest_rate(self, value: Decimal) -> Decimal:
        rate = as_decimal(value)
        if rate < MONEY_ZERO:
            raise serializers.ValidationError("Annual interest rate cannot be negative.")
        if rate > Decimal("50"):
            raise serializers.ValidationError("Annual interest rate cannot be greater than 50.")
        return value

    def validate(self, attrs):
        price = as_decimal(attrs["purchase_price"])
        payment_type = attrs["down_payment_type"]
        value = as_decimal(attrs["down_payment_value"])
        if payment_type == "percent":
            if value > PERCENT_MAX:
                raise serializers.ValidationError(
                    {"down_payment_value": "Down payment percentage cannot exceed 100."}
                )
            amount = (price * value) / PERCENT_MAX
        else:
            amount = value
        if amount < MONEY_ZERO:
            raise serializers.ValidationError(
                {"down_payment_value": "Down payment cannot be negative."}
            )
        if amount > price:
            raise serializers.ValidationError(
                {"down_payment_value": "Down payment cannot exceed the home purchase price."}
            )
        loan_amount = price - amount
        if loan_amount < MONEY_ZERO:
            raise serializers.ValidationError(
                {"down_payment_value": "Estimated loan amount cannot be negative."}
            )
        return attrs


class DtiCalculateSerializer(serializers.Serializer):
    household_id = serializers.IntegerField()
    proposed_housing_mode = serializers.ChoiceField(
        choices=["monthly_payment", "purchase"],
        required=False,
        allow_null=True,
    )
    proposed_housing = ProposedHousingSerializer(required=False, allow_null=True)
    proposed_purchase = ProposedPurchaseSerializer(required=False, allow_null=True)
    target_back_end_dti_percent = _percent_field(required=False)
    target_front_end_dti_percent = _percent_field(required=False, allow_null=True)
    excluded_debt_item_ids = serializers.ListField(
        child=serializers.IntegerField(), required=False, default=list
    )

    def validate(self, attrs):
        incoming = self.initial_data if hasattr(self, "initial_data") else {}
        housing_sent = "proposed_housing" in incoming and incoming.get("proposed_housing") not in (
            None,
            "",
        )
        purchase_sent = "proposed_purchase" in incoming and incoming.get("proposed_purchase") not in (
            None,
            "",
        )
        mode = attrs.get("proposed_housing_mode")
        if housing_sent and purchase_sent:
            raise serializers.ValidationError(
                {
                    "proposed_housing_mode": (
                        "Send either monthly housing components or a purchase estimate, not both."
                    )
                }
            )
        if mode is None:
            if purchase_sent:
                attrs["proposed_housing_mode"] = "purchase"
            elif housing_sent:
                attrs["proposed_housing_mode"] = "monthly_payment"
            return attrs
        if mode == "monthly_payment" and purchase_sent:
            raise serializers.ValidationError(
                {
                    "proposed_purchase": (
                        "Purchase estimate fields cannot be sent with monthly-payment mode."
                    )
                }
            )
        if mode == "purchase":
            if housing_sent:
                raise serializers.ValidationError(
                    {
                        "proposed_housing": (
                            "Monthly housing components cannot be sent with purchase mode."
                        )
                    }
                )
            if not purchase_sent:
                raise serializers.ValidationError(
                    {"proposed_purchase": "A purchase estimate is required for purchase mode."}
                )
        return attrs

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


def purchase_estimate_from_validated(data: dict):
    from affordability.services.dti import ZERO
    from affordability.services.mortgage import estimate_purchase_housing

    return estimate_purchase_housing(
        purchase_price=as_decimal(data["purchase_price"]),
        down_payment_type=data["down_payment_type"],
        down_payment_value=as_decimal(data["down_payment_value"]),
        annual_interest_rate=as_decimal(data["annual_interest_rate"]),
        loan_term_years=int(data["loan_term_years"]),
        annual_property_taxes=as_decimal(data.get("annual_property_taxes"), ZERO),
        annual_homeowners_insurance=as_decimal(data.get("annual_homeowners_insurance"), ZERO),
        monthly_mortgage_insurance=as_decimal(data.get("monthly_mortgage_insurance"), ZERO),
        monthly_hoa_dues=as_decimal(data.get("monthly_hoa_dues"), ZERO),
        other_required_monthly_housing_costs=as_decimal(
            data.get("other_required_monthly_housing_costs"), ZERO
        ),
    )
