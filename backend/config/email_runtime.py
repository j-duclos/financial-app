"""Choose an email backend that can actually reach an inbox on Render."""

from django.core.exceptions import ImproperlyConfigured

SMTP_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
CONSOLE_BACKEND = "django.core.mail.backends.console.EmailBackend"


def _is_non_inbox_backend(backend: str) -> bool:
    lowered = (backend or "").strip().lower()
    if not lowered:
        return True
    return any(token in lowered for token in ("console", "dummy", "locmem", "filebased"))


def resolve_email_backend(
    *,
    on_render: bool,
    configured: str,
    host: str,
    allow_console: bool,
) -> str:
    """Render gunicorn must not keep the Django console backend when SMTP is configured.

    Shell `manage.py` commands load current env; gunicorn workers often do not
    until restart. If EMAIL_HOST is set, prefer SMTP even when EMAIL_BACKEND is
    still the local-dev console default.
    """
    backend = (configured or "").strip()
    if on_render and _is_non_inbox_backend(backend):
        if (host or "").strip():
            return SMTP_BACKEND
        if not allow_console:
            raise ImproperlyConfigured(
                "This Render web process has no inbox mail backend. Set EMAIL_HOST "
                "and SMTP credentials (Resend/SMTP), then restart the web service."
            )
        return backend or CONSOLE_BACKEND
    return backend or CONSOLE_BACKEND
