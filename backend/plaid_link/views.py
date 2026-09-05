from plaid import ApiException
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.permissions import IsHouseholdMember
from core.utils import get_households_for_user, get_user_profile

from .models import PlaidItem, PlaidLinkedAccount
from .plaid_api_client import (
    plaid_api_env,
    plaid_config_location_hint,
    plaid_configured,
    plaid_credential_diagnostics,
    plaid_env_configured_explicitly,
    plaid_env_var_presence,
    plaid_token_fernet_key_set,
    plaid_unconfigured_detail,
)
from .plaid_errors import format_plaid_api_exception
from .serializers import (
    PlaidExchangeRequestSerializer,
    PlaidItemSerializer,
    PlaidLinkTokenRequestSerializer,
)
from .crypto import PlaidTokenDecryptError, decrypt_plaid_access_token
from .liabilities import (
    sync_credit_card_liabilities_for_household,
    sync_credit_card_liabilities_for_item,
)
from .services import (
    create_link_token,
    disconnect_plaid_linked_account,
    exchange_public_token,
    remove_plaid_item_from_plaid,
    resolve_plaid_link_redirect_uri,
    should_skip_plaid_item_sync,
    sync_all_plaid_items_for_user,
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
                    "detail": plaid_unconfigured_detail(),
                    "plaid_env": plaid_api_env(),
                    "plaid_env_explicit": plaid_env_configured_explicitly(),
                    "plaid_diagnostics": plaid_credential_diagnostics(),
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        force = request.query_params.get("force", "true").lower() in ("true", "1", "yes")
        if not force and should_skip_plaid_item_sync(item, force=False):
            return Response(
                {
                    "skipped": True,
                    "reason": "recently_synced",
                    "last_sync_at": item.last_sync_at.isoformat() if item.last_sync_at else None,
                    "added": 0,
                    "modified": 0,
                    "removed": 0,
                    "merged": 0,
                }
            )
        try:
            counts = sync_transactions_for_item(item, liabilities_force=True)
        except PlaidTokenDecryptError as e:
            return Response(
                {"detail": str(e), "plaid_env": plaid_api_env()},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        except ApiException as e:
            payload = format_plaid_api_exception(e, plaid_env=plaid_api_env())
            return Response(payload, status=status.HTTP_400_BAD_REQUEST)
        return Response(counts)

    @action(detail=True, methods=["post"], url_path="sync-liabilities")
    def sync_liabilities(self, request, pk=None):
        item = self.get_object()
        if not plaid_configured():
            return Response(
                {
                    "detail": plaid_unconfigured_detail(),
                    "plaid_env": plaid_api_env(),
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        try:
            payload = sync_credit_card_liabilities_for_item(item)
        except PlaidTokenDecryptError as e:
            return Response(
                {"detail": str(e), "plaid_env": plaid_api_env()},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        return Response(payload)

    @action(detail=True, methods=["post"], url_path="link-token-update")
    def link_token_update(self, request, pk=None):
        """Create a Link token in update mode to add Liabilities consent for an existing Item."""
        item = self.get_object()
        if not plaid_configured():
            return Response(
                {
                    "detail": plaid_unconfigured_detail(),
                    "plaid_env": plaid_api_env(),
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        try:
            access_token = decrypt_plaid_access_token(item.access_token_cipher)
            link_token = create_link_token(
                client_user_id=f"user-{request.user.pk}-hh-{item.household_id}-item-{item.pk}",
                access_token=access_token,
            )
        except PlaidTokenDecryptError as e:
            return Response(
                {"detail": str(e), "plaid_env": plaid_api_env()},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        except ApiException as e:
            payload = format_plaid_api_exception(e, plaid_env=plaid_api_env())
            return Response(payload, status=status.HTTP_400_BAD_REQUEST)
        except RuntimeError as e:
            return Response({"detail": str(e)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        return Response({"link_token": link_token, "update_mode": True})


class PlaidSyncAllView(APIView):
    """
    Background-friendly import for all linked bank logins (one Plaid Item each).

    POST /api/plaid/sync-all/?household=<id>&force=false
    Auto-sync on app load uses force=false and skips logins synced within ~5 minutes.
    """

    permission_classes = [IsAuthenticated, IsHouseholdMember]

    def post(self, request):
        if not plaid_configured():
            return Response(
                {
                    "detail": plaid_unconfigured_detail(),
                    "plaid_env": plaid_api_env(),
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        household_raw = (request.query_params.get("household") or "").strip()
        household_id = int(household_raw) if household_raw.isdigit() else None
        if household_id is not None:
            households = get_households_for_user(request.user)
            if not households.filter(pk=household_id).exists():
                return Response({"detail": "Not a member of this household."}, status=status.HTTP_403_FORBIDDEN)
        force = request.query_params.get("force", "false").lower() in ("true", "1", "yes")
        try:
            payload = sync_all_plaid_items_for_user(
                request.user,
                household_id=household_id,
                force=force,
            )
        except PlaidTokenDecryptError as e:
            return Response(
                {"detail": str(e), "plaid_env": plaid_api_env()},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        return Response(payload)


class PlaidSyncLiabilitiesAllView(APIView):
    """Refresh credit-card minimums for every Item in a household (one Plaid call per Item)."""

    permission_classes = [IsAuthenticated, IsHouseholdMember]

    def post(self, request):
        if not plaid_configured():
            return Response(
                {
                    "detail": plaid_unconfigured_detail(),
                    "plaid_env": plaid_api_env(),
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        household_raw = (request.query_params.get("household") or "").strip()
        household_id = int(household_raw) if household_raw.isdigit() else None
        if household_id is None:
            return Response({"detail": "household is required."}, status=status.HTTP_400_BAD_REQUEST)
        households = get_households_for_user(request.user)
        if not households.filter(pk=household_id).exists():
            return Response({"detail": "Not a member of this household."}, status=status.HTTP_403_FORBIDDEN)
        payload = sync_credit_card_liabilities_for_household(household_id)
        return Response(payload)


class PlaidLiabilitiesWebhookView(APIView):
    """Plaid LIABILITIES / DEFAULT_UPDATE receiver. Does not invent webhook event names."""

    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        from django.conf import settings as django_settings

        if not (getattr(django_settings, "PLAID_WEBHOOK_URL", "") or "").strip():
            return Response({"detail": "Webhooks are not configured."}, status=status.HTTP_404_NOT_FOUND)
        body = request.data if isinstance(request.data, dict) else {}
        webhook_type = str(body.get("webhook_type") or "").upper()
        webhook_code = str(body.get("webhook_code") or "").upper()
        item_id = str(body.get("item_id") or "").strip()
        if webhook_type != "LIABILITIES" or webhook_code != "DEFAULT_UPDATE" or not item_id:
            return Response({"status": "ignored"})
        item = PlaidItem.objects.filter(item_id=item_id).first()
        if item is None:
            return Response({"status": "ignored"})
        try:
            sync_credit_card_liabilities_for_item(item)
        except Exception:
            return Response({"status": "accepted"})
        return Response({"status": "ok"})


class PlaidLinkedAccountDisconnectView(APIView):
    """Disconnect Plaid from a single app account (keeps the account and ledger rows)."""

    permission_classes = [IsAuthenticated]

    def post(self, request, pk: int):
        households = get_households_for_user(request.user)
        linked = (
            PlaidLinkedAccount.objects.filter(pk=pk, item__household__in=households)
            .select_related("account", "item")
            .first()
        )
        if not linked:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        account_id = linked.account_id
        disconnect_plaid_linked_account(linked)
        return Response(
            {
                "detail": "Plaid disconnected from this account. Transactions already imported are unchanged.",
                "account_id": account_id,
            }
        )


class PlaidConfigCheckView(APIView):
    """Public, non-secret Plaid config check (verify Render env vars after deploy)."""

    permission_classes = [AllowAny]

    def get(self, request):
        return Response(
            {
                "plaid_configured": plaid_configured(),
                "plaid_env": plaid_api_env(),
                "plaid_env_explicit": plaid_env_configured_explicitly(),
                "config_location_hint": plaid_config_location_hint(),
                "env_vars_set": plaid_env_var_presence(),
                "diagnostics": plaid_credential_diagnostics(),
                "plaid_token_fernet_key_set": plaid_token_fernet_key_set(),
            }
        )


class PlaidMetaView(APIView):
    """Non-secret Plaid context for the web UI (Chase / OAuth troubleshooting)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(
            {
                "plaid_env": plaid_api_env(),
                "plaid_configured": plaid_configured(),
                "plaid_token_fernet_key_set": plaid_token_fernet_key_set(),
                "oauth_institutions_url": "https://dashboard.plaid.com/settings/compliance/us-oauth-institutions",
                "oauth_institution_status_url": "https://dashboard.plaid.com/activity/status/oauth-institutions",
                "plaid_dashboard_home": "https://dashboard.plaid.com/",
                "redirect_uris_url": "https://dashboard.plaid.com/developers/api",
                "troubleshooting_url": "https://plaid.com/docs/link/troubleshooting/",
            }
        )
