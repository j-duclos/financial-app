from datetime import date
from decimal import Decimal

from django.utils import timezone
from rest_framework import serializers

from accounts.models import Account
from accounts.serializers import AccountSerializer
from categories.models import Category
from categories.serializers import CategorySerializer
from core.models import Household
from core.utils import get_households_for_user
from transactions.models import Transaction
from transactions.serializers import TransactionSerializer

from .services.rule_schedule import (
    apply_rule_schedule_change,
    cancel_scheduled_changes,
    ensure_initial_schedule,
    get_next_scheduled_change,
    params_from_rule,
    resolve_rule_params,
)
from .models import (
    RecurringRule,
    RecurringRuleSchedule,
    Scenario,
    ScenarioRuleOverride,
    ScenarioOneTimeEvent,
    ScenarioAddedRecurring,
    ScenarioCategoryShock,
    StatementTransaction,
    ReconciliationMatch,
    UpcomingChargeNotification,
)


class RecurringRuleNestedAccountSerializer(serializers.ModelSerializer):
    """Account fields needed to display/filter rules — no health, payoff, or relationship queries."""

    household = serializers.IntegerField(source="household_id", read_only=True)

    class Meta:
        model = Account
        fields = [
            "id",
            "household",
            "name",
            "display_name",
            "effective_display_name",
            "account_type",
            "currency",
            "status",
        ]
        read_only_fields = fields


class RecurringRuleNestedCategorySerializer(serializers.ModelSerializer):
    household = serializers.IntegerField(source="household_id", read_only=True)
    parent = serializers.IntegerField(source="parent_id", read_only=True, allow_null=True)

    class Meta:
        model = Category
        fields = [
            "id",
            "household",
            "parent",
            "name",
            "category_type",
            "is_system",
            "is_archived",
            "sort_order",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


class RecurringRuleScheduleSerializer(serializers.ModelSerializer):
    class Meta:
        model = RecurringRuleSchedule
        fields = [
            "effective_from",
            "account_id",
            "transfer_to_account_id",
            "category_id",
            "direction",
            "amount",
            "currency",
            "frequency",
            "interval",
            "day_of_week",
            "day_of_month",
            "nth_week",
            "start_date",
            "end_date",
        ]


class RecurringRuleSerializer(serializers.ModelSerializer):
    """transfer_to_account is only meaningful for Credit Card Payment / Bank Transfer rules."""

    change_effective_date = serializers.DateField(
        required=False,
        allow_null=True,
        write_only=True,
        help_text="Date when schedule changes take effect (inclusive). Defaults to today.",
    )
    cancel_scheduled_change = serializers.BooleanField(
        required=False,
        default=False,
        write_only=True,
        help_text="Remove future-dated schedule segments without applying new values.",
    )
    scheduled_change = serializers.SerializerMethodField()
    next_occurrence_date = serializers.SerializerMethodField()
    estimated_monthly_amount = serializers.SerializerMethodField()
    account = RecurringRuleNestedAccountSerializer(read_only=True)
    account_id = serializers.PrimaryKeyRelatedField(
        queryset=Account.objects.none(), source="account", write_only=True
    )
    transfer_to_account = RecurringRuleNestedAccountSerializer(read_only=True)
    transfer_to_account_id = serializers.PrimaryKeyRelatedField(
        queryset=Account.objects.none(), source="transfer_to_account", write_only=True, required=False, allow_null=True
    )
    category = RecurringRuleNestedCategorySerializer(read_only=True)
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
            "scheduled_change",
            "next_occurrence_date",
            "estimated_monthly_amount",
            "change_effective_date",
            "cancel_scheduled_change",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "paused_at",
            "scheduled_change",
            "next_occurrence_date",
            "estimated_monthly_amount",
            "created_at",
            "updated_at",
        ]

    _SCHEDULE_ATTRS = (
        "account",
        "transfer_to_account",
        "category",
        "direction",
        "amount",
        "currency",
        "frequency",
        "interval",
        "day_of_week",
        "day_of_month",
        "nth_week",
        "start_date",
        "end_date",
    )

    def get_scheduled_change(self, obj: RecurringRule) -> dict | None:
        sched = get_next_scheduled_change(obj)
        if sched is None:
            return None
        return RecurringRuleScheduleSerializer(sched).data

    def get_next_occurrence_date(self, obj: RecurringRule) -> str | None:
        """Canonical next run from generate_rule_occurrence_dates — not a full forecast."""
        from bills.recurring_payment_status import get_next_rule_run_date

        due = get_next_rule_run_date(obj, timezone.localdate())
        return due.isoformat() if due else None

    def get_estimated_monthly_amount(self, obj: RecurringRule) -> str:
        """Overwritten in to_representation with schedule-resolved params."""
        from timeline.services.rule_amounts import rule_estimated_monthly_amount

        return str(rule_estimated_monthly_amount(obj))

    def to_representation(self, instance: RecurringRule) -> dict:
        data = super().to_representation(instance)
        today = timezone.localdate()
        params = resolve_rule_params(instance, today)
        data["amount"] = str(Decimal(params.amount).quantize(Decimal("0.01")))
        data["currency"] = params.currency
        data["direction"] = params.direction
        data["frequency"] = params.frequency
        data["interval"] = params.interval
        data["day_of_week"] = params.day_of_week
        data["day_of_month"] = params.day_of_month
        data["nth_week"] = params.nth_week
        data["start_date"] = params.start_date.isoformat()
        data["end_date"] = params.end_date.isoformat() if params.end_date else None
        from timeline.services.rule_amounts import rule_estimated_monthly_amount_from_fields

        data["estimated_monthly_amount"] = str(
            rule_estimated_monthly_amount_from_fields(
                amount=params.amount,
                frequency=params.frequency,
                interval=params.interval,
                direction=params.direction,
            )
        )
        segment = self._effective_segment(instance, today)
        if segment is not None:
            if params.account_id != instance.account_id and getattr(segment, "account", None):
                data["account"] = RecurringRuleNestedAccountSerializer(segment.account).data
            if params.transfer_to_account_id != instance.transfer_to_account_id:
                if segment.transfer_to_account_id and getattr(segment, "transfer_to_account", None):
                    data["transfer_to_account"] = RecurringRuleNestedAccountSerializer(
                        segment.transfer_to_account
                    ).data
                else:
                    data["transfer_to_account"] = None
            if params.category_id != instance.category_id:
                if segment.category_id and getattr(segment, "category", None):
                    data["category"] = RecurringRuleNestedCategorySerializer(segment.category).data
                else:
                    data["category"] = None
        return data

    def _effective_segment(self, obj: RecurringRule, today: date) -> RecurringRuleSchedule | None:
        cache = getattr(obj, "_prefetched_objects_cache", None)
        if not cache or "schedules" not in cache:
            return None
        eligible = [s for s in obj.schedules.all() if s.effective_from <= today]
        if not eligible:
            return None
        eligible.sort(key=lambda s: (s.effective_from, s.id), reverse=True)
        return eligible[0]

    @property
    def materialize_cutoff(self) -> date:
        return getattr(self, "_materialize_cutoff", timezone.localdate())

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        req = self.context.get("request")
        if not req or not req.user.is_authenticated:
            return
        if getattr(req, "method", "GET") in ("GET", "HEAD", "OPTIONS"):
            return
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
        change_date = attrs.get("change_effective_date")
        if change_date is not None and change_date < timezone.localdate():
            raise serializers.ValidationError(
                {"change_effective_date": "Effective date cannot be before today."}
            )
        return attrs

    def _params_after_attrs(self, instance: RecurringRule, attrs: dict) -> "RuleScheduleParams":
        from .services.rule_schedule import RuleScheduleParams

        base = params_from_rule(instance)
        if "account" in attrs:
            account_id = attrs["account"].pk if attrs["account"] is not None else base.account_id
        else:
            account_id = base.account_id
        if "transfer_to_account" in attrs:
            transfer_to_account_id = (
                attrs["transfer_to_account"].pk if attrs["transfer_to_account"] is not None else None
            )
        else:
            transfer_to_account_id = base.transfer_to_account_id
        if "category" in attrs:
            category_id = attrs["category"].pk if attrs["category"] is not None else None
        else:
            category_id = base.category_id
        data = {
            "account_id": account_id,
            "transfer_to_account_id": transfer_to_account_id,
            "category_id": category_id,
            "direction": attrs.get("direction", base.direction),
            "amount": Decimal(str(attrs.get("amount", base.amount))),
            "currency": attrs.get("currency", base.currency),
            "frequency": attrs.get("frequency", base.frequency),
            "interval": attrs.get("interval", base.interval),
            "day_of_week": attrs.get("day_of_week", base.day_of_week),
            "day_of_month": attrs.get("day_of_month", base.day_of_month),
            "nth_week": attrs.get("nth_week", base.nth_week),
            "start_date": attrs.get("start_date", base.start_date),
            "end_date": attrs.get("end_date", base.end_date),
        }
        return RuleScheduleParams(**data)

    def create(self, validated_data):
        validated_data.pop("change_effective_date", None)
        validated_data.pop("cancel_scheduled_change", None)
        rule = super().create(validated_data)
        ensure_initial_schedule(rule)
        self._materialize_cutoff = timezone.localdate()
        return rule

    def update(self, instance, validated_data):
        change_effective_date = validated_data.pop("change_effective_date", None)
        cancel_scheduled = validated_data.pop("cancel_scheduled_change", False)
        today = timezone.localdate()

        schedule_attrs = {k: validated_data[k] for k in self._SCHEDULE_ATTRS if k in validated_data}
        meta_attrs = {k: v for k, v in validated_data.items() if k not in self._SCHEDULE_ATTRS}

        for key, value in meta_attrs.items():
            setattr(instance, key, value)

        if cancel_scheduled:
            next_sched = get_next_scheduled_change(instance)
            cancel_scheduled_changes(instance)
            self._materialize_cutoff = next_sched.effective_from if next_sched else today
            instance.save()
            return instance

        if schedule_attrs:
            params = self._params_after_attrs(instance, schedule_attrs)
            effective_from = change_effective_date or today
            self._materialize_cutoff = apply_rule_schedule_change(
                instance, params, effective_from=effective_from, today=today
            )
        else:
            self._materialize_cutoff = today

        if meta_attrs:
            instance.save()
        elif not schedule_attrs:
            instance.save()
        return instance


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
    transfer_to_account = AccountSerializer(read_only=True)
    transfer_to_account_id = serializers.PrimaryKeyRelatedField(
        queryset=Account.objects.none(),
        source="transfer_to_account",
        required=False,
        allow_null=True,
        write_only=True,
    )
    category = CategorySerializer(read_only=True)
    category_id = serializers.PrimaryKeyRelatedField(
        queryset=Category.objects.none(), source="category", required=False, allow_null=True
    )

    class Meta:
        model = ScenarioOneTimeEvent
        fields = [
            "id", "scenario", "date", "account", "account_id",
            "transfer_to_account", "transfer_to_account_id",
            "description", "category", "category_id", "direction", "amount", "notes",
            "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate(self, attrs):
        direction = attrs.get("direction") or getattr(self.instance, "direction", None)
        account = attrs.get("account") or getattr(self.instance, "account", None)
        to_account = attrs.get("transfer_to_account")
        if to_account is None and self.instance is not None:
            to_account = getattr(self.instance, "transfer_to_account", None)

        if direction == ScenarioOneTimeEvent.Direction.TRANSFER:
            if to_account is None:
                raise serializers.ValidationError(
                    {"transfer_to_account_id": "Destination account is required for transfers."}
                )
            if account is not None and account.pk == to_account.pk:
                raise serializers.ValidationError(
                    {"transfer_to_account_id": "Source and destination must be different accounts."}
                )
        return attrs

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        req = self.context.get("request")
        if req and req.user.is_authenticated:
            households = get_households_for_user(req.user)
            acct_qs = Account.objects.filter(household__in=households)
            self.fields["scenario"].queryset = Scenario.objects.filter(household__in=households)
            self.fields["account_id"].queryset = acct_qs
            self.fields["transfer_to_account_id"].queryset = acct_qs
            self.fields["category_id"].queryset = Category.objects.filter(household__in=households)


class ScenarioAddedRecurringSerializer(serializers.ModelSerializer):
    scenario = serializers.PrimaryKeyRelatedField(queryset=Scenario.objects.none(), required=False)
    account = AccountSerializer(read_only=True)
    account_id = serializers.PrimaryKeyRelatedField(
        queryset=Account.objects.none(), source="account", write_only=True
    )
    transfer_to_account = AccountSerializer(read_only=True)
    transfer_to_account_id = serializers.PrimaryKeyRelatedField(
        queryset=Account.objects.none(),
        source="transfer_to_account",
        write_only=True,
        required=False,
        allow_null=True,
    )
    category = CategorySerializer(read_only=True)
    category_id = serializers.PrimaryKeyRelatedField(
        queryset=Category.objects.none(), source="category", required=False, allow_null=True
    )

    class Meta:
        model = ScenarioAddedRecurring
        fields = [
            "id",
            "scenario",
            "name",
            "account",
            "account_id",
            "transfer_to_account",
            "transfer_to_account_id",
            "category",
            "category_id",
            "direction",
            "amount",
            "currency",
            "frequency",
            "interval",
            "day_of_week",
            "day_of_month",
            "nth_week",
            "start_date",
            "end_date",
            "notes",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        req = self.context.get("request")
        if req and req.user.is_authenticated:
            households = get_households_for_user(req.user)
            acct_qs = Account.objects.filter(household__in=households)
            self.fields["scenario"].queryset = Scenario.objects.filter(household__in=households)
            self.fields["account_id"].queryset = acct_qs
            self.fields["transfer_to_account_id"].queryset = acct_qs
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
