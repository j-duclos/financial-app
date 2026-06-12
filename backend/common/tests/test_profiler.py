"""Profiler utility tests."""
from common.services.profiler import PerfTimer, perf_enabled, phase_end, phase_start


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
