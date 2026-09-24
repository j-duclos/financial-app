import logging

from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from billing.exceptions import BillingConfigurationError
from billing.services import (
    BillingConflictError,
    create_customer_portal_session,
    create_premium_checkout_session,
    get_billing_status_payload,
)
from billing.stripe_api import construct_webhook_event, signature_error_types
from billing.webhooks import HANDLED_EVENT_TYPES, event_id_and_type, process_stripe_event

logger = logging.getLogger(__name__)


def _billing_error_response(exc: BillingConfigurationError) -> Response:
    message = str(exc)
    code = status.HTTP_400_BAD_REQUEST
    lowered = message.lower()
    if "not configured" in lowered or "cannot determine frontend origin" in lowered:
        code = status.HTTP_503_SERVICE_UNAVAILABLE
    return Response({"detail": message}, status=code)


class BillingStatusView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(get_billing_status_payload(request.user))


class ComplimentaryInvitationPreviewView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = []

    def get_throttles(self):
        from core.throttles import InvitationAnonThrottle

        return [InvitationAnonThrottle()]

    def get(self, request):
        from billing.invitations import preview_invitation

        token = (request.query_params.get("token") or "").strip()
        payload = preview_invitation(token)
        return Response(payload)


class ComplimentaryInvitationAcceptView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = []

    def get_throttles(self):
        from core.throttles import InvitationUserThrottle

        return [InvitationUserThrottle()]

    def post(self, request):
        from billing.invitations import InvitationError, accept_invitation
        from billing.services import get_billing_status_payload

        token = ""
        if isinstance(request.data, dict):
            token = str(request.data.get("token") or "").strip()
        try:
            invite = accept_invitation(request.user, token)
        except InvitationError as exc:
            http_status = status.HTTP_400_BAD_REQUEST
            if exc.code == "email_mismatch":
                http_status = status.HTTP_403_FORBIDDEN
            elif exc.code == "email_verification_required":
                http_status = status.HTTP_403_FORBIDDEN
            return Response({"code": exc.code, "detail": exc.detail}, status=http_status)
        billing = get_billing_status_payload(request.user)
        return Response(
            {
                "status": "accepted",
                "complimentary_premium_until": invite.complimentary_premium_until.isoformat(),
                "plan": billing["plan"],
                "is_premium": billing["is_premium"],
                "entitlements": billing.get("entitlements"),
            }
        )


class CreateCheckoutSessionView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        from core.email_identity import is_email_verified

        if not is_email_verified(request.user):
            return Response(
                {
                    "code": "email_verification_required",
                    "detail": "Verify your email before subscribing.",
                },
                status=status.HTTP_403_FORBIDDEN,
            )
        # Price IDs and user IDs from the client are ignored. The authenticated
        # user and STRIPE_PREMIUM_PRICE_ID are the only inputs that matter.
        try:
            payload = create_premium_checkout_session(request.user)
        except BillingConflictError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)
        except BillingConfigurationError as exc:
            return _billing_error_response(exc)
        except Exception:
            logger.exception("create-checkout-session failed")
            return Response(
                {"detail": "Billing is temporarily unavailable. Please try again later."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        return Response(payload, status=status.HTTP_200_OK)


class CreatePortalSessionView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        try:
            payload = create_customer_portal_session(request.user)
        except BillingConfigurationError as exc:
            return _billing_error_response(exc)
        return Response(payload, status=status.HTTP_200_OK)


class StripeWebhookView(APIView):
    """Stripe server-to-server webhook. JWT is not used; signature is required."""

    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        signature = request.META.get("HTTP_STRIPE_SIGNATURE", "")
        if not signature:
            return Response(
                {"detail": "Missing Stripe-Signature header."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            event = construct_webhook_event(request.body, signature)
        except signature_error_types():
            return Response(
                {"detail": "Invalid Stripe signature."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except BillingConfigurationError as exc:
            return _billing_error_response(exc)
        except ValueError:
            return Response(
                {"detail": "Invalid Stripe payload."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        _event_id, event_type = event_id_and_type(event)
        if event_type not in HANDLED_EVENT_TYPES:
            return Response({"status": "ignored"})

        try:
            result = process_stripe_event(event)
        except Exception:
            logger.exception("Stripe webhook processing failed")
            return Response(
                {"detail": "Webhook processing failed."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
        return Response({"status": result})
