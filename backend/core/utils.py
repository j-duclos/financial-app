"""Helpers for core app."""
from core.models import Household, HouseholdMembership, UserProfile


def get_user_profile(user):
    """Return UserProfile for the user; create one if missing."""
    if not user or not user.is_authenticated:
        return None
    profile = getattr(user, "_profile", None)
    if profile is None:
        profile, _ = UserProfile.objects.get_or_create(user=user)
        user._profile = profile
    return profile


def get_households_for_user(user):
    """Return queryset of households the user is a member of."""
    if not user or not user.is_authenticated:
        return Household.objects.none()
    return Household.objects.filter(memberships__user=user).distinct()
