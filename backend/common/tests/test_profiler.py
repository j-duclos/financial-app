"""Profiler utility tests."""
from common.services.profiler import (
    PerfTimer,
    enter_build_timeline_context,
    exit_build_timeline_context,
    perf_enabled,
    phase_end,
    phase_start,
    projection_only_build_active,
    record_materialized_transaction,
    get_materialized_transaction_count,
)


def test_perf_timer_accumulates_phases():
    timer = PerfTimer()
    token = phase_start(timer, "alpha")
    phase_end(timer, token)
    assert "alpha" in timer.phases
    assert timer.phases["alpha"] >= 0


def test_perf_enabled_follows_debug_setting(settings):
    settings.DEBUG = False
    settings.ENABLE_PERF_LOGS = False
    assert perf_enabled() is False
    settings.DEBUG = True
    assert perf_enabled() is True
    settings.DEBUG = False
    settings.ENABLE_PERF_LOGS = True
    assert perf_enabled() is True


def test_projection_only_build_context():
    enter_build_timeline_context(projection_only=True)
    try:
        assert projection_only_build_active() is True
        assert get_materialized_transaction_count() == 0
        record_materialized_transaction()
        assert get_materialized_transaction_count() == 1
    finally:
        exit_build_timeline_context()
    assert projection_only_build_active() is False
    assert get_materialized_transaction_count() == 0
