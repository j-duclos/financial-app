from django.urls import path
from .views import MonthlySummaryView, CategoryBreakdownView, AccountBalancesView, DashboardSummaryView, SubscriptionIntelligenceView

urlpatterns = [
    path("monthly-summary/", MonthlySummaryView.as_view(), name="monthly-summary"),
    path("category-breakdown/", CategoryBreakdownView.as_view(), name="category-breakdown"),
    path("account-balances/", AccountBalancesView.as_view(), name="account-balances"),
    path("dashboard/summary/", DashboardSummaryView.as_view(), name="dashboard-summary"),
    path("subscriptions/", SubscriptionIntelligenceView.as_view(), name="subscription-intelligence"),
]
