"""Tests for status-appropriate contribution recommendation copy."""
from decimal import Decimal

from goals.forecast_insights import (
    PACE_AHEAD,
    PACE_BEHIND,
    PACE_COMPLETED,
    PACE_ON_TRACK,
    PACE_STALLED,
    contribution_recommendation_text,
)


def test_recommendation_behind_uses_need_wording():
    text = contribution_recommendation_text(
        {"suggested_monthly": "6192.45", "suggested_biweekly": None},
        Decimal("500.00"),
        pace_status=PACE_BEHIND,
    )
    assert text is not None
    assert "Need $6192.45/month to reach your target date" in text
    assert "stay on pace" not in text


def test_recommendation_on_track_uses_continue_wording():
    text = contribution_recommendation_text(
        {"suggested_monthly": "500.00", "suggested_biweekly": "230.77"},
        Decimal("0.00"),
        pace_status=PACE_ON_TRACK,
    )
    assert text is not None
    assert text.startswith("Continue $500.00/month to stay on pace")
    assert "$230.77/paycheck" in text


def test_recommendation_ahead_without_gap():
    text = contribution_recommendation_text(
        {"suggested_monthly": "500.00", "suggested_biweekly": None},
        Decimal("0.00"),
        pace_status=PACE_AHEAD,
    )
    assert text == "On track for your target date"


def test_recommendation_ahead_with_gap():
    text = contribution_recommendation_text(
        {"suggested_monthly": "500.00", "suggested_biweekly": None},
        Decimal("25.00"),
        pace_status=PACE_AHEAD,
    )
    assert text == "Add $25.00/month to stay on pace"


def test_recommendation_stalled():
    text = contribution_recommendation_text(
        {"suggested_monthly": "800.00", "suggested_biweekly": None},
        None,
        pace_status=PACE_STALLED,
    )
    assert text == "Need $800.00/month to reach your target date"


def test_recommendation_completed():
    text = contribution_recommendation_text({}, None, pace_status=PACE_COMPLETED)
    assert text == "Goal completed"
