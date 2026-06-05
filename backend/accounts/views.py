import asyncio
import concurrent.futures
from datetime import date
from decimal import Decimal

from django.db import close_old_connections, transaction
from django.db.models import DecimalField, F, Max, Q, Sum, Value
from django.db.models.functions import Coalesce
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.filters import SearchFilter
from rest_framework.viewsets import ModelViewSet

from core.models import UserProfile
from core.utils import get_households_for_user
from core.permissions import IsHouseholdMember
from transactions.models import Transaction, TransactionMatch, Transfer
from transactions.services import (
    clear_all_transactions_for_account,
    delete_manual_transactions_for_plaid_reset,
    eligible_manual_transactions_queryset,
)
from transactions.services.matching import ledger_visible_account_transactions_q
from timeline.models import (
    ReconciliationMatch,
    RecurringRule,
    ScenarioRuleOverride,
    StatementTransaction,
)
from credit_cards.services.payoff import (
    PAYOFF_STRATEGIES,
    compare_payment_strategies,
    project_credit_card_payoff,
)
from .models import Account
from .relationship_models import AccountRelationship
from .relationship_serializers import AccountRelationshipSummarySerializer
from .serializers import AccountSerializer
from .services.lifecycle import (
    archive_account,
    close_account,
    lifecycle_preflight,
    restore_account,
    soft_delete_account,
)
from .services.account_health import (
    calculate_account_health,
    calculate_account_health_for_accounts,
    dashboard_account_health_aggregate,
    serialize_account_health,
)
from .services.projected_statement import calculate_projected_statements_for_accounts
from .services.available_to_spend import (
    ALLOWED_FORECAST_DAYS,
    DEFAULT_FORECAST_DAYS,
    calculate_account_forecast_summary,
    calculate_forecast_summaries_for_accounts,
    dashboard_safe_to_spend_aggregate,
    normalize_forecast_days,
    serialize_forecast_summary,
)


def _parse_forecast_days_param(request) -> int:
    from common.services.forecast_horizon import parse_forecast_days_param

    return parse_forecast_days_param(request)


def _parse_optional_date_param(val):
    """Return date or None; raises ValueError if non-empty but invalid."""
    if val is None or val == "":
        return None
    if isinstance(val, date):
        return val
    return date.fromisoformat(str(val).strip())


def _relationships_by_account_id(account_ids: list[int]) -> dict[int, dict]:
    if not account_ids:
        return {}
    id_set = set(account_ids)
    bundle: dict[int, dict] = {aid: {"outgoing": [], "incoming": []} for aid in account_ids}
    rels = AccountRelationship.objects.filter(
        Q(source_account_id__in=id_set) | Q(destination_account_id__in=id_set),
    ).select_related("source_account", "destination_account")
    for rel in rels:
        data = AccountRelationshipSummarySerializer(rel).data
        if rel.source_account_id in id_set:
            bundle[rel.source_account_id]["outgoing"].append(data)
        if rel.destination_account_id in id_set:
            bundle[rel.destination_account_id]["incoming"].append(data)
    return bundle


def _event_loop_is_running() -> bool:
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return False
    return True


def _delete_transaction_cascade(txn: Transaction) -> None:
    """Delete transaction and, if it's a transfer leg, the other leg and the Transfer record."""
    try:
        transfer_out = txn.transfer_out
    except Transfer.DoesNotExist:
        transfer_out = None
    try:
        transfer_in = txn.transfer_in
    except Transfer.DoesNotExist:
        transfer_in = None
    transfer = transfer_out or transfer_in
    if transfer:
        other = (
            transfer.to_transaction
            if transfer.from_transaction_id == txn.pk
            else transfer.from_transaction
        )
        transfer.delete()
        other.delete()
    txn.delete()


def _purge_account_and_delete(account_pk: int) -> None:
    """
    Remove everything that references this account, then delete the row.

    SQLite + Django's collector can raise IntegrityError if related rows are not cleared in a
    safe order (e.g. statement import lines, recurring rules with dual Account FKs, profile default).
    """
    close_old_connections()
    try:
        with transaction.atomic():
            # Clear FKs that are not CASCADE from Account but can reference transactions on it.
            ReconciliationMatch.objects.filter(
                matched_transaction__account_id=account_pk
            ).update(matched_transaction=None)

            UserProfile.objects.filter(default_account_id=account_pk).update(default_account=None)
            ScenarioRuleOverride.objects.filter(override_account_id=account_pk).update(
                override_account=None
            )

            RecurringRule.objects.filter(transfer_to_account_id=account_pk).update(
                transfer_to_account=None
            )

            for txn in list(Transaction.objects.filter(account_id=account_pk)):
                _delete_transaction_cascade(txn)

            # Any stragglers (e.g. edge cases with transfers) — bulk collector removes Transfer rows.
            Transaction.objects.filter(account_id=account_pk).delete()

            StatementTransaction.objects.filter(account_id=account_pk).delete()

            RecurringRule.objects.filter(account_id=account_pk).delete()

            Account.all_objects.filter(pk=account_pk).delete()
    finally:
        close_old_connections()


class AccountViewSet(ModelViewSet):
    serializer_class = AccountSerializer
    permission_classes = [IsHouseholdMember]
    filterset_fields = ["household", "account_type"]
    filter_backends = ModelViewSet.filter_backends + [SearchFilter]
    search_fields = ["display_name", "purpose", "institution", "name"]

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        want_forecast = self.request.query_params.get("forecast_summary") == "true"
        want_health = self.request.query_params.get("health") == "true"
        want_relationships = self.request.query_params.get("relationships") == "true"
        if want_relationships or self.action in ("retrieve", "list"):
            qs = self.filter_queryset(self.get_queryset())
            account_ids = list(qs.values_list("pk", flat=True))
            if self.action == "retrieve" and self.kwargs.get("pk"):
                account_ids = [int(self.kwargs["pk"])]
            if account_ids:
                ctx["relationships_by_account_id"] = _relationships_by_account_id(account_ids)
        if want_forecast or want_health:
            days = DEFAULT_FORECAST_DAYS
            try:
                days = _parse_forecast_days_param(self.request)
            except ValueError:
                pass
            qs = self.filter_queryset(self.get_queryset())
            accounts = list(qs)
            if accounts:
                if want_forecast:
                    ctx["forecast_summaries_by_id"] = calculate_forecast_summaries_for_accounts(
                        self.request.user,
                        accounts,
                        days=days,
                    )
                if want_health:
                    ctx["health_by_id"] = calculate_account_health_for_accounts(
                        self.request.user,
                        accounts,
                        days=days,
                    )
                credit_cards = [a for a in accounts if a.is_credit_card()]
                if credit_cards:
                    ctx["projected_statement_by_id"] = calculate_projected_statements_for_accounts(
                        self.request.user,
                        accounts,
                    )
        if self.request.query_params.get("balance") == "true":
            qs = self.filter_queryset(self.get_queryset())
            credit_cards = [a for a in qs if a.is_credit_card()]
            if credit_cards:
                from credit_cards.services.payoff import payoff_estimates_for_accounts

                ctx["payoff_estimates_by_id"] = payoff_estimates_for_accounts(credit_cards)
        return ctx

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = "no-store, no-cache, must-revalidate"
        return response

    def _account_queryset_base(self):
        households = get_households_for_user(self.request.user)
        params = self.request.query_params
        include_deleted = params.get("include_deleted", "").lower() in ("true", "1", "yes")
        manager = Account.all_objects if include_deleted else Account.objects
        qs = manager.filter(household__in=households).select_related("household")
        household_id = params.get("household")
        if household_id:
            qs = qs.filter(household_id=household_id)

        status_param = (params.get("status") or "").strip().lower()
        if status_param and status_param != "all":
            qs = qs.filter(status=status_param)
        else:
            active_only = params.get("active_only", "").lower() in ("true", "1", "yes")
            if active_only:
                statuses = [Account.Status.ACTIVE]
            else:
                statuses = [
                    Account.Status.ACTIVE,
                    Account.Status.ARCHIVED,
                    Account.Status.CLOSED,
                ]
            if params.get("include_archived", "").lower() in ("true", "1", "yes"):
                if Account.Status.ARCHIVED not in statuses:
                    statuses.append(Account.Status.ARCHIVED)
            if params.get("include_closed", "").lower() in ("true", "1", "yes"):
                if Account.Status.CLOSED not in statuses:
                    statuses.append(Account.Status.CLOSED)
            if include_deleted:
                statuses.append(Account.Status.DELETED)
            qs = qs.filter(status__in=statuses)

        if params.get("exclude_hidden", "").lower() in ("true", "1", "yes"):
            qs = qs.filter(is_hidden=False)
        return qs

    def get_queryset(self):
        qs = self._account_queryset_base()
        visible_txn_q = ledger_visible_account_transactions_q()
        qs = qs.annotate(
            last_activity_date=Max("transactions__date", filter=visible_txn_q),
        )
        if self.request.query_params.get("balance") == "true":
            # Balance as of today: only transactions with date <= today (matches timeline/ledger).
            today = date.today()
            zero = Value(0, output_field=DecimalField())
            qs = qs.annotate(
                tx_sum=Coalesce(
                    Sum(
                        "transactions__amount",
                        filter=Q(transactions__date__lte=today) & visible_txn_q,
                    ),
                    zero,
                ),
                start=Coalesce(F("starting_balance"), zero),
            ).annotate(balance=F("start") + F("tx_sum"))
        # Order by position only so reorder (global list order) is respected
        return qs.order_by("position", "name")

    def perform_destroy(self, instance: Account):
        """Permanently remove account and all related data."""
        pk_val = instance.pk
        if _event_loop_is_running():
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                pool.submit(_purge_account_and_delete, pk_val).result()
        else:
            _purge_account_and_delete(pk_val)

    def _lifecycle_account(self, pk: int) -> Account:
        households = get_households_for_user(self.request.user)
        return Account.all_objects.filter(household__in=households).get(pk=pk)

    def get_object(self):
        """Use get_queryset() so retrieve/detail actions honor ?balance=true and list filters."""
        queryset = self.filter_queryset(self.get_queryset())
        pk = self.kwargs.get(self.lookup_field or "pk")
        obj = queryset.get(pk=pk)
        self.check_object_permissions(self.request, obj)
        return obj

    @action(detail=True, methods=["get"], url_path="lifecycle-preflight")
    def lifecycle_preflight_action(self, request, pk=None):
        account = self._lifecycle_account(pk)
        action_name = (request.query_params.get("action") or "archive").strip().lower()
        if action_name not in ("archive", "close", "delete", "restore"):
            return Response(
                {"detail": "action must be archive, close, delete, or restore."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(lifecycle_preflight(account, request.user, action=action_name))

    @action(detail=True, methods=["post"], url_path="archive")
    def archive(self, request, pk=None):
        account = self._lifecycle_account(pk)
        reason = (request.data.get("reason") or request.data.get("archive_reason") or "")[:255]
        preserve_recurring = request.data.get("preserve_recurring") is True
        archive_account(account, reason=reason, preserve_recurring=preserve_recurring)
        return Response(AccountSerializer(account, context=self.get_serializer_context()).data)

    @action(detail=True, methods=["post"], url_path="close")
    def close(self, request, pk=None):
        account = self._lifecycle_account(pk)
        closed_raw = request.data.get("closed_at")
        closed_at = None
        if closed_raw:
            try:
                closed_at = _parse_optional_date_param(closed_raw)
            except ValueError:
                return Response(
                    {"detail": "closed_at must be YYYY-MM-DD."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        reason = (request.data.get("reason") or request.data.get("close_reason") or "")[:255]
        force = request.data.get("force") is True or str(request.data.get("force", "")).lower() in (
            "true",
            "1",
            "yes",
        )
        try:
            close_account(account, closed_at=closed_at, reason=reason, force=force)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(AccountSerializer(account, context=self.get_serializer_context()).data)

    @action(detail=True, methods=["post"], url_path="restore")
    def restore(self, request, pk=None):
        account = self._lifecycle_account(pk)
        target = (request.data.get("target_status") or Account.Status.ACTIVE).strip().lower()
        reenable_plaid = request.data.get("reenable_plaid") is True
        reenable_forecast = request.data.get("reenable_forecast") is not False
        try:
            restore_account(
                account,
                target_status=target,
                reenable_plaid=reenable_plaid,
                reenable_forecast=reenable_forecast,
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(AccountSerializer(account, context=self.get_serializer_context()).data)

    @action(detail=True, methods=["post"], url_path="soft-delete")
    def soft_delete(self, request, pk=None):
        account = self._lifecycle_account(pk)
        soft_delete_account(account)
        return Response(AccountSerializer(account, context=self.get_serializer_context()).data)

    @action(detail=True, methods=["post"], url_path="permanent-delete")
    def permanent_delete(self, request, pk=None):
        if not request.user.is_staff:
            return Response(
                {"detail": "Permanent delete requires staff access."},
                status=status.HTTP_403_FORBIDDEN,
            )
        confirm = request.data.get("confirm")
        if confirm is not True and str(confirm).lower() not in ("true", "1", "yes"):
            return Response(
                {
                    "detail": 'Send {"confirm": true} to permanently remove this account and all related data.',
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        account = Account.all_objects.filter(
            household__in=get_households_for_user(request.user),
            pk=pk,
        ).first()
        if account is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        pk_val = account.pk
        if _event_loop_is_running():
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                pool.submit(_purge_account_and_delete, pk_val).result()
        else:
            _purge_account_and_delete(pk_val)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=["post"], url_path="reorder")
    def reorder(self, request):
        """
        Set display order of accounts. POST body: {"account_ids": [1, 2, 3, ...]}.
        Only accounts in the user's households are updated; order is by index in the list.
        """
        account_ids = request.data.get("account_ids")
        if not isinstance(account_ids, list) or len(account_ids) == 0:
            return Response(
                {"detail": "Body must include 'account_ids', a non-empty list of account IDs in desired order."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            account_ids = [int(aid) for aid in account_ids]
        except (TypeError, ValueError):
            return Response(
                {"detail": "Every item in 'account_ids' must be an integer."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        households = get_households_for_user(request.user)
        qs = Account.objects.filter(household__in=households, id__in=account_ids)
        id_to_account = {a.id: a for a in qs}
        for index, aid in enumerate(account_ids):
            if aid in id_to_account:
                id_to_account[aid].position = index
                id_to_account[aid].save(update_fields=["position"])
        return Response({"detail": "Order updated.", "account_ids": account_ids})

    @action(detail=True, methods=["post"], url_path="clear_phantom")
    def clear_phantom(self, request, pk=None):
        """
        Delete transaction(s) on this account with the given amount (e.g. phantom $3100).
        Uses the same DB as the running backend. POST body: {"amount": "3100"}.
        """
        account = self.get_object()
        try:
            amount = Decimal(str(request.data.get("amount", "")))
        except Exception:
            return Response(
                {"detail": "Body must include 'amount', e.g. {\"amount\": \"3100\"}."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        matches = list(
            Transaction.objects.filter(account=account).filter(
                amount__in=[amount, -amount]
            )
        )
        if not matches:
            return Response(
                {"detail": f"No transaction(s) with amount {amount} or {-amount} on this account.", "deleted": 0},
                status=status.HTTP_200_OK,
            )
        for t in matches:
            _delete_transaction_cascade(t)
        return Response({"detail": f"Deleted {len(matches)} transaction(s).", "deleted": len(matches)})

    @action(detail=True, methods=["get", "post"], url_path="clear-manual-transactions")
    def clear_manual_transactions(self, request, pk=None):
        """
        Optional reset before Plaid import: remove hand-entered / rule-shadow rows that have no
        Plaid transaction id. Rows imported from Plaid (plaid_transaction_id set) are kept.

        GET: ``eligible_count`` for optional query params ``before`` / ``after`` (YYYY-MM-DD, inclusive).

        POST body: ``{"confirm": true}`` plus optional ``before`` / ``after``. Requires confirmation.
        """
        account = self.get_object()
        src = request.query_params if request.method == "GET" else request.data
        try:
            before = _parse_optional_date_param(src.get("before"))
            after = _parse_optional_date_param(src.get("after"))
        except ValueError:
            return Response(
                {"detail": "Invalid date — use YYYY-MM-DD for before/after."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if before is not None and after is not None and after > before:
            return Response(
                {"detail": "'after' date must be on or before 'before' date when both are set."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        qs = eligible_manual_transactions_queryset(account)
        if before is not None:
            qs = qs.filter(date__lte=before)
        if after is not None:
            qs = qs.filter(date__gte=after)

        if request.method == "GET":
            return Response({"eligible_count": qs.count()})

        confirm = request.data.get("confirm")
        if confirm is not True and str(confirm).lower() not in ("true", "1", "yes"):
            return Response(
                {
                    "detail": 'Send JSON {"confirm": true} to delete eligible manual transactions '
                    "(bank-imported Plaid rows are kept).",
                    "eligible_count": qs.count(),
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        deleted = delete_manual_transactions_for_plaid_reset(account, before=before, after=after)
        return Response(
            {
                "deleted": deleted,
                "detail": f"Removed {deleted} manual transaction(s). Run Plaid Import to pull bank-posted lines.",
            }
        )

    @action(detail=True, methods=["get", "post"], url_path="clear-all-transactions")
    def clear_all_transactions(self, request, pk=None):
        """
        Nuclear reset: delete every ledger transaction on this account (all sources, all dates).

        GET: ``transaction_count`` and ``statement_lines`` (reconcile CSV rows) on this account.

        POST: ``{"confirm": true}`` — removes transactions. Transfer pairs: both legs are removed
        unless the counterparty account has ``preserve_partner_transfer_legs`` (manual-only ledger),
        in which case that account's row is kept and only the link is removed. Then removes orphan
        transfer groups and statement import lines for this account. The account and starting balance are kept.
        """
        account = self.get_object()
        txn_count = Transaction.objects.filter(account=account).count()
        stmt_count = StatementTransaction.objects.filter(account=account).count()

        if request.method == "GET":
            return Response(
                {
                    "transaction_count": txn_count,
                    "statement_lines": stmt_count,
                }
            )

        confirm = request.data.get("confirm")
        if confirm is not True and str(confirm).lower() not in ("true", "1", "yes"):
            return Response(
                {
                    "detail": 'Send JSON {"confirm": true} to delete all transactions on this account.',
                    "transaction_count": txn_count,
                    "statement_lines": stmt_count,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        stats = clear_all_transactions_for_account(account)
        reset_n = stats.get("plaid_items_cursor_reset", 0)
        return Response(
            {
                "detail": (
                    f"Deleted {stats['transactions_deleted']} transaction(s) and "
                    f"{stats['statement_lines_deleted']} reconcile statement line(s). "
                    f"Reset Plaid sync cursor on {reset_n} bank login(s) so the next import can reload history. "
                    "Transfers from this account removed the counterparty leg too, unless that account is marked "
                    "manual-only (preserve partner legs). "
                    "Use Import transactions on the Transactions page."
                ),
                **stats,
            }
        )

    @action(detail=True, methods=["get"], url_path="payoff/compare")
    def payoff_compare(self, request, pk=None):
        """Compare payoff projections across payment strategies."""
        account = self.get_object()
        if account.account_type != Account.AccountType.CREDIT:
            return Response(
                {"detail": "Payoff projection is only available for credit card accounts."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        fixed_raw = request.query_params.get("fixed_amount")
        custom_raw = request.query_params.get("custom_amount")
        fixed_amount = None
        custom_amount = None
        try:
            if fixed_raw:
                fixed_amount = Decimal(str(fixed_raw))
            if custom_raw:
                custom_amount = Decimal(str(custom_raw))
        except Exception:
            return Response(
                {"detail": "fixed_amount and custom_amount must be numbers."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(
            compare_payment_strategies(
                account,
                fixed_amount=fixed_amount,
                custom_amount=custom_amount,
            )
        )

    @action(detail=True, methods=["get"], url_path="payoff")
    def payoff(self, request, pk=None):
        """
        For CREDIT accounts: project payoff timeline and interest.
        GET ?strategy=minimum_payment|statement_balance|current_balance|fixed_amount|custom_amount
        Legacy: ?monthly_payment=100 implies strategy=custom_amount.
        Optional: ?fixed_amount= for fixed_amount strategy.
        """
        account = self.get_object()
        if account.account_type != Account.AccountType.CREDIT:
            return Response(
                {"detail": "Payoff projection is only available for credit card accounts."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        strategy = request.query_params.get("strategy", "").strip()
        monthly_raw = request.query_params.get("monthly_payment")
        fixed_raw = request.query_params.get("fixed_amount")
        custom_amount = None
        fixed_amount = None

        if monthly_raw not in (None, ""):
            strategy = "custom_amount"
            try:
                custom_amount = Decimal(str(monthly_raw))
            except Exception:
                return Response(
                    {"detail": "monthly_payment must be a number."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        elif strategy == "fixed_amount" and fixed_raw:
            try:
                fixed_amount = Decimal(str(fixed_raw))
                custom_amount = fixed_amount
            except Exception:
                return Response(
                    {"detail": "fixed_amount must be a number."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        elif not strategy:
            strategy = "minimum_payment"

        if strategy not in PAYOFF_STRATEGIES:
            return Response(
                {
                    "detail": f"strategy must be one of: {', '.join(sorted(PAYOFF_STRATEGIES))}.",
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        custom_raw = request.query_params.get("custom_amount")
        if custom_raw and custom_amount is None:
            try:
                custom_amount = Decimal(str(custom_raw))
            except Exception:
                return Response(
                    {"detail": "custom_amount must be a number."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        if strategy in ("custom_amount", "fixed_amount") and (custom_amount is None or custom_amount <= 0):
            return Response(
                {"detail": "A positive payment amount is required for this strategy."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        result = project_credit_card_payoff(
            account,
            strategy,
            custom_amount=custom_amount,
        )
        return Response(result)

    @action(detail=True, methods=["get"], url_path="available-to-spend")
    def available_to_spend(self, request, pk=None):
        """
        Forecast-aware available-to-spend for a single cash account.
        GET ?days=30 (7, 14, 30, 60, or 90).
        """
        account = self.get_object()
        try:
            days = _parse_forecast_days_param(request)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        summary = calculate_account_forecast_summary(
            request.user, account, days=days
        )
        return Response(serialize_forecast_summary(summary))

    @action(detail=True, methods=["get"], url_path="bucket-allocations")
    def bucket_allocations(self, request, pk=None):
        """Bucket reserves on this account (allocated vs available unallocated)."""
        from goals.bucket_services import account_bucket_summary

        account = self.get_object()
        return Response(account_bucket_summary(account.pk))

    @action(detail=False, methods=["get"], url_path="forecast-summary")
    def forecast_summary(self, request):
        """
        Batch forecast summaries for all accounts in the user's households.
        GET ?days=30&household=<id>
        """
        try:
            days = _parse_forecast_days_param(request)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        qs = self.filter_queryset(self.get_queryset())
        accounts = list(qs)
        summaries = calculate_forecast_summaries_for_accounts(
            request.user, accounts, days=days
        )
        return Response(
            {
                "days": days,
                "accounts": [
                    {
                        "account_id": a.id,
                        **serialize_forecast_summary(summaries[a.id]),
                    }
                    for a in accounts
                ],
            }
        )

    @action(detail=False, methods=["get"], url_path="safe-to-spend-dashboard")
    def safe_to_spend_dashboard(self, request):
        """
        Dashboard aggregate: total safe-to-spend (spending/bills), accounts at risk, next risk date.
        GET ?days=30
        """
        try:
            days = _parse_forecast_days_param(request)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        qs = self.filter_queryset(self.get_queryset())
        accounts = [a for a in qs if a.participates_in_forecast()]
        accounts_by_id = {a.id: a for a in accounts}
        summaries = calculate_forecast_summaries_for_accounts(
            request.user, accounts, days=days
        )
        aggregate = dashboard_safe_to_spend_aggregate(summaries, accounts_by_id)
        health_by_id = calculate_account_health_for_accounts(
            request.user, accounts, days=days
        )
        health_aggregate = dashboard_account_health_aggregate(
            health_by_id,
            accounts_by_id,
            safe_to_spend_total=aggregate.get("total_safe_to_spend"),
        )
        return Response({"days": days, **aggregate, **health_aggregate})

    @action(detail=False, methods=["get"], url_path="health")
    def account_health_batch(self, request):
        """
        Batch account health for all accounts in the user's households.
        GET ?days=30&household=<id>
        """
        try:
            days = _parse_forecast_days_param(request)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        qs = self.filter_queryset(self.get_queryset())
        accounts = list(qs)
        accounts_by_id = {a.id: a for a in accounts}
        health_by_id = calculate_account_health_for_accounts(
            request.user, accounts, days=days
        )
        return Response(
            {
                "days": days,
                "accounts": [
                    {"account_id": a.id, **serialize_account_health(health_by_id[a.id])}
                    for a in accounts
                ],
                **dashboard_account_health_aggregate(health_by_id, accounts_by_id),
            }
        )

    @action(detail=True, methods=["get"], url_path="health")
    def account_health(self, request, pk=None):
        """Health indicator for a single account. GET ?days=30"""
        account = self.get_object()
        try:
            days = _parse_forecast_days_param(request)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        health = calculate_account_health(request.user, account, days=days)
        return Response({"days": days, **serialize_account_health(health), "health": health})
