from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from alerts.models import ProjectedFundsAlert, PushDevice
from alerts.serializers import ProjectedFundsAlertSerializer, PushDeviceSerializer
from alerts.services.evaluate import ensure_household_alerts_fresh
from core.permissions import IsHouseholdMember
from core.utils import get_households_for_user, get_user_profile


class ProjectedFundsAlertViewSet(ModelViewSet):
    serializer_class = ProjectedFundsAlertSerializer
    permission_classes = [IsAuthenticated, IsHouseholdMember]
    http_method_names = ["get", "head", "options", "patch"]

    def get_queryset(self):
        households = list(get_households_for_user(self.request.user))
        for household in households:
            ensure_household_alerts_fresh(household.pk)
        qs = (
            ProjectedFundsAlert.objects.filter(household__in=households)
            .select_related("account", "household", "transaction", "rule")
            .order_by("occurrence_date", "id")
        )
        profile = get_user_profile(self.request.user)
        if profile is not None and not getattr(profile, "projected_funds_alerts_enabled", True):
            return qs.none()
        active = (self.request.query_params.get("active") or "").lower()
        if active in ("1", "true", "yes"):
            qs = qs.filter(resolved_at__isnull=True, dismissed_at__isnull=True)
        unread = (self.request.query_params.get("unread") or "").lower()
        if unread in ("1", "true", "yes"):
            qs = qs.filter(read_at__isnull=True, resolved_at__isnull=True, dismissed_at__isnull=True)
        return qs

    def partial_update(self, request, *args, **kwargs):
        instance = self.get_object()
        now = timezone.now()
        update_fields = []
        if "dismissed" in request.data:
            if request.data.get("dismissed") in (True, "true", "1", 1):
                instance.dismissed_at = instance.dismissed_at or now
            else:
                instance.dismissed_at = None
            update_fields.append("dismissed_at")
        if "read" in request.data or "read_at" in request.data:
            if request.data.get("read") is False:
                instance.read_at = None
            else:
                instance.read_at = instance.read_at or now
            update_fields.append("read_at")
        if update_fields:
            instance.save(update_fields=update_fields)
        return Response(self.get_serializer(instance).data)


class PushDeviceViewSet(ModelViewSet):
    serializer_class = PushDeviceSerializer
    permission_classes = [IsAuthenticated]
    http_method_names = ["get", "post", "delete", "head", "options"]

    def get_queryset(self):
        return PushDevice.objects.filter(user=self.request.user).order_by("-last_seen_at")

    def create(self, request, *args, **kwargs):
        token = (request.data.get("expo_push_token") or "").strip()
        existing = PushDevice.objects.filter(expo_push_token=token).first()
        serializer = self.get_serializer(existing, data=request.data, partial=bool(existing))
        serializer.is_valid(raise_exception=True)
        if existing is not None:
            existing.user = request.user
            existing.platform = serializer.validated_data.get("platform", existing.platform)
            existing.device_id = serializer.validated_data.get("device_id", existing.device_id)
            existing.enabled = serializer.validated_data.get("enabled", True)
            existing.save(
                update_fields=["user", "platform", "device_id", "enabled", "last_seen_at"]
            )
            return Response(self.get_serializer(existing).data, status=status.HTTP_201_CREATED)
        serializer.save(user=request.user)
        return Response(self.get_serializer(serializer.instance).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["post"], url_path="unregister")
    def unregister(self, request):
        token = (request.data.get("expo_push_token") or "").strip()
        if not token:
            return Response({"detail": "expo_push_token is required."}, status=400)
        deleted, _ = PushDevice.objects.filter(user=request.user, expo_push_token=token).delete()
        return Response({"deleted": deleted})
