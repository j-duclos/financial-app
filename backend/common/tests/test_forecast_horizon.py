"""Tests for forecast horizon tier parsing."""
from types import SimpleNamespace

import pytest

from billing.entitlements import EntitlementDenied
from billing.tests.helpers import grant_premium
from common.services.forecast_horizon import (
    EXTENDED_CASH_RISK_DAYS,
    PASSIVE_DEFAULT_FORECAST_DAYS,
    normalize_operational_forecast_days,
    parse_forecast_days_param,
    snap_span_to_forecast_days,
)


def _request(user=None, **params):
    return SimpleNamespace(query_params=params, user=user)


class TestParseForecastDaysParam:
    def test_defaults_to_passive_30(self):
        assert parse_forecast_days_param(_request()) == PASSIVE_DEFAULT_FORECAST_DAYS

    def test_accepts_days_alias(self):
        assert parse_forecast_days_param(_request(days="14")) == 14

    def test_forecast_days_takes_precedence_over_days(self):
        assert parse_forecast_days_param(_request(forecast_days="60", days="30")) == 60

    def test_rejects_invalid_value(self):
        with pytest.raises(ValueError, match="Invalid Forecast Window"):
            parse_forecast_days_param(_request(days="45"))

    def test_accepts_extended_when_explicit(self):
        assert parse_forecast_days_param(_request(forecast_days="90")) == 90

    def test_rejects_extended_when_not_allowed(self):
        with pytest.raises(ValueError, match="advanced forecasting"):
            parse_forecast_days_param(
                _request(forecast_days="60"), allow_extended=False
            )


@pytest.mark.django_db
class TestParseForecastDaysEntitlements:
    def test_free_explicit_180_raises_entitlement(self, user):
        with pytest.raises(EntitlementDenied) as exc:
            parse_forecast_days_param(_request(user, forecast_days="180"))
        assert exc.value.entitlement_code == "premium_required"
        assert exc.value.feature == "operational_forecast_days"
        assert exc.value.limit == 90

    def test_free_explicit_365_raises_entitlement(self, user):
        with pytest.raises(EntitlementDenied) as exc:
            parse_forecast_days_param(_request(user, days="365"))
        assert exc.value.feature == "operational_forecast_days"
        assert exc.value.limit == 90

    def test_free_explicit_90_allowed(self, user):
        assert parse_forecast_days_param(_request(user, forecast_days="90")) == 90

    def test_premium_explicit_180_and_365_allowed(self, user):
        grant_premium(user)
        assert parse_forecast_days_param(_request(user, forecast_days="180")) == 180
        assert parse_forecast_days_param(_request(user, forecast_days="365")) == 365

    def test_invalid_value_is_validation_not_premium(self, user):
        with pytest.raises(ValueError, match="Invalid Forecast Window"):
            parse_forecast_days_param(_request(user, forecast_days="45"))

    def test_passive_default_above_plan_clamps_without_error(self, user):
        assert parse_forecast_days_param(_request(user), default=180) == 90
        assert parse_forecast_days_param(_request(user), default=365) == 90
        assert parse_forecast_days_param(_request(user), default=30) == 30


class TestSnapSpanToForecastDays:
    def test_snaps_to_ceiling_bucket(self):
        assert snap_span_to_forecast_days(1) == 7
        assert snap_span_to_forecast_days(8) == 14
        assert snap_span_to_forecast_days(31) == 60
        assert snap_span_to_forecast_days(200) == 365


class TestNormalizeOperationalForecastDays:
    def test_defaults_and_clamps_to_30(self):
        assert normalize_operational_forecast_days(None) == 30
        assert normalize_operational_forecast_days(1) == 30
        assert normalize_operational_forecast_days(45) == 30
        assert normalize_operational_forecast_days(9999) == 30

    def test_accepts_operational_set(self):
        assert normalize_operational_forecast_days(30) == 30
        assert normalize_operational_forecast_days(60) == 60
        assert normalize_operational_forecast_days(90) == 90
        assert normalize_operational_forecast_days(180) == 180
        assert normalize_operational_forecast_days(365) == 365


def test_extended_cash_risk_horizon_is_six_months():
    assert EXTENDED_CASH_RISK_DAYS == 180
