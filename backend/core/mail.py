"""Transactional auth emails. Tokens are not logged."""
from __future__ import annotations

import logging
from urllib.parse import quote, urlencode

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string

from core.auth_tokens import (
    make_password_reset_token,
    make_password_reset_uid,
    make_verification_token,
    verification_max_age,
)
from core.email_identity import mark_verification_sent, normalize_email
from core.frontend_origin import get_frontend_origin

logger = logging.getLogger(__name__)

NEUTRAL_PASSWORD_RESET_DETAIL = (
    "If an account exists for that email, we've sent password reset instructions."
)


def _from_email() -> str:
    return (getattr(settings, "DEFAULT_FROM_EMAIL", "") or "noreply@localhost").strip()


def _send(subject: str, to_email: str, text_body: str, html_body: str) -> None:
    message = EmailMultiAlternatives(
        subject=subject,
        body=text_body,
        from_email=_from_email(),
        to=[to_email],
    )
    message.attach_alternative(html_body, "text/html")
    message.send(fail_silently=False)


def send_verification_email(user) -> bool:
    email = normalize_email(user.email)
    if not email:
        return False
    origin = get_frontend_origin()
    if not origin:
        logger.warning("Skipping verification email; FRONTEND_ORIGIN is not configured.")
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
    logger.info("Verification email sent user_id=%s", user.pk)
    return True


def send_email_changed_notice(*, old_email: str, username: str) -> bool:
    """Informational notice to the previous address. Must not block the change."""
    email = normalize_email(old_email)
    if not email:
        return False
    context = {"username": username}
    text_body = render_to_string("core/email/email_changed.txt", context)
    html_body = render_to_string("core/email/email_changed.html", context)
    _send("Your Financial App email was changed", email, text_body, html_body)
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
    uid = make_password_reset_uid(user)
    token = make_password_reset_token(user)
    reset_url = f"{origin}/reset-password?{urlencode({'uid': uid, 'token': token}, quote_via=quote)}"
    context = {"reset_url": reset_url, "username": user.username}
    text_body = render_to_string("core/email/reset_password.txt", context)
    html_body = render_to_string("core/email/reset_password.html", context)
    _send("Reset your password", email, text_body, html_body)
    logger.info("Password reset email sent user_id=%s", user.pk)
    return True
