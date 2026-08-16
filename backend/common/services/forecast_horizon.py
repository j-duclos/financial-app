"""
Forecast window tiers and request parsing.

Operational screens (Dashboard, Action Center, Transactions) default to 30 days.
Longer windows (60, 90, 180) run only when the client passes days or forecast_days
explicitly — never precomputed alongside the default window.
"""
from __future__ import annotations

from accounts.services.available_to_spend import (
    ALLOWED_FORECAST_DAYS,
    DEFAULT_FORECAST_DAYS,
    normalize_forecast_days,
)

PASSIVE_FORECAST_DAYS = frozenset({7, 14, 30})
ADVANCED_FORECAST_DAYS = frozenset({60, 90, 180, 365})
# Saved Settings default + Dashboard / Action Center / Transactions selectors.
OPERATIONAL_FORECAST_WINDOW_DAYS = frozenset({30, 60, 90, 180})
PASSIVE_DEFAULT_FORECAST_DAYS = DEFAULT_FORECAST_DAYS  # 30
ADVANCED_DEFAULT_FORECAST_DAYS = 90
MAX_TIMELINE_FORECAST_LOOKAHEAD_DAYS = 365


def parse_forecast_days_param(
    request,
    *,
    default: int = PASSIVE_DEFAULT_FORECAST_DAYS,
    allow_extended: bool = True,
) -> int:
    """
    Parse ``days`` or ``forecast_days`` query param.

    Passive endpoints default to 30. Extended values are accepted only
    when explicitly passed and ``allow_extended`` is True.
    """
    raw = request.query_params.get("forecast_days")
    if raw is None or raw == "":
        raw = request.query_params.get("days")
    if raw is None or raw == "":
        return normalize_forecast_days(default)
    try:
        days = normalize_forecast_days(int(raw))
    except (TypeError, ValueError) as exc:
        raise ValueError(
            f"Invalid Forecast Window — use one of {sorted(ALLOWED_FORECAST_DAYS)}."
        ) from exc
    if not allow_extended and days in ADVANCED_FORECAST_DAYS:
        raise ValueError(
            f"Forecast Window {days} days requires an advanced forecasting endpoint. "
            f"Use one of {sorted(PASSIVE_FORECAST_DAYS)}."
        )
    return days


def normalize_operational_forecast_days(days: int | None) -> int:
    """Clamp a saved/requested operational window to 30 / 60 / 90 / 180."""
    if days in OPERATIONAL_FORECAST_WINDOW_DAYS:
        return int(days)
    return PASSIVE_DEFAULT_FORECAST_DAYS


def horizon_span_days(start_date, end_date) -> int:
    """Inclusive calendar span for build_timeline logging."""
    return max((end_date - start_date).days, 0)


def snap_span_to_forecast_days(span: int) -> int:
    """Map a raw day span to the nearest allowed forecast bucket (ceiling)."""
    span = max(span, 1)
    for days in sorted(ALLOWED_FORECAST_DAYS):
        if span <= days:
            return days
    return max(ALLOWED_FORECAST_DAYS)
