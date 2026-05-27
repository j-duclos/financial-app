from django.urls import path

from credit_cards.views import (
    CreditCardInterestReportView,
    DebtDashboardSummaryView,
    DebtPayoffPlanView,
)

urlpatterns = [
    path(
        "interest-report/",
        CreditCardInterestReportView.as_view(),
        name="credit-card-interest-report",
    ),
    path("plan/", DebtPayoffPlanView.as_view(), name="debt-payoff-plan"),
    path("dashboard/", DebtDashboardSummaryView.as_view(), name="debt-dashboard-summary"),
]
