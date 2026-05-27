from decimal import Decimal
from rest_framework import serializers

from accounts.models import Account
from accounts.serializers import AccountSerializer
from categories.models import Category
from categories.serializers import CategorySerializer
from core.models import Household
from core.utils import get_households_for_user
from transactions.models import Transaction
from transactions.serializers import TransactionSerializer

from .models import (
    RecurringRule,
    Scenario,
    ScenarioRuleOverride,
    ScenarioOneTimeEvent,
    ScenarioCategoryShock,
    StatementTransaction,
    ReconciliationMatch,
    UpcomingChargeNotification,
)


class RecurringRuleSerializer(serializers.ModelSerializer):
    """transfer_to_account is only meaningful for Credit Card Payment / Bank Transfer rules."""

    account = AccountSerializer(read_only=True)
    account_id = serializers.PrimaryKeyRelatedField(
        queryset=Account.objects.none(), source="account", write_only=True
    )
    transfer_to_account = AccountSerializer(read_only=True)
    transfer_to_account_id = serializers.PrimaryKeyRelatedField(
        queryset=Account.objects.none(), source="transfer_to_account", write_only=True, required=False, allow_null=True
    )
    category = CategorySerializer(read_only=True)
    category_id = serializers.PrimaryKeyRelatedField(
        queryset=Category.objects.none(), source="category", write_only=True, required=False, allow_null=True
    )
    household = serializers.PrimaryKeyRelatedField(
        queryset=Household.objects.none(), required=True
    )

    class Meta:
        model = RecurringRule
        fields = [
            "id", "household", "name", "account", "account_id", "transfer_to_account", "transfer_to_account_id",
            "category", "category_id", "direction", "amount", "currency", "frequency", "interval",
            "day_of_week", "day_of_month", "nth_week", "start_date", "end_date",
            "active",
            "paused_at",
            "notes",
            "is_bill",
            "payment_flexibility_days",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "paused_at", "created_at", "updated_at"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        req = self.context.get("request")
        if req and req.user.is_authenticated:
            households = get_households_for_user(req.user)
            self.fields["household"].queryset = households
            accts = Account.objects.filter(household__in=households)
            self.fields["account_id"].queryset = accts
            self.fields["transfer_to_account_id"].queryset = accts
            self.fields["category_id"].queryset = Category.objects.filter(household__in=households)

    def validate(self, attrs):
        """
        Drop stale transfer_to_account when the category is not a transfer/card-pay category.

        Otherwise build_timeline treats the rule as a bank→card transfer and may suppress every
        projected occurrence when the destination card projects as paid off — while the UI shows a
        plain expense (e.g. Shopping).
        """
        attrs = super().validate(attrs)
        instance = getattr(self, "instance", None)
        cat = attrs.get("category")
        if cat is None and instance is not None:
            cat = instance.category
        name = (cat.name or "").strip() if cat else ""
        if name not in ("Credit Card Payment", "Bank Transfer"):
            attrs["transfer_to_account"] = None
        return attrs


class ScenarioSerializer(serializers.ModelSerializer):
    household = serializers.PrimaryKeyRelatedField(
        queryset=Household.objects.none(), required=True
    )

    class Meta:
        model = Scenario
        fields = [
            "id", "household", "name", "description", "template", "horizon_months",
            "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        req = self.context.get("request")
        if req and req.user.is_authenticated:
            self.fields["household"].queryset = get_households_for_user(req.user)


class ScenarioRuleOverrideSerializer(serializers.ModelSerializer):
    scenario = serializers.PrimaryKeyRelatedField(queryset=Scenario.objects.none(), required=False)
    rule = RecurringRuleSerializer(read_only=True)
    rule_id = serializers.PrimaryKeyRelatedField(
        queryset=RecurringRule.objects.none(), source="rule", write_only=True
    )
    override_account = AccountSerializer(read_only=True)
    override_account_id = serializers.PrimaryKeyRelatedField(
        queryset=Account.objects.none(), source="override_account", required=False, allow_null=True
    )
    override_category = CategorySerializer(read_only=True)
    override_category_id = serializers.PrimaryKeyRelatedField(
        queryset=Category.objects.none(), source="override_category", required=False, allow_null=True
    )

    class Meta:
        model = ScenarioRuleOverride
        fields = [
            "id", "scenario", "rule", "rule_id",
            "override_amount", "override_active", "override_start_date", "override_end_date",
            "override_account", "override_account_id", "override_category", "override_category_id",
            "notes",
            "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        req = self.context.get("request")
        if req and req.user.is_authenticated:
            households = get_households_for_user(req.user)
            self.fields["scenario"].queryset = Scenario.objects.filter(household__in=households)
            self.fields["rule_id"].queryset = RecurringRule.objects.filter(household__in=households)
            self.fields["override_account_id"].queryset = Account.objects.filter(household__in=households)
            self.fields["override_category_id"].queryset = Category.objects.filter(household__in=households)


class ScenarioOneTimeEventSerializer(serializers.ModelSerializer):
    scenario = serializers.PrimaryKeyRelatedField(queryset=Scenario.objects.none(), required=False)
    account = AccountSerializer(read_only=True)
    account_id = serializers.PrimaryKeyRelatedField(
        queryset=Account.objects.none(), source="account", write_only=True
    )
    category = CategorySerializer(read_only=True)
    category_id = serializers.PrimaryKeyRelatedField(
        queryset=Category.objects.none(), source="category", required=False, allow_null=True
    )

    class Meta:
        model = ScenarioOneTimeEvent
        fields = [
            "id", "scenario", "date", "account", "account_id", "description",
            "category", "category_id", "direction", "amount", "notes",
            "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        req = self.context.get("request")
        if req and req.user.is_authenticated:
            households = get_households_for_user(req.user)
            self.fields["scenario"].queryset = Scenario.objects.filter(household__in=households)
            self.fields["account_id"].queryset = Account.objects.filter(household__in=households)
            self.fields["category_id"].queryset = Category.objects.filter(household__in=households)


class ScenarioCategoryShockSerializer(serializers.ModelSerializer):
    scenario = serializers.PrimaryKeyRelatedField(queryset=Scenario.objects.none(), required=False)
    category = CategorySerializer(read_only=True)
    category_id = serializers.PrimaryKeyRelatedField(
        queryset=Category.objects.none(), source="category", write_only=True
    )

    class Meta:
        model = ScenarioCategoryShock
        fields = [
            "id", "scenario", "category", "category_id",
            "percent_change", "start_date", "end_date",
            "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        req = self.context.get("request")
        if req and req.user.is_authenticated:
            households = get_households_for_user(req.user)
            self.fields["scenario"].queryset = Scenario.objects.filter(household__in=households)
            self.fields["category_id"].queryset = Category.objects.filter(household__in=households)


class StatementTransactionSerializer(serializers.ModelSerializer):
    account = AccountSerializer(read_only=True)
    account_id = serializers.PrimaryKeyRelatedField(
        queryset=Account.objects.none(), source="account", write_only=True
    )

    class Meta:
        model = StatementTransaction
        fields = [
            "id", "household", "account", "account_id", "posted_date", "description",
            "amount", "external_id", "raw", "created_at",
        ]
        read_only_fields = ["id", "created_at"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        req = self.context.get("request")
        if req and req.user.is_authenticated:
            self.fields["account_id"].queryset = Account.objects.filter(
                household__in=get_households_for_user(req.user)
            )


class ReconciliationMatchSerializer(serializers.ModelSerializer):
    statement_txn = StatementTransactionSerializer(read_only=True)
    matched_transaction = TransactionSerializer(read_only=True)
    matched_transaction_id = serializers.PrimaryKeyRelatedField(
        queryset=Transaction.objects.none(), source="matched_transaction", required=False, allow_null=True
    )

    class Meta:
        model = ReconciliationMatch
        fields = ["id", "statement_txn", "matched_transaction", "matched_transaction_id", "status", "matched_at"]
        read_only_fields = ["id", "matched_at"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        req = self.context.get("request")
        if req and req.user.is_authenticated:
            households = get_households_for_user(req.user)
            self.fields["matched_transaction_id"].queryset = Transaction.objects.filter(
                account__household__in=households
            )


class UpcomingChargeNotificationSerializer(serializers.ModelSerializer):
    """Read-only serializer for in-app upcoming charge reminders."""

    rule_name = serializers.CharField(source="rule.name", read_only=True)
    rule_amount = serializers.DecimalField(
        max_digits=15, decimal_places=2, source="rule.amount", read_only=True
    )
    rule_currency = serializers.CharField(source="rule.currency", read_only=True)
    account_name = serializers.SerializerMethodField()
    rule_id = serializers.PrimaryKeyRelatedField(read_only=True, source="rule")

    def get_account_name(self, obj):
        return obj.rule.account.effective_display_name

    class Meta:
        model = UpcomingChargeNotification
        fields = [
            "id",
            "rule_id",
            "rule_name",
            "rule_amount",
            "rule_currency",
            "account_name",
            "due_date",
            "created_at",
            "read_at",
        ]
        read_only_fields = ["id", "created_at", "due_date", "rule_id"]
