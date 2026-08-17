from datetime import date
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated

from core.utils import get_households_for_user
from accounts.models import Account
from accounts.services.balances import signed_ledger_balance
from accounts.services.extended_cash_risk import get_extended_cash_risk
from common.services.forecast_horizon import parse_forecast_days_param
from .services.dashboard_summary import (
    build_dashboard_summary,
    build_dashboard_summary_details,
    build_dashboard_summary_fast,
)
from .services.monthly_reports import build_monthly_reports
from .services.report_context import build_report_context
from .services.reporting import build_category_breakdown, build_monthly_summary
from .services.subscription_intelligence import build_subscription_intelligence


class MonthlySummaryView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        month = request.query_params.get("month")  # YYYY-MM
        if not month:
            return Response({"detail": "Query param 'month' (YYYY-MM) is required."}, status=400)
        try:
            ctx = build_report_context(request.user, month)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=400)
        return Response(build_monthly_summary(ctx))


class CategoryBreakdownView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        month = request.query_params.get("month")
        if not month:
            return Response({"detail": "Query param 'month' (YYYY-MM) is required."}, status=400)
        try:
            ctx = build_report_context(request.user, month)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=400)
        return Response(build_category_breakdown(ctx, include_previous=True))


class MonthlyReportsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        month = request.query_params.get("month")
        if not month:
            return Response({"detail": "Query param 'month' (YYYY-MM) is required."}, status=400)
        months = request.query_params.get("months", "12")
        try:
            history_months = max(1, min(int(months), 36))
        except (TypeError, ValueError):
            return Response({"detail": "months must be an integer."}, status=400)
        include_history = request.query_params.get("include_history", "").lower() in (
            "1",
            "true",
            "yes",
        )
        household_id = request.query_params.get("household_id")
        try:
            household_id = int(household_id) if household_id else None
        except (TypeError, ValueError):
            return Response({"detail": "household_id must be an integer."}, status=400)
        try:
            payload = build_monthly_reports(
                request.user,
                month,
                history_months=history_months,
                household_id=household_id,
                include_history=include_history,
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=400)
        return Response(payload)


class AccountBalancesView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        households = get_households_for_user(request.user)
        today = date.today()
        accounts = Account.objects.for_net_worth().filter(
            household__in=households,
            is_hidden=False,
        )
        result = []
        for acc in accounts:
            result.append({
                "account_id": acc.id,
                "account_name": acc.effective_display_name,
                "balance": signed_ledger_balance(acc, today),
            })
        return Response({"balances": result})


class DashboardSummaryView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        try:
            days = parse_forecast_days_param(request)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=400)
        data = build_dashboard_summary(request.user, days=days)
        return Response(data)


class DashboardSummaryFastView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        try:
            days = parse_forecast_days_param(request)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=400)
        data = build_dashboard_summary_fast(request.user, days=days)
        return Response(data)


class DashboardSummaryDetailsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        try:
            days = parse_forecast_days_param(request)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=400)
        data = build_dashboard_summary_details(request.user, days=days)
        return Response(data)


class ExtendedCashRiskView(APIView):
    """Lightweight 6-month first-cash-negative warning, independent of Forecast Window."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        data = get_extended_cash_risk(request.user)
        return Response(data)


class SubscriptionIntelligenceView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(build_subscription_intelligence(request.user))
