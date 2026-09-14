"""Email identity helpers.

New registrations require a non-blank, case-insensitively unique email.
Existing development users may still have blank, duplicate, mixed-case, or
whitespace-padded emails, so lookups normalize both the submitted value and the
stored database value.
"""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.db.models.functions import Lower, Trim
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


def _users_with_normalized_email(normalized_email: str):
    """Match email after trimming and lower-casing the stored DB value too.

    Older/dev rows may contain leading/trailing whitespace. ``email__iexact``
    does not repair that, which can make password recovery silently miss a
    perfectly valid account even though sending mail directly to that user
    works. Keep this normalization at query time so old rows remain recoverable.
    """
    email = normalize_email(normalized_email)
    if not email:
        return User.objects.none()
    return (
        User.objects.annotate(_normalized_email=Lower(Trim("email")))
        .filter(_normalized_email=email)
        .order_by("id")
    )


def email_taken(normalized_email: str, *, exclude_user_id: int | None = None) -> bool:
    if not normalize_email(normalized_email):
        return False
    qs = _users_with_normalized_email(normalized_email)
    if exclude_user_id is not None:
        qs = qs.exclude(pk=exclude_user_id)
    return qs.exists()


def find_users_by_email(normalized_email: str):
    return _users_with_normalized_email(normalized_email)


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
    user.email = normalize_email(normalized_email)
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
