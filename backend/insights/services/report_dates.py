"""Canonical report date windows. Selected month is authoritative."""
from __future__ import annotations

from calendar import monthrange
from dataclasses import dataclass
from datetime import date


@dataclass(frozen=True)
class ReportPeriod:
    month: str
    start: date
    end: date
    previous_start: date
    previous_end: date
    history_start: date
    history_end: date
    history_months: int
    anchor: date


def parse_month_str(month: str) -> tuple[int, int]:
    try:
        year_s, month_s = month.split("-")
        year, month_int = int(year_s), int(month_s)
    except (ValueError, TypeError, AttributeError) as exc:
        raise ValueError("month must be YYYY-MM.") from exc
    if month_int < 1 or month_int > 12:
        raise ValueError("month must be YYYY-MM.")
    return year, month_int


def month_start(year: int, month: int) -> date:
    return date(year, month, 1)


def month_end(year: int, month: int) -> date:
    return date(year, month, monthrange(year, month)[1])


def shift_month(year: int, month: int, delta: int) -> tuple[int, int]:
    idx = year * 12 + (month - 1) + delta
    return idx // 12, (idx % 12) + 1


def add_months(d: date, months: int) -> date:
    year, month = shift_month(d.year, d.month, months)
    day = min(d.day, monthrange(year, month)[1])
    return date(year, month, day)


def report_period(month: str, *, history_months: int = 12) -> ReportPeriod:
    """
    Windows for a selected report month.

    For month=2026-08 and history_months=12:
      start/end = 2026-08-01 .. 2026-08-31
      previous  = 2026-07-01 .. 2026-07-31
      history   = 2025-09-01 .. 2026-08-31
    """
    history_months = max(1, min(int(history_months), 36))
    year, month_int = parse_month_str(month)
    start = month_start(year, month_int)
    end = month_end(year, month_int)
    prev_y, prev_m = shift_month(year, month_int, -1)
    hist_y, hist_m = shift_month(year, month_int, -(history_months - 1))
    anchor_day = min(15, end.day)
    return ReportPeriod(
        month=f"{year:04d}-{month_int:02d}",
        start=start,
        end=end,
        previous_start=month_start(prev_y, prev_m),
        previous_end=month_end(prev_y, prev_m),
        history_start=month_start(hist_y, hist_m),
        history_end=end,
        history_months=history_months,
        anchor=date(year, month_int, anchor_day),
    )


def month_key(value) -> str:
    if hasattr(value, "strftime"):
        return value.strftime("%Y-%m")
    return str(value)[:7]
