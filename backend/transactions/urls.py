from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import TransactionViewSet, TransferCreateView

router = DefaultRouter()
router.register("", TransactionViewSet, basename="transaction")
urlpatterns = [
    path("transfers/", TransferCreateView.as_view(), name="transfer-create"),
    path("", include(router.urls)),
]