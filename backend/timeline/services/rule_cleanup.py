"""Cleanup when recurring rules are removed or deactivated."""

from datetime import date

from django.utils import timezone

from timeline.models import RecurringRule
from transactions.models import Transaction, Transfer


def _delete_rule_linked_transactions(rule_id: int, *, on_or_after: date | None = None, after: date | None = None) -> None:
    qs = Transaction.objects.filter(rule_id=rule_id)
    if on_or_after is not None:
        qs = qs.filter(date__gte=on_or_after)
    elif after is not None:
        qs = qs.filter(date__gt=after)
    else:
        return
    txn_pks = set(qs.values_list("pk", flat=True))
    deleted: set[int] = set()
    for pk in list(txn_pks):
        if pk in deleted:
            continue
        txn = Transaction.objects.filter(pk=pk).first()
        if txn is None or txn.rule_id != rule_id:
            continue
        try:
            tr = txn.transfer_out
        except Transfer.DoesNotExist:
            tr = None
        if tr is None:
            try:
                tr = txn.transfer_in
            except Transfer.DoesNotExist:
                tr = None
        if tr:
            other = tr.to_transaction if tr.from_transaction_id == txn.pk else tr.from_transaction
            leg_a, leg_b = txn.pk, other.pk
            tr.delete()
            for leg_pk in (leg_a, leg_b):
                if leg_pk not in deleted:
                    Transaction.objects.filter(pk=leg_pk).delete()
                    deleted.add(leg_pk)
        else:
            txn.delete()
            deleted.add(pk)


def delete_materialized_transactions_for_rule_on_or_after(rule_id: int, cutoff: date) -> None:
    """
    Delete DB transactions still pointing at this rule with date >= cutoff.
    Used when deleting a rule so planned/materialized future rows do not remain as orphans
    (Transaction.rule is SET_NULL on rule delete, which would leave misleading projected rows).
    """
    _delete_rule_linked_transactions(rule_id, on_or_after=cutoff)


def delete_materialized_transactions_for_rule_after(rule_id: int, cutoff: date) -> None:
    """Delete rule-linked transactions with date strictly after cutoff."""
    _delete_rule_linked_transactions(rule_id, after=cutoff)


def delete_future_materialized_transactions_for_rule(rule_id: int) -> None:
    """Delete rule-linked transactions dated today or later (server local date)."""
    delete_materialized_transactions_for_rule_on_or_after(rule_id, timezone.localdate())


def pause_recurring_rule(rule: RecurringRule, *, as_of_date: date | None = None) -> RecurringRule:
    """
    Pause automatic rule materialization from as_of_date (inclusive) forward and remove
    any rule-linked transactions dated after as_of_date.
    """
    as_of = as_of_date or timezone.localdate()
    rule.active = False
    rule.paused_at = as_of
    rule.save(update_fields=["active", "paused_at", "updated_at"])
    delete_materialized_transactions_for_rule_after(rule.pk, as_of)
    return rule


def resume_recurring_rule(rule: RecurringRule) -> RecurringRule:
    """Clear pause so timeline/ledger can materialize future occurrences again."""
    rule.active = True
    rule.paused_at = None
    rule.save(update_fields=["active", "paused_at", "updated_at"])
    return rule
