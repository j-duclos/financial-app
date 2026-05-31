"""
Build scenario timeline by applying what-if edits on top of the real forecast ledger.

Comparison must use the same rows you see in Transactions (actual + planned), not a
separate re-projection that can drop paychecks or flip signs.
"""
from __future__ import annotations

import copy
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal
from typing import Any, Optional

from accounts.models import Account
from timeline.models import RecurringRule, Scenario, ScenarioRuleOverride


def override_changes_timing(ov: ScenarioRuleOverride) -> bool:
    """
    True only when the user intentionally changed schedule boundaries.

    Saved overrides often include the rule's default account/category and a start date
    meaning "raise effective" — that must not delete payroll before that date.
    """
    rule = ov.rule
    if ov.override_end_date is not None:
        return True
    if ov.override_start_date is None:
        return False
    if ov.override_active is not None:
        return True
    if ov.override_account_id is not None and ov.override_account_id != rule.account_id:
        return True
    if ov.override_category_id is not None and ov.override_category_id != rule.category_id:
        return True
    return False
from timeline.services.ledger import (
    _append_scenario_projection_rows,
    _apply_scenario_category_shocks,
    _projected_rule_timeline_row,
    _timeline_row_date,
    append_scenario_added_recurring_projections,
    apply_scenario_overrides,
    dedupe_future_rule_occurrence_rows,
    generate_rule_occurrences,
    recompute_future_timeline_running_balances,
    signed_amount_for_rule,
)


def _future_rule_row(row: dict, rule_id: int, today: date) -> bool:
    rd = _timeline_row_date(row.get("date"))
    return rd is not None and rd >= today and row.get("rule_id") == rule_id


def _date_in_effective_window(
    row_date: date,
    eff_start: date,
    eff_end: date | None,
) -> bool:
    if row_date < eff_start:
        return False
    if eff_end is not None and row_date > eff_end:
        return False
    return True


def _ensure_projected_occurrences(
    rows: list[dict],
    rule: RecurringRule,
    eff: dict[str, Any],
    today: date,
    end_date: date,
    forecastable_account_ids: set[int],
) -> None:
    """Add projected rows for rule dates in range that are not already on the timeline."""
    acc_id = eff.get("account_id") or rule.account_id
    if acc_id not in forecastable_account_ids:
        return
    eff_start = eff.get("start_date") or rule.start_date
    eff_end = eff.get("end_date")
    occ_dates = generate_rule_occurrences(
        rule,
        start_date=today,
        end_date=end_date,
        effective_start=eff_start,
        effective_end=eff_end,
    )
    raw_amount = eff.get("amount") or rule.amount
    amount_decimal = signed_amount_for_rule(rule, Decimal(str(raw_amount)))
    cat_id = eff.get("category_id") or rule.category_id
    cat_name = rule.category.name if rule.category else None
    acc_name = rule.account.name if rule.account else ""

    existing = {
        (r.get("rule_id"), _timeline_row_date(r.get("date")), r.get("account_id"))
        for r in rows
        if r.get("rule_id") == rule.id
    }

    for d in occ_dates:
        if d < today:
            continue
        key = (rule.id, d, acc_id)
        if key in existing:
            continue
        rows.append(
            _projected_rule_timeline_row(
                d=d,
                description=rule.name,
                account_id=acc_id,
                account_name=acc_name,
                category_id=cat_id,
                category_name=cat_name,
                amount=amount_decimal,
                row_type=rule.direction,
                rule_id=rule.id,
                sort_key=(d, 1, rule.id),
            )
        )


def build_scenario_timeline_from_base(
    base_rows: list[dict],
    scenario: Scenario,
    *,
    today: date,
    end_date: date,
    forecastable_account_ids: set[int],
) -> list[dict]:
    """Apply scenario overrides/events to a copy of the base forecast timeline."""
    rows: list[dict] = [copy.deepcopy(r) for r in base_rows]
    rows = dedupe_future_rule_occurrence_rows(rows, today)
    rows = [r for r in rows if r.get("source") not in ("scenario_event", "scenario_added_recurring")]

    overrides = ScenarioRuleOverride.objects.filter(scenario=scenario).select_related(
        "rule", "rule__account", "rule__category"
    )

    for ov in overrides:
        rule = ov.rule
        eff = apply_scenario_overrides(rule, scenario)
        if not eff.get("active", True):
            rows = [r for r in rows if not _future_rule_row(r, rule.id, today)]
            continue

        timing_changed = override_changes_timing(ov)
        eff_start = rule.start_date
        if timing_changed:
            eff_start = eff.get("start_date") or rule.start_date
        if eff_start < today:
            eff_start = today
        eff_end = eff.get("end_date") if timing_changed else rule.end_date

        if timing_changed:
            rows = [
                r
                for r in rows
                if not _future_rule_row(r, rule.id, today)
                or _date_in_effective_window(_timeline_row_date(r["date"]), eff_start, eff_end)
            ]

        amount_changed = ov.override_amount is not None
        if amount_changed:
            new_amt = Decimal(str(eff["amount"]))
            for r in rows:
                if not _future_rule_row(r, rule.id, today):
                    continue
                rd = _timeline_row_date(r.get("date"))
                if rd is None or not _date_in_effective_window(rd, eff_start, eff_end):
                    continue
                signed = signed_amount_for_rule(rule, new_amt, r)
                r["amount"] = signed
                r["type"] = "INFLOW" if signed >= 0 else "OUTFLOW"

        if ov.override_account_id is not None:
            new_aid = eff.get("account_id") or rule.account_id
            new_name = Account.objects.filter(pk=new_aid).values_list("name", flat=True).first()
            if not new_name and rule.account:
                new_name = rule.account.name
            for r in rows:
                if _future_rule_row(r, rule.id, today):
                    r["account_id"] = new_aid
                    if new_name:
                        r["account_name"] = new_name

        if timing_changed or amount_changed:
            _ensure_projected_occurrences(
                rows, rule, eff, today, end_date, forecastable_account_ids
            )

    _append_scenario_projection_rows(rows, scenario, today, end_date)
    seen_added: set[tuple] = set()
    append_scenario_added_recurring_projections(
        scenario=scenario,
        rows=rows,
        start_date=today,
        end_date=end_date,
        forecastable_account_ids=forecastable_account_ids,
        seen_keys=seen_added,
    )
    _apply_scenario_category_shocks(rows, scenario)

    account_ids = {r.get("account_id") for r in rows if r.get("account_id") is not None}

    rows = dedupe_future_rule_occurrence_rows(rows, today)
    recompute_future_timeline_running_balances(
        rows, today=today, account_ids=account_ids
    )
    return rows
