from datetime import date
from decimal import Decimal

from rest_framework import serializers

from accounts.models import Account
from core.utils import get_households_for_user
from goals.models import FinancialGoal
from goals.services import calculate_goal_progress, ensure_starting_debt, enrich_goal_progress


class FinancialGoalSerializer(serializers.ModelSerializer):
    remaining_amount = serializers.CharField(read_only=True)
    progress_percent = serializers.CharField(read_only=True)
    projected_completion_date = serializers.CharField(read_only=True, allow_null=True)
    on_track_status = serializers.CharField(read_only=True)
    recommended_monthly_contribution = serializers.CharField(read_only=True, allow_null=True)
    linked_account_name = serializers.SerializerMethodField()
    linked_credit_account_name = serializers.SerializerMethodField()
    linked_account_balance = serializers.CharField(read_only=True, allow_null=True)
    linked_debt_balance = serializers.CharField(read_only=True, allow_null=True)
    is_debt_goal = serializers.BooleanField(read_only=True)
    goal_health = serializers.CharField(read_only=True)
    monthly_required = serializers.CharField(read_only=True, allow_null=True)
    current_contribution_rate = serializers.CharField(read_only=True, allow_null=True)
    forecast_gap = serializers.CharField(read_only=True, allow_null=True)
    funding_account = serializers.CharField(read_only=True, allow_null=True)
    milestones = serializers.ListField(read_only=True)

    class Meta:
        model = FinancialGoal
        fields = [
            "id",
            "household",
            "name",
            "goal_type",
            "target_amount",
            "current_amount",
            "starting_debt_amount",
            "target_date",
            "linked_account",
            "linked_credit_account",
            "linked_account_name",
            "linked_credit_account_name",
            "monthly_contribution",
            "contribution_rule",
            "priority",
            "status",
            "notes",
            "created_at",
            "updated_at",
            "completed_at",
            "remaining_amount",
            "progress_percent",
            "projected_completion_date",
            "on_track_status",
            "recommended_monthly_contribution",
            "linked_account_balance",
            "linked_debt_balance",
            "is_debt_goal",
            "goal_health",
            "monthly_required",
            "current_contribution_rate",
            "forecast_gap",
            "funding_account",
            "milestones",
        ]
        read_only_fields = ["id", "created_at", "updated_at", "completed_at"]

    def get_linked_account_name(self, obj: FinancialGoal) -> str | None:
        if obj.linked_account_id and obj.linked_account:
            return obj.linked_account.effective_display_name
        return None

    def get_linked_credit_account_name(self, obj: FinancialGoal) -> str | None:
        if obj.linked_credit_account_id and obj.linked_credit_account:
            return obj.linked_credit_account.effective_display_name
        return None

    def validate_target_amount(self, value: Decimal) -> Decimal:
        if value is None or value <= 0:
            raise serializers.ValidationError("Target amount must be positive.")
        return value

    def validate_current_amount(self, value: Decimal) -> Decimal:
        if value is not None and value < 0:
            raise serializers.ValidationError("Current amount cannot be negative.")
        return value or Decimal("0")

    def validate(self, attrs):
        goal_type = attrs.get("goal_type") or getattr(self.instance, "goal_type", None)
        linked = attrs.get("linked_account")
        if linked is None and self.instance:
            linked = self.instance.linked_account
        linked_credit = attrs.get("linked_credit_account")
        if linked_credit is None and self.instance:
            linked_credit = self.instance.linked_credit_account

        is_debt = goal_type == FinancialGoal.GoalType.DEBT_PAYOFF
        if is_debt:
            if linked:
                raise serializers.ValidationError(
                    {"linked_account": "Debt payoff goals cannot link a savings account here."}
                )
            if linked_credit and not (
                linked_credit.is_credit_card() or linked_credit.role == Account.AccountRole.LOAN
            ):
                raise serializers.ValidationError(
                    {"linked_credit_account": "Link a credit card or loan account."}
                )
        else:
            if linked_credit:
                raise serializers.ValidationError(
                    {"linked_credit_account": "Only debt payoff goals can link a credit/loan account."}
                )
            if linked and linked.is_credit_card():
                raise serializers.ValidationError(
                    {"linked_account": "Link a checking or savings account for savings goals."}
                )

        household = attrs.get("household") or getattr(self.instance, "household", None)
        request = self.context.get("request")
        if request and household:
            households = get_households_for_user(request.user)
            if household not in households:
                raise serializers.ValidationError({"household": "Not a member of this household."})

        for account in (linked, linked_credit):
            if account and household and account.household_id != household.id:
                raise serializers.ValidationError("Linked account must belong to the goal household.")

        return attrs

    def _attach_progress(self, representation: dict, instance: FinancialGoal) -> dict:
        progress = enrich_goal_progress(instance, calculate_goal_progress(instance))
        for key in (
            "current_amount",
            "target_amount",
            "remaining_amount",
            "progress_percent",
            "projected_completion_date",
            "on_track_status",
            "recommended_monthly_contribution",
            "linked_account_balance",
            "linked_debt_balance",
            "is_debt_goal",
            "goal_health",
            "monthly_required",
            "current_contribution_rate",
            "forecast_gap",
            "funding_account",
            "milestones",
        ):
            if key in progress and progress.get(key) is not None:
                representation[key] = progress.get(key)
        return representation

    def to_representation(self, instance):
        data = super().to_representation(instance)
        return self._attach_progress(data, instance)

    def create(self, validated_data):
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            validated_data.setdefault("created_by", request.user)
        goal = super().create(validated_data)
        if goal.is_debt_goal():
            ensure_starting_debt(goal)
        return goal

    def update(self, instance, validated_data):
        goal = super().update(instance, validated_data)
        if goal.is_debt_goal():
            ensure_starting_debt(goal)
        return goal


class ContributePreviewSerializer(serializers.Serializer):
    from_account = serializers.PrimaryKeyRelatedField(queryset=Account.objects.all())
    amount = serializers.DecimalField(max_digits=15, decimal_places=2)
    date = serializers.DateField()

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError("Amount must be positive.")
        return value


class ContributeSerializer(serializers.Serializer):
    from_account = serializers.PrimaryKeyRelatedField(
        queryset=Account.objects.all(), required=False, allow_null=True
    )
    amount = serializers.DecimalField(max_digits=15, decimal_places=2)
    date = serializers.DateField()
    method = serializers.ChoiceField(choices=["transfer", "manual"], default="transfer")

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError("Amount must be positive.")
        return value

    def validate_date(self, value):
        if isinstance(value, date):
            return value
        return value
