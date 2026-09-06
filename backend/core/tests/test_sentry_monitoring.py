"""Sentry monitoring is optional and must not affect API availability."""

from unittest.mock import patch

import pytest
from django.test import Client

from config.sentry import init_sentry, monitoring_enabled
from config.sentry_scrub import is_sensitive_key, scrub_sentry_event


@pytest.fixture(autouse=True)
def _reset_sentry_flag():
    import config.sentry as sentry_mod

    previous = sentry_mod._enabled
    sentry_mod._enabled = False
    yield
    sentry_mod._enabled = previous


def test_health_does_not_depend_on_sentry(client: Client):
    assert monitoring_enabled() is False
    response = client.get("/health/")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] in ("ok", "degraded")
    assert "sentry" not in body


def test_init_sentry_noop_without_dsn(monkeypatch):
    monkeypatch.setenv("SENTRY_DSN", "")
    assert init_sentry() is False
    assert monitoring_enabled() is False


def test_init_sentry_when_dsn_configured(monkeypatch):
    sentry_sdk = pytest.importorskip("sentry_sdk")
    monkeypatch.setenv("SENTRY_DSN", "https://public@example.com/1")
    monkeypatch.setenv("SENTRY_ENVIRONMENT", "staging")
    monkeypatch.setenv("SENTRY_RELEASE", "abc123")
    with (
        patch.object(sentry_sdk, "init") as init,
        patch("sentry_sdk.integrations.django.DjangoIntegration", return_value="django-integration"),
    ):
        assert init_sentry() is True
    init.assert_called_once()
    kwargs = init.call_args.kwargs
    assert kwargs["dsn"] == "https://public@example.com/1"
    assert kwargs["environment"] == "staging"
    assert kwargs["release"] == "abc123"
    assert kwargs["send_default_pii"] is False
    assert kwargs["traces_sample_rate"] == 0
    assert kwargs["before_send"] is not None
    assert monitoring_enabled() is True


def test_sensitive_keys_exact_match_only():
    assert is_sensitive_key("password")
    assert is_sensitive_key("access_token")
    assert is_sensitive_key("Authorization")
    assert not is_sensitive_key("plaid")
    assert not is_sensitive_key("compass")
    assert not is_sensitive_key("memo_count")


def test_scrubber_removes_authorization_and_token_fields():
    event = scrub_sentry_event(
        {
            "user": {"id": 42, "email": "user@example.com", "username": "pat"},
            "request": {
                "headers": {
                    "Authorization": "Bearer secret-jwt",
                    "Cookie": "session=abc",
                    "Content-Type": "application/json",
                },
                "cookies": {"sessionid": "abc"},
                "data": {"password": "hunter2", "memo": "Rent", "amount": "12.00"},
                "query_string": "token=reset-secret&uid=MQ",
            },
            "extra": {
                "password": "hunter2",
                "access_token": "access-sandbox-abcdefghijklmnopqrstuvwxyz",
                "payee": "Acme Payroll",
                "status_code": 400,
            },
            "exception": {
                "values": [
                    {
                        "value": "Plaid error token=access-sandbox-abcdefghijklmnopqrstuvwxyz"
                    }
                ]
            },
        }
    )
    assert event["user"] == {"id": 42}
    headers = event["request"]["headers"]
    assert headers["Authorization"] == "[Filtered]"
    assert headers["Cookie"] == "[Filtered]"
    assert headers["Content-Type"] == "application/json"
    assert event["request"]["cookies"] == "[Filtered]"
    assert event["request"]["data"] == "[Filtered]"
    assert event["request"]["query_string"] == "[Filtered]"
    assert event["extra"]["password"] == "[Filtered]"
    assert event["extra"]["access_token"] == "[Filtered]"
    assert event["extra"]["payee"] == "[Filtered]"
    assert event["extra"]["status_code"] == 400
    assert "[Filtered]" in event["exception"]["values"][0]["value"]
    assert "access-sandbox-" not in event["exception"]["values"][0]["value"]
