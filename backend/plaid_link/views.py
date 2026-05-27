from plaid import ApiException
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.permissions import IsHouseholdMember
from core.utils import get_households_for_user, get_user_profile

from .models import PlaidItem
from .plaid_api_client import plaid_api_env, plaid_configured, plaid_credential_diagnostics
from .plaid_errors import format_plaid_api_exception
from .serializers import (
    PlaidExchangeRequestSerializer,
    PlaidItemSerializer,
    PlaidLinkTokenRequestSerializer,
)
from .services import (
    create_link_token,
    exchange_public_token,
    remove_plaid_item_from_plaid,
    resolve_plaid_link_redirect_uri,
    sync_transactions_for_item,
)


class PlaidLinkTokenView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        ser = PlaidLinkTokenRequestSerializer(data=request.data, context={"request": request})
        ser.is_valid(raise_exception=True)
        if not plaid_configured():
            return Response(
                {
                    "detail": "Plaid is not configured. Set PLAID_CLIENT_ID and a secret for this "
                    "environment (PLAID_SECRET, or PLAID_SANDBOX_SECRET when PLAID_ENV=sandbox).",
                    "plaid_env": plaid_api_env(),
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        hid = ser.validated_data["household_id"]
        body_phone = (ser.validated_data.get("phone_number") or "").strip()
        profile = get_user_profile(request.user)
        profile_phone = (getattr(profile, "phone_e164", None) or "").strip()
        phone_final = body_phone or profile_phone or None
        email_final = (request.user.email or "").strip() or None
        rid = (ser.validated_data.get("redirect_uri") or "").strip()
        try:
            link_token = create_link_token(
                client_user_id=f"user-{request.user.pk}-hh-{hid}",
                phone_number=phone_final,
                email_address=email_final,
                link_redirect_uri=rid or None,
            )
        except ApiException as e:
            attempted = resolve_plaid_link_redirect_uri(rid or None)
            payload = format_plaid_api_exception(
                e,
                plaid_env=plaid_api_env(),
                redirect_uri_attempted=attempted,
            )
            if attempted:
                payload["redirect_uri_sent"] = attempted
            return Response(payload, status=status.HTTP_400_BAD_REQUEST)
        except RuntimeError as e:
            return Response({"detail": str(e)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        return Response({"link_token": link_token})


class PlaidExchangeView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        ser = PlaidExchangeRequestSerializer(data=request.data, context={"request": request})
        ser.is_valid(raise_exception=True)
        if not plaid_configured():
            return Response(
                {
                    "detail": "Plaid is not configured. Set PLAID_CLIENT_ID and a secret for this "
                    "environment (see PLAID_SANDBOX_SECRET / PLAID_SECRET).",
                    "plaid_env": plaid_api_env(),
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        try:
            item = exchange_public_token(
                public_token=ser.validated_data["public_token"],
                household_id=ser.validated_data["household_id"],
            )
        except ApiException as e:
            payload = format_plaid_api_exception(e, plaid_env=plaid_api_env())
            return Response(payload, status=status.HTTP_400_BAD_REQUEST)
        except RuntimeError as e:
            return Response({"detail": str(e)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        out = PlaidItemSerializer(item, context={"request": request})
        return Response(out.data, status=status.HTTP_201_CREATED)


class PlaidItemViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """List / retrieve / delete linked Plaid items; POST …/sync/ to import transactions."""

    permission_classes = [IsAuthenticated, IsHouseholdMember]
    serializer_class = PlaidItemSerializer

    def get_queryset(self):
        households = get_households_for_user(self.request.user)
        qs = PlaidItem.objects.filter(household__in=households).prefetch_related("linked_accounts__account")
        hid = self.request.query_params.get("household")
        if hid:
            qs = qs.filter(household_id=hid)
        return qs

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        remove_plaid_item_from_plaid(instance)
        self.perform_destroy(instance)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"], url_path="reset-sync-cursor")
    def reset_sync_cursor(self, request, pk=None):
        """
        Clear the stored Plaid ``transactions/sync`` cursor for this login.

        Use when local transactions were removed but Plaid still thinks you are \"caught up\" —
        the next Import will request history from the beginning again (Plaid may return many pages).
        """
        item = self.get_object()
        item.transactions_cursor = ""
        item.save(update_fields=["transactions_cursor", "updated_at"])
        return Response(
            {
                "detail": "Sync cursor cleared. Run Import transactions to reload from Plaid.",
            }
        )

    @action(detail=True, methods=["post"], url_path="sync")
    def sync(self, request, pk=None):
        item = self.get_object()
        if not plaid_configured():
            return Response(
                {
                    "detail": (
                        "Plaid is not configured on this server. Set PLAID_CLIENT_ID and a secret for "
                        f"PLAID_ENV={plaid_api_env()!r} in backend/.env, then restart the backend. "
                        "Existing bank logins in the database still need live API credentials to sync."
                    ),
                    "plaid_env": plaid_api_env(),
                    "plaid_diagnostics": plaid_credential_diagnostics(),
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        try:
            counts = sync_transactions_for_item(item)
        except ApiException as e:
            payload = format_plaid_api_exception(e, plaid_env=plaid_api_env())
            return Response(payload, status=status.HTTP_400_BAD_REQUEST)
        return Response(counts)


class PlaidMetaView(APIView):
    """Non-secret Plaid context for the web UI (Chase / OAuth troubleshooting)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(
            {
                "plaid_env": plaid_api_env(),
                "plaid_configured": plaid_configured(),
                "oauth_institutions_url": "https://dashboard.plaid.com/settings/compliance/us-oauth-institutions",
                "oauth_institution_status_url": "https://dashboard.plaid.com/activity/status/oauth-institutions",
                "plaid_dashboard_home": "https://dashboard.plaid.com/",
                "redirect_uris_url": "https://dashboard.plaid.com/developers/api",
                "troubleshooting_url": "https://plaid.com/docs/link/troubleshooting/",
            }
        )
