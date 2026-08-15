"""Recurring rule schedule segments (future-effective changes without rewriting history)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from typing import Any, Optional

from django.utils import timezone

from common.services.cache import invalidate_financial_cache_for_household
from timeline.models import RecurringRule, RecurringRuleSchedule


@dataclass(frozen=True)
class RuleScheduleParams:
    account_id: int
    transfer_to_account_id: Optional[int]
    category_id: Optional[int]
    direction: str
    amount: Decimal
    currency: str
    frequency: str
    interval: int
    day_of_week: Optional[int]
    day_of_month: Optional[int]
    nth_week: Optional[int]
    start_date: date
    end_date: Optional[date]


class RuleProjectionView:
    """Rule-like object for generate_rule_occurrences using schedule params."""

    def __init__(self, rule: RecurringRule, params: RuleScheduleParams):
        self._rule = rule
        self._params = params

    def __getattr__(self, name: str):
        return getattr(self._rule, name)

    @property
    def account_id(self) -> int:
        return self._params.account_id

    @property
    def transfer_to_account_id(self) -> Optional[int]:
        return self._params.transfer_to_account_id

    @property
    def category_id(self) -> Optional[int]:
        return self._params.category_id

    @property
    def direction(self) -> str:
        return self._params.direction

    @property
    def amount(self):
        return self._params.amount

    @property
    def currency(self) -> str:
        return self._params.currency

    @property
    def frequency(self) -> str:
        return self._params.frequency

    @property
    def interval(self) -> int:
        return self._params.interval

    @property
    def day_of_week(self) -> Optional[int]:
        return self._params.day_of_week

    @property
    def day_of_month(self) -> Optional[int]:
        return self._params.day_of_month

    @property
    def nth_week(self) -> Optional[int]:
        return self._params.nth_week

    @property
    def start_date(self) -> date:
        return self._params.start_date

    @property
    def end_date(self) -> Optional[date]:
        return self._params.end_date


def params_from_rule(rule: RecurringRule) -> RuleScheduleParams:
    return RuleScheduleParams(
        account_id=rule.account_id,
        transfer_to_account_id=rule.transfer_to_account_id,
        category_id=rule.category_id,
        direction=rule.direction,
        amount=Decimal(str(rule.amount)),
        currency=rule.currency,
        frequency=rule.frequency,
        interval=rule.interval or 1,
        day_of_week=rule.day_of_week,
        day_of_month=rule.day_of_month,
        nth_week=rule.nth_week,
        start_date=rule.start_date,
        end_date=rule.end_date,
    )


def params_from_schedule(schedule: RecurringRuleSchedule) -> RuleScheduleParams:
    return RuleScheduleParams(
        account_id=schedule.account_id,
        transfer_to_account_id=schedule.transfer_to_account_id,
        category_id=schedule.category_id,
        direction=schedule.direction,
        amount=Decimal(str(schedule.amount)),
        currency=schedule.currency,
        frequency=schedule.frequency,
        interval=schedule.interval or 1,
        day_of_week=schedule.day_of_week,
        day_of_month=schedule.day_of_month,
        nth_week=schedule.nth_week,
        start_date=schedule.start_date,
        end_date=schedule.end_date,
    )


def schedule_params_to_dict(params: RuleScheduleParams) -> dict[str, Any]:
    return {
        "account_id": params.account_id,
        "transfer_to_account_id": params.transfer_to_account_id,
        "category_id": params.category_id,
        "direction": params.direction,
        "amount": params.amount,
        "currency": params.currency,
        "frequency": params.frequency,
        "interval": params.interval,
        "day_of_week": params.day_of_week,
        "day_of_month": params.day_of_month,
        "nth_week": params.nth_week,
        "start_date": params.start_date,
        "end_date": params.end_date,
    }


def _schedules_list(rule: RecurringRule) -> Optional[list[RecurringRuleSchedule]]:
    cache = getattr(rule, "_prefetched_objects_cache", None)
    if cache and "schedules" in cache:
        return list(rule.schedules.all())
    return None


def resolve_rule_params(rule: RecurringRule, as_of_date: date) -> RuleScheduleParams:
    """Parameters for projections on as_of_date (latest schedule with effective_from <= date)."""
    prefetched = _schedules_list(rule)
    if prefetched is not None:
        eligible = [s for s in prefetched if s.effective_from <= as_of_date]
        if not eligible:
            return params_from_rule(rule)
        eligible.sort(key=lambda s: (s.effective_from, s.id), reverse=True)
        return params_from_schedule(eligible[0])
    schedule = (
        rule.schedules.filter(effective_from__lte=as_of_date).order_by("-effective_from", "-id").first()
    )
    if schedule is not None:
        return params_from_schedule(schedule)
    return params_from_rule(rule)


def projection_rule(rule: RecurringRule, as_of_date: date) -> RuleProjectionView:
    return RuleProjectionView(rule, resolve_rule_params(rule, as_of_date))


def signed_amount_from_params(params: RuleScheduleParams) -> Decimal:
    amount = abs(params.amount)
    if params.direction == RecurringRule.Direction.EXPENSE:
        return -amount
    if params.direction == RecurringRule.Direction.INCOME:
        return amount
    return params.amount


def rule_occurrence_amount_for_account(
    rule: RecurringRule,
    params: RuleScheduleParams,
    account_id: int,
) -> Decimal:
    """Signed amount for one materialized leg of a rule occurrence."""
    if rule.transfer_to_account_id:
        amt = abs(params.amount)
        if account_id == rule.account_id:
            return -amt
        if account_id == rule.transfer_to_account_id:
            return amt
    return signed_amount_from_params(params)


def _schedules_for_rule(rule: RecurringRule):
    """Query schedules by rule id (avoids stale prefetched rule.schedules caches on updates)."""
    return RecurringRuleSchedule.objects.filter(rule_id=rule.pk)


def create_schedule_from_params(
    rule: RecurringRule,
    *,
    effective_from: date,
    params: RuleScheduleParams,
) -> RecurringRuleSchedule:
    schedule, _ = RecurringRuleSchedule.objects.update_or_create(
        rule=rule,
        effective_from=effective_from,
        defaults={
            "account_id": params.account_id,
            "transfer_to_account_id": params.transfer_to_account_id,
            "category_id": params.category_id,
            "direction": params.direction,
            "amount": params.amount,
            "currency": params.currency,
            "frequency": params.frequency,
            "interval": params.interval,
            "day_of_week": params.day_of_week,
            "day_of_month": params.day_of_month,
            "nth_week": params.nth_week,
            "start_date": params.start_date,
            "end_date": params.end_date,
        },
    )
    return schedule


def ensure_initial_schedule(rule: RecurringRule) -> RecurringRuleSchedule:
    existing = rule.schedules.order_by("effective_from").first()
    if existing is not None:
        return existing
    return create_schedule_from_params(rule, effective_from=rule.start_date, params=params_from_rule(rule))


_RULE_ROW_PARAM_FIELDS = (
    "account_id",
    "transfer_to_account_id",
    "category_id",
    "direction",
    "amount",
    "currency",
    "frequency",
    "interval",
    "day_of_week",
    "day_of_month",
    "nth_week",
    "start_date",
    "end_date",
)


def sync_rule_row_from_params(rule: RecurringRule, params: RuleScheduleParams) -> list[str]:
    """Align RecurringRule row with params. Returns field names that actually changed."""
    desired = {
        "account_id": params.account_id,
        "transfer_to_account_id": params.transfer_to_account_id,
        "category_id": params.category_id,
        "direction": params.direction,
        "amount": params.amount,
        "currency": params.currency,
        "frequency": params.frequency,
        "interval": params.interval,
        "day_of_week": params.day_of_week,
        "day_of_month": params.day_of_month,
        "nth_week": params.nth_week,
        "start_date": params.start_date,
        "end_date": params.end_date,
    }
    changed: list[str] = []
    for field in _RULE_ROW_PARAM_FIELDS:
        new_value = desired[field]
        current = getattr(rule, field)
        if field == "amount":
            differs = Decimal(str(current)) != Decimal(str(new_value))
        elif field == "interval":
            differs = (current or 1) != new_value
        else:
            differs = current != new_value
        if differs:
            setattr(rule, field, new_value)
            changed.append(field)
    return changed


def rule_row_matches_params(rule: RecurringRule, params: RuleScheduleParams) -> bool:
    return (
        rule.account_id == params.account_id
        and rule.transfer_to_account_id == params.transfer_to_account_id
        and rule.category_id == params.category_id
        and rule.direction == params.direction
        and Decimal(str(rule.amount)) == Decimal(str(params.amount))
        and rule.currency == params.currency
        and rule.frequency == params.frequency
        and (rule.interval or 1) == params.interval
        and rule.day_of_week == params.day_of_week
        and rule.day_of_month == params.day_of_month
        and rule.nth_week == params.nth_week
        and rule.start_date == params.start_date
        and rule.end_date == params.end_date
    )


def promote_due_schedules(
    *,
    today: Optional[date] = None,
    as_of_date: Optional[date] = None,
    household_ids: list[int],
) -> None:
    """Materialize due schedule segments onto rule rows for the given households only."""
    today = as_of_date or today or timezone.localdate()
    if not household_ids:
        return
    due_qs = RecurringRuleSchedule.objects.filter(
        effective_from__lte=today,
        rule__household_id__in=household_ids,
    )
    rule_ids = due_qs.values_list("rule_id", flat=True).distinct()
    to_update: list[RecurringRule] = []
    now = timezone.now()
    for rule in RecurringRule.objects.filter(pk__in=rule_ids).prefetch_related("schedules"):
        params = resolve_rule_params(rule, today)
        changed = sync_rule_row_from_params(rule, params)
        if not changed:
            continue
        rule.updated_at = now
        to_update.append(rule)
    if to_update:
        RecurringRule.objects.bulk_update(
            to_update,
            [
                "account_id",
                "transfer_to_account_id",
                "category_id",
                "direction",
                "amount",
                "currency",
                "frequency",
                "interval",
                "day_of_week",
                "day_of_month",
                "nth_week",
                "start_date",
                "end_date",
                "updated_at",
            ],
        )
        for hid in {rule.household_id for rule in to_update}:
            invalidate_financial_cache_for_household(hid)


def get_next_scheduled_change(rule: RecurringRule, *, today: Optional[date] = None) -> Optional[RecurringRuleSchedule]:
    today = today or timezone.localdate()
    prefetched = _schedules_list(rule)
    if prefetched is not None:
        future = [s for s in prefetched if s.effective_from > today]
        future.sort(key=lambda s: (s.effective_from, s.id))
        return future[0] if future else None
    return rule.schedules.filter(effective_from__gt=today).order_by("effective_from", "id").first()


def cancel_scheduled_changes(rule: RecurringRule, *, today: Optional[date] = None) -> int:
    today = today or timezone.localdate()
    deleted, _ = rule.schedules.filter(effective_from__gt=today).delete()
    return deleted


def apply_rule_schedule_change(
    rule: RecurringRule,
    params: RuleScheduleParams,
    *,
    effective_from: date,
    today: Optional[date] = None,
) -> date:
    """
    Record a new schedule segment. Returns the cutoff date for clearing materialized rows.
    If effective_from > today, the rule row is left as today's segment until that date.
    """
    today = today or timezone.localdate()
    effective_from = max(effective_from, rule.start_date)

    schedules_qs = _schedules_for_rule(rule)
    if effective_from <= today:
        schedules_qs.delete()
    else:
        schedules_qs.filter(effective_from__gte=effective_from).delete()
    create_schedule_from_params(rule, effective_from=effective_from, params=params)

    if effective_from <= today:
        changed = sync_rule_row_from_params(rule, params)
        if changed:
            rule.save(
                update_fields=[
                    *changed,
                    "updated_at",
                ]
            )
        return today
    return effective_from


def generate_rule_occurrence_dates(
    rule: RecurringRule,
    start_date: date,
    end_date: date,
    *,
    effective_start: Optional[date] = None,
    effective_end: Optional[date] = None,
) -> list[date]:
    """
    Occurrence dates in range, respecting schedule segments (amount/cadence may change mid-range).
    """
    from timeline.services.ledger import generate_rule_occurrences

    if not rule.active:
        return []

    range_start = max(start_date, effective_start or rule.start_date)
    range_end = end_date
    if effective_end is not None:
        range_end = min(range_end, effective_end)
    if rule.end_date:
        range_end = min(range_end, rule.end_date)
    if effective_end and effective_end < range_end:
        range_end = min(range_end, effective_end)
    if rule.paused_at:
        pause_cap = rule.paused_at - timedelta(days=1)
        if range_start > pause_cap:
            return []
        range_end = min(range_end, pause_cap)
    if range_start > range_end:
        return []

    prefetched = _schedules_list(rule)
    if prefetched is not None:
        schedules = sorted(prefetched, key=lambda s: s.effective_from)
    else:
        schedules = list(rule.schedules.order_by("effective_from"))
    if not schedules:
        return generate_rule_occurrences(
            rule, start_date, end_date, effective_start=effective_start, effective_end=effective_end
        )

    boundaries = sorted(
        {
            s.effective_from
            for s in schedules
            if range_start <= s.effective_from <= range_end
        }
    )

    segments: list[tuple[date, date]] = []
    seg_start = range_start
    for boundary in boundaries:
        if boundary > seg_start:
            segments.append((seg_start, boundary - timedelta(days=1)))
        seg_start = boundary
    segments.append((seg_start, range_end))

    out: list[date] = []
    for seg_start, seg_end in segments:
        if seg_start > seg_end:
            continue
        proj = projection_rule(rule, seg_start)
        out.extend(
            generate_rule_occurrences(
                proj,
                start_date,
                end_date,
                effective_start=seg_start,
                effective_end=seg_end,
            )
        )
    return sorted(set(out))
