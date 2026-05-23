"""Helpers for recurring-rule transfers: two Transaction rows, often no Transfer bridge."""
from __future__ import annotations

from typing import Optional

from timeline.models import RecurringRule

from .models import Transaction

# When rule-based transfer legs have slightly different dates (or one was moved), still treat as a pair.
RULE_TRANSFER_DATE_SLACK_DAYS = 7


def find_rule_transfer_counterpart_txn(
    *,
    rule_id: int,
    exclude_txn_pk: int,
    old_date,
    old_amount,
    old_account_id: int,
) -> Optional[Transaction]:
    """
    Find the other leg of a recurring transfer (same rule_id, no Transfer row).
    Prefer exact same date; otherwise opposite amount on another account within a small date window.
    """
    rule = RecurringRule.objects.filter(pk=rule_id).first()
    if rule is None or rule.transfer_to_account_id is None:
        return None

    base = (
        Transaction.objects.filter(rule_id=rule_id)
        .exclude(pk=exclude_txn_pk)
        .exclude(account_id=old_account_id)
    )
    other = base.filter(date=old_date).first()
    if other is not None:
        return other

    candidates = list(base.filter(amount=-old_amount))
    if not candidates:
        return None
    near = [c for c in candidates if abs((c.date - old_date).days) <= RULE_TRANSFER_DATE_SLACK_DAYS]
    if not near:
        return None
    return min(near, key=lambda t: (abs((t.date - old_date).days), t.pk))
