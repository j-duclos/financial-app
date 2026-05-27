from rest_framework.routers import DefaultRouter

from .views import SpendingTargetViewSet

router = DefaultRouter()
router.register("", SpendingTargetViewSet, basename="spending-target")
urlpatterns = router.urls
