"""Object-level permission: user must be a member of the household that owns the resource."""
from rest_framework.permissions import BasePermission

from core.models import HouseholdMembership


def get_household_from_obj(obj):
    """Resolve household from an object (account, transaction, category, budget, etc.)."""
    if hasattr(obj, "household"):
        return obj.household
    if hasattr(obj, "account"):
        return obj.account.household if hasattr(obj.account, "household") else None
    if hasattr(obj, "category"):
        return obj.category.household if hasattr(obj.category, "household") else None
    if hasattr(obj, "statement_txn"):
        return getattr(obj.statement_txn, "household", None)
    if hasattr(obj, "scenario"):
        return getattr(obj.scenario, "household", None)
    if hasattr(obj, "rule"):
        return getattr(obj.rule, "household", None)
    return None


class IsHouseholdMember(BasePermission):
    """User must be a member of the household that owns the object."""

    def has_object_permission(self, request, view, obj):
        if not request.user or not request.user.is_authenticated:
            return False
        household = get_household_from_obj(obj)
        if not household:
            return False
        return HouseholdMembership.objects.filter(
            household=household, user=request.user
        ).exists()
