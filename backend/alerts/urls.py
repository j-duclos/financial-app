from django.urls import path, include
from rest_framework.routers import DefaultRouter

from alerts.views import ProjectedFundsAlertViewSet, PushDeviceViewSet

router = DefaultRouter()
router.register("alerts", ProjectedFundsAlertViewSet, basename="projected-funds-alert")
router.register("push-devices", PushDeviceViewSet, basename="push-device")

urlpatterns = [
    path("", include(router.urls)),
]
