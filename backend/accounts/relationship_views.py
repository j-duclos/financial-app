from django.db.models import Q
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from core.permissions import IsHouseholdMember
from core.utils import get_households_for_user

from .relationship_models import AccountRelationship
from .relationship_serializers import AccountRelationshipSerializer
from .services.relationships import (
    deactivate_relationship,
    relationship_has_historical_transfers,
)


class AccountRelationshipViewSet(ModelViewSet):
    serializer_class = AccountRelationshipSerializer
    permission_classes = [IsHouseholdMember]

    def get_queryset(self):
        households = get_households_for_user(self.request.user)
        qs = AccountRelationship.objects.filter(household__in=households).select_related(
            "source_account", "destination_account",
        )
        household_id = self.request.query_params.get("household")
        if household_id:
            qs = qs.filter(household_id=household_id)
        account_id = self.request.query_params.get("account")
        if account_id:
            qs = qs.filter(
                Q(source_account_id=account_id) | Q(destination_account_id=account_id)
            )
        active = self.request.query_params.get("is_active")
        if active is not None:
            qs = qs.filter(is_active=active.lower() in ("true", "1", "yes"))
        return qs.order_by("-updated_at")

    def perform_destroy(self, instance):
        if relationship_has_historical_transfers(instance):
            deactivate_relationship(instance)
        else:
            instance.delete()

    @action(detail=True, methods=["post"])
    def deactivate(self, request, pk=None):
        rel = self.get_object()
        deactivate_relationship(rel)
        rel.refresh_from_db()
        return Response(self.get_serializer(rel).data)
