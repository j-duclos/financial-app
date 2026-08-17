"""Month-chunk windows for progressive Calendar loading.

Chunking is a delivery/render concern. The canonical forecast still covers the
full selected range; these windows only describe which days to return or mount.
"""
from __future__ import annotations

from calendar import monthrange
from datetime import date, timedelta

# Ranges at or under this many days are returned as a single chunk.
SHORT_RANGE_DAYS = 62
DEFAULT_MONTHS_PER_CHUNK = 2


def _month_end(d: date) -> date:
    return date(d.year, d.month, monthrange(d.year, d.month)[1])


def _add_months(d: date, months: int) -> date:
    month_index = d.month - 1 + months
    year = d.year + month_index // 12
    month = month_index % 12 + 1
    day = min(d.day, monthrange(year, month)[1])
    return date(year, month, day)


def calendar_chunk_windows(
    start: date,
    end: date,
    as_of: date,
    *,
    months_per_chunk: int = DEFAULT_MONTHS_PER_CHUNK,
) -> list[tuple[date, date]]:
    """
    Split [start, end] into month chunks.

    Short ranges (about 30–60 days) are a single window.
    Longer ranges start with the as-of month plus the next month (clipped to
    the selected range), then continue in ``months_per_chunk`` steps.
    """
    if start > end:
        return []
    span_days = (end - start).days + 1
    if span_days <= SHORT_RANGE_DAYS:
        return [(start, end)]

    months_per_chunk = max(1, months_per_chunk)
    first_month = date(as_of.year, as_of.month, 1)
    first_end_month = _add_months(first_month, months_per_chunk - 1)
    first_end = min(end, _month_end(first_end_month))
    if first_end < start:
        first_end = min(end, _month_end(start))

    windows = [(start, first_end)]
    cursor = first_end + timedelta(days=1)
    while cursor <= end:
        last_month = _add_months(date(cursor.year, cursor.month, 1), months_per_chunk - 1)
        chunk_end = min(end, _month_end(last_month))
        windows.append((cursor, chunk_end))
        cursor = chunk_end + timedelta(days=1)
    return windows
