import pytest
from django.core.exceptions import ImproperlyConfigured

from config.email_runtime import (
    CONSOLE_BACKEND,
    RESEND_SMTP_HOST,
    SMTP_BACKEND,
    apply_inbox_smtp_env,
    resolve_email_backend,
)


def test_local_defaults_to_console():
    assert (
        resolve_email_backend(on_render=False, configured="", host="", allow_console=True)
        == CONSOLE_BACKEND
    )


def test_host_overrides_console_even_when_not_on_render():
    assert (
        resolve_email_backend(
            on_render=False,
            configured=CONSOLE_BACKEND,
            host="smtp.resend.com",
            allow_console=True,
        )
        == SMTP_BACKEND
    )


def test_render_with_host_overrides_console():
    assert (
        resolve_email_backend(
            on_render=True,
            configured=CONSOLE_BACKEND,
            host="smtp.resend.com",
            allow_console=False,
        )
        == SMTP_BACKEND
    )


def test_render_keeps_explicit_provider_backend():
    anymail = "anymail.backends.resend.EmailBackend"
    assert (
        resolve_email_backend(
            on_render=True,
            configured=anymail,
            host="",
            allow_console=False,
        )
        == anymail
    )


def test_render_gunicorn_without_host_refuses_console():
    with pytest.raises(ImproperlyConfigured, match="inbox mail backend"):
        resolve_email_backend(
            on_render=True,
            configured=CONSOLE_BACKEND,
            host="",
            allow_console=False,
        )


def test_render_management_command_can_use_console_without_host():
    assert (
        resolve_email_backend(
            on_render=True,
            configured="",
            host="",
            allow_console=True,
        )
        == CONSOLE_BACKEND
    )


def test_resend_api_key_fills_smtp_host_and_password():
    host, user, password = apply_inbox_smtp_env(
        email_host="",
        email_user="",
        email_password="",
        resend_api_key="re_test_key",
    )
    assert host == RESEND_SMTP_HOST
    assert user == "resend"
    assert password == "re_test_key"


def test_explicit_smtp_env_wins_over_resend_key():
    host, user, password = apply_inbox_smtp_env(
        email_host="smtp.example.com",
        email_user="apikey",
        email_password="smtp-pass",
        resend_api_key="re_test_key",
    )
    assert host == "smtp.example.com"
    assert user == "apikey"
    assert password == "smtp-pass"
