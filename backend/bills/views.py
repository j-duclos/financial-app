from datetime import date

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.utils import get_households_for_user
from transactions.models import Transaction

from .models import BillOccurrence
from .services import (
    get_bills_overview,
    get_monthly_bill_checklist,
    get_occurrence_detail,
    link_bill_transaction,
    mark_bill_missed,
    mark_bill_paid,
    skip_bill_occurrence,
)


def _parse_month_params(request):
    month_param = request.query_params.get("month")
    if month_param:
        try:
            year, month = map(int, month_param.split("-"))
            return year, month
        except (ValueError, TypeError):
            return None, None
    year = request.query_params.get("year")
    month = request.query_params.get("month_num") or request.query_params.get("month_number")
    if year and month:
        try:
            return int(year), int(month)
        except (ValueError, TypeError):
            return None, None
    today = date.today()
    return today.year, today.month


def _occurrence_for_user(user, pk: int) -> BillOccurrence | None:
    households = get_households_for_user(user)
    return (
        BillOccurrence.objects.filter(pk=pk, household__in=households)
        .select_related("account", "category", "rule", "transaction")
        .first()
    )


class MonthlyBillChecklistView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        year, month = _parse_month_params(request)
        if not year or not month or month < 1 or month > 12:
            return Response({"detail": "Provide month=YYYY-MM or year and month_num."}, status=400)
        household_id = request.query_params.get("household")
        account_id = request.query_params.get("account")
        status_filter = request.query_params.get("status")
        category_id = request.query_params.get("category")
        data = get_monthly_bill_checklist(
            request.user,
            month=month,
            year=year,
            household_id=int(household_id) if household_id else None,
            account_id=int(account_id) if account_id else None,
            status_filter=status_filter or None,
            category_id=int(category_id) if category_id else None,
        )
        return Response(data)


class BillsOverviewView(APIView):
    """Multi-month bill command center."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        year, month = _parse_month_params(request)
        if not year or not month:
            return Response({"detail": "Invalid month."}, status=400)
        try:
            before = int(request.query_params.get("months_before", "0"))
            after = int(request.query_params.get("months_after", "1"))
        except ValueError:
            before, after = 0, 1
        before = max(0, min(before, 6))
        after = max(0, min(after, 6))
        data = get_bills_overview(
            request.user,
            center_month=month,
            center_year=year,
            months_before=before,
            months_after=after,
        )
        return Response(data)


class BillOccurrenceDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk: int):
        occ = _occurrence_for_user(request.user, pk)
        if not occ:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(get_occurrence_detail(occ))


class BillOccurrenceActionView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk: int, action: str):
        occ = _occurrence_for_user(request.user, pk)
        if not occ:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)

        if action == "mark-paid":
            mark_bill_paid(occ, user=request.user)
        elif action == "mark-missed":
            mark_bill_missed(occ)
        elif action == "skip":
            skip_bill_occurrence(occ)
        elif action == "link-transaction":
            txn_id = request.data.get("transaction_id")
            if not txn_id:
                return Response({"detail": "transaction_id is required."}, status=400)
            try:
                link_bill_transaction(occ, int(txn_id))
            except (Transaction.DoesNotExist, ValueError) as exc:
                return Response({"detail": str(exc)}, status=400)
        elif action == "snooze-warning":
            days = int(request.data.get("days", 7))
            from datetime import timedelta

            occ.warning_snoozed_until = date.today() + timedelta(days=days)
            occ.save(update_fields=["warning_snoozed_until", "updated_at"])
        elif action == "set-autopay":
            mode = request.data.get("autopay_mode", "unknown")
            if mode not in ("manual", "autopay", "unknown"):
                return Response({"detail": "Invalid autopay_mode."}, status=400)
            occ.autopay_override = mode
            occ.save(update_fields=["autopay_override", "updated_at"])
        else:
            return Response({"detail": "Unknown action."}, status=400)

        year, month = map(int, occ.month.split("-"))
        data = get_monthly_bill_checklist(request.user, month=month, year=year)
        item = next((i for i in data["items"] if i["id"] == occ.id), None)
        detail = get_occurrence_detail(occ)
        return Response({"occurrence": item, "checklist": data, "detail": detail})
