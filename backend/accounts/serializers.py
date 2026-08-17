from decimal import Decimal
from datetime import date

from rest_framework import serializers
from core.models import Household
from core.serializers import HouseholdSerializer
from core.utils import get_households_for_user

from .models import Account
from .relationship_models import AccountRelationship
from .relationship_serializers import AccountRelationshipSummarySerializer


class AccountSerializer(serializers.ModelSerializer):
    household = serializers.PrimaryKeyRelatedField(
        queryset=Household.objects.none(), required=True, allow_null=False
    )
    balance = serializers.DecimalField(max_digits=15, decimal_places=2, read_only=True, required=False)
    credit_limit = serializers.DecimalField(
        max_digits=15, decimal_places=2, allow_null=True, required=False
    )
    billing_cycle_end_day = serializers.IntegerField(
        allow_null=True, required=False, min_value=1, max_value=31
    )
    statement_closing_day = serializers.IntegerField(
        allow_null=True, required=False, min_value=1, max_value=31
    )
    payment_due_day = serializers.IntegerField(
        allow_null=True, required=False, min_value=1, max_value=31
    )
    interest_rate = serializers.DecimalField(
        max_digits=5, decimal_places=2, allow_null=True, required=False,
        min_value=Decimal("0"), max_value=Decimal("100"),
    )
    interest_cycle_end_day = serializers.IntegerField(
        allow_null=True, required=False, min_value=1, max_value=31
    )
    promotional_apr = serializers.DecimalField(
        max_digits=5, decimal_places=2, allow_null=True, required=False,
        min_value=Decimal("0"), max_value=Decimal("100"),
    )
    promotional_end_date = serializers.DateField(allow_null=True, required=False)
    last_four = serializers.CharField(max_length=4, allow_blank=True, required=False)
    role_display = serializers.CharField(source="get_role_display", read_only=True)
    minimum_buffer = serializers.DecimalField(
        max_digits=12, decimal_places=2, required=False, min_value=Decimal("0"),
    )
    target_utilization_percent = serializers.DecimalField(
        max_digits=5,
        decimal_places=2,
        required=False,
        allow_null=True,
        min_value=Decimal("0"),
        max_value=Decimal("100"),
    )
    current_balance = serializers.DecimalField(
        max_digits=12, decimal_places=2, required=False, allow_null=True, min_value=Decimal("0"),
    )
    statement_balance = serializers.DecimalField(
        max_digits=12, decimal_places=2, required=False, allow_null=True, min_value=Decimal("0"),
    )
    minimum_payment_amount = serializers.DecimalField(
        max_digits=12, decimal_places=2, required=False, allow_null=True, min_value=Decimal("0"),
    )
    autopay_fixed_amount = serializers.DecimalField(
        max_digits=12, decimal_places=2, required=False, allow_null=True, min_value=Decimal("0"),
    )
    autopay_account = serializers.PrimaryKeyRelatedField(
        queryset=Account.objects.none(), allow_null=True, required=False
    )
    available_credit = serializers.DecimalField(
        max_digits=12, decimal_places=2, read_only=True, required=False
    )
    utilization_percent = serializers.DecimalField(
        max_digits=6, decimal_places=2, read_only=True, allow_null=True, required=False
    )
    payoff_to_avoid_interest = serializers.SerializerMethodField()
    estimated_monthly_interest = serializers.SerializerMethodField()
    projected_interest_if_unpaid = serializers.SerializerMethodField()
    is_payment_due_soon = serializers.BooleanField(read_only=True, required=False)
    days_until_due = serializers.IntegerField(read_only=True, allow_null=True, required=False)
    available_to_spend = serializers.DecimalField(
        max_digits=15, decimal_places=2, read_only=True, required=False, allow_null=True
    )
    projected_balance_30_days = serializers.DecimalField(
        max_digits=15, decimal_places=2, read_only=True, required=False, allow_null=True
    )
    lowest_projected_balance_30_days = serializers.DecimalField(
        max_digits=15, decimal_places=2, read_only=True, required=False, allow_null=True
    )
    upcoming_inflows_30_days = serializers.DecimalField(
        max_digits=15, decimal_places=2, read_only=True, required=False, allow_null=True
    )
    upcoming_outflows_30_days = serializers.DecimalField(
        max_digits=15, decimal_places=2, read_only=True, required=False, allow_null=True
    )
    risk_status = serializers.CharField(read_only=True, required=False, allow_null=True)
    risk_date = serializers.DateField(read_only=True, required=False, allow_null=True)
    risk_reason = serializers.CharField(read_only=True, required=False, allow_null=True)
    health_status = serializers.CharField(read_only=True, required=False, allow_null=True)
    health_score = serializers.IntegerField(read_only=True, required=False, allow_null=True)
    health_reason = serializers.CharField(read_only=True, required=False, allow_null=True)
    health_risk_date = serializers.DateField(read_only=True, required=False, allow_null=True)
    health_details = serializers.JSONField(read_only=True, required=False, allow_null=True)
    health_recommended_action = serializers.CharField(
        read_only=True, required=False, allow_null=True
    )
    outgoing_relationships = serializers.SerializerMethodField()
    incoming_relationships = serializers.SerializerMethodField()
    display_name = serializers.CharField(max_length=100, allow_blank=True, required=False)
    purpose = serializers.CharField(max_length=255, allow_blank=True, required=False)
    notes = serializers.CharField(allow_blank=True, required=False)
    effective_display_name = serializers.CharField(read_only=True)
    short_description = serializers.CharField(read_only=True)
    last_activity_date = serializers.SerializerMethodField()
    payoff_estimate = serializers.JSONField(read_only=True, required=False)

    class Meta:
        model = Account
        fields = [
            "id", "household", "account_type", "role", "role_display", "minimum_buffer",
            "name", "display_name", "purpose", "notes", "effective_display_name",
            "short_description", "nickname", "institution", "last_four", "currency",
            "starting_balance", "apr", "promotional_apr", "promotional_end_date",
            "interest_rate", "interest_cycle_end_day", "credit_limit", "target_utilization_percent",
            "billing_cycle_end_day", "statement_closing_day", "payment_due_day",
            "current_balance", "statement_balance", "minimum_payment_amount",
            "last_statement_date", "next_statement_date", "next_payment_due_date",
            "autopay_enabled", "autopay_account", "autopay_type", "autopay_fixed_amount",
            "status", "archived_at", "closed_at", "deleted_at", "is_hidden",
            "close_reason", "archive_reason", "preserve_in_net_worth", "plaid_sync_enabled",
            "is_active", "archived", "include_in_forecast", "include_in_available_credit",
            "preserve_partner_transfer_legs",
            "position", "created_at", "updated_at", "balance",
            "available_credit", "utilization_percent", "payoff_to_avoid_interest",
            "estimated_monthly_interest", "projected_interest_if_unpaid",
            "is_payment_due_soon", "days_until_due",
            "available_to_spend", "projected_balance_30_days",
            "lowest_projected_balance_30_days", "upcoming_inflows_30_days",
            "upcoming_outflows_30_days", "risk_status", "risk_date", "risk_reason",
            "health_status", "health_score", "health_reason", "health_risk_date",
            "health_details", "health_recommended_action",
            "outgoing_relationships", "incoming_relationships",
            "last_activity_date",
            "payoff_estimate",
        ]
        read_only_fields = [
            "id", "status", "archived_at", "closed_at", "deleted_at",
            "created_at", "updated_at", "role_display",
            "effective_display_name", "short_description",
            "last_statement_date", "next_statement_date", "next_payment_due_date",
            "available_credit", "utilization_percent", "payoff_to_avoid_interest",
            "estimated_monthly_interest", "projected_interest_if_unpaid",
            "is_payment_due_soon", "days_until_due",
            "available_to_spend", "projected_balance_30_days",
            "lowest_projected_balance_30_days", "upcoming_inflows_30_days",
            "upcoming_outflows_30_days", "risk_status", "risk_date", "risk_reason",
            "health_status", "health_score", "health_reason", "health_risk_date",
            "health_details", "health_recommended_action",
            "outgoing_relationships", "incoming_relationships",
            "last_activity_date",
        ]

    def get_last_activity_date(self, instance):
        val = getattr(instance, "last_activity_date", None)
        if val is None:
            return None
        return val.isoformat() if hasattr(val, "isoformat") else val

    def get_outgoing_relationships(self, instance):
        return self._relationships_for(instance, "outgoing")

    def get_incoming_relationships(self, instance):
        return self._relationships_for(instance, "incoming")

    def _relationships_for(self, instance, direction: str):
        rels_by_account = self.context.get("relationships_by_account_id") or {}
        rel_bundle = rels_by_account.get(instance.pk)
        if rel_bundle:
            return rel_bundle.get(direction, [])
        if not self.context.get("include_relationships"):
            return []
        lookup = (
            {"source_account_id": instance.pk}
            if direction == "outgoing"
            else {"destination_account_id": instance.pk}
        )
        qs = AccountRelationship.objects.filter(**lookup).select_related(
            "source_account", "destination_account"
        )
        return AccountRelationshipSummarySerializer(qs, many=True).data

    def get_payoff_to_avoid_interest(self, instance):
        fields = self._credit_interest_fields(instance)
        return fields["payoff_to_avoid_interest"] if fields else None

    def get_estimated_monthly_interest(self, instance):
        fields = self._credit_interest_fields(instance)
        return fields["estimated_monthly_interest"] if fields else None

    def get_projected_interest_if_unpaid(self, instance):
        fields = self._credit_interest_fields(instance)
        return fields["projected_interest_if_unpaid"] if fields else None

    def _credit_interest_fields(self, instance) -> dict | None:
        if not instance.is_credit_card():
            return None
        cache = getattr(instance, "_credit_interest_fields_cache", None)
        if cache is not None:
            return cache
        payments_map = self.context.get("payments_since_statement_by_id")
        if payments_map is not None:
            paid = payments_map.get(instance.pk, Decimal("0"))
            stmt = Decimal(str(instance.statement_balance or 0))
            payoff = max(Decimal("0"), stmt - paid)
        else:
            payoff = instance.payoff_to_avoid_interest
        from credit_cards.services.payoff import calculate_monthly_interest

        unpaid = payoff
        if unpaid <= 0:
            unpaid = Decimal(str(instance.statement_balance or 0))
        interest = calculate_monthly_interest(instance, unpaid)
        cache = {
            "payoff_to_avoid_interest": str(payoff),
            "estimated_monthly_interest": str(interest),
            "projected_interest_if_unpaid": str(interest),
        }
        instance._credit_interest_fields_cache = cache
        return cache

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        if not request or not getattr(request.user, "is_authenticated", False):
            return
        if getattr(request, "method", "GET") in ("GET", "HEAD", "OPTIONS"):
            return
        self.fields["household"].queryset = get_households_for_user(request.user)
        hh_ids = list(self.fields["household"].queryset.values_list("pk", flat=True))
        self.fields["autopay_account"].queryset = Account.objects.filter(
            household_id__in=hh_ids,
            account_type__in=[
                Account.AccountType.CHECKING,
                Account.AccountType.SAVINGS,
                Account.AccountType.CASH,
            ],
        )

    def validate_last_four(self, value):
        if value is None or value == "":
            return ""
        digits = "".join(c for c in str(value) if c.isdigit())
        if len(digits) > 4:
            digits = digits[-4:]
        if len(digits) not in (0, 4):
            raise serializers.ValidationError("Enter exactly four digits, or leave blank.")
        return digits

    def _is_credit(self, data):
        account_type = data.get("account_type")
        if account_type is None and self.instance:
            account_type = self.instance.account_type
        return account_type == Account.AccountType.CREDIT

    def validate_credit_limit(self, value):
        if value is not None and Decimal(str(value)) < 0:
            raise serializers.ValidationError("Credit limit cannot be negative.")
        return value

    def validate_apr(self, value):
        if value is not None and Decimal(str(value)) < 0:
            raise serializers.ValidationError("APR cannot be negative.")
        return value

    def _apply_nickname_compat(self, attrs):
        """Map deprecated nickname writes to display_name when display_name not provided."""
        if "nickname" in attrs and "display_name" not in attrs:
            nick = (attrs.get("nickname") or "").strip()
            attrs["display_name"] = nick[:100]
        if "display_name" in attrs:
            attrs["display_name"] = (attrs.get("display_name") or "").strip()[:100]
        if "purpose" in attrs:
            attrs["purpose"] = (attrs.get("purpose") or "").strip()[:255]
        if "notes" in attrs:
            attrs["notes"] = attrs.get("notes") or ""
        return attrs

    def _drop_null_credit_card_amounts(self, attrs):
        """Omit explicit nulls so model defaults apply (create sends null for non-credit)."""
        for field in (
            "current_balance",
            "statement_balance",
            "minimum_payment_amount",
            "autopay_fixed_amount",
        ):
            if attrs.get(field) is None:
                attrs.pop(field, None)
        return attrs

    def validate(self, attrs):
        attrs = self._apply_nickname_compat(attrs)
        attrs = self._drop_null_credit_card_amounts(attrs)
        is_credit = self._is_credit(attrs)
        autopay_account_explicit = "autopay_account" in attrs
        autopay_touched = any(
            key in attrs for key in ("autopay_account", "autopay_enabled", "autopay_type", "account_type")
        )
        if autopay_account_explicit:
            autopay_account = attrs.get("autopay_account")
        elif autopay_touched and self.instance:
            autopay_account = self.instance.autopay_account
        else:
            autopay_account = None
        if autopay_account is not None and autopay_touched:
            if autopay_account.account_type not in (
                Account.AccountType.CHECKING,
                Account.AccountType.SAVINGS,
                Account.AccountType.CASH,
            ):
                raise serializers.ValidationError(
                    {"autopay_account": "Autopay must come from a checking, savings, or cash account."}
                )
            card = self.instance
            if card and autopay_account.pk == card.pk:
                raise serializers.ValidationError(
                    {"autopay_account": "Autopay account cannot be the same credit card."}
                )
        if attrs.get("statement_closing_day") is not None and not is_credit:
            attrs["statement_closing_day"] = None
        if attrs.get("payment_due_day") is not None and not is_credit:
            attrs["payment_due_day"] = None
        stmt_day = attrs.get("statement_closing_day")
        if stmt_day is not None:
            attrs["billing_cycle_end_day"] = stmt_day
        elif attrs.get("billing_cycle_end_day") is not None and is_credit:
            attrs["statement_closing_day"] = attrs["billing_cycle_end_day"]
        if not is_credit and attrs.get("target_utilization_percent") is None:
            attrs.pop("target_utilization_percent", None)
        return attrs

    def create(self, validated_data):
        if "role" not in validated_data:
            validated_data["role"] = Account.infer_role_from_account_type(
                validated_data["account_type"]
            )
        instance = super().create(validated_data)
        self._sync_nickname_from_display_name(instance)
        return instance

    def update(self, instance, validated_data):
        archived_toggle = validated_data.pop("archived", None)
        if "account_type" in validated_data and "role" not in validated_data:
            validated_data["role"] = Account.infer_role_from_account_type(
                validated_data["account_type"]
            )
        instance = super().update(instance, validated_data)
        if archived_toggle is not None:
            from accounts.services.lifecycle import archive_account, restore_account

            if archived_toggle and instance.status == Account.Status.ACTIVE:
                archive_account(instance, reason=instance.archive_reason or "")
                instance.refresh_from_db()
            elif not archived_toggle and instance.status == Account.Status.ARCHIVED:
                restore_account(instance, target_status=Account.Status.ACTIVE)
                instance.refresh_from_db()
        if "display_name" in validated_data:
            self._sync_nickname_from_display_name(instance)
        return instance

    def _sync_nickname_from_display_name(self, instance):
        """Keep nickname in sync with display_name for legacy clients."""
        dn = (instance.display_name or "").strip()
        if (instance.nickname or "").strip() != dn:
            Account.objects.filter(pk=instance.pk).update(nickname=dn)

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data["effective_display_name"] = instance.effective_display_name
        data["short_description"] = instance.short_description
        data["household"] = HouseholdSerializer(instance.household).data
        data["billing_cycle_end_day"] = instance.get_statement_closing_day()
        data["statement_closing_day"] = instance.get_statement_closing_day()
        data["interest_cycle_end_day"] = getattr(instance, "interest_cycle_end_day", None)
        data["promotional_end_date"] = getattr(instance, "promotional_end_date", None)
        promo_apr = getattr(instance, "promotional_apr", None)
        data["promotional_apr"] = str(promo_apr) if promo_apr is not None else None
        credit_limit = getattr(instance, "credit_limit", None)
        data["credit_limit"] = str(credit_limit) if credit_limit is not None else None
        interest_rate = getattr(instance, "interest_rate", None)
        data["interest_rate"] = str(interest_rate) if interest_rate is not None else None
        minimum_buffer = getattr(instance, "minimum_buffer", None)
        data["minimum_buffer"] = str(minimum_buffer) if minimum_buffer is not None else "0"

        request = self.context.get("request")
        want_balance = bool(request and request.query_params.get("balance") == "true")
        signed_balances = self.context.get("signed_balances_by_id")
        signed = None
        if want_balance:
            if signed_balances is not None and instance.pk in signed_balances:
                signed = signed_balances[instance.pk]
            else:
                annotated = getattr(instance, "balance", None)
                if annotated is not None and not instance.is_credit_card():
                    signed = Decimal(str(annotated))
                else:
                    from timeline.services.ledger import _balance_at_end_of_date

                    signed = _balance_at_end_of_date(instance.pk, date.today())
            data["balance"] = str(signed)

        if instance.is_credit_card():
            from accounts.services.balances import credit_owed_from_signed_balance

            if signed is None and "balance" in data and data["balance"] is not None:
                signed = Decimal(str(data["balance"]))
            if signed is not None:
                owed = credit_owed_from_signed_balance(signed)
            else:
                owed = Decimal(str(instance.current_balance or 0))
            data["balance_owed"] = str(owed)
            data["balance"] = str(-owed)
            cl = getattr(instance, "credit_limit", None)
            if cl is not None:
                from accounts.services.balances import calculate_credit_metrics

                metrics = calculate_credit_metrics(
                    instance, signed if signed is not None else -owed
                )
                data["available_balance"] = str(metrics["available"])
                data["available_credit"] = str(metrics["available"])
                util = metrics["utilization_percent"]
                data["utilization_percent"] = str(util) if util is not None else None
            else:
                data["available_balance"] = None
                data["available_credit"] = None
                data["utilization_percent"] = None
            interest_fields = self._credit_interest_fields(instance) or {}
            data["payoff_to_avoid_interest"] = interest_fields.get("payoff_to_avoid_interest")
            data["estimated_monthly_interest"] = interest_fields.get(
                "estimated_monthly_interest"
            )
            data["projected_interest_if_unpaid"] = interest_fields.get(
                "projected_interest_if_unpaid"
            )
            data["is_payment_due_soon"] = instance.is_payment_due_soon
            data["days_until_due"] = instance.days_until_due
            data["current_balance"] = str(owed)
            data["statement_balance"] = (
                str(instance.statement_balance) if instance.statement_balance is not None else None
            )
            data["minimum_payment_amount"] = (
                str(instance.minimum_payment_amount)
                if instance.minimum_payment_amount is not None
                else None
            )
            from .services.credit_card import credit_payment_due_state

            due_state = credit_payment_due_state(instance)
            data["payment_due_is_stale"] = due_state["is_stale"]
            data["payment_due_amount"] = (
                str(due_state["amount"]) if due_state["amount"] is not None else None
            )
            data["payment_due_amount_unavailable"] = (
                not due_state["amount_known"] and owed > 0
            )
        elif "balance" in data and data["balance"] is not None:
            data["available_balance"] = data["balance"]
            data["balance_owed"] = None
            data["available_credit"] = None
            data["utilization_percent"] = None
            data["payoff_to_avoid_interest"] = None
            data["estimated_monthly_interest"] = None
            data["projected_interest_if_unpaid"] = None
            data["is_payment_due_soon"] = False
            data["days_until_due"] = None
        else:
            data["available_balance"] = None
            data["balance_owed"] = None

        forecast_by_id = self.context.get("forecast_summaries_by_id") or {}
        summary = forecast_by_id.get(instance.pk)
        if summary:
            from .services.available_to_spend import serialize_forecast_summary

            data.update(serialize_forecast_summary(summary))

        health_by_id = self.context.get("health_by_id") or {}
        health = health_by_id.get(instance.pk)
        if health:
            from .services.account_health import serialize_account_health

            data.update(serialize_account_health(health))

        projected_by_id = self.context.get("projected_statement_by_id") or {}
        projected = projected_by_id.get(instance.pk)
        if projected:
            from .services.projected_statement import serialize_projected_statement

            data.update(serialize_projected_statement(projected))

        payoff_by_id = self.context.get("payoff_estimates_by_id") or {}
        payoff_est = payoff_by_id.get(instance.pk)
        if payoff_est is not None:
            data["payoff_estimate"] = payoff_est

        return data
