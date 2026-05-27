"""Bucket contributions via real transfers/transactions + GoalContribution rows."""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any

from accounts.models import Account
from accounts.services.available_to_spend import calculate_account_forecast_summary
from goals.bucket_services import (
    calculate_bucket_progress,
    enrich_bucket,
    record_contribution,
    sync_bucket_allocated_amount,
)
from goals.models import GoalBucket, GoalContribution
from goals.services import _decimal, _quantize_money
from transactions.services.posting import create_transfer, post_transaction


def preview_bucket_contribution(
    user,
    bucket: GoalBucket,
    *,
    from_account_id: int,
    amount: Decimal,
    contrib_date: date,
    today: date | None = None,
) -> dict[str, Any]:
    today = today or date.today()
    amount = _quantize_money(_decimal(amount))
    if amount <= 0:
        raise ValueError("Amount must be positive.")

    progress = calculate_bucket_progress(bucket, today=today)
    current = _decimal(progress["current_amount"])
    target = _decimal(progress["target_amount"])
    after_current = min(target, current + amount) if bucket.is_debt_bucket() else current + amount

    try:
        from_account = Account.objects.select_related("household").get(pk=from_account_id)
    except Account.DoesNotExist:
        raise ValueError("From account not found.")
    if from_account.household_id != bucket.household_id:
        raise ValueError("From account must belong to the bucket household.")

    after_progress = {
        **progress,
        "current_amount": str(_quantize_money(after_current)),
        "remaining_amount": str(_quantize_money(max(Decimal("0"), target - after_current))),
        "progress_percent": str(
            min(Decimal("100"), after_current / target * Decimal("100")).quantize(Decimal("0.01"))
        ),
    }

    forecast = calculate_account_forecast_summary(user, from_account, as_of_date=today)
    sts_before = None
    sts_after = None
    if forecast.get("supports_available_to_spend"):
        sts_before = _decimal(forecast.get("available_to_spend") or 0)
        reserve = _decimal(forecast.get("bucket_allocation") or 0)
        sts_after = max(Decimal("0"), sts_before - amount)
        if bucket.include_in_safe_to_spend and bucket.linked_account_id == from_account_id:
            sts_after = max(Decimal("0"), sts_before - amount)

    funding = bucket.linked_account
    can_transfer = funding is not None and from_account_id != funding.id

    return {
        "current_amount": progress["current_amount"],
        "after_amount": after_progress["current_amount"],
        "progress_percent": progress["progress_percent"],
        "after_progress_percent": after_progress["progress_percent"],
        "safe_to_spend_before": str(sts_before) if sts_before is not None else None,
        "safe_to_spend_after": str(_quantize_money(sts_after)) if sts_after is not None else None,
        "can_transfer": can_transfer,
        "funding_account_id": funding.id if funding else None,
        "funding_account_name": funding.effective_display_name if funding else None,
        "requires_linked_account_for_transfer": funding is None,
    }


def execute_bucket_contribution(
    user,
    bucket: GoalBucket,
    *,
    from_account_id: int | None,
    amount: Decimal,
    contrib_date: date,
    method: str,
    today: date | None = None,
) -> dict[str, Any]:
    today = today or date.today()
    amount = _quantize_money(_decimal(amount))
    if amount <= 0:
        raise ValueError("Amount must be positive.")

    method = (method or "transfer").lower()
    if method not in ("transfer", "manual"):
        raise ValueError("method must be 'transfer' or 'manual'.")

    payee = f"Bucket: {bucket.name}"
    source = GoalContribution.Source.TRANSFER if method == "transfer" else GoalContribution.Source.MANUAL
    funding = bucket.linked_account

    if bucket.is_debt_bucket():
        if funding is None:
            raise ValueError("Link a credit or loan account for debt payoff buckets.")
        if method == "transfer":
            if not from_account_id:
                raise ValueError("from_account is required for transfers.")
            xfer = create_transfer(
                user,
                from_account_id,
                funding.id,
                amount,
                contrib_date,
                memo=payee,
                payee=payee,
            )
            txn = xfer.to_transaction
        else:
            txn = post_transaction(user, funding.id, contrib_date, payee, amount)
        record_contribution(
            bucket,
            transaction=txn,
            account_id=funding.id,
            amount=amount,
            contrib_date=contrib_date,
            source=source,
        )
    else:
        if method == "transfer":
            if funding is None:
                raise ValueError("Link a funding account to record a transfer contribution.")
            if not from_account_id:
                raise ValueError("from_account is required for transfers.")
            xfer = create_transfer(
                user,
                from_account_id,
                funding.id,
                amount,
                contrib_date,
                memo=payee,
                payee=payee,
            )
            txn = xfer.to_transaction
        elif funding is not None:
            txn = post_transaction(user, funding.id, contrib_date, payee, amount)
        else:
            raise ValueError("Link a funding account or use transfer from another account.")
        record_contribution(
            bucket,
            transaction=txn,
            account_id=funding.id,
            amount=amount,
            contrib_date=contrib_date,
            source=source,
        )

    sync_bucket_allocated_amount(bucket)
    progress = enrich_bucket(bucket, calculate_bucket_progress(bucket, today=today), today=today)
    return {"goal_progress": progress, "bucket": bucket}
