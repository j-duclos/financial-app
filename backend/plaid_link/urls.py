from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    PlaidConfigCheckView,
    PlaidExchangeView,
    PlaidItemViewSet,
    PlaidLinkTokenView,
    PlaidLinkedAccountDisconnectView,
    PlaidMetaView,
)

router = DefaultRouter()
router.register("plaid/items", PlaidItemViewSet, basename="plaid-item")

urlpatterns = [
    path("plaid/config-check/", PlaidConfigCheckView.as_view(), name="plaid-config-check"),
    path("plaid/meta/", PlaidMetaView.as_view(), name="plaid-meta"),
    path("plaid/link-token/", PlaidLinkTokenView.as_view(), name="plaid-link-token"),
    path("plaid/exchange/", PlaidExchangeView.as_view(), name="plaid-exchange"),
    path(
        "plaid/linked-accounts/<int:pk>/disconnect/",
        PlaidLinkedAccountDisconnectView.as_view(),
        name="plaid-linked-account-disconnect",
    ),
    path("", include(router.urls)),
]
