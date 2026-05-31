"""Auto-track goal progress from linked-account ledger activity."""

from __future__ import annotations

from goals.models import GoalBucket, GoalContribution
from goals.services import _decimal, _quantize_money

ACTIVE_BUCKET_STATUSES = (GoalBucket.Status.ACTIVE, GoalBucket.Status.PAUSED)


def active_bucket_for_linked_account(account_id: int) -> GoalBucket | None:
    return (
        GoalBucket.objects.filter(
            linked_account_id=account_id,
            status__in=ACTIVE_BUCKET_STATUSES,
        )
        .select_related("linked_account")
        .order_by("pk")
        .first()
    )


def linked_account_in_use(
    account_id: int,
    *,
    exclude_bucket_id: int | None = None,
) -> bool:
    qs = GoalBucket.objects.filter(
        linked_account_id=account_id,
        status__in=ACTIVE_BUCKET_STATUSES,
    )
    if exclude_bucket_id is not None:
        qs = qs.exclude(pk=exclude_bucket_id)
    return qs.exists()


def clear_goal_contribution_for_transaction(txn) -> None:
    GoalContribution.objects.filter(transaction_id=txn.pk).delete()


def sync_linked_goal_contribution_for_transaction(txn) -> GoalContribution | None:
    """Mirror eligible ledger rows on the goal's linked account as contributions."""
    bucket = active_bucket_for_linked_account(txn.account_id)
    if bucket is None:
        clear_goal_contribution_for_transaction(txn)
        return None
    amount = _quantize_money(_decimal(txn.amount))
    contrib, created = GoalContribution.objects.get_or_create(
        transaction_id=txn.pk,
        defaults={
            "bucket": bucket,
            "account_id": txn.account_id,
            "amount": amount,
            "date": txn.date,
            "source": GoalContribution.Source.AUTO,
        },
    )
    if not created:
        contrib.bucket = bucket
        contrib.account_id = txn.account_id
        contrib.amount = amount
        contrib.date = txn.date
        contrib.source = GoalContribution.Source.AUTO
        contrib.save(
            update_fields=["bucket", "account_id", "amount", "date", "source"]
        )
    return contrib


def sync_all_transactions_for_linked_bucket(bucket: GoalBucket) -> None:
    if not bucket.linked_account_id:
        return
    from transactions.models import Transaction

    txns = Transaction.objects.filter(account_id=bucket.linked_account_id).select_related(
        "category"
    )
    for txn in txns:
        sync_linked_goal_contribution_for_transaction(txn)
    GoalContribution.objects.filter(bucket=bucket).exclude(
        transaction_id__in=txns.values_list("pk", flat=True)
    ).delete()
