"""Tests for bill display status and checklist warning rollups."""
from datetime import date

from bills.bill_insights import (
    DISPLAY_DUE_SOON,
    DISPLAY_LATE,
    build_checklist_warnings,
    count_late_occurrences,
    count_late_recurring_bills,
    format_late_bills_message,
)


def test_late_count_is_per_rule_not_per_occurrence():
    items = [
        {"id": 1, "rule_id": 10, "status": DISPLAY_LATE, "skipped": False, "warnings": []},
        {"id": 2, "rule_id": 10, "status": DISPLAY_LATE, "skipped": False, "warnings": []},
        {"id": 3, "rule_id": 11, "status": DISPLAY_LATE, "skipped": False, "warnings": []},
    ]
    assert count_late_occurrences(items) == 3
    assert count_late_recurring_bills(items) == 2


def test_aggregate_warning_uses_missed_not_overdue():
    items = [
        {"id": 1, "rule_id": 10, "status": DISPLAY_LATE, "skipped": False, "warnings": []},
        {"id": 2, "rule_id": 11, "status": DISPLAY_LATE, "skipped": False, "warnings": []},
    ]
    warnings = build_checklist_warnings(items, today=date(2026, 6, 15))
    assert warnings[0]["id"] == "multiple-late"
    assert warnings[0]["message"] == format_late_bills_message(2)
    assert "overdue" not in warnings[0]["message"].lower()


def test_due_soon_not_included_in_late_counts():
    items = [
        {"id": 1, "rule_id": 10, "status": DISPLAY_DUE_SOON, "skipped": False, "warnings": []},
        {"id": 2, "rule_id": 11, "status": DISPLAY_DUE_SOON, "skipped": False, "warnings": []},
    ]
    assert count_late_recurring_bills(items) == 0
    warnings = build_checklist_warnings(items, today=date(2026, 6, 15))
    assert not any(w["id"] == "multiple-late" for w in warnings)
