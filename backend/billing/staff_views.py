"""Staff-only complimentary Premium invitation management."""
from django.contrib.auth import get_user_model
from django.shortcuts import get_object_or_404
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from billing.complimentary import set_complimentary_premium_until
from billing.invitations import (
    InvitationError,
    create_invitation,
    invitation_staff_payload,
    list_invitations_for_staff,
    resend_invitation,
    revoke_invitation,
)
from billing.models import BillingSubscription, ComplimentaryPremiumInvitation
from billing.permissions import IsStaffUser

User = get_user_model()


class InvitationCreateSerializer(serializers.Serializer):
    email = serializers.EmailField()
    complimentary_premium_until = serializers.DateTimeField()
    expires_at = serializers.DateTimeField(required=False, allow_null=True)


class ComplimentaryUntilSerializer(serializers.Serializer):
    complimentary_premium_until = serializers.DateTimeField()


def _invitation_error_response(exc: InvitationError) -> Response:
    http_status = status.HTTP_400_BAD_REQUEST
    if exc.code in {"accepted", "revoked"}:
        http_status = status.HTTP_409_CONFLICT
    return Response({"code": exc.code, "detail": exc.detail}, status=http_status)


class StaffBetaTesterInvitationListCreateView(APIView):
    permission_classes = [IsAuthenticated, IsStaffUser]

    def get(self, request):
        search = request.query_params.get("q") or request.query_params.get("search") or ""
        status_filter = request.query_params.get("status") or ""
        rows = [
            invitation_staff_payload(invite)
            for invite in list_invitations_for_staff(search=search, status=status_filter)
        ]
        return Response({"count": len(rows), "results": rows})

    def post(self, request):
        serializer = InvitationCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            invite, _raw = create_invitation(
                email=serializer.validated_data["email"],
                complimentary_premium_until=serializer.validated_data["complimentary_premium_until"],
                expires_at=serializer.validated_data.get("expires_at"),
                created_by=request.user,
                send_email=True,
            )
        except InvitationError as exc:
            return _invitation_error_response(exc)
        payload = invitation_staff_payload(invite)
        payload["detail"] = f"Beta invitation sent to {invite.email}."
        return Response(payload, status=status.HTTP_201_CREATED)


class StaffBetaTesterInvitationResendView(APIView):
    permission_classes = [IsAuthenticated, IsStaffUser]

    def post(self, request, invitation_id: int):
        invite = get_object_or_404(ComplimentaryPremiumInvitation, pk=invitation_id)
        try:
            resend_invitation(invite, created_by=request.user)
        except InvitationError as exc:
            return _invitation_error_response(exc)
        invite.refresh_from_db()
        payload = invitation_staff_payload(invite)
        payload["detail"] = f"Invitation resent to {invite.email}."
        return Response(payload)


class StaffBetaTesterInvitationRevokeView(APIView):
    permission_classes = [IsAuthenticated, IsStaffUser]

    def post(self, request, invitation_id: int):
        invite = get_object_or_404(ComplimentaryPremiumInvitation, pk=invitation_id)
        try:
            revoke_invitation(invite)
        except InvitationError as exc:
            return _invitation_error_response(exc)
        invite.refresh_from_db()
        payload = invitation_staff_payload(invite)
        payload["detail"] = "Invitation revoked."
        return Response(payload)


class StaffComplimentaryPremiumView(APIView):
    permission_classes = [IsAuthenticated, IsStaffUser]

    def patch(self, request, user_id: int):
        user = get_object_or_404(User, pk=user_id)
        serializer = ComplimentaryUntilSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            until = set_complimentary_premium_until(
                user, serializer.validated_data["complimentary_premium_until"]
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        ComplimentaryPremiumInvitation.objects.filter(
            accepted_by=user, accepted_at__isnull=False
        ).update(complimentary_premium_until=until)
        billing = BillingSubscription.objects.filter(user=user).first()
        return Response(
            {
                "user_id": user.pk,
                "complimentary_premium_until": until.isoformat(),
                "has_billing_row": billing is not None,
            }
        )
