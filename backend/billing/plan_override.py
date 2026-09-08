"""Development-only plan simulation.

Stripe subscription state remains authoritative in production. This module
never creates Stripe customers, Checkout sessions, webhooks, or
BillingSubscription rows.
"""
from __future__ import annotations

from typing import Any

from django.conf import settings
from django.core.exceptions import ObjectDoesNotExist

from billing.models import BillingSubscription

PLAN_FREE = BillingSubscription.Plan.FREE
PLAN_PREMIUM = BillingSubscription.Plan.PREMIUM
ALLOWED_OVERRIDE_PLANS = frozenset({PLAN_FREE, PLAN_PREMIUM})


def plan_test_override_enabled() -> bool:
    """True only for local DEBUG with the explicit allow flag, never on Render."""
    if getattr(settings, "ON_RENDER", False):
        return False
    if not bool(getattr(settings, "DEBUG", False)):
        return False
    return bool(getattr(settings, "ALLOW_PLAN_TEST_OVERRIDE", False))


def get_stored_test_plan_override(user) -> str | None:
    """Return the stored FREE/PREMIUM override, or None. Does not check flags."""
    if user is None:
        return None
    try:
        profile = user.profile
    except (ObjectDoesNotExist, AttributeError):
        return None
    value = (getattr(profile, "test_plan_override", None) or "").strip().upper()
    if value in ALLOWED_OVERRIDE_PLANS:
        return value
    return None


def active_test_plan_override(user) -> str | None:
    """Return the override only when development override functionality is enabled."""
    if not plan_test_override_enabled():
        return None
    return get_stored_test_plan_override(user)


def set_own_test_plan_override(user, plan: str | None) -> str | None:
    """Set the authenticated user's own override. Does not touch Stripe or billing rows."""
    from core.utils import get_user_profile

    if plan is not None:
        plan = str(plan).strip().upper()
        if plan not in ALLOWED_OVERRIDE_PLANS:
            raise ValueError("plan must be FREE, PREMIUM, or null.")
    else:
        plan = None

    profile = get_user_profile(user)
    profile.test_plan_override = plan
    profile.save(update_fields=["test_plan_override", "updated_at"])
    user._profile = profile
    user.profile = profile
    return plan


def test_override_status_fields(user, *, effective_plan: str) -> dict[str, Any]:
    """Dev-only billing payload fields. Empty when override capability is disabled."""
    if not plan_test_override_enabled():
        return {}
    return {
        "test_override_available": True,
        "test_plan_override": get_stored_test_plan_override(user),
        "effective_plan": effective_plan,
    }
