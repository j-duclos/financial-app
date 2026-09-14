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
        from core.mail import email_transport_label, non_inbox_send_detail, send_verification_email

        user = request.user
        email = normalize_email(getattr(user, "email", ""))
        logger.info(
            "auth_email verification_request user_id=%s has_email=%s verified=%s",
            user.pk,
            bool(email),
            is_email_verified(user),
        )

        if is_email_verified(user):
            return Response(
                {
                    "detail": "Email is already verified.",
                    "transport": email_transport_label(),
                }
            )

        if not email:
            logger.warning("auth_email verification_missing_email user_id=%s", user.pk)
            return Response(
                {"detail": "Add an email address to your account before verifying."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Repair legacy whitespace/case in-place so every future auth-email path
        # addresses the exact same canonical recipient.
        if getattr(user, "email", "") != email:
            user.email = email
            user.save(update_fields=["email"])
            logger.info("auth_email verification_recipient_normalized user_id=%s", user.pk)

        from core.frontend_origin import get_frontend_origin

        if not get_frontend_origin():
            logger.error("auth_email verification_missing_frontend_origin user_id=%s", user.pk)
            return Response(
                {
                    "detail": "This server cannot build a verification link (FRONTEND_ORIGIN is missing).",
                    "transport": email_transport_label(),
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        try:
            sent = send_verification_email(user)
        except Exception:
            logger.exception("auth_email verification_delivery_failed user_id=%s", user.pk)
            return Response(
                {
                    "detail": "We couldn't send the verification email right now. Please try again."
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        if sent is not True:
            transport = email_transport_label()
            logger.error(
                "auth_email verification_backend_rejected user_id=%s transport=%s",
                user.pk,
                transport,
            )
            detail = (
                non_inbox_send_detail()
                if transport in {"console", "dummy", "locmem", "file"}
                else "We couldn't send the verification email right now. Please try again."
            )
            return Response(
                {"detail": detail, "transport": transport},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        logger.info("auth_email verification_accepted user_id=%s transport=%s", user.pk, email_transport_label())
        return Response(
            {
                "detail": "Verification email sent.",
                "transport": email_transport_label(),
            }
        )


class StrictForgotPasswordView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = []

    def get_throttles(self):
        from core.throttles import AuthEmailAnonThrottle

        return [AuthEmailAnonThrottle()]

    def post(self, request):
        from core.email_identity import find_users_by_email, normalize_email
        from core.mail import NEUTRAL_PASSWORD_RESET_DETAIL, email_transport_label, non_inbox_send_detail, send_password_reset_email

        serializer = ForgotPasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = normalize_email(serializer.validated_data["email"])
        user = find_users_by_email(email).first()

        # Log only match state/user id; never log the submitted address or token.
        transport = email_transport_label()
        logger.info(
            "auth_email password_reset_lookup matched=%s user_id=%s transport=%s",
            user is not None,
            user.pk if user is not None else None,
            transport,
        )

        # Keep unknown addresses neutral so the endpoint cannot enumerate users.
        if user is None:
            return Response({"detail": NEUTRAL_PASSWORD_RESET_DETAIL, "transport": transport})

        canonical_email = normalize_email(getattr(user, "email", ""))
        if canonical_email and getattr(user, "email", "") != canonical_email:
            user.email = canonical_email
            user.save(update_fields=["email"])
            logger.info("auth_email password_reset_recipient_normalized user_id=%s", user.pk)

        try:
            sent = send_password_reset_email(user)
        except Exception:
            logger.exception("auth_email password_reset_delivery_failed user_id=%s", user.pk)
            return Response(
                {
                    "detail": "We couldn't send the password reset email right now. Please try again."
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        if sent is not True:
            transport = email_transport_label()
            logger.error(
                "auth_email password_reset_backend_rejected user_id=%s transport=%s",
                user.pk,
                transport,
            )
            detail = (
                non_inbox_send_detail()
                if transport in {"console", "dummy", "locmem", "file"}
                else "We couldn't send the password reset email right now. Please try again."
            )
            return Response(
                {"detail": detail, "transport": transport},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        logger.info(
            "auth_email password_reset_accepted user_id=%s transport=%s",
            user.pk,
            email_transport_label(),
        )
        return Response(
            {"detail": NEUTRAL_PASSWORD_RESET_DETAIL, "transport": email_transport_label()}
        )
