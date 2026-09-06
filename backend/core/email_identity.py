"""Email identity helpers.

New registrations require a non-blank, case-insensitively unique email.
Existing development users may still have blank or duplicate emails, so
uniqueness is enforced in application code rather than a database constraint.
"""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.utils import timezone

from core.utils import get_user_profile

User = get_user_model()


def normalize_email(value: str | None) -> str:
    return (value or "").strip().lower()


def is_email_verified(user) -> bool:
    if user is None:
        return False
    email = normalize_email(getattr(user, "email", ""))
    if not email:
        return False
    from core.models import UserProfile

    verified_at = (
        UserProfile.objects.filter(user_id=user.pk)
        .values_list("email_verified_at", flat=True)
        .first()
    )
    return bool(verified_at)


def email_taken(normalized_email: str, *, exclude_user_id: int | None = None) -> bool:
    if not normalized_email:
        return False
    qs = User.objects.filter(email__iexact=normalized_email)
    if exclude_user_id is not None:
        qs = qs.exclude(pk=exclude_user_id)
    return qs.exists()


def find_users_by_email(normalized_email: str):
    if not normalized_email:
        return User.objects.none()
    return User.objects.filter(email__iexact=normalized_email).order_by("id")


def clear_email_verified(user):
    profile = get_user_profile(user)
    if profile is None:
        return None
    if profile.email_verified_at is not None:
        profile.email_verified_at = None
        profile.save(update_fields=["email_verified_at", "updated_at"])
    return profile


def assign_user_email(user, normalized_email: str):
    """Set User.email and clear verification. Caller must validate uniqueness."""
    user.email = normalized_email
    user.save(update_fields=["email"])
    clear_email_verified(user)
    return user


def mark_email_verified(user, *, when=None):
    profile = get_user_profile(user)
    if profile is None:
        return None
    stamp = when or timezone.now()
    if profile.email_verified_at is None:
        profile.email_verified_at = stamp
        profile.save(update_fields=["email_verified_at", "updated_at"])
    return profile


def mark_verification_sent(user, *, when=None):
    profile = get_user_profile(user)
    if profile is None:
        return None
    profile.email_verification_sent_at = when or timezone.now()
    profile.save(update_fields=["email_verification_sent_at", "updated_at"])
    return profile
