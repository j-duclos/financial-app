from django.urls import path, include
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenRefreshView

from .views import (
    RegisterView,
    ProfileView,
    ChangePasswordView,
    ChangeEmailView,
    ExportDataView,
    ExportTransactionsCsvView,
    DeleteAccountPreflightView,
    DeleteAccountView,
    HouseholdViewSet,
    TokenObtainPairViewNoAuth,
    VerifyEmailView,
    ResendVerificationView,
    ForgotPasswordView,
    ResetPasswordView,
)
from timeline.views import TimelineView

router = DefaultRouter()
router.register("households", HouseholdViewSet, basename="household")

urlpatterns = [
    path("auth/register/", RegisterView.as_view(), name="register"),
    path("auth/token/", TokenObtainPairViewNoAuth.as_view(), name="token_obtain_pair"),
    path("auth/refresh/", TokenRefreshView.as_view(), name="token_refresh"),
    path("auth/verify-email/", VerifyEmailView.as_view(), name="verify-email"),
    path("auth/resend-verification/", ResendVerificationView.as_view(), name="resend-verification"),
    path("auth/forgot-password/", ForgotPasswordView.as_view(), name="forgot-password"),
    path("auth/reset-password/", ResetPasswordView.as_view(), name="reset-password"),
    path("profile/", ProfileView.as_view(), name="profile"),
    path("profile/change-email/", ChangeEmailView.as_view(), name="profile-change-email"),
    path("profile/change-password/", ChangePasswordView.as_view(), name="profile-change-password"),
    path("profile/export-data/", ExportDataView.as_view(), name="profile-export-data"),
    path("profile/export-transactions.csv", ExportTransactionsCsvView.as_view(), name="profile-export-transactions-csv"),
    path("profile/delete-account/preflight/", DeleteAccountPreflightView.as_view(), name="profile-delete-account-preflight"),
    path("profile/delete-account/", DeleteAccountView.as_view(), name="profile-delete-account"),
    path("timeline/", TimelineView.as_view(), name="timeline"),
    path("", include(router.urls)),
]
