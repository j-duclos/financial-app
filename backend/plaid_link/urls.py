from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    PlaidConfigCheckView,
    PlaidExchangeView,
    PlaidItemViewSet,
    PlaidLiabilitiesWebhookView,
    PlaidLinkTokenView,
    PlaidLinkedAccountDisconnectView,
    PlaidMetaView,
    PlaidSyncAllView,
    PlaidSyncLiabilitiesAllView,
)

router = DefaultRouter()
router.register("plaid/items", PlaidItemViewSet, basename="plaid-item")

urlpatterns = [
    path("plaid/config-check/", PlaidConfigCheckView.as_view(), name="plaid-config-check"),
    path("plaid/meta/", PlaidMetaView.as_view(), name="plaid-meta"),
    path("plaid/link-token/", PlaidLinkTokenView.as_view(), name="plaid-link-token"),
    path("plaid/exchange/", PlaidExchangeView.as_view(), name="plaid-exchange"),
    path("plaid/sync-all/", PlaidSyncAllView.as_view(), name="plaid-sync-all"),
    path("plaid/sync-liabilities/", PlaidSyncLiabilitiesAllView.as_view(), name="plaid-sync-liabilities"),
    path("plaid/webhooks/liabilities/", PlaidLiabilitiesWebhookView.as_view(), name="plaid-liabilities-webhook"),
    path(
        "plaid/linked-accounts/<int:pk>/disconnect/",
        PlaidLinkedAccountDisconnectView.as_view(),
        name="plaid-linked-account-disconnect",
    ),
    path("", include(router.urls)),
]
