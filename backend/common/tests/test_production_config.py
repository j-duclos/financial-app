from io import StringIO

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import override_settings

from common.services.production_config import (
    build_billing_report,
    build_email_report,
    build_plaid_report,
    build_production_health_report,
    format_report,
    report_contains_secrets,
    stripe_secret_mode,
)
from plaid_link.plaid_api_client import plaid_api_env


INJECTED_SECRETS = [
    "sk_test_THIS_MUST_NOT_PRINT",
    "whsec_THIS_MUST_NOT_PRINT",
    "price_THIS_MUST_NOT_PRINT",
    "super-secret-smtp-password",
]


def test_stripe_secret_mode_from_prefix():
    assert stripe_secret_mode("sk_test_abc") == "test"
    assert stripe_secret_mode("sk_live_abc") == "live"
    assert stripe_secret_mode("") == "missing"
    assert stripe_secret_mode("rk_test_abc") == "unknown"


@override_settings(
    STRIPE_SECRET_KEY="sk_test_THIS_MUST_NOT_PRINT",
    STRIPE_WEBHOOK_SECRET="whsec_THIS_MUST_NOT_PRINT",
    STRIPE_PREMIUM_PRICE_ID="price_THIS_MUST_NOT_PRINT",
    FRONTEND_ORIGIN="https://flowsight360.com",
    BILLING_SUCCESS_URL="",
    BILLING_CANCEL_URL="",
)
def test_billing_report_omits_secrets_and_price_ids():
    text = format_report(build_billing_report(probe_stripe=False))
    assert "STRIPE_SECRET_KEY: configured" in text
    assert "STRIPE_SECRET_MODE: test" in text
    assert "STRIPE_PREMIUM_PRICE_ID: configured" in text
    assert "STRIPE_WEBHOOK_SECRET: configured" in text
    assert "FRONTEND_ORIGIN: configured" in text
    assert "BILLING_SUCCESS_URL: default" in text
    assert "BILLING_CANCEL_URL: default" in text
    assert report_contains_secrets(text, INJECTED_SECRETS) == []
    assert "sk_test_" not in text
    assert "whsec_" not in text
    assert "price_" not in text


@override_settings(
    STRIPE_SECRET_KEY="",
    STRIPE_WEBHOOK_SECRET="",
    STRIPE_PREMIUM_PRICE_ID="",
    FRONTEND_ORIGIN="",
    BILLING_SUCCESS_URL="",
    BILLING_CANCEL_URL="",
)
def test_billing_report_works_when_config_is_missing(monkeypatch):
    monkeypatch.delenv("RENDER_EXTERNAL_URL", raising=False)
    text = format_report(build_billing_report(probe_stripe=False))
    assert "STRIPE_SECRET_KEY: missing" in text
    assert "STRIPE_SECRET_MODE: missing" in text
    assert "FRONTEND_ORIGIN: missing" in text
    assert "STRIPE_API_REACHABLE: skipped" in text


@override_settings(
    EMAIL_BACKEND="django.core.mail.backends.smtp.EmailBackend",
    EMAIL_HOST="smtp.example.com",
    EMAIL_PORT=587,
    EMAIL_USE_TLS=True,
    EMAIL_USE_SSL=False,
    EMAIL_HOST_PASSWORD="super-secret-smtp-password",
    DEFAULT_FROM_EMAIL="noreply@flowsight360.com",
    FRONTEND_ORIGIN="https://flowsight360.com",
)
def test_email_report_omits_passwords():
    text = format_report(build_email_report())
    assert "EMAIL_BACKEND: django.core.mail.backends.smtp.EmailBackend" in text
    assert "SMTP_HOST: configured yes" in text
    assert "SMTP_PORT: 587" in text
    assert "TLS/SSL: TLS" in text
    assert "DEFAULT_FROM_EMAIL: noreply@flowsight360.com" in text
    assert "FRONTEND_ORIGIN: configured yes" in text
    assert "super-secret-smtp-password" not in text
    assert "PASSWORD_RESET_REQUEST_ENDPOINT: /api/auth/forgot-password/" in text
    assert "PASSWORD_RESET_COMPLETE_ENDPOINT: /api/auth/reset-password/" in text


@override_settings(
    EMAIL_BACKEND="django.core.mail.backends.console.EmailBackend",
    EMAIL_HOST="",
    FRONTEND_ORIGIN="",
    DEFAULT_FROM_EMAIL="noreply@localhost",
)
def test_email_report_works_when_smtp_missing(monkeypatch):
    monkeypatch.delenv("RENDER_EXTERNAL_URL", raising=False)
    text = format_report(build_email_report())
    assert "SMTP_HOST: configured no" in text
    assert "FRONTEND_ORIGIN: configured no" in text
    assert "FRONTEND_ORIGIN" in dict(build_email_report())["PASSWORD_RESET_REMAINING"]
    assert "PASSWORD_RESET_REMAINING" in text


def test_plaid_env_defaults_to_sandbox_in_development(monkeypatch, settings):
    settings.DEBUG = True
    monkeypatch.delenv("PLAID_ENV", raising=False)
    monkeypatch.delenv("RENDER", raising=False)
    assert plaid_api_env() == "sandbox"
    text = format_report(build_plaid_report())
    assert "implicit development default" in text


def test_plaid_env_production_refuses_sandbox_fallback(monkeypatch, settings):
    settings.DEBUG = False
    monkeypatch.delenv("PLAID_ENV", raising=False)
    monkeypatch.setenv("RENDER", "true")
    with pytest.raises(RuntimeError, match="sandbox default is not allowed"):
        plaid_api_env()
    text = format_report(build_plaid_report())
    assert "PLAID_ENV: missing" in text
    assert "sandbox fallback refused" in text


def test_plaid_env_explicit_production(monkeypatch, settings):
    settings.DEBUG = False
    monkeypatch.setenv("PLAID_ENV", "production")
    monkeypatch.setenv("PLAID_CLIENT_ID", "client-id")
    monkeypatch.setenv("PLAID_PRODUCTION_SECRET", "prod-secret")
    assert plaid_api_env() == "production"
    text = format_report(build_plaid_report())
    assert "PLAID_ENV: production" in text
    assert "PLAID_CLIENT_ID: configured" in text
    assert "PLAID_SECRET: configured" in text
    assert "prod-secret" not in text
    assert "client-id" not in text


def test_settings_source_refuses_missing_plaid_env_in_production():
    from pathlib import Path

    source = Path(__file__).resolve().parents[2].joinpath("config/settings.py").read_text()
    assert "PLAID_ENV must be set explicitly when DEBUG is False" in source
    assert "implicit sandbox default is not allowed in production" in source


@override_settings(FRONTEND_ORIGIN="")
def test_production_health_operates_when_config_is_missing(monkeypatch):
    monkeypatch.delenv("RENDER_EXTERNAL_URL", raising=False)
    monkeypatch.delenv("PLAID_ENV", raising=False)
    monkeypatch.delenv("PLAID_CLIENT_ID", raising=False)
    monkeypatch.delenv("STRIPE_SECRET_KEY", raising=False)
    text = format_report(build_production_health_report(probe_stripe=False))
    assert "database:" in text
    assert "redis:" in text
    assert "email_configured:" in text
    assert "stripe_configured:" in text
    assert "plaid_configured:" in text
    assert "frontend_origin_configured:" in text
    assert report_contains_secrets(text, INJECTED_SECRETS) == []


def test_management_commands_write_safe_output(monkeypatch):
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_live_COMMAND_SECRET")
    out = StringIO()
    call_command("check_billing_config", "--offline", stdout=out)
    billing = out.getvalue()
    assert "STRIPE_SECRET_KEY:" in billing
    assert "sk_live_COMMAND_SECRET" not in billing

    out = StringIO()
    call_command("check_email_config", stdout=out)
    email = out.getvalue()
    assert "EMAIL_BACKEND:" in email
    assert "EMAIL_HOST_PASSWORD" not in email

    out = StringIO()
    call_command("check_production_config", "--offline", stdout=out)
    health = out.getvalue()
    assert "database:" in health
    assert "sk_live_COMMAND_SECRET" not in health


@override_settings(
    STRIPE_SECRET_KEY="",
    STRIPE_PREMIUM_PRICE_ID="",
    STRIPE_WEBHOOK_SECRET="",
    FRONTEND_ORIGIN="",
    EMAIL_HOST="",
)
def test_strict_billing_fails_when_missing(monkeypatch):
    monkeypatch.delenv("RENDER_EXTERNAL_URL", raising=False)
    with pytest.raises(CommandError):
        call_command("check_billing_config", "--offline", "--strict", stdout=StringIO())


@override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
def test_send_test_email_only_when_invoked():
    from django.core import mail

    assert mail.outbox == []
    call_command("send_test_email", "ops@example.com", stdout=StringIO())
    assert len(mail.outbox) == 1
    assert mail.outbox[0].to == ["ops@example.com"]
    body = f"{mail.outbox[0].subject}\n{mail.outbox[0].body}"
    assert "sk_live_" not in body
    assert "password" not in body.lower()


def test_send_test_email_rejects_invalid_address():
    with pytest.raises(CommandError):
        call_command("send_test_email", "not-an-email", stdout=StringIO())
