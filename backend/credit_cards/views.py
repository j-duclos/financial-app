from decimal import Decimal, InvalidOperation

from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import Account
from core.utils import get_households_for_user
from credit_cards.services.debt_engine import (
    DEBT_STRATEGIES,
    PAYOFF_MODES,
    build_dashboard_debt_summary,
    simulate_household_debt,
)
from credit_cards.services.reports import build_credit_card_interest_report


class CreditCardInterestReportView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        month = request.query_params.get("month")
        if month:
            try:
                year, month_int = map(int, month.split("-"))
                if month_int < 1 or month_int > 12:
                    raise ValueError
            except (ValueError, TypeError):
                return Response({"detail": "month must be YYYY-MM."}, status=400)
        data = build_credit_card_interest_report(request.user, month=month)
        return Response(data)


def _credit_cards_for_user(user, household_id: str | None = None) -> list[Account]:
    households = get_households_for_user(user)
    if household_id:
        households = households.filter(pk=int(household_id))
    return list(
        Account.objects.non_deleted()
        .filter(household__in=households, account_type=Account.AccountType.CREDIT, is_hidden=False)
        .order_by("name")
    )


def _parse_decimal(value: str | None) -> Decimal:
    if not value:
        return Decimal("0")
    return Decimal(value)


class DebtPayoffPlanView(APIView):
    """Household debt payoff engine — strategies, modes, what-if."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        strategy = request.query_params.get("strategy", "avalanche")
        mode = request.query_params.get("mode", "aggressive")
        if strategy not in DEBT_STRATEGIES:
            return Response({"detail": f"strategy must be one of: {', '.join(sorted(DEBT_STRATEGIES))}"}, status=400)
        if mode not in PAYOFF_MODES:
            return Response({"detail": f"mode must be one of: {', '.join(sorted(PAYOFF_MODES))}"}, status=400)

        try:
            extra = _parse_decimal(request.query_params.get("extra_monthly"))
            income_cut = _parse_decimal(request.query_params.get("income_reduction_pct"))
            lump = _parse_decimal(request.query_params.get("lump_sum"))
            lump_account = request.query_params.get("lump_sum_account")
        except (InvalidOperation, ValueError):
            return Response({"detail": "Invalid decimal parameter."}, status=400)

        lump_by: dict[int, Decimal] = {}
        if lump > 0 and lump_account:
            try:
                lump_by[int(lump_account)] = lump
            except ValueError:
                return Response({"detail": "lump_sum_account must be an integer."}, status=400)

        custom_order = None
        order_raw = request.query_params.get("custom_order")
        if order_raw:
            try:
                custom_order = [int(x) for x in order_raw.split(",") if x.strip()]
            except ValueError:
                return Response({"detail": "custom_order must be comma-separated account ids."}, status=400)

        cards = _credit_cards_for_user(request.user, request.query_params.get("household"))
        plan = simulate_household_debt(
            cards,
            strategy=strategy,
            mode=mode,
            extra_monthly=extra,
            lump_sum_by_account=lump_by or None,
            custom_order=custom_order,
        )
        if income_cut > 0:
            plan["income_reduction_note"] = (
                f"Extra payments reduced by {income_cut}% for this scenario."
            )
        return Response(plan)


class DebtDashboardSummaryView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        cards = _credit_cards_for_user(request.user, request.query_params.get("household"))
        return Response(build_dashboard_debt_summary(cards))
