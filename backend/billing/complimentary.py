"""Production-safe complimentary Premium for selected beta testers.

Admin-owned on UserProfile. Does not modify Stripe customer/subscription IDs
or BillingSubscription status. Distinct from development-only plan_override.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from django.core.exceptions import ObjectDoesNotExist
from django.utils import timezone


def complimentary_premium_expires_at(user) -> datetime | None:
    """Return the stored complimentary expiration, or None if unset/unavailable."""
    if user is None:
        return None
    try:
        profile = user.profile
    except (ObjectDoesNotExist, AttributeError):
        return None
    until = getattr(profile, "complimentary_premium_until", None)
    return until if isinstance(until, datetime) else None


def has_complimentary_premium(user) -> bool:
    """True when complimentary_premium_until is a timestamp strictly in the future."""
    until = complimentary_premium_expires_at(user)
    if until is None:
        return False
    if timezone.is_naive(until):
        until = timezone.make_aware(until, timezone.utc)
    return until > timezone.now()


def complimentary_status_fields(user) -> dict[str, Any]:
    """Authenticated billing-status fields for complimentary Premium."""
    until = complimentary_premium_expires_at(user)
    return {
        "complimentary_premium": has_complimentary_premium(user),
        "complimentary_premium_until": until.isoformat() if until else None,
    }


def set_complimentary_premium_until(user, until: datetime) -> datetime:
    """Set complimentary Premium expiration. Does not touch Stripe billing rows."""
    from core.utils import get_user_profile

    if user is None or not getattr(user, "pk", None):
        raise ValueError("User is required.")
    if until is None:
        raise ValueError("Complimentary Premium expiration is required.")
    aware = until
    if timezone.is_naive(aware):
        aware = timezone.make_aware(aware, timezone.utc)
    if aware <= timezone.now():
        raise ValueError("Complimentary Premium expiration must be in the future.")
    profile = get_user_profile(user)
    profile.complimentary_premium_until = aware
    profile.save(update_fields=["complimentary_premium_until", "updated_at"])
    user.profile = profile
    user._profile = profile
    return aware
