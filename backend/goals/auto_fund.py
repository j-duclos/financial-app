"""Sync recurring transfer rules when goal buckets auto-fund from paycheck rules."""
from __future__ import annotations

from decimal import Decimal

from django.db import transaction

from goals.models import GoalBucket, RuleAllocation
from goals.services import _decimal, _quantize_money
from timeline.models import RecurringRule

AUTO_FUND_NOTE_PREFIX = "goal_auto_fund_bucket="


def auto_fund_note_for_bucket(bucket_id: int) -> str:
    return f"{AUTO_FUND_NOTE_PREFIX}{bucket_id}"


def find_auto_fund_transfer_rule(bucket: GoalBucket) -> RecurringRule | None:
    note = auto_fund_note_for_bucket(bucket.pk)
    return (
        RecurringRule.objects.filter(
            household_id=bucket.household_id,
            direction=RecurringRule.Direction.TRANSFER,
            notes__contains=note,
        )
        .order_by("-id")
        .first()
    )


def _allocation_transfer_amount(allocation: RuleAllocation, income_rule: RecurringRule) -> Decimal | None:
    if allocation.fixed_amount and allocation.fixed_amount > 0:
        return _quantize_money(_decimal(allocation.fixed_amount))
    if allocation.percent and allocation.percent > 0:
        base = abs(_decimal(income_rule.amount))
        return _quantize_money(base * _decimal(allocation.percent) / Decimal("100"))
    return None


def _primary_income_allocation(bucket: GoalBucket) -> tuple[RuleAllocation, RecurringRule] | None:
    for alloc in (
        RuleAllocation.objects.filter(bucket=bucket, active=True)
        .select_related("rule")
        .order_by("id")
    ):
        rule = alloc.rule
        if not rule or not rule.active:
            continue
        if rule.direction != RecurringRule.Direction.INCOME:
            continue
        amount = _allocation_transfer_amount(alloc, rule)
        if amount is None or amount <= 0:
            continue
        return alloc, rule
    return None


def _copy_rule_schedule(source: RecurringRule, *, name: str, amount: Decimal, notes: str) -> dict:
    return {
        "household_id": source.household_id,
        "name": name,
        "account_id": source.account_id,
        "transfer_to_account_id": None,  # set by caller
        "category_id": None,
        "direction": RecurringRule.Direction.TRANSFER,
        "amount": amount,
        "currency": source.currency,
        "frequency": source.frequency,
        "interval": source.interval,
        "day_of_week": source.day_of_week,
        "day_of_month": source.day_of_month,
        "nth_week": source.nth_week,
        "start_date": source.start_date,
        "end_date": source.end_date,
        "active": source.active,
        "paused_at": source.paused_at,
        "notes": notes,
    }


@transaction.atomic
def sync_auto_fund_transfer_rule(bucket: GoalBucket) -> RecurringRule | None:
    """
    When auto_fund_enabled and a paycheck RuleAllocation exists, maintain a TRANSFER rule
    from the paycheck account to the bucket linked account on the same schedule.
    """
    existing = find_auto_fund_transfer_rule(bucket)

    if bucket.is_debt_bucket() or not bucket.linked_account_id:
        if existing:
            existing.active = False
            existing.save(update_fields=["active", "updated_at"])
        return None

    if not bucket.auto_fund_enabled:
        if existing:
            existing.active = False
            existing.save(update_fields=["active", "updated_at"])
        return None

    pair = _primary_income_allocation(bucket)
    if pair is None:
        if existing:
            existing.active = False
            existing.save(update_fields=["active", "updated_at"])
        return None

    _alloc, income_rule = pair
    transfer_amount = _allocation_transfer_amount(_alloc, income_rule)
    if transfer_amount is None or transfer_amount <= 0:
        if existing:
            existing.active = False
            existing.save(update_fields=["active", "updated_at"])
        return None

    if income_rule.account_id == bucket.linked_account_id:
        if existing:
            existing.active = False
            existing.save(update_fields=["active", "updated_at"])
        return None

    note = auto_fund_note_for_bucket(bucket.pk)
    rule_name = f"Goal: {bucket.name}"

    if existing:
        existing.name = rule_name
        existing.account_id = income_rule.account_id
        existing.transfer_to_account_id = bucket.linked_account_id
        existing.amount = transfer_amount
        existing.frequency = income_rule.frequency
        existing.interval = income_rule.interval
        existing.day_of_week = income_rule.day_of_week
        existing.day_of_month = income_rule.day_of_month
        existing.nth_week = income_rule.nth_week
        existing.start_date = income_rule.start_date
        existing.end_date = income_rule.end_date
        existing.active = income_rule.active
        existing.paused_at = income_rule.paused_at
        existing.save()
        return existing

    fields = _copy_rule_schedule(income_rule, name=rule_name, amount=transfer_amount, notes=note)
    fields["transfer_to_account_id"] = bucket.linked_account_id
    return RecurringRule.objects.create(**fields)


@transaction.atomic
def apply_bucket_funding_config(
    bucket: GoalBucket,
    *,
    auto_fund_enabled: bool | None = None,
    income_rule_id: int | None = None,
    fixed_amount: Decimal | None = None,
    percent: Decimal | None = None,
    clear_allocation: bool = False,
) -> GoalBucket:
    """Upsert paycheck RuleAllocation and sync auto-fund transfer rule."""
    updates: list[str] = []
    if auto_fund_enabled is not None and bucket.auto_fund_enabled != auto_fund_enabled:
        bucket.auto_fund_enabled = auto_fund_enabled
        updates.append("auto_fund_enabled")

    if updates:
        bucket.save(update_fields=[*updates, "updated_at"])

    if clear_allocation:
        RuleAllocation.objects.filter(bucket=bucket).delete()
        sync_auto_fund_transfer_rule(bucket)
        return bucket

    if income_rule_id is None:
        sync_auto_fund_transfer_rule(bucket)
        return bucket

    try:
        income_rule = RecurringRule.objects.get(pk=income_rule_id, household_id=bucket.household_id)
    except RecurringRule.DoesNotExist as exc:
        raise ValueError("Income rule not found for this household.") from exc

    if income_rule.direction != RecurringRule.Direction.INCOME:
        raise ValueError("Selected rule must be an income rule (paycheck/deposit).")

    has_fixed = fixed_amount is not None and fixed_amount > 0
    has_percent = percent is not None and percent > 0
    if not has_fixed and not has_percent:
        raise ValueError("Set a fixed amount or percent for the paycheck allocation.")

    if has_fixed and has_percent:
        raise ValueError("Set either fixed amount or percent, not both.")

    RuleAllocation.objects.filter(bucket=bucket).exclude(rule=income_rule).delete()

    alloc_defaults = {
        "fixed_amount": _quantize_money(fixed_amount) if has_fixed else None,
        "percent": _quantize_money(percent) if has_percent else None,
        "active": True,
    }
    RuleAllocation.objects.update_or_create(
        rule=income_rule,
        bucket=bucket,
        defaults=alloc_defaults,
    )

    sync_auto_fund_transfer_rule(bucket)
    bucket.refresh_from_db()
    return bucket
