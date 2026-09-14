"""Transactional auth emails. Tokens are not logged."""
from __future__ import annotations

import logging
import smtplib
import time
from urllib.parse import quote, urlencode

from django.conf import settings
from django.core.mail import EmailMultiAlternatives, get_connection
from django.template.loader import render_to_string

from core.auth_tokens import (
    make_password_reset_token,
    make_password_reset_uid,
    make_verification_token,
    verification_max_age,
)
from core.email_identity import mark_verification_sent, normalize_email
from core.frontend_origin import get_frontend_origin, is_production_frontend_runtime

logger = logging.getLogger(__name__)

NEUTRAL_PASSWORD_RESET_DETAIL = (
    "If an account exists for that email, we've sent password reset instructions."
)


def _email_host() -> str:
    return (getattr(settings, "EMAIL_HOST", "") or "").strip()


def _smtp_backend_class() -> str:
    return "django.core.mail.backends.smtp.EmailBackend"


def email_transport_label() -> str:
    """Safe backend class label for logs/API. Never includes hosts or credentials.

    If EMAIL_HOST is set, this process sends over SMTP even when EMAIL_BACKEND
    is still the Django console default.
    """
    if _email_host():
        return "smtp"
    backend = (getattr(settings, "EMAIL_BACKEND", "") or "").strip().lower()
    if "console" in backend:
        return "console"
    if "dummy" in backend:
        return "dummy"
    if "locmem" in backend:
        return "locmem"
    if "filebased" in backend:
        return "file"
    if "smtp" in backend:
        return "smtp"
    if any(token in backend for token in ("anymail", "sendgrid", "mailgun", "ses", "postmark")):
        return "provider"
    return "other"


def email_backend_delivers_to_inbox() -> bool:
    return email_transport_label() in {"smtp", "provider"}


def non_inbox_send_detail() -> str:
    """User-facing 503 when this process cannot deliver to an inbox."""
    host_set = bool((getattr(settings, "EMAIL_HOST", "") or "").strip())
    if not host_set:
        return (
            "This web process has no EMAIL_HOST and no RESEND_API_KEY. "
            "Put SMTP or Resend on the Render Web service Environment, not a shell."
        )
    return (
        "EMAIL_HOST is set but this process is still using the console mail backend. "
        "Redeploy the Web service so gunicorn loads the latest code."
    )


def _recipient_domain(email: str) -> str:
    if "@" not in email:
        return "none"
    return email.rsplit("@", 1)[-1].lower() or "none"


def _must_deliver_to_inbox() -> bool:
    debug = bool(getattr(settings, "DEBUG", False))
    return is_production_frontend_runtime(debug=debug)


def _refuse_non_inbox_backend() -> bool:
    """True when this process must not report a successful inbox send."""
    if not _must_deliver_to_inbox():
        return False
    if _email_host() or email_backend_delivers_to_inbox():
        return False
    logger.error(
        "auth_email refusing non-inbox backend transport=%s",
        email_transport_label(),
    )
    return True


def _from_email() -> str:
    return (getattr(settings, "DEFAULT_FROM_EMAIL", "") or "noreply@localhost").strip()


def _send(subject: str, to_email: str, text_body: str, html_body: str) -> None:
    """Send a transactional email with bounded SMTP retries.

    Web requests must not sit on an SMTP connection for ~30+ seconds and then
    silently lose the message. Each attempt gets a fresh connection and a
    bounded timeout. Transient SMTP/network failures are retried twice.
    """

    logger.info(
        "auth_email send_attempt transport=%s recipient_domain=%s",
        email_transport_label(),
        _recipient_domain(to_email),
    )
    timeout = float(getattr(settings, "EMAIL_TIMEOUT", 10) or 10)
    last_error: BaseException | None = None
    host = _email_host() or None
    backend = getattr(settings, "EMAIL_BACKEND", None)
    if host:
        backend = _smtp_backend_class()

    for attempt in (1, 2, 3):
        connection = get_connection(
            backend=backend,
            fail_silently=False,
            timeout=timeout,
            host=host,
            port=getattr(settings, "EMAIL_PORT", None),
            username=getattr(settings, "EMAIL_HOST_USER", "") or None,
            password=getattr(settings, "EMAIL_HOST_PASSWORD", None),
            use_tls=getattr(settings, "EMAIL_USE_TLS", True),
            use_ssl=getattr(settings, "EMAIL_USE_SSL", False),
        )
        message = EmailMultiAlternatives(
            subject=subject,
            body=text_body,
            from_email=_from_email(),
            to=[to_email],
            connection=connection,
        )
        message.attach_alternative(html_body, "text/html")
        try:
            connection.open()
            sent_count = message.send(fail_silently=False)
            if sent_count != 1:
                raise smtplib.SMTPException(
                    f"Email backend reported {sent_count} messages sent; expected 1."
                )
            return
        except (smtplib.SMTPException, OSError, TimeoutError) as exc:
            last_error = exc
            if attempt == 3:
                raise
            logger.warning(
                "Transient email delivery failure; retrying subject=%s attempt=%s error_type=%s",
                subject,
                attempt,
                type(exc).__name__,
            )
            time.sleep(0.35 * attempt)
        finally:
            try:
                connection.close()
            except Exception:
                pass

    if last_error is not None:
        raise last_error


def send_verification_email(user) -> bool:
    email = normalize_email(user.email)
    if not email:
        return False
    origin = get_frontend_origin()
    if not origin:
        logger.warning("Skipping verification email; FRONTEND_ORIGIN is not configured.")
        return False
    if _refuse_non_inbox_backend():
        return False
    token = make_verification_token(user)
    verify_url = f"{origin}/verify-email?{urlencode({'token': token}, quote_via=quote)}"
    hours = max(1, verification_max_age() // 3600)
    context = {
        "verify_url": verify_url,
        "hours": hours,
        "username": user.username,
    }
    text_body = render_to_string("core/email/verify_email.txt", context)
    html_body = render_to_string("core/email/verify_email.html", context)
    _send("Verify your email", email, text_body, html_body)
    mark_verification_sent(user)
    logger.info(
        "Verification email sent user_id=%s transport=%s recipient_domain=%s",
        user.pk,
        email_transport_label(),
        _recipient_domain(email),
    )
    return True


def send_email_changed_notice(*, old_email: str, username: str) -> bool:
    """Informational notice to the previous address. Must not block the change."""
    email = normalize_email(old_email)
    if not email:
        return False
    context = {"username": username}
    text_body = render_to_string("core/email/email_changed.txt", context)
    html_body = render_to_string("core/email/email_changed.html", context)
    _send("Your FlowSight email was changed", email, text_body, html_body)
    logger.info("Email-changed notice sent user=%s", username)
    return True


def send_password_reset_email(user) -> bool:
    email = normalize_email(user.email)
    if not email:
        return False
    origin = get_frontend_origin()
    if not origin:
        logger.warning("Skipping password reset email; FRONTEND_ORIGIN is not configured.")
        return False
    if _refuse_non_inbox_backend():
        return False
    uid = make_password_reset_uid(user)
    token = make_password_reset_token(user)
    reset_url = f"{origin}/reset-password?{urlencode({'uid': uid, 'token': token}, quote_via=quote)}"
    context = {"reset_url": reset_url, "username": user.username}
    text_body = render_to_string("core/email/reset_password.txt", context)
    html_body = render_to_string("core/email/reset_password.html", context)
    _send("Reset your password", email, text_body, html_body)
    logger.info(
        "Password reset email sent user_id=%s transport=%s recipient_domain=%s",
        user.pk,
        email_transport_label(),
        _recipient_domain(email),
    )
    return True
