from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import TransactionViewSet, TransferCreateView, TransferBalancePreviewView

router = DefaultRouter()
router.register("", TransactionViewSet, basename="transaction")
urlpatterns = [
    path("transfers/preview/", TransferBalancePreviewView.as_view(), name="transfer-balance-preview"),
    path("transfers/", TransferCreateView.as_view(), name="transfer-create"),
    path("", include(router.urls)),
]