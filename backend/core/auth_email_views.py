"""Strict auth-email endpoints.

These views deliberately avoid false-success responses. Unknown password-reset
addresses remain neutral to prevent account enumeration, but known accounts and
verification resends only return success after the configured email backend has
accepted the message.
"""
from __future__ import annotations

import logging

from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.serializers import ForgotPasswordSerializer

logger = logging.getLogger(__name__)


class StrictResendVerificationView(APIView):
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

        email = normalize_email(request.user.email)
        if not email:
            return Response(
                {"detail": "Add an email address to your account before verifying."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            sent = send_verification_email(request.user)
        except Exception:
            logger.exception("Verification email delivery failed user_id=%s", request.user.pk)
            return Response(
                {
                    "detail": "We couldn't send the verification email right now. Please try again."
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        if sent is not True:
            logger.error(
                "Verification email backend did not accept message user_id=%s",
                request.user.pk,
            )
            return Response(
                {
                    "detail": "We couldn't send the verification email right now. Please try again."
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        logger.info("Verification resend accepted user_id=%s", request.user.pk)
        return Response({"detail": "Verification email sent."})


class StrictForgotPasswordView(APIView):
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

        # Keep unknown addresses neutral so the endpoint cannot enumerate users.
        if user is None:
            return Response({"detail": NEUTRAL_PASSWORD_RESET_DETAIL})

        try:
            sent = send_password_reset_email(user)
        except Exception:
            logger.exception("Password reset email delivery failed user_id=%s", user.pk)
            return Response(
                {
                    "detail": "We couldn't send the password reset email right now. Please try again."
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        if sent is not True:
            logger.error(
                "Password reset email backend did not accept message user_id=%s",
                user.pk,
            )
            return Response(
                {
                    "detail": "We couldn't send the password reset email right now. Please try again."
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        logger.info("Password reset email accepted user_id=%s", user.pk)
        return Response({"detail": NEUTRAL_PASSWORD_RESET_DETAIL})
