"""Launch plan limits and server-side entitlement checks.

Premium is determined by ``user_has_premium`` (Stripe subscription status,
with an optional development-only test override that never runs in production).
Limits are not inferred from a Stripe customer id.

Downgrade never deletes accounts, Plaid Items, transactions, or history.
Enforcement blocks *new* Premium-only work (new Plaid connections, extra
manual accounts/rules/goals, longer forecast windows).
"""
from __future__ import annotations

from typing import Any

from rest_framework import status
from rest_framework.exceptions import APIException
from rest_framework.response import Response

FEATURE_PLAID_BANK_SYNC = "plaid_bank_sync"
FEATURE_PAYMENT_PLANNER_FULL = "payment_planner_full"
FEATURE_REPORTS_ADVANCED = "reports_advanced"
FEATURE_LINKED_INSTITUTIONS = "linked_institutions"
FEATURE_MANUAL_ACCOUNTS = "manual_accounts"
FEATURE_RECURRING_RULES = "recurring_rules"
FEATURE_FORECAST_DAYS = "operational_forecast_days"
FEATURE_GOALS = "goals"

UNLIMITED = None

FREE_LIMITS: dict[str, int | None] = {
    FEATURE_LINKED_INSTITUTIONS: 0,
    FEATURE_MANUAL_ACCOUNTS: 3,
    FEATURE_RECURRING_RULES: 10,
    FEATURE_FORECAST_DAYS: 90,
    FEATURE_GOALS: 2,
}

PREMIUM_LIMITS: dict[str, int | None] = {
    FEATURE_LINKED_INSTITUTIONS: UNLIMITED,
    FEATURE_MANUAL_ACCOUNTS: UNLIMITED,
    FEATURE_RECURRING_RULES: UNLIMITED,
    FEATURE_FORECAST_DAYS: 365,
    FEATURE_GOALS: UNLIMITED,
}

PLAID_PREMIUM_DETAIL = "Automatic bank syncing is available with Premium."
PLAID_SYNC_PAUSED_DETAIL = "Automatic bank syncing is paused on the Free plan."
PAYMENT_PLANNER_FULL_DETAIL = (
    "Custom payoff simulations are available with Premium."
)
REPORTS_ADVANCED_DETAIL = (
    "Historical cash-flow trends are available with Premium."
)
# Selected month + previous month (MoM comparison). Multi-month trends are Premium.
FREE_REPORTS_HISTORY_MONTHS = 2


class EntitlementDenied(APIException):
    status_code = status.HTTP_403_FORBIDDEN
    default_code = "premium_required"
    default_detail = "This feature is available with Premium."

    def __init__(
        self,
        *,
        feature: str,
        detail: str,
        code: str = "premium_required",
        limit: int | None = None,
    ):
        super().__init__(detail=detail, code=code)
        self.entitlement_code = code
        self.feature = feature
        self.limit = limit
        self.upgrade_required = True

    def payload(self) -> dict[str, Any]:
        body: dict[str, Any] = {
            "code": self.entitlement_code,
            "feature": self.feature,
            "detail": str(self.detail),
            "upgrade_required": True,
        }
        if self.limit is not None:
            body["limit"] = self.limit
        return body


def entitlement_error_response(exc: EntitlementDenied) -> Response:
    return Response(exc.payload(), status=status.HTTP_403_FORBIDDEN)


def _premium(user) -> bool:
    from billing.services import user_has_premium

    return user_has_premium(user)


def plan_limits_for_user(user) -> dict[str, int | None]:
    return dict(PREMIUM_LIMITS if _premium(user) else FREE_LIMITS)


def max_forecast_days_for_user(user) -> int:
    limits = plan_limits_for_user(user)
    days = limits[FEATURE_FORECAST_DAYS]
    return int(days if days is not None else 365)


def user_may_use_plaid_sync(user) -> bool:
    return _premium(user)


def household_has_premium_member(household) -> bool:
    from django.contrib.auth import get_user_model
    from core.models import HouseholdMembership

    User = get_user_model()
    user_ids = HouseholdMembership.objects.filter(household=household).values_list(
        "user_id", flat=True
    )
    for member in User.objects.filter(pk__in=user_ids):
        if _premium(member):
            return True
    return False


def _households(user):
    from core.utils import get_households_for_user

    return get_households_for_user(user)


def count_linked_institutions(user) -> int:
    from plaid_link.models import PlaidItem

    return PlaidItem.objects.filter(household__in=_households(user)).count()


def count_manual_accounts(user) -> int:
    from accounts.models import Account

    return (
        Account.objects.filter(
            household__in=_households(user),
            status=Account.Status.ACTIVE,
        )
        .filter(plaid_link__isnull=True)
        .count()
    )


def count_recurring_rules(user) -> int:
    from timeline.models import RecurringRule

    return RecurringRule.objects.filter(
        household__in=_households(user),
        active=True,
    ).count()


def count_goals(user) -> int:
    from goals.models import FinancialGoal, GoalBucket

    households = _households(user)
    financial = FinancialGoal.objects.filter(
        household__in=households,
        status__in=(FinancialGoal.Status.ACTIVE, FinancialGoal.Status.PAUSED),
    ).count()
    buckets = GoalBucket.objects.filter(
        household__in=households,
        status__in=(GoalBucket.Status.ACTIVE, GoalBucket.Status.PAUSED),
    ).count()
    return financial + buckets


def usage_for_user(user) -> dict[str, int]:
    return {
        FEATURE_LINKED_INSTITUTIONS: count_linked_institutions(user),
        FEATURE_MANUAL_ACCOUNTS: count_manual_accounts(user),
        FEATURE_RECURRING_RULES: count_recurring_rules(user),
        FEATURE_GOALS: count_goals(user),
    }


def build_entitlement_payload(user) -> dict[str, Any]:
    is_premium = _premium(user)
    limits = plan_limits_for_user(user)
    return {
        "plan": "PREMIUM" if is_premium else "FREE",
        "is_premium": is_premium,
        "plaid_bank_sync": is_premium,
        FEATURE_PAYMENT_PLANNER_FULL: is_premium,
        FEATURE_REPORTS_ADVANCED: is_premium,
        "limits": {
            FEATURE_LINKED_INSTITUTIONS: limits[FEATURE_LINKED_INSTITUTIONS],
            FEATURE_MANUAL_ACCOUNTS: limits[FEATURE_MANUAL_ACCOUNTS],
            FEATURE_RECURRING_RULES: limits[FEATURE_RECURRING_RULES],
            FEATURE_FORECAST_DAYS: limits[FEATURE_FORECAST_DAYS],
            FEATURE_GOALS: limits[FEATURE_GOALS],
        },
        "usage": usage_for_user(user),
    }


def require_plaid_bank_sync(user, *, sync: bool = False) -> None:
    """Block new Plaid Link/exchange (and paid sync) for Free users."""
    if user_may_use_plaid_sync(user):
        return
    raise EntitlementDenied(
        feature=FEATURE_PLAID_BANK_SYNC,
        detail=PLAID_SYNC_PAUSED_DETAIL if sync else PLAID_PREMIUM_DETAIL,
        code="premium_required",
    )


def user_may_use_payment_planner_full(user) -> bool:
    return _premium(user)


def require_payment_planner_full(user) -> None:
    """Block Premium-only payoff comparison / custom simulation endpoints."""
    if user_may_use_payment_planner_full(user):
        return
    raise EntitlementDenied(
        feature=FEATURE_PAYMENT_PLANNER_FULL,
        detail=PAYMENT_PLANNER_FULL_DETAIL,
        code="premium_required",
    )


def user_may_use_reports_advanced(user) -> bool:
    """Read-only Premium check — do not create billing rows on report GET."""
    from billing.services import user_has_premium

    return user_has_premium(user, create_billing_row=False)


def require_reports_advanced(user) -> None:
    """Block Premium-only historical/trend report depth."""
    if user_may_use_reports_advanced(user):
        return
    raise EntitlementDenied(
        feature=FEATURE_REPORTS_ADVANCED,
        detail=REPORTS_ADVANCED_DETAIL,
        code="premium_required",
    )


def resolve_reports_history_months(user, requested: int) -> int:
    """Cap Free history to the basic window; Premium may request 1–36 months."""
    history_months = max(1, min(int(requested), 36))
    if user_may_use_reports_advanced(user):
        return history_months
    return min(history_months, FREE_REPORTS_HISTORY_MONTHS)


def require_within_limit(user, feature: str, *, noun: str, extra: int = 1) -> None:
    limits = plan_limits_for_user(user)
    cap = limits.get(feature, UNLIMITED)
    if cap is UNLIMITED:
        return
    usage = usage_for_user(user).get(feature, 0)
    if usage + extra <= cap:
        return
    raise EntitlementDenied(
        feature=feature,
        detail=f"The Free plan includes up to {cap} {noun}. Upgrade to Premium for more.",
        code="plan_limit_reached",
        limit=int(cap),
    )


def require_manual_account_slot(user) -> None:
    require_within_limit(user, FEATURE_MANUAL_ACCOUNTS, noun="manually managed accounts")


def require_recurring_rule_slot(user) -> None:
    require_within_limit(user, FEATURE_RECURRING_RULES, noun="active recurring rules")


def require_goal_slot(user) -> None:
    require_within_limit(user, FEATURE_GOALS, noun="goals")


def require_forecast_days_allowed(user, days: int) -> None:
    max_days = max_forecast_days_for_user(user)
    if days <= max_days:
        return
    raise EntitlementDenied(
        feature=FEATURE_FORECAST_DAYS,
        detail=f"Forecast planning beyond {max_days} days is available with Premium.",
        code="premium_required",
        limit=max_days,
    )
