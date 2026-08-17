from django.urls import path
from .views import (
    MonthlySummaryView,
    CategoryBreakdownView,
    MonthlyReportsView,
    AccountBalancesView,
    DashboardSummaryView,
    DashboardSummaryFastView,
    DashboardSummaryDetailsView,
    ExtendedCashRiskView,
    SubscriptionIntelligenceView,
)

urlpatterns = [
    path("monthly-summary/", MonthlySummaryView.as_view(), name="monthly-summary"),
    path("category-breakdown/", CategoryBreakdownView.as_view(), name="category-breakdown"),
    path("reports/monthly/", MonthlyReportsView.as_view(), name="monthly-reports"),
    path("account-balances/", AccountBalancesView.as_view(), name="account-balances"),
    path("dashboard/summary/", DashboardSummaryView.as_view(), name="dashboard-summary"),
    path("dashboard/summary-fast/", DashboardSummaryFastView.as_view(), name="dashboard-summary-fast"),
    path("dashboard/details/", DashboardSummaryDetailsView.as_view(), name="dashboard-summary-details"),
    path("extended-cash-risk/", ExtendedCashRiskView.as_view(), name="extended-cash-risk"),
    path("subscriptions/", SubscriptionIntelligenceView.as_view(), name="subscription-intelligence"),
]
