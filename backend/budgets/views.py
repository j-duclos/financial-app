from datetime import date

from rest_framework import status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from core.permissions import IsHouseholdMember
from core.utils import get_households_for_user

from .models import Budget, SpendingTarget
from .serializers import (
    BudgetSerializer,
    SpendingTargetSerializer,
    SpendingTargetWriteSerializer,
)
from categories.models import Category

from .services.spending_targets import spending_targets_summary, suggest_target_type


class BudgetViewSet(ModelViewSet):
    serializer_class = BudgetSerializer
    permission_classes = [IsHouseholdMember]
    filterset_fields = ["household", "year", "month"]

    def get_queryset(self):
        households = get_households_for_user(self.request.user)
        return Budget.objects.filter(household__in=households).select_related(
            "household", "category"
        )


class SpendingTargetViewSet(ModelViewSet):
    permission_classes = [IsHouseholdMember]
    filterset_fields = ["household", "period", "active", "category"]

    def get_serializer_class(self):
        if self.action in ("create", "update", "partial_update"):
            return SpendingTargetWriteSerializer
        return SpendingTargetSerializer

    def get_queryset(self):
        households = get_households_for_user(self.request.user)
        return SpendingTarget.objects.filter(household__in=households).select_related(
            "household", "category", "account"
        )

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx["request"] = self.request
        return ctx

    @action(detail=False, methods=["get"], url_path="summary")
    def summary(self, request):
        anchor_str = request.query_params.get("anchor")
        household_id = request.query_params.get("household")
        include_scheduled = (
            request.query_params.get("include_scheduled", "true").lower() != "false"
            and request.query_params.get("include_forecast", "true").lower() != "false"
        )
        anchor = None
        if anchor_str:
            try:
                anchor = date.fromisoformat(anchor_str[:10])
            except ValueError:
                return Response(
                    {"detail": "anchor must be YYYY-MM-DD."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        hid = int(household_id) if household_id else None
        data = spending_targets_summary(
            request.user,
            anchor=anchor,
            household_id=hid,
            include_scheduled=include_scheduled,
        )
        return Response(data)

    @action(detail=False, methods=["get"], url_path="suggest-type")
    def suggest_type(self, request):
        category_id = request.query_params.get("category")
        if not category_id:
            return Response(
                {"detail": "category query parameter is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        households = get_households_for_user(request.user)
        try:
            category = Category.objects.get(
                pk=int(category_id), household__in=households
            )
        except (Category.DoesNotExist, ValueError):
            return Response(
                {"detail": "Category not found."},
                status=status.HTTP_404_NOT_FOUND,
            )
        if category.category_type != Category.CategoryType.EXPENSE:
            return Response(
                {"detail": "Category must be an expense category."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(suggest_target_type(category))
