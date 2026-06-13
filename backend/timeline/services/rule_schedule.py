"""Recurring rule schedule segments (future-effective changes without rewriting history)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from typing import Any, Optional

from django.utils import timezone

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


def resolve_rule_params(rule: RecurringRule, as_of_date: date) -> RuleScheduleParams:
    """Parameters for projections on as_of_date (latest schedule with effective_from <= date)."""
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


def sync_rule_row_from_params(rule: RecurringRule, params: RuleScheduleParams) -> None:
    """Keep RecurringRule row aligned with params shown in lists (today's segment)."""
    rule.account_id = params.account_id
    rule.transfer_to_account_id = params.transfer_to_account_id
    rule.category_id = params.category_id
    rule.direction = params.direction
    rule.amount = params.amount
    rule.currency = params.currency
    rule.frequency = params.frequency
    rule.interval = params.interval
    rule.day_of_week = params.day_of_week
    rule.day_of_month = params.day_of_month
    rule.nth_week = params.nth_week
    rule.start_date = params.start_date
    rule.end_date = params.end_date


def promote_due_schedules(*, today: Optional[date] = None, as_of_date: Optional[date] = None) -> None:
    """Apply schedule segments whose effective_from has arrived to the rule row (for list UI)."""
    today = as_of_date or today or timezone.localdate()
    rule_ids = (
        RecurringRuleSchedule.objects.filter(effective_from__lte=today)
        .values_list("rule_id", flat=True)
        .distinct()
    )
    for rule in RecurringRule.objects.filter(pk__in=rule_ids).prefetch_related("schedules"):
        params = resolve_rule_params(rule, today)
        sync_rule_row_from_params(rule, params)
        rule.save(
            update_fields=[
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
            ]
        )


def get_next_scheduled_change(rule: RecurringRule, *, today: Optional[date] = None) -> Optional[RecurringRuleSchedule]:
    today = today or timezone.localdate()
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
        sync_rule_row_from_params(rule, params)
        rule.save(
            update_fields=[
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
