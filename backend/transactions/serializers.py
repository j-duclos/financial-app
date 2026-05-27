from decimal import Decimal
from rest_framework import serializers
from rest_framework.exceptions import ValidationError

from .models import Transaction, TransactionMatch, Transfer
from accounts.models import Account
from accounts.serializers import AccountSerializer
from categories.models import Category
from categories.serializers import CategorySerializer


class TransactionSerializer(serializers.ModelSerializer):
    account = AccountSerializer(read_only=True)
    account_id = serializers.PrimaryKeyRelatedField(
        queryset=Account.objects.none(), source="account", write_only=True, required=False
    )
    category = CategorySerializer(read_only=True)
    category_id = serializers.PrimaryKeyRelatedField(
        queryset=Category.objects.none(), source="category", write_only=True, required=False, allow_null=True
    )
    direction = serializers.SerializerMethodField()
    transfer_to_account = serializers.SerializerMethodField()
    transfer_to_account_id = serializers.PrimaryKeyRelatedField(
        queryset=Account.objects.none(), write_only=True, required=False, allow_null=True
    )
    rule_name = serializers.SerializerMethodField()
    linked_transaction_id = serializers.SerializerMethodField()

    class Meta:
        model = Transaction
        fields = [
            "id", "account", "account_id", "date", "payee", "memo", "amount",
            "direction", "category", "category_id", "cleared", "reconciled", "reconciled_at",
            "reconciliation_id", "tags",
            "transfer_to_account", "transfer_to_account_id",
            "status", "source", "rule_id", "rule_name", "linked_transaction_id",
            "interest_cycle_end_date", "plaid_transaction_id",
            "transfer_group_id", "posted_date", "planned_date", "imported_description",
            "normalized_payee", "import_match_status", "is_bill",
            "created_at", "updated_at",
        ]
        read_only_fields = [
            "id",
            "created_at",
            "updated_at",
            "interest_cycle_end_date",
            "plaid_transaction_id",
            "imported_description",
            "normalized_payee",
        ]

    def get_direction(self, obj):
        return "INFLOW" if obj.amount and obj.amount >= 0 else "OUTFLOW"

    def get_transfer_to_account(self, obj):
        """Other account in a two-sided transfer: 'to' account when this row is the outgoing leg, 'from' account when this row is the incoming leg. For rule-created payments, return the paired transaction's account (may differ from rule default)."""
        try:
            t = obj.transfer_out
            return AccountSerializer(t.to_transaction.account).data
        except Transfer.DoesNotExist:
            pass
        try:
            t = obj.transfer_in
            return AccountSerializer(t.from_transaction.account).data
        except Transfer.DoesNotExist:
            pass
        if obj.rule_id:
            from timeline.models import RecurringRule
            rule = RecurringRule.objects.filter(pk=obj.rule_id).select_related("transfer_to_account").first()
            if rule and rule.transfer_to_account_id:
                # Return the actual paired "to" transaction's account (same rule+date, other account), not the rule default
                paired = (
                    Transaction.objects.filter(
                        rule_id=obj.rule_id, date=obj.date
                    ).exclude(account_id=obj.account_id).select_related("account").first()
                )
                if paired and paired.account_id:
                    return AccountSerializer(paired.account).data
                return AccountSerializer(rule.transfer_to_account).data
        return None

    def get_rule_name(self, obj):
        """Return the recurring rule name when this transaction is from a rule, so the UI can show it."""
        if not obj.rule_id:
            return None
        from timeline.models import RecurringRule
        rule = RecurringRule.objects.filter(pk=obj.rule_id).values_list("name", flat=True).first()
        return rule

    def get_linked_transaction_id(self, obj):
        """The other leg of a transfer (Transfer model or rule+date pair), if any."""
        try:
            t = obj.transfer_out
            return t.to_transaction_id
        except Transfer.DoesNotExist:
            pass
        try:
            t = obj.transfer_in
            return t.from_transaction_id
        except Transfer.DoesNotExist:
            pass
        if obj.rule_id:
            paired_pk = (
                Transaction.objects.filter(rule_id=obj.rule_id, date=obj.date)
                .exclude(pk=obj.pk)
                .values_list("pk", flat=True)
                .first()
            )
            return paired_pk
        return None

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if self.context.get("request"):
            from core.utils import get_households_for_user
            user = self.context["request"].user
            households = get_households_for_user(user)
            accts = Account.objects.filter(household__in=households)
            self.fields["account_id"].queryset = accts
            self.fields["category_id"].queryset = Category.objects.filter(household__in=households)
            self.fields["transfer_to_account_id"].queryset = accts

    def update(self, instance, validated_data):
        """
        ``transfer_to_account_id`` is not a DB column; when set, create the paired inflow on the
        destination account (``Transfer`` + ``TransferGroup``). If the edited row is a matched
        Plaid import, the link is applied to the *planned* (canonical) outflow row.
        """
        has_to = "transfer_to_account_id" in validated_data
        to_account_obj = validated_data.pop("transfer_to_account_id", None) if has_to else None

        out_for_link = instance
        if has_to and to_account_obj is not None:
            m = TransactionMatch.objects.filter(imported_transaction=instance).select_related(
                "planned_transaction"
            ).first()
            if m:
                out_for_link = m.planned_transaction

        instance = super().update(instance, validated_data)
        instance.refresh_from_db()

        # Matched Plaid import ↔ planned forecast rows share the same bank account. When only one
        # side's date is PATCHed, keep dates aligned so duplicate cleanup in the viewset does not
        # treat the partner row on the old date as stale and delete it.
        if "date" in validated_data:
            new_date = validated_data["date"]
            m_imp = TransactionMatch.objects.filter(imported_transaction_id=instance.pk).first()
            if m_imp:
                Transaction.objects.filter(pk=m_imp.planned_transaction_id).update(date=new_date)
            m_plan = TransactionMatch.objects.filter(planned_transaction_id=instance.pk).first()
            if m_plan:
                Transaction.objects.filter(pk=m_plan.imported_transaction_id).update(date=new_date)

        if has_to and to_account_obj is not None:
            out_for_link.refresh_from_db()
            if not hasattr(out_for_link, "transfer_out"):
                if out_for_link.amount is None or out_for_link.amount >= 0:
                    raise ValidationError(
                        {
                            "transfer_to_account_id": (
                                "Set a payment destination only on an outflow (negative amount) on the payer account, "
                                "or unmatch this import if you need to use the bank line as the payer side."
                            )
                        }
                    )
                from .services.posting import (
                    link_in_leg_from_existing_out_leg,
                    prepare_outflow_txn_for_card_payment_link,
                )

                prepare_outflow_txn_for_card_payment_link(out_for_link)
                out_for_link.refresh_from_db()
                in_leg = link_in_leg_from_existing_out_leg(
                    out_txn=out_for_link,
                    to_account=to_account_obj,
                    payee=out_for_link.payee,
                )
                if in_leg is None:
                    raise ValidationError(
                        {
                            "transfer_to_account_id": (
                                "Could not create the payment on the other account. "
                                "It may already be part of a transfer, or the destination is invalid."
                            )
                        }
                    )
            if has_to:
                validated_data["transfer_to_account_id"] = to_account_obj

        return instance


class TransferCreateSerializer(serializers.Serializer):
    from_account = serializers.PrimaryKeyRelatedField(queryset=Account.objects.none())
    to_account = serializers.PrimaryKeyRelatedField(queryset=Account.objects.none())
    amount = serializers.DecimalField(max_digits=15, decimal_places=2, min_value=Decimal("0"))
    date = serializers.DateField()
    payee = serializers.CharField(required=False, allow_blank=True, default="")
    memo = serializers.CharField(required=False, allow_blank=True, default="")
    from_category_id = serializers.PrimaryKeyRelatedField(
        queryset=Category.objects.none(), required=False, allow_null=True
    )

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if self.context.get("request"):
            from core.utils import get_households_for_user
            user = self.context["request"].user
            households = get_households_for_user(user)
            qs = Account.objects.filter(household__in=households)
            self.fields["from_account"].queryset = qs
            self.fields["to_account"].queryset = qs
            self.fields["from_category_id"].queryset = Category.objects.filter(household__in=households)

    def validate(self, data):
        from_account = data["from_account"]
        to_account = data["to_account"]
        if from_account.pk == to_account.pk:
            raise serializers.ValidationError({"to_account": "From and to account must be different."})
        if from_account.household_id != to_account.household_id:
            raise serializers.ValidationError({"to_account": "Both accounts must belong to the same household."})
        if data["amount"] <= 0:
            raise serializers.ValidationError({"amount": "Amount must be positive."})
        return data


class TransferSerializer(serializers.ModelSerializer):
    from_transaction = TransactionSerializer(read_only=True)
    to_transaction = TransactionSerializer(read_only=True)

    class Meta:
        model = Transfer
        fields = ["transfer_id", "from_transaction", "to_transaction", "amount", "date", "memo", "created_at"]
