from datetime import timedelta
from decimal import Decimal

from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import ModelViewSet

from core.utils import get_households_for_user
from core.permissions import IsHouseholdMember

from transactions.models import Transaction, Transfer

from .models import (
    RecurringRule,
    Scenario,
    ScenarioRuleOverride,
    StatementTransaction,
    ReconciliationMatch,
    UpcomingChargeNotification,
)
from .serializers import (
    RecurringRuleSerializer,
    ScenarioSerializer,
    ScenarioRuleOverrideSerializer,
    StatementTransactionSerializer,
    ReconciliationMatchSerializer,
    UpcomingChargeNotificationSerializer,
)
from .services.ledger import build_timeline
from .services.rule_cleanup import delete_future_materialized_transactions_for_rule
from .reconcile_services import parse_csv_to_statement_rows, get_suggestions
from .pagination import RecurringRulePagination


class UpcomingChargeNotificationViewSet(ModelViewSet):
    """List and mark read upcoming charge notifications (due within the next 3 calendar days)."""

    serializer_class = UpcomingChargeNotificationSerializer
    permission_classes = [IsHouseholdMember]
    http_method_names = ["get", "head", "options", "patch"]

    def get_queryset(self):
        households = get_households_for_user(self.request.user)
        today = timezone.localdate()
        window_end = today + timedelta(days=2)
        qs = (
            UpcomingChargeNotification.objects.filter(
                household__in=households,
                due_date__gte=today,
                due_date__lte=window_end,
            )
            .select_related("rule", "rule__account", "household")
            .order_by("due_date", "-created_at")
        )
        if self.request.query_params.get("unread_only", "").lower() in ("true", "1", "yes"):
            qs = qs.filter(read_at__isnull=True)
        return qs

    def partial_update(self, request, *args, **kwargs):
        """Support PATCH to mark as read (send read_at in body or use action)."""
        instance = self.get_object()
        if request.data.get("read") is not False:
            instance.read_at = instance.read_at or timezone.now()
            instance.save(update_fields=["read_at"])
        return Response(UpcomingChargeNotificationSerializer(instance, context={"request": request}).data)


class RecurringRuleViewSet(ModelViewSet):
    serializer_class = RecurringRuleSerializer
    permission_classes = [IsHouseholdMember]
    pagination_class = RecurringRulePagination

    def get_queryset(self):
        households = get_households_for_user(self.request.user)
        return RecurringRule.objects.filter(household__in=households).select_related(
            "account", "category", "household"
        )

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        response = super().update(request, *args, **kwargs)
        # Move any "from" leg transactions that are on a different account onto the rule's
        # current account. If the same occurrence already exists on the target account
        # (e.g. materialized when viewing the timeline), remove the duplicate instead of moving.
        if response.status_code != status.HTTP_200_OK:
            return response
        valid_account_ids = [instance.account_id]
        if instance.transfer_to_account_id:
            valid_account_ids.append(instance.transfer_to_account_id)
        to_move = list(
            Transaction.objects.filter(rule_id=instance.id).exclude(
                account_id__in=valid_account_ids
            )
        )
        for txn in to_move:
            existing = Transaction.objects.filter(
                rule_id=instance.id,
                date=txn.date,
                account_id=instance.account_id,
            ).first()
            # Same sign => same "leg" (e.g. both expense); avoid keeping transfer to-leg as "existing"
            if existing is not None and (existing.amount * txn.amount) > 0:
                # Duplicate: delete the one we would have moved (and its transfer pair if any)
                try:
                    tr = txn.transfer_out
                except Transfer.DoesNotExist:
                    try:
                        tr = txn.transfer_in
                    except Transfer.DoesNotExist:
                        tr = None
                if tr:
                    other = (
                        tr.to_transaction
                        if tr.from_transaction_id == txn.pk
                        else tr.from_transaction
                    )
                    tr.delete()
                    other.delete()
                txn.delete()
            else:
                txn.account_id = instance.account_id
                txn.save(update_fields=["account_id"])

        # Deduplicate: if multiple transactions exist for the same rule/date/account (same sign),
        # keep one and delete the rest. Prefer keeping one that is part of a transfer (so we don't
        # remove the other leg); then keep oldest by id so we don't delete the original.
        same_account = list(
            Transaction.objects.filter(
                rule_id=instance.id, account_id=instance.account_id
            ).select_related("transfer_out", "transfer_in").order_by("date", "id")
        )
        from collections import defaultdict
        by_key = defaultdict(list)  # (date, sign) -> [txn, ...]
        for txn in same_account:
            sign = 1 if (txn.amount and txn.amount >= 0) else -1
            by_key[(txn.date, sign)].append(txn)
        for (_date, _sign), txns in by_key.items():
            if len(txns) <= 1:
                continue
            # Prefer keeping the one that is part of a transfer; else keep oldest (smallest id)
            def _has_transfer(t):
                try:
                    t.transfer_out
                    return True
                except Transfer.DoesNotExist:
                    pass
                try:
                    t.transfer_in
                    return True
                except Transfer.DoesNotExist:
                    return False
            has_transfer = [t for t in txns if _has_transfer(t)]
            keep_candidates = has_transfer if has_transfer else txns
            keep = min(keep_candidates, key=lambda t: t.id)
            for txn in txns:
                if txn.id == keep.id:
                    continue
                try:
                    tr = txn.transfer_out
                except Transfer.DoesNotExist:
                    try:
                        tr = txn.transfer_in
                    except Transfer.DoesNotExist:
                        tr = None
                if tr:
                    other = (
                        tr.to_transaction
                        if tr.from_transaction_id == txn.pk
                        else tr.from_transaction
                    )
                    tr.delete()
                    other.delete()
                txn.delete()

        # Final cleanup: move "to" legs to the new transfer_to_account if the rule's destination card
        # changed; otherwise remove transactions on wrong accounts.
        wrong_account = Transaction.objects.filter(
            rule_id=instance.id,
        ).exclude(account_id__in=valid_account_ids)
        if instance.transfer_to_account_id:
            # Move existing "to" legs (e.g. old card) to the new destination card instead of deleting
            wrong_account.update(account_id=instance.transfer_to_account_id)
        else:
            wrong_account.delete()

        # Sync all rule-created transactions to the rule's category and payee so Edit transaction
        # shows the same category/destination as the rule (e.g. Credit Card Payment, not Utilities).
        Transaction.objects.filter(rule_id=instance.id).update(
            category_id=instance.category_id,
            payee=instance.name,
        )

        return response

    def perform_destroy(self, instance: RecurringRule):
        """
        Materialized planned rows still reference this rule; FK is SET_NULL on rule delete which
        leaves them in the ledger. Remove future-dated (> local today) rule rows first; keep past
        history (dates before today) so the register stays accurate after SET_NULL.
        """
        delete_future_materialized_transactions_for_rule(instance.pk)
        super().perform_destroy(instance)


class ScenarioViewSet(ModelViewSet):
    serializer_class = ScenarioSerializer
    permission_classes = [IsHouseholdMember]

    def get_queryset(self):
        households = get_households_for_user(self.request.user)
        return Scenario.objects.filter(household__in=households)

    @action(detail=True, methods=["get", "post"], url_path="overrides")
    def overrides(self, request, pk=None):
        scenario = self.get_object()
        if request.method == "GET":
            qs = ScenarioRuleOverride.objects.filter(scenario=scenario).select_related(
                "rule", "rule__account", "rule__category", "override_account", "override_category"
            )
            serializer = ScenarioRuleOverrideSerializer(qs, many=True, context={"request": request})
            return Response(serializer.data)
        serializer = ScenarioRuleOverrideSerializer(
            data={**request.data, "scenario": scenario.pk},
            context={"request": request},
        )
        serializer.is_valid(raise_exception=True)
        serializer.save(scenario=scenario)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class ScenarioRuleOverrideViewSet(ModelViewSet):
    serializer_class = ScenarioRuleOverrideSerializer
    permission_classes = [IsHouseholdMember]

    def get_queryset(self):
        households = get_households_for_user(self.request.user)
        return ScenarioRuleOverride.objects.filter(
            scenario__household__in=households
        ).select_related("scenario", "rule", "override_account", "override_category")

    def perform_create(self, serializer):
        scenario_id = self.request.data.get("scenario") or self.kwargs.get("scenario_id")
        if scenario_id:
            serializer.save(scenario_id=scenario_id)
        else:
            serializer.save()


class TimelineView(APIView):
    permission_classes = [IsHouseholdMember]

    def get(self, request):
        try:
            start = request.query_params.get("start")
            end = request.query_params.get("end")
            as_of = request.query_params.get("as_of")
            horizon = request.query_params.get("horizon", "6m")
            scenario_id = request.query_params.get("scenario_id")
            account_id = request.query_params.get("account_id")
            household_id = request.query_params.get("household_id")

            from datetime import datetime as dt
            today = timezone.localdate()
            as_of_date = dt.strptime(as_of, "%Y-%m-%d").date() if as_of else None
            if not end:
                if horizon == "3m":
                    end = today + timedelta(days=90)
                elif horizon == "12m":
                    end = today + timedelta(days=365)
                elif horizon == "18m":
                    end = today + timedelta(days=548)  # ~18 months
                elif horizon == "24m":
                    end = today + timedelta(days=730)
                elif horizon == "36m":
                    end = today + timedelta(days=1095)  # ~36 months
                else:
                    end = today + timedelta(days=180)
            else:
                end = dt.strptime(end, "%Y-%m-%d").date() if isinstance(end, str) else end
            if not start:
                start = today
            else:
                start = dt.strptime(start, "%Y-%m-%d").date() if isinstance(start, str) else start

            scenario_id = int(scenario_id) if scenario_id else None
            account_id = int(account_id) if account_id else None
            household_id = int(household_id) if household_id else None

            rows = build_timeline(
                request.user,
                start_date=start,
                end_date=end,
                scenario_id=scenario_id,
                account_id=account_id,
                household_id=household_id,
                as_of_date=as_of_date,
            )
            # Serialize dates and decimals for JSON
            for r in rows:
                r["date"] = r["date"].isoformat() if hasattr(r["date"], "isoformat") else str(r["date"])
                r["amount"] = str(r["amount"])
                r["running_balance"] = str(r["running_balance"])
            account_balances = {}
            for r in rows:
                aid = r["account_id"]
                if aid not in account_balances:
                    account_balances[aid] = {"account_id": aid, "account_name": r.get("account_name", ""), "ending_balance": r["running_balance"]}
                else:
                    account_balances[aid]["ending_balance"] = r["running_balance"]
            resp = Response({
                "timeline": rows,
                "account_summary": list(account_balances.values()),
            })
            resp["Cache-Control"] = "no-store, no-cache, must-revalidate"
            resp["X-Timeline-Skip-Logic"] = "1"
            return resp
        except Exception as e:
            return Response(
                {"detail": f"Timeline error: {type(e).__name__}: {e}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


class ReconcileImportCsvView(APIView):
    permission_classes = [IsHouseholdMember]

    def post(self, request):
        account_id = request.data.get("account_id")
        file = request.FILES.get("file") or request.data.get("file")
        if not account_id or not file:
            return Response(
                {"detail": "account_id and file are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        households = get_households_for_user(request.user)
        from accounts.models import Account
        acc = Account.objects.filter(pk=account_id, household__in=households).first()
        if not acc:
            return Response({"detail": "Account not found."}, status=status.HTTP_404_NOT_FOUND)
        content = file.read() if hasattr(file, "read") else file
        try:
            rows = parse_csv_to_statement_rows(
                content,
                account_id=int(account_id),
                household_id=acc.household_id,
                date_col=request.data.get("date_col", "date"),
                description_col=request.data.get("description_col", "description"),
                amount_col=request.data.get("amount_col", "amount"),
            )
        except Exception as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        created = []
        for r in rows:
            st = StatementTransaction.objects.create(
                household_id=r["household_id"],
                account_id=r["account_id"],
                posted_date=r["posted_date"],
                description=r["description"],
                amount=r["amount"],
                raw=r,
            )
            created.append(StatementTransactionSerializer(st, context={"request": request}).data)
        return Response({"imported": len(created), "rows": created}, status=status.HTTP_201_CREATED)


class ReconcileSuggestionsView(APIView):
    permission_classes = [IsHouseholdMember]

    def get(self, request):
        account_id = request.query_params.get("account_id")
        start = request.query_params.get("start")
        end = request.query_params.get("end")
        if not account_id or not start or not end:
            return Response(
                {"detail": "account_id, start, end are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        from datetime import datetime
        start_date = datetime.strptime(start, "%Y-%m-%d").date()
        end_date = datetime.strptime(end, "%Y-%m-%d").date()
        households = get_households_for_user(request.user)
        suggestions = get_suggestions(
            int(account_id), start_date, end_date, request.user, list(households.values_list("pk", flat=True))
        )
        return Response({"suggestions": suggestions})


class ReconcileMatchView(APIView):
    permission_classes = [IsHouseholdMember]

    def post(self, request):
        statement_txn_id = request.data.get("statement_txn_id")
        matched_transaction_id = request.data.get("matched_transaction_id")
        status_val = request.data.get("status", ReconciliationMatch.Status.MATCHED)
        if not statement_txn_id:
            return Response(
                {"detail": "statement_txn_id is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        households = get_households_for_user(request.user)
        st = StatementTransaction.objects.filter(
            pk=statement_txn_id, household__in=households
        ).first()
        if not st:
            return Response({"detail": "Statement transaction not found."}, status=status.HTTP_404_NOT_FOUND)
        from django.utils import timezone
        match, created = ReconciliationMatch.objects.update_or_create(
            statement_txn=st,
            defaults={
                "matched_transaction_id": matched_transaction_id or None,
                "status": status_val,
                "matched_at": timezone.now() if status_val == ReconciliationMatch.Status.MATCHED else None,
            },
        )
        return Response(
            ReconciliationMatchSerializer(match, context={"request": request}).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class ReconcileUnmatchedView(APIView):
    permission_classes = [IsHouseholdMember]

    def get(self, request):
        account_id = request.query_params.get("account_id")
        households = get_households_for_user(request.user)
        qs = StatementTransaction.objects.filter(household__in=households).select_related("account")
        if account_id:
            qs = qs.filter(account_id=account_id)
        unmatched_stmt = []
        for st in qs:
            if not hasattr(st, "match") or not st.match or st.match.status != ReconciliationMatch.Status.MATCHED:
                unmatched_stmt.append(StatementTransactionSerializer(st).data)
        return Response({
            "unmatched_statement": unmatched_stmt,
        })
