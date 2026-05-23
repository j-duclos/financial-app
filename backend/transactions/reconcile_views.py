from datetime import datetime
from decimal import Decimal, InvalidOperation

from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import Account
from core.permissions import IsHouseholdMember
from core.utils import get_households_for_user

from .models import Transaction
from .services.reconciliation import (
    complete_reconciliation,
    get_setup_data,
)


def _parse_date_param(value: str | None):
    if not value:
        return None
    return datetime.strptime(value, "%Y-%m-%d").date()


def _serialize_reconcile_txn(txn: Transaction, running_balance: str | None) -> dict:
    category_name = txn.category.name if txn.category_id else None
    return {
        "id": txn.pk,
        "date": txn.date.isoformat(),
        "payee": txn.payee,
        "memo": txn.memo,
        "amount": str(txn.amount),
        "direction": "INFLOW" if txn.amount >= 0 else "OUTFLOW",
        "category": category_name,
        "source": txn.source,
        "cleared": txn.cleared,
        "reconciled": txn.reconciled,
        "running_balance": running_balance,
    }


class ReconcileSetupView(APIView):
    """Setup data for bank reconciliation: balances and unreconciled transactions in a date range."""

    permission_classes = [IsHouseholdMember]

    def get(self, request):
        account_id = request.query_params.get("account_id")
        if not account_id:
            return Response(
                {"detail": "account_id is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        households = get_households_for_user(request.user)
        account = Account.objects.filter(pk=account_id, household__in=households).first()
        if not account:
            return Response({"detail": "Account not found."}, status=status.HTTP_404_NOT_FOUND)

        try:
            start = _parse_date_param(request.query_params.get("start"))
            end = _parse_date_param(request.query_params.get("end"))
        except ValueError:
            return Response(
                {"detail": "start and end must be YYYY-MM-DD."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            data = get_setup_data(account, start=start, end=end)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        running = data["running_balances"]
        txns_payload = [
            _serialize_reconcile_txn(
                t,
                str(running[t.pk]) if t.pk in running else None,
            )
            for t in data["unreconciled_transactions"]
        ]
        last_end = data["last_reconcile_period_end"]
        return Response(
            {
                "account_id": account.pk,
                "last_reconciled_balance": str(data["last_reconciled_balance"]),
                "period_opening_balance": str(data["period_opening_balance"]),
                "app_current_balance": str(data["app_current_balance"]),
                "is_first_reconciliation": data["is_first_reconciliation"],
                "account_starting_balance": data["account_starting_balance"],
                "min_start_date": data["min_start_date"].isoformat(),
                "period_start_date": data["period_start_date"].isoformat(),
                "period_end_date": data["period_end_date"].isoformat(),
                "last_reconcile_period_end": last_end.isoformat() if last_end else None,
                "max_end_date": data["max_end_date"].isoformat(),
                "unreconciled_transactions": txns_payload,
            }
        )


class ReconcileCompleteView(APIView):
    """Complete a reconciliation for a date range after checked transactions balance to bank."""

    permission_classes = [IsHouseholdMember]

    def post(self, request):
        account_id = request.data.get("account_id")
        bank_raw = request.data.get("bank_current_balance")
        checked_ids = request.data.get("checked_transaction_ids") or []
        start_raw = request.data.get("period_start_date") or request.data.get("start_date")
        end_raw = request.data.get("period_end_date") or request.data.get("end_date")

        if account_id is None or bank_raw is None or bank_raw == "":
            return Response(
                {"detail": "account_id and bank_current_balance are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not start_raw or not end_raw:
            return Response(
                {"detail": "period_start_date and period_end_date are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not isinstance(checked_ids, list):
            return Response(
                {"detail": "checked_transaction_ids must be a list."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            bank_balance = Decimal(str(bank_raw))
        except (InvalidOperation, TypeError):
            return Response(
                {"detail": "bank_current_balance must be a valid decimal."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            period_start = _parse_date_param(str(start_raw))
            period_end = _parse_date_param(str(end_raw))
        except ValueError:
            return Response(
                {"detail": "period_start_date and period_end_date must be YYYY-MM-DD."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        households = get_households_for_user(request.user)
        account = Account.objects.filter(pk=account_id, household__in=households).first()
        if not account:
            return Response({"detail": "Account not found."}, status=status.HTTP_404_NOT_FOUND)

        try:
            checked_pks = [int(x) for x in checked_ids]
        except (TypeError, ValueError):
            return Response(
                {"detail": "checked_transaction_ids must contain integers."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            rec = complete_reconciliation(
                account=account,
                user=request.user,
                bank_current_balance=bank_balance,
                checked_transaction_ids=checked_pks,
                period_start=period_start,
                period_end=period_end,
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(
            {
                "id": rec.pk,
                "account_id": rec.account_id,
                "bank_current_balance": str(rec.bank_current_balance),
                "app_current_balance": str(rec.app_current_balance),
                "last_reconciled_balance": str(rec.last_reconciled_balance),
                "final_reconciled_balance": str(rec.final_reconciled_balance),
                "difference": str(rec.difference),
                "period_start_date": rec.period_start_date.isoformat() if rec.period_start_date else None,
                "period_end_date": rec.period_end_date.isoformat() if rec.period_end_date else None,
                "status": rec.status,
                "completed_at": rec.completed_at.isoformat() if rec.completed_at else None,
                "checked_transaction_ids": checked_pks,
            },
            status=status.HTTP_201_CREATED,
        )
