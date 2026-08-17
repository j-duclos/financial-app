"""Baseline Calendar cost by horizon. Prints CALENDAR_HORIZON_PROFILE lines."""
from __future__ import annotations

import json
import time
from datetime import timedelta

import pytest
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db import connection
from django.test.utils import CaptureQueriesContext

from common.services.profiler import get_build_timeline_count, reset_build_timeline_count
from core.models import Household, HouseholdMembership
from timeline.services.calendar import build_timeline_calendar
from timeline.services.ledger import build_timeline
from timeline.tests.test_calendar_query_efficiency import AS_OF, seed_calendar_fixture

User = get_user_model()

HORIZONS = (
    ("30d", 30),
    ("60d", 60),
    ("90d", 90),
    ("6m", 180),
)


@pytest.fixture
def user(db):
    return User.objects.create_user(username="calprof", password="testpass123")


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="Cal Profile HH")
    HouseholdMembership.objects.create(
        household=h, user=user, role=HouseholdMembership.Role.OWNER
    )
    return h


def _count_rule_rows(rows: list[dict]) -> int:
    n = 0
    for row in rows:
        src = str(row.get("source") or row.get("txn_source") or "").lower()
        if src == "rule" or row.get("rule_id"):
            n += 1
    return n


@pytest.mark.django_db
def test_profile_calendar_horizons(user, household):
    seed_calendar_fixture(user, household, n_checking=5, n_cards=3, n_bills=12)
    print("\nCALENDAR_HORIZON_PROFILE_HEADER")
    for label, days in HORIZONS:
        end = AS_OF + timedelta(days=days)
        cache.clear()
        reset_build_timeline_count()

        t0 = time.perf_counter()
        with CaptureQueriesContext(connection) as ctx:
            rows = build_timeline(
                user,
                start_date=AS_OF,
                end_date=end,
                as_of_date=AS_OF,
                projection_only=True,
                caller="calendar_profile_timeline",
            )
        timeline_ms = (time.perf_counter() - t0) * 1000
        timeline_sql = len(ctx.captured_queries)
        timeline_builds = get_build_timeline_count()
        rule_rows = _count_rule_rows(rows)

        cache.clear()
        reset_build_timeline_count()
        t1 = time.perf_counter()
        with CaptureQueriesContext(connection) as ctx2:
            result = build_timeline_calendar(
                user,
                start_date=AS_OF,
                end_date=end,
                as_of_date=AS_OF,
                projection_only=True,
            )
        calendar_ms = (time.perf_counter() - t1) * 1000
        calendar_sql = len(ctx2.captured_queries)
        calendar_builds = get_build_timeline_count()
        payload = json.dumps(result, default=str)
        payload_bytes = len(payload.encode("utf-8"))
        day_count = len(result["days"])
        txn_count = sum(len(d.get("transactions") or []) for d in result["days"])
        first_two_month_end = AS_OF.replace(day=1)
        if first_two_month_end.month == 12:
            chunk_end = first_two_month_end.replace(year=first_two_month_end.year + 1, month=2, day=1)
        else:
            month = first_two_month_end.month + 2
            year = first_two_month_end.year
            if month > 12:
                month -= 12
                year += 1
            chunk_end = first_two_month_end.replace(year=year, month=month, day=1)
        from datetime import timedelta as td

        chunk_last = chunk_end - td(days=1)
        sliced = [d for d in result["days"] if d["date"] <= chunk_last.isoformat()]
        sliced_bytes = len(json.dumps({"days": sliced, "summary": result["summary"]}, default=str).encode("utf-8"))
        summary_bytes = len(json.dumps(result["summary"], default=str).encode("utf-8"))
        serialize_ms = calendar_ms - timeline_ms
        from timeline.services.calendar import calendar_chunk_payload, calendar_summary_payload
        from timeline.services.calendar_cache import get_or_build_canonical_calendar
        from timeline.services.calendar_chunks import calendar_chunk_windows

        cache.clear()
        reset_build_timeline_count()
        t2 = time.perf_counter()
        with CaptureQueriesContext(connection) as ctx3:
            canonical = get_or_build_canonical_calendar(
                user,
                start_date=AS_OF,
                end_date=end,
                household_id=household.id,
                as_of_date=AS_OF,
                projection_only=True,
            )
        first_build_ms = (time.perf_counter() - t2) * 1000
        first_build_sql = len(ctx3.captured_queries)
        windows = calendar_chunk_windows(AS_OF, end, AS_OF)
        first_chunk = calendar_chunk_payload(canonical, *windows[0])
        first_chunk_bytes = len(json.dumps(first_chunk, default=str).encode("utf-8"))
        summary_only_bytes = len(json.dumps(calendar_summary_payload(canonical), default=str).encode("utf-8"))
        reset_build_timeline_count()
        t3 = time.perf_counter()
        with CaptureQueriesContext(connection) as ctx4:
            get_or_build_canonical_calendar(
                user,
                start_date=AS_OF,
                end_date=end,
                household_id=household.id,
                as_of_date=AS_OF,
                projection_only=True,
            )
        cached_ms = (time.perf_counter() - t3) * 1000
        cached_sql = len(ctx4.captured_queries)
        cached_builds = get_build_timeline_count()
        later_chunk_bytes = 0
        if len(windows) > 1:
            later = calendar_chunk_payload(canonical, *windows[1])
            later_chunk_bytes = len(json.dumps(later, default=str).encode("utf-8"))
        print(
            "CALENDAR_HORIZON_PROFILE "
            f"horizon={label} "
            f"timeline_ms={timeline_ms:.0f} "
            f"calendar_ms={calendar_ms:.0f} "
            f"walk_serialize_ms={serialize_ms:.0f} "
            f"timeline_sql={timeline_sql} "
            f"calendar_sql={calendar_sql} "
            f"timeline_builds={timeline_builds} "
            f"calendar_builds={calendar_builds} "
            f"rule_or_recurring_rows={rule_rows} "
            f"timeline_rows={len(rows)} "
            f"calendar_days={day_count} "
            f"calendar_txns={txn_count} "
            f"payload_bytes={payload_bytes} "
            f"first_chunk_bytes={sliced_bytes} "
            f"summary_bytes={summary_bytes} "
            f"AFTER_first_build_ms={first_build_ms:.0f} "
            f"AFTER_first_build_sql={first_build_sql} "
            f"AFTER_first_chunk_bytes={first_chunk_bytes} "
            f"AFTER_summary_bytes={summary_only_bytes} "
            f"AFTER_cached_ms={cached_ms:.0f} "
            f"AFTER_cached_sql={cached_sql} "
            f"AFTER_cached_builds={cached_builds} "
            f"AFTER_later_chunk_bytes={later_chunk_bytes} "
            f"AFTER_first_chunk_days={len(first_chunk['days'])} "
            f"AFTER_windows={len(windows)}"
        )
    assert True
