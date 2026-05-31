from datetime import date
from decimal import Decimal
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.db.models import Sum
from django.db.models.functions import Coalesce

from core.utils import get_households_for_user
from accounts.models import Account
from accounts.services.available_to_spend import normalize_forecast_days
from accounts.services.balances import signed_ledger_balance
from transactions.models import Transaction
from .services.dashboard_summary import build_dashboard_summary
from .services.reporting import exclude_internal_transfers
from .services.subscription_intelligence import build_subscription_intelligence


class MonthlySummaryView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        month = request.query_params.get("month")  # YYYY-MM
        if not month:
            return Response({"detail": "Query param 'month' (YYYY-MM) is required."}, status=400)
        try:
            year, month_int = map(int, month.split("-"))
        except (ValueError, TypeError):
            return Response({"detail": "month must be YYYY-MM."}, status=400)
        households = get_households_for_user(request.user)
        account_ids = Account.objects.for_historical_reporting().filter(
            household__in=households,
        ).values_list("id", flat=True)
        qs = exclude_internal_transfers(
            Transaction.objects.filter(account_id__in=account_ids, date__year=year, date__month=month_int)
        )
        total_income = qs.filter(amount__gt=0).aggregate(s=Coalesce(Sum("amount"), Decimal("0")))["s"] or Decimal("0")
        total_expenses = qs.filter(amount__lt=0).aggregate(s=Coalesce(Sum("amount"), Decimal("0")))["s"] or Decimal("0")
        net = total_income + total_expenses  # expenses are negative
        return Response({
            "month": month,
            "total_income": total_income,
            "total_expenses": total_expenses,
            "net": net,
        })


class CategoryBreakdownView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        month = request.query_params.get("month")
        if not month:
            return Response({"detail": "Query param 'month' (YYYY-MM) is required."}, status=400)
        try:
            year, month_int = map(int, month.split("-"))
        except (ValueError, TypeError):
            return Response({"detail": "month must be YYYY-MM."}, status=400)
        households = get_households_for_user(request.user)
        account_ids = Account.objects.for_historical_reporting().filter(
            household__in=households,
        ).values_list("id", flat=True)
        from categories.models import Category
        # Group by category (including null = uncategorized)
        qs = (
            exclude_internal_transfers(
                Transaction.objects.filter(account_id__in=account_ids, date__year=year, date__month=month_int)
            )
            .values("category_id")
            .annotate(total=Coalesce(Sum("amount"), Decimal("0")))
        )
        breakdown = []
        for row in qs:
            cat_id = row["category_id"]
            total = row["total"]
            if cat_id:
                cat = Category.objects.filter(pk=cat_id).first()
                label = cat.name if cat else f"Category #{cat_id}"
            else:
                label = "Uncategorized"
            breakdown.append({"category_id": cat_id, "category_name": label, "total": total})
        return Response({"month": month, "breakdown": breakdown})


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
        days_param = request.query_params.get("days")
        try:
            days = normalize_forecast_days(int(days_param)) if days_param else 30
        except (TypeError, ValueError) as exc:
            return Response({"detail": str(exc)}, status=400)
        data = build_dashboard_summary(request.user, days=days)
        return Response(data)


class SubscriptionIntelligenceView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(build_subscription_intelligence(request.user))
