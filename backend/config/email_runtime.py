"""Choose an email backend that can actually reach an inbox on Render."""

from django.core.exceptions import ImproperlyConfigured

SMTP_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
CONSOLE_BACKEND = "django.core.mail.backends.console.EmailBackend"
RESEND_SMTP_HOST = "smtp.resend.com"
RESEND_SMTP_USER = "resend"


def _is_non_inbox_backend(backend: str) -> bool:
    lowered = (backend or "").strip().lower()
    if not lowered:
        return True
    return any(token in lowered for token in ("console", "dummy", "locmem", "filebased"))


def apply_inbox_smtp_env(
    *,
    email_host: str,
    email_user: str,
    email_password: str,
    resend_api_key: str,
) -> tuple[str, str, str]:
    """Fill SMTP host/user/password from Resend when EMAIL_HOST was never set.

    Dashboard SMTP vars and a shell `send_test_email` can diverge. A Resend API
    key on the web service is enough to talk to smtp.resend.com.
    """
    host = (email_host or "").strip()
    user = (email_user or "").strip()
    password = email_password or ""
    key = (resend_api_key or "").strip()
    if not host and key:
        host = RESEND_SMTP_HOST
    if key and not user:
        user = RESEND_SMTP_USER
    if key and not str(password).strip():
        password = key
    return host, user, password


def resolve_email_backend(
    *,
    on_render: bool,
    configured: str,
    host: str,
    allow_console: bool,
) -> str:
    """Use SMTP whenever a host exists, even if EMAIL_BACKEND is still console.

    `on_render` is only used to refuse a host-less console backend in gunicorn.
    """
    backend = (configured or "").strip()
    if (host or "").strip() and _is_non_inbox_backend(backend):
        return SMTP_BACKEND
    if on_render and _is_non_inbox_backend(backend):
        if not allow_console:
            raise ImproperlyConfigured(
                "This Render web process has no inbox mail backend. Set EMAIL_HOST "
                "or RESEND_API_KEY on the Web service, then redeploy."
            )
        return backend or CONSOLE_BACKEND
    return backend or CONSOLE_BACKEND
