"""Helpers for core app."""
from django.db import transaction

from core.models import Household, HouseholdMembership, UserProfile


def user_profile_create_defaults() -> dict:
    """Python defaults for NOT NULL UserProfile columns (get_or_create does not always apply them)."""
    skip = {"id", "user"}
    defaults = {}
    for field in UserProfile._meta.concrete_fields:
        if field.name in skip or field.primary_key:
            continue
        if getattr(field, "auto_now", False) or getattr(field, "auto_now_add", False):
            continue
        if field.has_default():
            defaults[field.name] = field.get_default()
    return defaults


def get_user_profile(user):
    """Return UserProfile for the user; create one if missing."""
    if not user or not user.is_authenticated:
        return None
    profile = getattr(user, "_profile", None)
    if profile is None:
        profile, _ = UserProfile.objects.get_or_create(
            user=user,
            defaults=user_profile_create_defaults(),
        )
        user._profile = profile
    return profile


def get_households_for_user(user):
    """Return queryset of households the user is a member of."""
    if not user or not user.is_authenticated:
        return Household.objects.none()
    return Household.objects.filter(memberships__user=user).distinct()


def _personal_household_name(user) -> str:
    username = (getattr(user, "username", "") or "My").strip() or "My"
    name = f"{username}'s household"
    return name[:255]


def ensure_default_household(user):
    """Idempotent personal-household provisioning.

    - No household: create one and set it as default.
    - Exactly one household and no default: set that household as default.
    - Multiple households and no default: do not pick one.
    - Existing valid default: leave it unchanged (no duplicates).
    """
    profile = get_user_profile(user)
    if profile is None:
        return None

    households = list(get_households_for_user(user).order_by("id"))
    if profile.default_household_id:
        if any(h.id == profile.default_household_id for h in households):
            return profile.default_household
        profile.default_household = None
        profile.save(update_fields=["default_household", "updated_at"])
        user._profile = profile
        households = list(get_households_for_user(user).order_by("id"))

    if len(households) > 1:
        return None

    if len(households) == 1:
        household = households[0]
        if profile.default_household_id != household.id:
            profile.default_household = household
            profile.save(update_fields=["default_household", "updated_at"])
            user._profile = profile
        return household

    with transaction.atomic():
        profile = (
            UserProfile.objects.select_for_update()
            .select_related("default_household")
            .get(pk=profile.pk)
        )
        households = list(get_households_for_user(user).order_by("id"))
        if profile.default_household_id and any(
            h.id == profile.default_household_id for h in households
        ):
            user._profile = profile
            return profile.default_household
        if len(households) > 1:
            user._profile = profile
            return None
        if len(households) == 1:
            household = households[0]
        else:
            household = Household.objects.create(name=_personal_household_name(user))
            HouseholdMembership.objects.create(
                household=household,
                user=user,
                role=HouseholdMembership.Role.OWNER,
            )
        if profile.default_household_id != household.id:
            profile.default_household = household
            profile.save(update_fields=["default_household", "updated_at"])
        user._profile = profile
        return household
