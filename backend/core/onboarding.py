"""Cheap first-run setup checks. Does not build timelines or forecasts."""

from __future__ import annotations

import logging
from dataclasses import dataclass

from django.utils import timezone

from core.utils import get_households_for_user, get_user_profile

logger = logging.getLogger(__name__)

ONBOARDING_TOTAL_STEPS = 4


def is_forecast_ready(*, has_account: bool, has_transaction: bool, has_recurring: bool) -> bool:
    """Practical readiness: an account plus activity or repeating money."""
    return bool(has_account) and (bool(has_transaction) or bool(has_recurring))


@dataclass(frozen=True)
class SetupFlags:
    has_account: bool
    has_transaction: bool
    has_recurring: bool
    has_upcoming_transaction: bool = False
    has_goal: bool = False

    @property
    def forecast_ready(self) -> bool:
        return is_forecast_ready(
            has_account=self.has_account,
            has_transaction=self.has_transaction,
            has_recurring=self.has_recurring,
        )


def setup_flags_for_user(user) -> SetupFlags:
    """Existence checks scoped to households the user belongs to."""
    household_ids = list(get_households_for_user(user).values_list("id", flat=True))
    if not household_ids:
        return SetupFlags(
            has_account=False,
            has_transaction=False,
            has_recurring=False,
            has_upcoming_transaction=False,
            has_goal=False,
        )

    from accounts.models import Account
    from goals.models import GoalBucket
    from timeline.models import RecurringRule
    from transactions.models import Transaction

    has_account = Account.objects.filter(household_id__in=household_ids).exists()
    has_transaction = False
    has_upcoming_transaction = False
    if has_account:
        txn_qs = Transaction.objects.filter(account__household_id__in=household_ids)
        has_transaction = txn_qs.exists()
        today = timezone.localdate()
        has_upcoming_transaction = (
            txn_qs.filter(date__gte=today)
            .exclude(
                source__in=[
                    Transaction.Source.RULE,
                    Transaction.Source.INTEREST,
                    Transaction.Source.SYSTEM,
                ]
            )
            .exists()
        )
    has_recurring = RecurringRule.objects.filter(household_id__in=household_ids).exists()
    has_goal = GoalBucket.objects.filter(
        household_id__in=household_ids,
        status__in=[GoalBucket.Status.ACTIVE, GoalBucket.Status.PAUSED],
    ).exists()
    return SetupFlags(
        has_account=has_account,
        has_transaction=has_transaction,
        has_recurring=has_recurring,
        has_upcoming_transaction=has_upcoming_transaction,
        has_goal=has_goal,
    )


def _maybe_auto_complete(profile, flags: SetupFlags) -> None:
    if not flags.forecast_ready or profile.onboarding_completed_at is not None:
        return
    now = timezone.now()
    updated = type(profile).objects.filter(pk=profile.pk, onboarding_completed_at__isnull=True).update(
        onboarding_completed_at=now
    )
    if updated:
        profile.onboarding_completed_at = now
        logger.info("onboarding_completed user_id=%s", profile.user_id)


def onboarding_status_payload(user, *, persist_auto_complete: bool = True) -> dict:
    profile = get_user_profile(user)
    flags = setup_flags_for_user(user)
    if persist_auto_complete and profile is not None:
        _maybe_auto_complete(profile, flags)

    completed = bool(profile and profile.onboarding_completed_at)
    dismissed = bool(profile and profile.onboarding_dismissed_at)
    steps = {
        "account": flags.has_account,
        "transaction": flags.has_transaction,
        "recurring": flags.has_recurring,
        "forecast_ready": flags.forecast_ready,
    }
    completed_steps = sum(1 for value in steps.values() if value)
    show_welcome = (not completed) and (not dismissed) and (not flags.forecast_ready)
    return {
        "completed": completed,
        "dismissed": dismissed,
        "show_welcome": show_welcome,
        "steps": steps,
        "progress": {
            "completed_steps": completed_steps,
            "total_steps": ONBOARDING_TOTAL_STEPS,
        },
        "checklist": {
            "account": flags.has_account,
            "upcoming_transaction": flags.has_upcoming_transaction,
            "recurring": flags.has_recurring,
            "goal": flags.has_goal,
        },
    }


def mark_onboarding_complete(user) -> dict:
    profile = get_user_profile(user)
    if profile is not None and profile.onboarding_completed_at is None:
        profile.onboarding_completed_at = timezone.now()
        profile.save(update_fields=["onboarding_completed_at", "updated_at"])
        logger.info("onboarding_completed user_id=%s", user.pk)
    return onboarding_status_payload(user, persist_auto_complete=False)


def mark_onboarding_dismissed(user) -> dict:
    profile = get_user_profile(user)
    if profile is not None and profile.onboarding_dismissed_at is None:
        profile.onboarding_dismissed_at = timezone.now()
        profile.save(update_fields=["onboarding_dismissed_at", "updated_at"])
        logger.info("onboarding_dismissed user_id=%s", user.pk)
    return onboarding_status_payload(user, persist_auto_complete=True)
