"""Configuration parsing for MINIMUM_PAYMENT_FRESHNESS_DAYS."""
import pytest
from django.core.exceptions import ImproperlyConfigured

from config.settings import _env_positive_int


def test_env_positive_int_uses_default_when_unset(monkeypatch):
    monkeypatch.delenv("MINIMUM_PAYMENT_FRESHNESS_DAYS", raising=False)
    assert _env_positive_int("MINIMUM_PAYMENT_FRESHNESS_DAYS", default=45) == 45


def test_env_positive_int_rejects_non_integer(monkeypatch):
    monkeypatch.setenv("MINIMUM_PAYMENT_FRESHNESS_DAYS", "abc")
    with pytest.raises(ImproperlyConfigured, match="positive integer"):
        _env_positive_int("MINIMUM_PAYMENT_FRESHNESS_DAYS", default=45)


def test_env_positive_int_rejects_zero(monkeypatch):
    monkeypatch.setenv("MINIMUM_PAYMENT_FRESHNESS_DAYS", "0")
    with pytest.raises(ImproperlyConfigured, match="at least 1"):
        _env_positive_int("MINIMUM_PAYMENT_FRESHNESS_DAYS", default=45)
