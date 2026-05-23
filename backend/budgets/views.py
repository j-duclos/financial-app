from rest_framework.viewsets import ModelViewSet
from core.utils import get_households_for_user
from core.permissions import IsHouseholdMember
from .models import Budget
from .serializers import BudgetSerializer


class BudgetViewSet(ModelViewSet):
    serializer_class = BudgetSerializer
    permission_classes = [IsHouseholdMember]
    filterset_fields = ["household", "year", "month"]

    def get_queryset(self):
        households = get_households_for_user(self.request.user)
        return Budget.objects.filter(household__in=households).select_related("household", "category")
