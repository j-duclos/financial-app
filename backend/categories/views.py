from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import OrderingFilter
from rest_framework.viewsets import ModelViewSet

from core.utils import get_households_for_user
from core.permissions import IsHouseholdMember

from .models import Category
from .serializers import CategorySerializer
from .pagination import CategoryPagination


class CategoryViewSet(ModelViewSet):
    serializer_class = CategorySerializer
    permission_classes = [IsHouseholdMember]
    pagination_class = CategoryPagination
    filter_backends = [DjangoFilterBackend, OrderingFilter]
    filterset_fields = ["household", "category_type", "parent", "is_archived"]
    ordering_fields = ["category_type", "sort_order", "name", "created_at"]
    ordering = ["category_type", "name"]

    def get_queryset(self):
        households = get_households_for_user(self.request.user)
        qs = (
            Category.objects.filter(household__in=households)
            .select_related("household", "parent")
        )
        include_archived = self.request.query_params.get("include_archived", "").lower()
        if include_archived not in ("true", "1"):
            qs = qs.filter(is_archived=False)
        return qs

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        has_transactions = instance.transactions.exists()
        has_budgets = instance.budgets.exists()

        if has_transactions or has_budgets:
            instance.is_archived = True
            instance.save(update_fields=["is_archived", "updated_at"])
            from rest_framework.response import Response

            return Response(status=204)
        return super().destroy(request, *args, **kwargs)
