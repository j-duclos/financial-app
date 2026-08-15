from datetime import date

import pytest

from insights.services.report_dates import report_period, shift_month, month_end


@pytest.mark.parametrize(
    "month,start,end,prev_start,prev_end,history_start",
    [
        ("2026-08", date(2026, 8, 1), date(2026, 8, 31), date(2026, 7, 1), date(2026, 7, 31), date(2025, 9, 1)),
        ("2026-01", date(2026, 1, 1), date(2026, 1, 31), date(2025, 12, 1), date(2025, 12, 31), date(2025, 2, 1)),
        ("2026-12", date(2026, 12, 1), date(2026, 12, 31), date(2026, 11, 1), date(2026, 11, 30), date(2026, 1, 1)),
        ("2024-02", date(2024, 2, 1), date(2024, 2, 29), date(2024, 1, 1), date(2024, 1, 31), date(2023, 3, 1)),
        ("2025-02", date(2025, 2, 1), date(2025, 2, 28), date(2025, 1, 1), date(2025, 1, 31), date(2024, 3, 1)),
        ("2025-06", date(2025, 6, 1), date(2025, 6, 30), date(2025, 5, 1), date(2025, 5, 31), date(2024, 7, 1)),
    ],
)
def test_report_period_windows(month, start, end, prev_start, prev_end, history_start):
    period = report_period(month, history_months=12)
    assert period.month == month
    assert period.start == start
    assert period.end == end
    assert period.previous_start == prev_start
    assert period.previous_end == prev_end
    assert period.history_start == history_start
    assert period.history_end == end
    assert period.anchor.day == min(15, end.day)


def test_shift_month_crosses_year():
    assert shift_month(2026, 1, -1) == (2025, 12)
    assert shift_month(2026, 12, 1) == (2027, 1)


def test_month_end_leap_february():
    assert month_end(2024, 2) == date(2024, 2, 29)
    assert month_end(2025, 2) == date(2025, 2, 28)


def test_invalid_month_raises():
    with pytest.raises(ValueError):
        report_period("2026-13")
    with pytest.raises(ValueError):
        report_period("August")
