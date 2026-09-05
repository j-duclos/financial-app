from django.urls import path

from affordability.views import (
    DtiCalculateView,
    DtiCreditCardSuggestionView,
    DtiDebtItemDetailView,
    DtiDebtItemListCreateView,
    DtiIncomeSourceDetailView,
    DtiIncomeSourceListCreateView,
    DtiProfileView,
)

urlpatterns = [
    path("dti/profile/", DtiProfileView.as_view(), name="dti-profile"),
    path(
        "dti/income-sources/",
        DtiIncomeSourceListCreateView.as_view(),
        name="dti-income-source-list",
    ),
    path(
        "dti/income-sources/<int:pk>/",
        DtiIncomeSourceDetailView.as_view(),
        name="dti-income-source-detail",
    ),
    path("dti/debt-items/", DtiDebtItemListCreateView.as_view(), name="dti-debt-item-list"),
    path(
        "dti/debt-items/<int:pk>/",
        DtiDebtItemDetailView.as_view(),
        name="dti-debt-item-detail",
    ),
    path("dti/calculate/", DtiCalculateView.as_view(), name="dti-calculate"),
    path(
        "dti/credit-card-suggestions/",
        DtiCreditCardSuggestionView.as_view(),
        name="dti-credit-card-suggestions",
    ),
]
