"""In-app feedback: sanitize, persist helpers, and email delivery.

Do not log full feedback bodies. Do not include financial data in emails.
"""
from __future__ import annotations

import logging
from datetime import timedelta

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.utils import timezone
from django.utils.html import strip_tags

logger = logging.getLogger(__name__)

FEEDBACK_MESSAGE_MAX_LENGTH = 4000
FEEDBACK_EMAIL_FALLBACK = "feedback@example.com"
REVIEW_SESSION_GAP = timedelta(minutes=15)

FEEDBACK_CATEGORY_LABELS = {
    "hard_to_use": "Hard to use",
    "missing_feature": "Missing feature",
    "something_broken": "Something is broken",
    "performance": "Performance",
    "account_sync": "Account / sync issue",
    "other": "Other",
}


def get_feedback_email_to() -> str:
    raw = (getattr(settings, "FEEDBACK_EMAIL_TO", "") or "").strip()
    return raw or FEEDBACK_EMAIL_FALLBACK


def sanitize_feedback_message(raw: str | None, *, max_length: int = FEEDBACK_MESSAGE_MAX_LENGTH) -> str:
    text = strip_tags(raw or "")
    cleaned = []
    for ch in text:
        code = ord(ch)
        if ch in ("\n", "\t") or code >= 32:
            cleaned.append(ch)
    return "".join(cleaned).strip()[:max_length]


def truncate_email_error(exc: BaseException, *, max_length: int = 500) -> str:
    return str(exc).replace("\n", " ").strip()[:max_length]


def _from_email() -> str:
    return (getattr(settings, "DEFAULT_FROM_EMAIL", "") or "noreply@localhost").strip()


def send_feedback_email(*, feedback) -> None:
    """Send a plain-text notice. Raises on SMTP failure so the caller can record it."""
    category = FEEDBACK_CATEGORY_LABELS.get(feedback.category, feedback.category or "Other")
    source_label = (feedback.source or "mobile").capitalize()
    subject = f"[FlowSight Feedback] {source_label} - {category}"
    user = feedback.user
    lines = [
        f"User id: {user.pk}",
        f"Username: {user.username}",
        f"Platform: {feedback.platform or 'unknown'}",
        f"App version: {feedback.app_version or '-'}",
        f"Build: {feedback.build_number or '-'}",
        f"Device OS: {feedback.device_os_version or '-'}",
        f"Category: {category}",
        f"Contact permission: {'yes' if feedback.allow_contact else 'no'}",
    ]
    if feedback.allow_contact:
        email = (getattr(user, "email", "") or "").strip()
        lines.append(f"Account email: {email or '(none on file)'}")
    lines.extend(["", "Message:", feedback.message or ""])
    body = "\n".join(lines)
    message = EmailMultiAlternatives(
        subject=subject,
        body=body,
        from_email=_from_email(),
        to=[get_feedback_email_to()],
    )
    message.send(fail_silently=False)
    logger.info(
        "Feedback email sent feedback_id=%s user_id=%s category=%s",
        feedback.pk,
        user.pk,
        feedback.category or "",
    )


def deliver_feedback_email(feedback) -> None:
    try:
        send_feedback_email(feedback=feedback)
    except Exception as exc:
        logger.warning(
            "Feedback email failed feedback_id=%s user_id=%s",
            feedback.pk,
            feedback.user_id,
        )
        feedback.email_error = truncate_email_error(exc)
        feedback.email_sent_at = None
        feedback.save(update_fields=["email_error", "email_sent_at"])
        return
    feedback.email_sent_at = timezone.now()
    feedback.email_error = ""
    feedback.save(update_fields=["email_sent_at", "email_error"])
