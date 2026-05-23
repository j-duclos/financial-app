from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .relationship_views import AccountRelationshipViewSet
from .views import AccountViewSet

router = DefaultRouter()
router.register("relationships", AccountRelationshipViewSet, basename="account-relationship")
router.register("", AccountViewSet, basename="account")
urlpatterns = [
    path("", include(router.urls)),
]
