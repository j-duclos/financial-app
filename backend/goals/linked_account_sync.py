"""Auto-track goal progress from linked-account ledger activity."""

from __future__ import annotations

from datetime import date, datetime

from django.core.exceptions import ValidationError
from django.db.models import DateField
from django.utils import timezone

from goals.models import GoalBucket, GoalContribution
from goals.services import _decimal, _quantize_money
from transactions.models import Transaction

_DATE_FIELD = DateField()


def _as_contribution_date(value) -> date | None:
    """Normalize txn.date from DateField, datetime, or ISO text. Invalid values are ignored."""
    if value is None or value == "":
        return None
    try:
        converted = _DATE_FIELD.to_python(value)
    except (ValidationError, TypeError, ValueError):
        return None
    if converted is None:
        return None
    if isinstance(converted, datetime):
        return converted.date()
    if isinstance(converted, date):
        return converted
    return None


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
    contribs = list(
        GoalContribution.objects.filter(transaction_id=txn.pk).select_related("bucket")
    )
    bucket_ids = {c.bucket_id for c in contribs if c.bucket_id}
    GoalContribution.objects.filter(transaction_id=txn.pk).delete()
    if not bucket_ids:
        return
    from goals.bucket_services import sync_bucket_allocated_amount

    for bucket in GoalBucket.objects.filter(pk__in=bucket_ids):
        sync_bucket_allocated_amount(bucket)


def _eligible_for_linked_contribution(txn: Transaction) -> bool:
    """Only posted history counts — not forecast/planned rows scheduled for later."""
    txn_date = _as_contribution_date(getattr(txn, "date", None))
    if txn_date is None:
        return False
    if txn_date > timezone.localdate():
        return False
    if txn.status == Transaction.Status.PLANNED:
        return False
    return True


def sync_linked_goal_contribution_for_transaction(txn) -> GoalContribution | None:
    """Mirror eligible ledger rows on the goal's linked account as contributions."""
    contrib_date = _as_contribution_date(getattr(txn, "date", None))
    if contrib_date is None or not _eligible_for_linked_contribution(txn):
        clear_goal_contribution_for_transaction(txn)
        return None
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
            "date": contrib_date,
            "source": GoalContribution.Source.AUTO,
        },
    )
    if not created:
        contrib.bucket = bucket
        contrib.account_id = txn.account_id
        contrib.amount = amount
        contrib.date = contrib_date
        contrib.source = GoalContribution.Source.AUTO
        contrib.save(
            update_fields=["bucket", "account_id", "amount", "date", "source"]
        )
    from goals.bucket_services import sync_bucket_allocated_amount

    sync_bucket_allocated_amount(bucket)
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
    from goals.bucket_services import sync_bucket_allocated_amount

    sync_bucket_allocated_amount(bucket)
