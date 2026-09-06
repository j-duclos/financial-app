from django.http import JsonResponse

from rest_framework import status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import ModelViewSet
from rest_framework_simplejwt.views import TokenObtainPairView
import logging

from .models import Household, HouseholdMembership
from .permissions import IsHouseholdMember
from .serializers import (
    ChangePasswordSerializer,
    ForgotPasswordSerializer,
    HouseholdSerializer,
    HouseholdDetailSerializer,
    RegisterSerializer,
    ResetPasswordSerializer,
    UserProfileSerializer,
    VerifyEmailSerializer,
)
from .utils import get_user_profile, get_households_for_user


from common.services.redis_config import redis_diagnostics, verify_redis_cache

logger = logging.getLogger(__name__)


def home(request):
    return JsonResponse({
        "status": "ok",
        "service": "financial-app-api",
        "docs": "/api/docs/",
        "admin": "/admin/",
    })


def health(request):
    payload: dict = {"status": "ok"}
    diag = redis_diagnostics()
    payload["redis"] = {
        "configured": diag["redis_configured"],
        "timeline_cache_enabled": diag["timeline_cache_enabled"],
    }
    if diag["redis_configured"]:
        ok, _ = verify_redis_cache()
        payload["redis"]["connected"] = ok
        if not ok:
            payload["status"] = "degraded"
    return JsonResponse(payload)


class TokenObtainPairViewNoAuth(TokenObtainPairView):
    """Obtain JWT token; do not run JWT auth on this request so a stale/invalid token can't cause 401."""
    permission_classes = [AllowAny]
    authentication_classes = []


class RegisterView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        from rest_framework_simplejwt.tokens import RefreshToken
        from core.mail import send_verification_email

        try:
            send_verification_email(user)
        except Exception:
            logger.exception("Failed to send verification email user_id=%s", user.pk)
        refresh = RefreshToken.for_user(user)
        profile = get_user_profile(user)
        return Response(
            {
                "user": {"id": user.id, "username": user.username},
                "profile": UserProfileSerializer(profile).data if profile else None,
                "access": str(refresh.access_token),
                "refresh": str(refresh),
            },
            status=status.HTTP_201_CREATED,
        )


class VerifyEmailView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        from core.auth_tokens import TokenError, read_verification_token
        from core.email_identity import is_email_verified, mark_email_verified

        serializer = VerifyEmailSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            user = read_verification_token(serializer.validated_data["token"])
        except TokenError as exc:
            status_code = (
                status.HTTP_400_BAD_REQUEST
                if exc.code in ("invalid", "expired")
                else status.HTTP_400_BAD_REQUEST
            )
            return Response({"status": exc.code}, status=status_code)
        if is_email_verified(user):
            return Response({"status": "already_verified"})
        mark_email_verified(user)
        return Response({"status": "verified"})


class ResendVerificationView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = []

    def get_throttles(self):
        from core.throttles import AuthEmailUserThrottle

        return [AuthEmailUserThrottle()]

    def post(self, request):
        from core.email_identity import is_email_verified, normalize_email
        from core.mail import send_verification_email

        if is_email_verified(request.user):
            return Response({"detail": "Email is already verified."})
        if not normalize_email(request.user.email):
            return Response(
                {"detail": "Add an email address to your account before verifying."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            send_verification_email(request.user)
        except Exception:
            logger.exception("Failed to resend verification email user_id=%s", request.user.pk)
            return Response(
                {"detail": "We couldn't send the email right now. Please try again later."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        return Response({"detail": "Verification email sent."})


class ForgotPasswordView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = []

    def get_throttles(self):
        from core.throttles import AuthEmailAnonThrottle

        return [AuthEmailAnonThrottle()]

    def post(self, request):
        from core.email_identity import find_users_by_email, normalize_email
        from core.mail import NEUTRAL_PASSWORD_RESET_DETAIL, send_password_reset_email

        serializer = ForgotPasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = normalize_email(serializer.validated_data["email"])
        user = find_users_by_email(email).first()
        if user is not None:
            try:
                send_password_reset_email(user)
            except Exception:
                logger.exception("Failed to send password reset email user_id=%s", user.pk)
        return Response({"detail": NEUTRAL_PASSWORD_RESET_DETAIL})


class ResetPasswordView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        from core.auth_tokens import TokenError, read_password_reset_user

        serializer = ResetPasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            user = read_password_reset_user(
                serializer.validated_data["uid"],
                serializer.validated_data["token"],
            )
        except TokenError:
            return Response(
                {"detail": "This password reset link is invalid or has expired."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        # Password hash change invalidates Django's password-reset token.
        # SimpleJWT token blacklist is not configured; existing JWTs remain
        # valid until ACCESS/REFRESH lifetime expiry.
        user.set_password(serializer.validated_data["new_password"])
        user.save(update_fields=["password"])
        return Response({"detail": "Your password has been reset."})


class ProfileView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        profile = get_user_profile(request.user)
        serializer = UserProfileSerializer(profile, context={"request": request})
        return Response(serializer.data)

    def patch(self, request):
        profile = get_user_profile(request.user)
        serializer = UserProfileSerializer(profile, data=request.data, partial=True, context={"request": request})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class ChangePasswordView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = ChangePasswordSerializer(
            data=request.data, context={"user": request.user, "request": request}
        )
        serializer.is_valid(raise_exception=True)
        user = request.user
        if not user.check_password(serializer.validated_data["current_password"]):
            return Response(
                {"current_password": ["Current password is incorrect."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        user.set_password(serializer.validated_data["new_password"])
        user.save(update_fields=["password"])
        return Response({"detail": "Password updated."})


class HouseholdViewSet(ModelViewSet):
    serializer_class = HouseholdSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return get_households_for_user(self.request.user)

    def get_serializer_class(self):
        if self.action == "retrieve":
            return HouseholdDetailSerializer
        return HouseholdSerializer

    def perform_create(self, serializer):
        household = serializer.save()
        HouseholdMembership.objects.create(
            household=household, user=self.request.user, role=HouseholdMembership.Role.OWNER
        )
