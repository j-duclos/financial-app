"""
Recurring payment status — mirrors apps/web/src/lib/recurringDisplay.ts so dashboard
bill alerts match the Recurring page summary (one status per rule, not per checklist row).
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any, Iterable, Optional

from timeline.models import RecurringRule
from timeline.services.ledger import generate_rule_occurrences

from .bill_insights import (
    DISPLAY_DUE_SOON,
    DISPLAY_LIKELY_FORGOTTEN,
    DISPLAY_LATE,
    format_late_bills_message,
)

# Must match recurringDisplay.ts DUE_SOON_DAYS
DUE_SOON_DAYS = 5


def rule_is_running(rule: RecurringRule, today: date) -> bool:
    if rule.end_date and rule.end_date < today:
        return False
    return bool(rule.active)


def _occurrence_has_verified_payment(item: dict[str, Any]) -> bool:
    linked = item.get("matched_transaction_id") or item.get("transaction_id")
    settled = item.get("status") in ("paid", "reconciled")
    return bool(linked) or settled


def _days_until_due(due_date: date, today: date) -> int:
    return (due_date - today).days


def pick_checklist_occurrence_for_rule(
    checklist_items: list[dict[str, Any]],
    rule_id: int,
    today: date,
) -> dict[str, Any] | None:
    """Same selection as pickChecklistOccurrenceForRule in recurringDisplay.ts."""
    today_iso = today.isoformat()
    for_rule = [i for i in checklist_items if i.get("rule_id") == rule_id]
    if not for_rule:
        return None

    def is_settled(item: dict[str, Any]) -> bool:
        return bool(item.get("skipped")) or item.get("status") in (
            "paid",
            "reconciled",
            "skipped",
        )

    unpaid = [i for i in for_rule if not is_settled(i)]
    pool = unpaid if unpaid else for_rule

    past_due = [i for i in pool if i.get("due_date", "") <= today_iso]
    if past_due:
        return max(past_due, key=lambda i: i["due_date"])

    return min(pool, key=lambda i: i["due_date"])


def get_next_rule_run_date(rule: RecurringRule, today: date) -> date | None:
    end = today + timedelta(days=365 * 2)
    for due in generate_rule_occurrences(rule, today, end):
        if due >= today:
            return due
    return None


def derive_recurring_payment_status(
    rule: RecurringRule,
    occurrence: dict[str, Any] | None,
    *,
    today: date,
) -> str:
    if not rule_is_running(rule, today):
        if not rule.active or rule.paused_at:
            return "paused"
        if rule.end_date and rule.end_date < today:
            return "inactive"
        return "paused"

    if occurrence and (occurrence.get("skipped") or occurrence.get("status") == "skipped"):
        return "skipped"

    if occurrence and _occurrence_has_verified_payment(occurrence):
        return "paid"

    due_date: date | None = None
    if occurrence and occurrence.get("due_date"):
        due_date = date.fromisoformat(str(occurrence["due_date"])[:10])
    elif rule_is_running(rule, today):
        due_date = get_next_rule_run_date(rule, today)

    if due_date is None:
        return "scheduled"

    if occurrence:
        st = occurrence.get("status")
        if st in (DISPLAY_LATE, "missed", DISPLAY_LIKELY_FORGOTTEN):
            return "missed"

    days = _days_until_due(due_date, today)
    if days < 0:
        return "missed"
    if days <= DUE_SOON_DAYS:
        return "due_soon"
    return "scheduled"


def compute_recurring_payment_counts(
    rules: Iterable[RecurringRule],
    checklist_items: list[dict[str, Any]],
    *,
    today: date,
) -> tuple[int, int]:
    """
    Return (missed_count, due_soon_count) for the Recurring page summary bar.
    Manual checklist rows without a rule_id are excluded.
    """
    missed = 0
    due_soon = 0
    for rule in rules:
        occ = pick_checklist_occurrence_for_rule(checklist_items, rule.id, today)
        status = derive_recurring_payment_status(rule, occ, today=today)
        if status == "missed":
            missed += 1
        elif status == "due_soon":
            due_soon += 1
    return missed, due_soon


def recurring_missed_message(missed: int, due_soon: int) -> str | None:
    if missed == 1:
        return format_late_bills_message(1)
    if missed > 1:
        return format_late_bills_message(missed)
    if due_soon == 1:
        return "1 bill due soon"
    if due_soon > 1:
        return f"{due_soon} bills due soon"
    return None


def recurring_insight_recommended_action(missed: int, due_soon: int) -> str:
    if missed > 0 and due_soon > 0:
        return (
            f"Review the recurring checklist: {missed} missed payment"
            f"{'s' if missed != 1 else ''} and {due_soon} due soon."
        )
    if missed > 0:
        return (
            f"Review the recurring checklist and resolve {missed} missed payment"
            f"{'s' if missed != 1 else ''}."
        )
    if due_soon > 0:
        return (
            f"{due_soon} payment{'s' if due_soon != 1 else ''} due soon — confirm or schedule "
            "before the due date."
        )
    return "Review your monthly bill checklist."
