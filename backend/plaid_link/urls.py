from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import PlaidExchangeView, PlaidItemViewSet, PlaidLinkTokenView, PlaidMetaView

router = DefaultRouter()
router.register("plaid/items", PlaidItemViewSet, basename="plaid-item")

urlpatterns = [
    path("plaid/meta/", PlaidMetaView.as_view(), name="plaid-meta"),
    path("plaid/link-token/", PlaidLinkTokenView.as_view(), name="plaid-link-token"),
    path("plaid/exchange/", PlaidExchangeView.as_view(), name="plaid-exchange"),
    path("", include(router.urls)),
]
