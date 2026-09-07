"""User-scoped snooze/dismiss presentation state for recommendations."""

from __future__ import annotations

from datetime import timedelta

from django.utils import timezone
from rest_framework.exceptions import ValidationError

from recommendations.models import RecommendationPreference

SURVIVAL_MODE_ID = "survival-mode"
SNOOZE_DAYS = 7


def is_survival_mode_id(recommendation_id: str) -> bool:
    return recommendation_id == SURVIVAL_MODE_ID


def prune_expired_preferences(user) -> None:
    RecommendationPreference.objects.filter(
        user=user,
        state=RecommendationPreference.State.SNOOZED,
        snoozed_until__lte=timezone.now(),
    ).delete()


def preferences_payload(user) -> dict[str, list[str]]:
    prune_expired_preferences(user)
    dismissed: list[str] = []
    snoozed: list[str] = []
    for pref in RecommendationPreference.objects.filter(user=user).only(
        "recommendation_id", "state"
    ):
        if pref.state == RecommendationPreference.State.DISMISSED:
            dismissed.append(pref.recommendation_id)
        elif pref.state == RecommendationPreference.State.SNOOZED:
            snoozed.append(pref.recommendation_id)
    return {"dismissed": dismissed, "snoozed": snoozed}


def _require_mutable(recommendation_id: str) -> None:
    if is_survival_mode_id(recommendation_id):
        raise ValidationError("Survival Mode cannot be snoozed or dismissed.")


def _upsert(user, recommendation_id: str, **fields) -> RecommendationPreference:
    pref, _created = RecommendationPreference.objects.update_or_create(
        user=user,
        recommendation_id=recommendation_id,
        defaults=fields,
    )
    return pref


def snooze_recommendation(user, recommendation_id: str) -> dict[str, list[str]]:
    _require_mutable(recommendation_id)
    until = timezone.now() + timedelta(days=SNOOZE_DAYS)
    _upsert(
        user,
        recommendation_id,
        state=RecommendationPreference.State.SNOOZED,
        snoozed_until=until,
    )
    return preferences_payload(user)


def dismiss_recommendation(user, recommendation_id: str) -> dict[str, list[str]]:
    _require_mutable(recommendation_id)
    _upsert(
        user,
        recommendation_id,
        state=RecommendationPreference.State.DISMISSED,
        snoozed_until=None,
    )
    return preferences_payload(user)


def restore_recommendation(user, recommendation_id: str) -> dict[str, list[str]]:
    RecommendationPreference.objects.filter(
        user=user,
        recommendation_id=recommendation_id,
        state=RecommendationPreference.State.DISMISSED,
    ).delete()
    return preferences_payload(user)


def unsnooze_recommendation(user, recommendation_id: str) -> dict[str, list[str]]:
    RecommendationPreference.objects.filter(
        user=user,
        recommendation_id=recommendation_id,
        state=RecommendationPreference.State.SNOOZED,
    ).delete()
    return preferences_payload(user)
