"""
Dedicated recurring-rule transaction materialization.

Future RULE-sourced transactions are created here (or via rule lifecycle hooks),
not during dashboard/timeline read paths that use build_timeline(projection_only=True).

TODO: Add a scheduled worker (e.g. daily_materialize_recurring_transactions) when
background job infrastructure is available — materialize next 90 days for active users.
"""
from __future__ import annotations

import logging
import time
from datetime import date, timedelta
from typing import Any

from django.utils import timezone

from accounts.services.available_to_spend import normalize_forecast_days
from common.services.cache import invalidate_financial_cache_for_household, invalidate_user_financial_cache
from common.services.profiler import enter_materialization_context, exit_materialization_context, perf_enabled, perf_print
from core.utils import get_households_for_user
from timeline.models import RecurringRule
from timeline.services.ledger import build_timeline, repair_unlinked_rule_transfer_pairs
from timeline.services.rule_cleanup import delete_future_materialized_transactions_for_rule
from timeline.services.rule_schedule import promote_due_schedules

logger = logging.getLogger(__name__)

DEFAULT_MATERIALIZE_DAYS = 90


def materialize_recurring_transactions_for_user(
    user,
    through_date: date | None = None,
    *,
    account_ids: list[int] | None = None,
    rule_ids: list[int] | None = None,
    force: bool = False,
    forecast_days: int = DEFAULT_MATERIALIZE_DAYS,
) -> dict[str, Any]:
    """
    Materialize future rule occurrences as PLANNED/RULE Transaction rows.

    Idempotent: re-running does not create duplicates (uniqueness: rule + date + account).
    Runs a full-household timeline build so transfer legs and debt-skip logic stay correct.
    """
    today = timezone.localdate()
    days = normalize_forecast_days(forecast_days)
    if through_date is None:
        through_date = today + timedelta(days=days)
    if through_date < today:
        through_date = today

    households = get_households_for_user(user)
    rules_qs = RecurringRule.objects.filter(household__in=households, active=True)
    if rule_ids:
        rules_qs = rules_qs.filter(pk__in=rule_ids)
    if account_ids:
        rules_qs = rules_qs.filter(account_id__in=account_ids) | rules_qs.filter(
            transfer_to_account_id__in=account_ids
        )
    rules = list(rules_qs.distinct())
    rules_processed = len(rules)

    logger.debug(
        "Materialization started user=%s through_date=%s rules=%s force=%s",
        user.pk,
        through_date.isoformat(),
        rules_processed,
        force,
    )
    if perf_enabled():
        perf_print(
            f"[PERF] materialization started user={user.pk} "
            f"through_date={through_date.isoformat()}"
        )

    if force:
        for rule in rules:
            delete_future_materialized_transactions_for_rule(rule.pk)

    promote_due_schedules(as_of_date=today)

    enter_materialization_context(rules_processed=rules_processed)
    wall_start = time.perf_counter()
    try:
        build_timeline(
            user,
            start_date=today,
            end_date=through_date,
            as_of_date=today,
            projection_only=False,
            caller="materialization",
        )
    finally:
        summary = exit_materialization_context()

    elapsed_ms = (time.perf_counter() - wall_start) * 1000
    result = {
        "rules_processed": rules_processed,
        "occurrences_generated": summary.get("occurrences_generated", 0),
        "existing_loaded": summary.get("existing_loaded", 0),
        "transactions_created": summary.get("transactions_created", 0),
        "transactions_updated": summary.get("transactions_updated", 0),
        "transactions_skipped": summary.get("transactions_skipped", 0),
    }

    from transactions.services.matching import rematch_unmatched_for_accounts

    rematch_ids: set[int] = set()
    if account_ids:
        rematch_ids.update(account_ids)
        repair_unlinked_rule_transfer_pairs(account_ids)
    if rule_ids:
        for rid in rule_ids:
            rule = RecurringRule.objects.filter(pk=rid).first()
            if rule is None:
                continue
            if rule.account_id:
                rematch_ids.add(rule.account_id)
            if rule.transfer_to_account_id:
                rematch_ids.add(rule.transfer_to_account_id)
    if rematch_ids:
        rematch_unmatched_for_accounts(rematch_ids)

    invalidate_user_financial_cache(user.pk)
    for household in households:
        invalidate_financial_cache_for_household(household.pk)

    logger.debug(
        "Materialization finished user=%s rules=%s existing_loaded=%s created=%s updated=%s skipped=%s elapsed_ms=%.0f",
        user.pk,
        result["rules_processed"],
        result["existing_loaded"],
        result["transactions_created"],
        result["transactions_updated"],
        result["transactions_skipped"],
        elapsed_ms,
    )
    if perf_enabled():
        perf_print(
            f"[PERF] materialize_recurring_transactions rules={result['rules_processed']} "
            f"occurrences={result['occurrences_generated']} "
            f"existing_loaded={result['existing_loaded']} "
            f"created={result['transactions_created']} "
            f"updated={result['transactions_updated']} "
            f"skipped={result['transactions_skipped']} "
            f"elapsed_ms={elapsed_ms:.0f}"
        )
    return result


def refresh_rule_materialization(
    user,
    rule: RecurringRule,
    *,
    forecast_days: int = DEFAULT_MATERIALIZE_DAYS,
) -> dict[str, Any]:
    """Materialize future occurrences for one rule after create/update/resume."""
    if not rule.active:
        return {
            "rules_processed": 0,
            "occurrences_generated": 0,
            "existing_loaded": 0,
            "transactions_created": 0,
            "transactions_updated": 0,
            "transactions_skipped": 0,
        }
    return materialize_recurring_transactions_for_user(
        user,
        rule_ids=[rule.pk],
        forecast_days=forecast_days,
    )
