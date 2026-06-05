"""Tests for forecast horizon tier parsing."""
from types import SimpleNamespace

import pytest

from common.services.forecast_horizon import (
    PASSIVE_DEFAULT_FORECAST_DAYS,
    parse_forecast_days_param,
    snap_span_to_forecast_days,
)


def _request(**params):
    return SimpleNamespace(query_params=params)


class TestParseForecastDaysParam:
    def test_defaults_to_passive_30(self):
        assert parse_forecast_days_param(_request()) == PASSIVE_DEFAULT_FORECAST_DAYS

    def test_accepts_days_alias(self):
        assert parse_forecast_days_param(_request(days="14")) == 14

    def test_forecast_days_takes_precedence_over_days(self):
        assert parse_forecast_days_param(_request(forecast_days="60", days="30")) == 60

    def test_rejects_invalid_value(self):
        with pytest.raises(ValueError, match="Invalid forecast horizon"):
            parse_forecast_days_param(_request(days="45"))

    def test_accepts_extended_when_explicit(self):
        assert parse_forecast_days_param(_request(forecast_days="90")) == 90

    def test_rejects_extended_when_not_allowed(self):
        with pytest.raises(ValueError, match="advanced forecasting"):
            parse_forecast_days_param(
                _request(forecast_days="60"), allow_extended=False
            )


class TestSnapSpanToForecastDays:
    def test_snaps_to_ceiling_bucket(self):
        assert snap_span_to_forecast_days(1) == 7
        assert snap_span_to_forecast_days(8) == 14
        assert snap_span_to_forecast_days(31) == 60
        assert snap_span_to_forecast_days(200) == 90
