from decimal import Decimal
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.db.models import Sum, Q
from django.db.models.functions import Coalesce

from core.utils import get_households_for_user
from accounts.models import Account
from transactions.models import Transaction


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
        qs = Transaction.objects.filter(account_id__in=account_ids, date__year=year, date__month=month_int)
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
            Transaction.objects.filter(account_id__in=account_ids, date__year=year, date__month=month_int)
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
        accounts = Account.objects.for_net_worth().filter(household__in=households)
        result = []
        for acc in accounts:
            tx_sum = (
                Transaction.objects.filter(account=acc).aggregate(bal=Coalesce(Sum("amount"), Decimal("0")))
            )["bal"] or Decimal("0")
            start = (acc.starting_balance or Decimal("0"))
            balance = start + tx_sum
            if acc.account_type == Account.AccountType.CREDIT:
                balance = -balance  # Credit cards are liabilities for net worth
            result.append({
                "account_id": acc.id,
                "account_name": acc.effective_display_name,
                "balance": balance,
            })
        return Response({"balances": result})
