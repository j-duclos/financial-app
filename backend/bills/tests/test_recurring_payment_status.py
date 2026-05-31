"""Dashboard missed/due-soon counts must match the Recurring page."""
from datetime import date

from bills.bill_insights import DISPLAY_DUE_SOON, DISPLAY_LATE, build_checklist_warnings
from bills.recurring_payment_status import (
    compute_recurring_payment_counts,
    derive_recurring_payment_status,
    pick_checklist_occurrence_for_rule,
)


class _FakeRule:
    def __init__(
        self,
        rule_id: int,
        *,
        active: bool = True,
        end_date: date | None = None,
        paused_at=None,
        start_date: date | None = None,
    ):
        self.id = rule_id
        self.active = active
        self.end_date = end_date
        self.paused_at = paused_at
        self.start_date = start_date or date(2025, 1, 1)
        self.frequency = "MONTHLY_DAY"
        self.day_of_month = 5
        self.interval = 1
        self.day_of_week = 0
        self.nth_week = 1


def test_manual_late_rows_do_not_inflate_missed_count():
    today = date(2026, 6, 15)
    rules = [_FakeRule(1), _FakeRule(2), _FakeRule(3)]
    items = [
        {"id": 101, "rule_id": 1, "status": DISPLAY_LATE, "due_date": "2026-06-01", "skipped": False},
        {"id": 102, "rule_id": 2, "status": DISPLAY_LATE, "due_date": "2026-06-05", "skipped": False},
        {"id": 103, "rule_id": 3, "status": DISPLAY_LATE, "due_date": "2026-06-10", "skipped": False},
        # Manual / one-off rows (no rule_id) — checklist-only, not on Recurring page
        {"id": 201, "rule_id": None, "status": DISPLAY_LATE, "due_date": "2026-06-02", "skipped": False},
        {"id": 202, "rule_id": None, "status": DISPLAY_LATE, "due_date": "2026-06-03", "skipped": False},
        {"id": 203, "rule_id": None, "status": DISPLAY_LATE, "due_date": "2026-06-04", "skipped": False},
    ]
    missed, due_soon = compute_recurring_payment_counts(rules, items, today=today)
    assert missed == 3
    assert due_soon == 0


def test_aggregate_warning_uses_recurring_missed_count():
    today = date(2026, 6, 15)
    items = [
        {"id": 1, "rule_id": 10, "status": DISPLAY_LATE, "due_date": "2026-06-01", "skipped": False, "warnings": []},
        {"id": 2, "rule_id": None, "status": DISPLAY_LATE, "due_date": "2026-06-02", "skipped": False, "warnings": []},
    ]
    warnings = build_checklist_warnings(items, today=today, missed_bill_count=1)
    assert not any(w["id"] == "multiple-late" for w in warnings)

    warnings = build_checklist_warnings(items, today=today, missed_bill_count=3)
    assert warnings[0]["message"] == "3 bills missed this month"


def test_biweekly_picks_one_occurrence_per_rule():
    today = date(2026, 6, 20)
    items = [
        {"id": 1, "rule_id": 5, "status": DISPLAY_LATE, "due_date": "2026-06-01", "skipped": False},
        {"id": 2, "rule_id": 5, "status": DISPLAY_LATE, "due_date": "2026-06-15", "skipped": False},
    ]
    picked = pick_checklist_occurrence_for_rule(items, 5, today)
    assert picked is not None
    assert picked["due_date"] == "2026-06-15"
    status = derive_recurring_payment_status(_FakeRule(5), picked, today=today)
    assert status == "missed"


def test_due_soon_not_counted_as_missed():
    today = date(2026, 6, 15)
    rules = [_FakeRule(1)]
    items = [
        {
            "id": 1,
            "rule_id": 1,
            "status": DISPLAY_DUE_SOON,
            "due_date": "2026-06-18",
            "skipped": False,
            "days_until_due": 3,
        },
    ]
    missed, due_soon = compute_recurring_payment_counts(rules, items, today=today)
    assert missed == 0
    assert due_soon == 1
