from decimal import Decimal

from rest_framework import serializers

from accounts.models import Account
from core.utils import get_households_for_user
from goals.bucket_services import (
    bucket_to_api_dict,
    calculate_bucket_progress,
    enrich_bucket,
)
from goals.linked_account_sync import linked_account_in_use, sync_all_transactions_for_linked_bucket
from goals.models import GoalBucket, GoalContribution, RuleAllocation
from timeline.models import RecurringRule
from transactions.models import Transaction


class GoalBucketSerializer(serializers.ModelSerializer):
    goal_type = serializers.CharField(source="type", read_only=True)
    current_amount = serializers.CharField(read_only=True)
    allocated_amount = serializers.DecimalField(max_digits=15, decimal_places=2, read_only=True)
    remaining_amount = serializers.CharField(read_only=True)
    progress_percent = serializers.CharField(read_only=True)
    projected_completion_date = serializers.CharField(read_only=True, allow_null=True)
    on_track_status = serializers.CharField(read_only=True)
    recommended_monthly_contribution = serializers.CharField(read_only=True, allow_null=True)
    linked_account_name = serializers.SerializerMethodField()
    linked_credit_account_name = serializers.SerializerMethodField()
    is_debt_goal = serializers.BooleanField(read_only=True)
    goal_health = serializers.CharField(read_only=True)
    monthly_required = serializers.CharField(read_only=True, allow_null=True)
    current_contribution_rate = serializers.CharField(read_only=True, allow_null=True)
    forecast_gap = serializers.CharField(read_only=True, allow_null=True)
    funding_account = serializers.CharField(read_only=True, allow_null=True)
    milestones = serializers.ListField(read_only=True)
    monthly_contribution = serializers.DecimalField(
        source="monthly_target", max_digits=15, decimal_places=2, required=False
    )

    class Meta:
        model = GoalBucket
        fields = [
            "id",
            "household",
            "name",
            "description",
            "type",
            "goal_type",
            "target_amount",
            "allocated_amount",
            "current_amount",
            "start_date",
            "target_date",
            "linked_account",
            "linked_account_name",
            "linked_credit_account_name",
            "monthly_target",
            "monthly_contribution",
            "auto_fund_enabled",
            "forecast_enabled",
            "include_in_safe_to_spend",
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
            "is_debt_goal",
            "goal_health",
            "monthly_required",
            "current_contribution_rate",
            "forecast_gap",
            "funding_account",
            "milestones",
        ]
        read_only_fields = ["id", "created_at", "updated_at", "completed_at", "allocated_amount"]

    def get_linked_account_name(self, obj: GoalBucket) -> str | None:
        if obj.linked_account_id and obj.linked_account:
            return obj.linked_account.effective_display_name
        return None

    def get_linked_credit_account_name(self, obj: GoalBucket) -> str | None:
        if obj.is_debt_bucket() and obj.linked_account:
            return obj.linked_account.effective_display_name
        return None

    def validate_target_amount(self, value: Decimal) -> Decimal:
        if value is None or value <= 0:
            raise serializers.ValidationError("Target amount must be positive.")
        return value

    def validate(self, attrs):
        bucket_type = attrs.get("type") or getattr(self.instance, "type", None)
        linked = attrs.get("linked_account")
        if linked is None and self.instance:
            linked = self.instance.linked_account
        household = attrs.get("household") or getattr(self.instance, "household", None)
        if bucket_type == GoalBucket.BucketType.DEBT_PAYOFF and linked:
            if not (linked.is_credit_card() or linked.role == Account.AccountRole.LOAN):
                raise serializers.ValidationError(
                    {"linked_account": "Link a credit card or loan account."}
                )
        elif linked and linked.is_credit_card():
            raise serializers.ValidationError(
                {"linked_account": "Link a checking or savings account."}
            )
        request = self.context.get("request")
        if request and household:
            households = get_households_for_user(request.user)
            if household not in households:
                raise serializers.ValidationError({"household": "Not a member of this household."})
        if linked and household and linked.household_id != household.id:
            raise serializers.ValidationError("Linked account must belong to the bucket household.")
        if linked:
            exclude_id = self.instance.pk if self.instance else None
            if linked_account_in_use(linked.id, exclude_bucket_id=exclude_id):
                raise serializers.ValidationError(
                    {"linked_account": "This account already has an active goal."}
                )
        elif bucket_type != GoalBucket.BucketType.DEBT_PAYOFF:
            raise serializers.ValidationError(
                {"linked_account": "Link the checking or savings account where this goal's money lives."}
            )
        return attrs

    def to_representation(self, instance):
        progress = enrich_bucket(instance, calculate_bucket_progress(instance))
        data = bucket_to_api_dict(instance, progress)
        data["linked_credit_account"] = (
            instance.linked_account_id if instance.is_debt_bucket() else None
        )
        return data

    def create(self, validated_data):
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            validated_data.setdefault("created_by", request.user)
        if not validated_data.get("start_date"):
            from datetime import date

            validated_data.setdefault("start_date", date.today())
        bucket = super().create(validated_data)
        sync_all_transactions_for_linked_bucket(bucket)
        from goals.auto_fund import sync_auto_fund_transfer_rule

        sync_auto_fund_transfer_rule(bucket)
        return bucket

    def update(self, instance, validated_data):
        old_linked = instance.linked_account_id
        old_auto_fund = instance.auto_fund_enabled
        bucket = super().update(instance, validated_data)
        if bucket.linked_account_id != old_linked:
            sync_all_transactions_for_linked_bucket(bucket)
        if bucket.auto_fund_enabled != old_auto_fund or bucket.linked_account_id != old_linked:
            from goals.auto_fund import sync_auto_fund_transfer_rule

            sync_auto_fund_transfer_rule(bucket)
        return bucket


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


class AssignContributionSerializer(serializers.Serializer):
    bucket = serializers.PrimaryKeyRelatedField(queryset=GoalBucket.objects.all())
    transaction = serializers.PrimaryKeyRelatedField(queryset=Transaction.objects.all())
    amount = serializers.DecimalField(max_digits=15, decimal_places=2)

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError("Amount must be positive.")
        return value


class RuleAllocationSerializer(serializers.ModelSerializer):
    rule_name = serializers.CharField(source="rule.name", read_only=True)
    bucket_name = serializers.CharField(source="bucket.name", read_only=True)
    rule_direction = serializers.CharField(source="rule.direction", read_only=True)

    class Meta:
        model = RuleAllocation
        fields = [
            "id",
            "rule",
            "rule_name",
            "rule_direction",
            "bucket",
            "bucket_name",
            "percent",
            "fixed_amount",
            "active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate(self, attrs):
        rule = attrs.get("rule") or getattr(self.instance, "rule", None)
        bucket = attrs.get("bucket") or getattr(self.instance, "bucket", None)
        if rule and bucket and rule.household_id != bucket.household_id:
            raise serializers.ValidationError("Rule and bucket must belong to the same household.")
        if rule and rule.direction != RecurringRule.Direction.INCOME:
            raise serializers.ValidationError({"rule": "Only income rules (paychecks) can fund goal buckets."})

        fixed = attrs.get("fixed_amount")
        pct = attrs.get("percent")
        if self.instance:
            if fixed is None:
                fixed = self.instance.fixed_amount
            if pct is None:
                pct = self.instance.percent
        if (fixed is None or fixed <= 0) and (pct is None or pct <= 0):
            raise serializers.ValidationError("Set a positive fixed_amount or percent.")
        if fixed and fixed > 0 and pct and pct > 0:
            raise serializers.ValidationError("Set either fixed_amount or percent, not both.")
        if pct is not None and (pct <= 0 or pct > 100):
            raise serializers.ValidationError({"percent": "Percent must be between 0 and 100."})
        return attrs


class BucketFundingConfigSerializer(serializers.Serializer):
    auto_fund_enabled = serializers.BooleanField(required=False)
    income_rule_id = serializers.IntegerField(required=False, allow_null=True)
    fixed_amount = serializers.DecimalField(
        max_digits=15, decimal_places=2, required=False, allow_null=True
    )
    percent = serializers.DecimalField(max_digits=6, decimal_places=2, required=False, allow_null=True)
    clear_allocation = serializers.BooleanField(required=False, default=False)

    def validate(self, attrs):
        if attrs.get("clear_allocation"):
            return attrs
        income_rule_id = attrs.get("income_rule_id")
        fixed = attrs.get("fixed_amount")
        pct = attrs.get("percent")
        has_fixed = fixed is not None and fixed > 0
        has_pct = pct is not None and pct > 0
        if income_rule_id is not None and not has_fixed and not has_pct:
            raise serializers.ValidationError(
                "Set fixed_amount or percent when linking a paycheck rule."
            )
        if has_fixed and has_pct:
            raise serializers.ValidationError("Set either fixed_amount or percent, not both.")
        if has_pct and (pct <= 0 or pct > 100):
            raise serializers.ValidationError({"percent": "Percent must be between 0 and 100."})
        return attrs


class GoalContributionSerializer(serializers.ModelSerializer):
    bucket_name = serializers.CharField(source="bucket.name", read_only=True)

    class Meta:
        model = GoalContribution
        fields = [
            "id",
            "bucket",
            "bucket_name",
            "transaction",
            "account",
            "amount",
            "date",
            "source",
            "notes",
            "created_at",
        ]
        read_only_fields = fields
