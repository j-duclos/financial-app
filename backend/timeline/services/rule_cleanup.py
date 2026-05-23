"""Cleanup when recurring rules are removed or deactivated."""

from datetime import date

from django.utils import timezone

from transactions.models import Transaction, Transfer


def delete_materialized_transactions_for_rule_on_or_after(rule_id: int, cutoff: date) -> None:
    """
    Delete DB transactions still pointing at this rule with date >= cutoff.
    Used when deleting a rule so planned/materialized future rows do not remain as orphans
    (Transaction.rule is SET_NULL on rule delete, which would leave misleading projected rows).
    """
    txn_pks = set(
        Transaction.objects.filter(rule_id=rule_id, date__gte=cutoff).values_list("pk", flat=True)
    )
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


def delete_future_materialized_transactions_for_rule(rule_id: int) -> None:
    """Delete rule-linked transactions dated today or later (server local date)."""
    delete_materialized_transactions_for_rule_on_or_after(rule_id, timezone.localdate())
