from django.urls import path, include
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenRefreshView

from .views import (
    RegisterView,
    ProfileView,
    ChangePasswordView,
    HouseholdViewSet,
    DatabaseInfoView,
    TokenObtainPairViewNoAuth,
)
from timeline.views import TimelineView

router = DefaultRouter()
router.register("households", HouseholdViewSet, basename="household")

urlpatterns = [
    path("db-info/", DatabaseInfoView.as_view(), name="db_info"),
    path("auth/register/", RegisterView.as_view(), name="register"),
    path("auth/token/", TokenObtainPairViewNoAuth.as_view(), name="token_obtain_pair"),
    path("auth/refresh/", TokenRefreshView.as_view(), name="token_refresh"),
    path("profile/", ProfileView.as_view(), name="profile"),
    path("profile/change-password/", ChangePasswordView.as_view(), name="profile-change-password"),
    path("timeline/", TimelineView.as_view(), name="timeline"),
    path("", include(router.urls)),
]
