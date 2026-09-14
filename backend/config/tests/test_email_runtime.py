import pytest
from django.core.exceptions import ImproperlyConfigured

from config.email_runtime import CONSOLE_BACKEND, SMTP_BACKEND, resolve_email_backend


def test_local_defaults_to_console():
    assert (
        resolve_email_backend(on_render=False, configured="", host="", allow_console=True)
        == CONSOLE_BACKEND
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
