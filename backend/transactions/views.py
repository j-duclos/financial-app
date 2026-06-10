from typing import Optional

from decimal import Decimal

from django.db.models import Q
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.viewsets import ModelViewSet
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.request import Request
from django_filters.rest_framework import DjangoFilterBackend

from core.utils import get_households_for_user
from core.permissions import IsHouseholdMember
from .models import Transaction, TransactionMatch, Transfer
from .serializers import TransactionSerializer, TransferCreateSerializer, TransferSerializer
from .rule_transfer_pairs import find_rule_transfer_counterpart_txn
from .services import (
    cleanup_orphaned_rule_materializations_for_user,
    create_transfer,
    delete_transaction_respecting_partner_ledger,
    post_transaction,
)
from .services.matching import (
    find_candidate_matches,
    ignore_imported_transaction,
    manual_match_transactions,
    mark_import_duplicate,
    unmatch_transaction,
)
from .pagination import TransactionPagination


def _dedupe_rule_rows_on_date(
    *,
    rule_id: int,
    occurrence_date,
    keep_ids: set[int],
    account_ids: list[int],
) -> None:
    """One materialized row per rule occurrence per account — drop extras after date moves."""
    Transaction.objects.filter(
        rule_id=rule_id,
        date=occurrence_date,
        account_id__in=account_ids,
    ).exclude(pk__in=keep_ids).delete()


def _record_rule_occurrence_date_move(
    instance: Transaction,
    *,
    old_date,
    new_date,
    other: Optional[Transaction],
) -> None:
    """Skip the old schedule date and remove duplicate rule rows after a one-off date change."""
    if instance.rule_id is None or old_date == new_date or new_date is None:
        return
    from timeline.models import RecurringRule, RecurringRuleSkip

    RecurringRuleSkip.objects.get_or_create(rule_id=instance.rule_id, date=old_date)

    rule = RecurringRule.objects.filter(pk=instance.rule_id).first()
    if rule is None:
        return

    keep_ids = {instance.pk}
    if other is not None:
        keep_ids.add(other.pk)
    for mm in TransactionMatch.objects.filter(
        Q(imported_transaction_id=instance.pk) | Q(planned_transaction_id=instance.pk)
    ):
        keep_ids.add(mm.imported_transaction_id)
        keep_ids.add(mm.planned_transaction_id)

    if rule.transfer_to_account_id:
        account_ids = [rule.account_id, rule.transfer_to_account_id]
    else:
        account_ids = [instance.account_id]

    _dedupe_rule_rows_on_date(
        rule_id=rule.id,
        occurrence_date=old_date,
        keep_ids=keep_ids,
        account_ids=account_ids,
    )
    _dedupe_rule_rows_on_date(
        rule_id=rule.id,
        occurrence_date=new_date,
        keep_ids=keep_ids,
        account_ids=account_ids,
    )


def _resolve_transfer_pair(
    instance: Transaction,
) -> tuple[Optional[Transfer], Optional[Transaction]]:
    try:
        t = instance.transfer_out
        return t, t.to_transaction
    except Transfer.DoesNotExist:
        pass
    try:
        t = instance.transfer_in
        return t, t.from_transaction
    except Transfer.DoesNotExist:
        pass
    return None, None


def _find_likely_transfer_counterpart(instance: Transaction, *, on_date) -> Optional[Transaction]:
    """When the Transfer row is missing, find the other leg by date, amount, and payee."""
    if instance.amount in (None, 0):
        return None
    abs_amt = abs(instance.amount)
    opp_amt = abs_amt if instance.amount < 0 else -abs_amt
    payee_root = (instance.payee or "").split("(")[0].strip()[:40]
    qs = (
        Transaction.objects.filter(
            date=on_date,
            amount=opp_amt,
            source=Transaction.Source.ACTUAL,
            account__household_id=instance.account.household_id,
        )
        .exclude(account_id=instance.account_id)
        .exclude(pk=instance.pk)
    )
    if payee_root:
        qs = qs.filter(Q(payee__icontains=payee_root) | Q(payee__startswith=payee_root))
    return qs.order_by("id").first()


def _delete_stale_transfer_legs_on_date(
    *,
    old_date,
    keep_ids: set[int],
    account_ids: list[int],
    amount_abs: Decimal,
) -> None:
    """Remove duplicate ACTUAL legs left on the old date after a transfer date move."""
    if not old_date or not account_ids or amount_abs <= 0:
        return
    amounts = [amount_abs, -amount_abs]
    Transaction.objects.filter(
        date=old_date,
        account_id__in=account_ids,
        source=Transaction.Source.ACTUAL,
    ).exclude(pk__in=keep_ids).filter(amount__in=amounts).delete()


def _ensure_rule_transfer_counterpart_after_update(
    instance: Transaction,
    *,
    old_date,
    old_amount,
    old_account_id: int,
) -> Optional[Transaction]:
    """
    Return the other leg of a recurring transfer after PATCH, creating it when it was never
    materialized or when the date move made the 7-day slack lookup miss a distant/composite leg.
    """
    from timeline.models import RecurringRule
    from timeline.services.ledger import _materialize_rule_occurrence

    if instance.rule_id is None:
        return None

    other = find_rule_transfer_counterpart_txn(
        rule_id=instance.rule_id,
        exclude_txn_pk=instance.pk,
        old_date=old_date,
        old_amount=old_amount,
        old_account_id=old_account_id,
    )
    if other is not None:
        return other

    rule = RecurringRule.objects.filter(pk=instance.rule_id).first()
    if rule is None or rule.transfer_to_account_id is None:
        return None

    if instance.account_id == rule.account_id:
        counterparty_id = rule.transfer_to_account_id
        counterparty_category_id = None
        opposite_amount = -instance.amount
    elif instance.account_id == rule.transfer_to_account_id:
        counterparty_id = rule.account_id
        counterparty_category_id = rule.category_id
        opposite_amount = -instance.amount
    else:
        return None

    exact = (
        Transaction.objects.filter(
            rule_id=rule.id,
            account_id=counterparty_id,
            date=instance.date,
            amount=opposite_amount,
        )
        .exclude(pk=instance.pk)
        .first()
    )
    if exact is not None:
        return exact

    return _materialize_rule_occurrence(
        rule,
        instance.date,
        counterparty_id,
        opposite_amount,
        rule.name,
        counterparty_category_id,
    )


class TransactionViewSet(ModelViewSet):
    serializer_class = TransactionSerializer
    permission_classes = [IsHouseholdMember]
    pagination_class = TransactionPagination
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ["account", "category"]
    ordering_fields = ["date", "id", "amount"]
    ordering = ["-date", "-id"]

    def get_queryset(self):
        from .services.matching import ledger_visible_transactions

        households = get_households_for_user(self.request.user)
        qs = ledger_visible_transactions(
            Transaction.objects.filter(account__household__in=households)
        ).select_related(
            "account", "category", "account__household"
        ).select_related(
            "transfer_out", "transfer_out__to_transaction", "transfer_out__to_transaction__account"
        )
        date_after = self.request.query_params.get("date_after")
        date_before = self.request.query_params.get("date_before")
        if date_after:
            qs = qs.filter(date__gte=date_after)
        if date_before:
            qs = qs.filter(date__lte=date_before)
        return qs

    def create(self, request: Request, *args, **kwargs):
        data = request.data
        account_id = data.get("account_id") or data.get("account")
        if not account_id:
            return Response(
                {"account_id": ["This field is required."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            txn = post_transaction(
                user=request.user,
                account_id=account_id,
                date=data["date"],
                payee=data.get("payee", ""),
                amount=data["amount"],
                category_id=data.get("category_id") or data.get("category"),
                memo=data.get("memo", ""),
                cleared=data.get("cleared", False),
                tags=data.get("tags") or [],
            )
        except ValueError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        serializer = self.get_serializer(txn)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        old_date = instance.date
        old_amount = instance.amount
        old_account_id = instance.account_id
        old_rule_id = getattr(instance, "rule_id", None)
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        # Serializer may create a Transfer + card leg (link_in_leg). get_queryset uses
        # select_related(transfer_out); without a refresh this row still looks unlinked in memory,
        # so pairing/sync and stale cleanup see the wrong counterpart — especially for rule
        # materializations that had no bridge before PATCH.
        instance.refresh_from_db()
        new_date = serializer.validated_data.get("date")
        # If user explicitly cleared rule_id (PATCH null), skip this date on the rule and detach the paired leg.
        # Do not treat "rule_id omitted" on partial update as detach — validated_data.get("rule_id") would be None.
        if (
            old_rule_id is not None
            and "rule_id" in serializer.validated_data
            and serializer.validated_data.get("rule_id") is None
        ):
            from timeline.models import RecurringRuleSkip
            RecurringRuleSkip.objects.get_or_create(rule_id=old_rule_id, date=old_date)
            paired = find_rule_transfer_counterpart_txn(
                rule_id=old_rule_id,
                exclude_txn_pk=instance.pk,
                old_date=old_date,
                old_amount=old_amount,
                old_account_id=old_account_id,
            )
            if paired is not None:
                Transaction.objects.filter(pk=paired.pk).update(rule_id=None)
        # Optionally change the transfer's "to" account (credit account) when editing the from leg.
        # Handled below for both Transfer-linked and rule-created pairs.
        transfer_to_account_id = serializer.validated_data.get("transfer_to_account_id")
        transfer, other = _resolve_transfer_pair(instance)
        if other is None and "date" in serializer.validated_data:
            other = _find_likely_transfer_counterpart(instance, on_date=old_date)

        if other is None and instance.rule_id is not None:
            other = _ensure_rule_transfer_counterpart_after_update(
                instance,
                old_date=old_date,
                old_amount=old_amount,
                old_account_id=old_account_id,
            )

        if other is not None:
            if (
                "date" in serializer.validated_data
                and getattr(other, "rule_id", None) is not None
                and other.date != serializer.validated_data["date"]
            ):
                from timeline.models import RecurringRuleSkip
                RecurringRuleSkip.objects.get_or_create(rule_id=other.rule_id, date=other.date)
            if transfer_to_account_id is not None and transfer is None:
                from timeline.models import RecurringRule
                rule = RecurringRule.objects.filter(pk=instance.rule_id).first()
                if rule and instance.account_id == rule.account_id:
                    new_to = transfer_to_account_id
                    if new_to.pk != instance.account_id and getattr(new_to, "household_id", None) == instance.account.household_id:
                        Transaction.objects.filter(pk=other.pk).update(account=new_to)
            if transfer is not None and transfer_to_account_id is not None:
                new_to = transfer_to_account_id
                if new_to.pk != instance.account_id and new_to.household_id == instance.account.household_id:
                    Transaction.objects.filter(pk=transfer.to_transaction_id).update(account=new_to)
            sync_fields = {}
            if "date" in serializer.validated_data:
                sync_fields["date"] = serializer.validated_data["date"]
            if "payee" in serializer.validated_data:
                sync_fields["payee"] = serializer.validated_data["payee"]
            if "memo" in serializer.validated_data:
                sync_fields["memo"] = serializer.validated_data["memo"]
            if "amount" in serializer.validated_data:
                sync_fields["amount"] = -serializer.validated_data["amount"]
            if sync_fields:
                Transaction.objects.filter(pk=other.pk).update(**sync_fields)
                if transfer is not None:
                    if "date" in sync_fields:
                        Transfer.objects.filter(pk=transfer.pk).update(date=sync_fields["date"])
                    if "amount" in sync_fields:
                        Transfer.objects.filter(pk=transfer.pk).update(
                            amount=abs(serializer.validated_data["amount"])
                        )
            if (
                "date" in serializer.validated_data
                and old_date != serializer.validated_data["date"]
            ):
                instance.refresh_from_db()
                other.refresh_from_db()
                amt = abs(instance.amount or Decimal("0"))
                if amt <= 0 and other.amount is not None:
                    amt = abs(other.amount)
                _delete_stale_transfer_legs_on_date(
                    old_date=old_date,
                    keep_ids={instance.pk, other.pk},
                    account_ids=[instance.account_id, other.account_id],
                    amount_abs=amt,
                )
        if (
            instance.rule_id is not None
            and new_date is not None
            and old_date != new_date
            and "date" in serializer.validated_data
        ):
            _record_rule_occurrence_date_move(
                instance,
                old_date=old_date,
                new_date=new_date,
                other=other,
            )
        data = dict(serializer.data)
        if other is not None:
            data["synced_to_account_id"] = other.account_id
        return Response(data)

    @action(detail=False, methods=["get"], url_path="import-unmatched")
    def import_unmatched(self, request: Request):
        """Plaid rows not yet matched to a forecast transaction."""
        households = get_households_for_user(request.user)
        qs = (
            Transaction.objects.filter(
                account__household__in=households,
                source=Transaction.Source.PLAID,
                import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
            )
            .select_related("account")
            .order_by("-date", "-id")[:500]
        )
        ser = self.get_serializer(qs, many=True)
        return Response(ser.data)

    @action(detail=True, methods=["get"], url_path="match-suggestions")
    def match_suggestions(self, request: Request, pk=None):
        txn = self.get_object()
        ranked = find_candidate_matches(txn)
        return Response(
            {
                "candidates": [
                    {"planned_transaction_id": p.pk, "score": sc, "parts": parts}
                    for p, sc, parts in ranked[:20]
                ]
            }
        )

    @action(detail=True, methods=["post"], url_path="match-manual")
    def match_manual(self, request: Request, pk=None):
        imp = self.get_object()
        raw = request.data.get("planned_transaction_id")
        if raw is None:
            return Response(
                {"detail": "planned_transaction_id is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            m = manual_match_transactions(
                planned_id=int(raw),
                imported_id=imp.pk,
                user=request.user,
            )
        except ValueError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"match_id": m.pk}, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="unmatch")
    def unmatch(self, request: Request, pk=None):
        imp = self.get_object()
        m = TransactionMatch.objects.filter(imported_transaction=imp).first()
        if m is None:
            return Response(
                {"detail": "This transaction is not linked as a matched Plaid import."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        unmatch_transaction(m)
        return Response({"detail": "Unmatched."})

    @action(detail=True, methods=["post"], url_path="ignore-import")
    def ignore_import(self, request: Request, pk=None):
        imp = self.get_object()
        try:
            ignore_imported_transaction(imp)
        except ValueError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"detail": "Ignored."})

    @action(detail=True, methods=["post"], url_path="mark-duplicate")
    def mark_duplicate(self, request: Request, pk=None):
        imp = self.get_object()
        try:
            mark_import_duplicate(imp)
        except ValueError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"detail": "Marked duplicate."})

    @action(detail=False, methods=["post"], url_path="cleanup-orphaned-rule-rows")
    def cleanup_orphaned_rule_rows(self, request: Request):
        """
        Remove materialized future rows left by deleted recurring rules (source=RULE, rule_id=NULL).
        """
        deleted = cleanup_orphaned_rule_materializations_for_user(request.user)
        return Response({"deleted": deleted}, status=status.HTTP_200_OK)

    def perform_destroy(self, instance: Transaction):
        today = timezone.localdate()
        if instance.source == Transaction.Source.INTEREST:
            from timeline.models import InterestCycleSkip

            anchor = instance.interest_cycle_end_date or instance.date
            InterestCycleSkip.objects.get_or_create(
                account_id=instance.account_id,
                cycle_end_date=anchor,
            )
        # Only record a skip for future rule occurrences — timeline only re-materializes those.
        # Past/posted transactions are never re-created, so no skip needed.
        if instance.rule_id is not None and instance.date >= today:
            from timeline.models import RecurringRuleSkip
            RecurringRuleSkip.objects.get_or_create(rule_id=instance.rule_id, date=instance.date)
        # Transfer pairs: delete both legs unless counterparty account is manual-only
        # (preserve_partner_transfer_legs); see delete_transaction_respecting_partner_ledger.
        delete_transaction_respecting_partner_ledger(instance)


class TransferCreateView(APIView):
    permission_classes = [IsHouseholdMember]

    def post(self, request: Request):
        serializer = TransferCreateSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        payee = request.data.get("payee")
        if payee is not None and isinstance(payee, str):
            payee = payee.strip()
        else:
            payee = None
        try:
            transfer = create_transfer(
                user=request.user,
                from_account_id=data["from_account"].pk,
                to_account_id=data["to_account"].pk,
                amount=data["amount"],
                transfer_date=data["date"],
                memo=data.get("memo", ""),
                from_category_id=data.get("from_category_id").pk if data.get("from_category_id") else None,
                payee=payee if payee else None,
            )
        except ValueError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        out = TransferSerializer(transfer)
        return Response(out.data, status=status.HTTP_201_CREATED)
