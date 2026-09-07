"""Product feedback and mobile review-prompt APIs."""
from datetime import timedelta
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from django.core import mail
from django.core.cache import cache
from django.utils import timezone

from core.feedback import FEEDBACK_MESSAGE_MAX_LENGTH, get_feedback_email_to, sanitize_feedback_message
from core.models import Feedback, ReviewPromptState

pytestmark = pytest.mark.django_db

User = get_user_model()

FEEDBACK_BODY = {
    "source": "mobile",
    "platform": "ios",
    "category": "performance",
    "message": "The reports screen feels slow.",
    "allow_contact": True,
    "app_version": "0.9.0",
    "build_number": "12",
    "device_os_version": "18.0",
}


def test_feedback_requires_authentication(api_client):
    r = api_client.post("/api/feedback/", FEEDBACK_BODY, format="json")
    assert r.status_code in (401, 403)
    assert Feedback.objects.count() == 0


def test_feedback_persists_and_emails_configured_destination(authenticated_client, user, settings):
    settings.FEEDBACK_EMAIL_TO = "ops-inbox@example.com"
    user.email = "member@example.com"
    user.save(update_fields=["email"])
    mail.outbox.clear()

    r = authenticated_client.post("/api/feedback/", FEEDBACK_BODY, format="json")
    assert r.status_code == 201, r.data
    assert r.json()["email_sent"] is True
    record = Feedback.objects.get(pk=r.json()["id"])
    assert record.user_id == user.id
    assert record.source == "mobile"
    assert record.platform == "ios"
    assert record.category == "performance"
    assert record.message == FEEDBACK_BODY["message"]
    assert record.allow_contact is True
    assert record.app_version == "0.9.0"
    assert record.build_number == "12"
    assert record.email_sent_at is not None
    assert record.email_error == ""
    assert len(mail.outbox) == 1
    sent = mail.outbox[0]
    assert sent.to == ["ops-inbox@example.com"]
    assert get_feedback_email_to() == "ops-inbox@example.com"
    assert sent.subject == "[FlowSight Feedback] Mobile - Performance"
    assert "User id:" in sent.body
    assert user.username in sent.body
    assert "Platform: ios" in sent.body
    assert "App version: 0.9.0" in sent.body
    assert "Category: Performance" in sent.body
    assert FEEDBACK_BODY["message"] in sent.body
    assert "member@example.com" in sent.body
    assert "plaid" not in sent.body.lower()
    assert "jwt" not in sent.body.lower()


def test_feedback_omits_account_email_without_contact_permission(authenticated_client, user):
    user.email = "secret@example.com"
    user.save(update_fields=["email"])
    mail.outbox.clear()
    r = authenticated_client.post(
        "/api/feedback/",
        {**FEEDBACK_BODY, "allow_contact": False},
        format="json",
    )
    assert r.status_code == 201
    body = mail.outbox[0].body
    assert "secret@example.com" not in body
    assert "Contact permission: no" in body


def test_feedback_email_failure_keeps_record(authenticated_client, user):
    mail.outbox.clear()
    with patch("core.feedback.send_feedback_email", side_effect=RuntimeError("smtp down")):
        r = authenticated_client.post("/api/feedback/", FEEDBACK_BODY, format="json")
    assert r.status_code == 201, r.data
    assert r.json()["email_sent"] is False
    record = Feedback.objects.get(pk=r.json()["id"])
    assert record.message == FEEDBACK_BODY["message"]
    assert record.email_sent_at is None
    assert "smtp down" in record.email_error
    assert Feedback.objects.filter(user=user).count() == 1
    assert mail.outbox == []


def test_feedback_message_length_validation(authenticated_client):
    r = authenticated_client.post(
        "/api/feedback/",
        {**FEEDBACK_BODY, "message": "x" * (FEEDBACK_MESSAGE_MAX_LENGTH + 1)},
        format="json",
    )
    assert r.status_code == 400
    assert "message" in r.json()
    assert Feedback.objects.count() == 0


def test_feedback_category_optional(authenticated_client):
    r = authenticated_client.post(
        "/api/feedback/",
        {
            "source": "mobile",
            "platform": "android",
            "message": "The onboarding copy is unclear.",
        },
        format="json",
    )
    assert r.status_code == 201, r.data
    record = Feedback.objects.get()
    assert record.category == ""
    assert record.platform == "android"


def test_feedback_strips_html_and_requires_text(authenticated_client):
    r = authenticated_client.post(
        "/api/feedback/",
        {**FEEDBACK_BODY, "message": "<p></p>"},
        format="json",
    )
    assert r.status_code == 400
    r = authenticated_client.post(
        "/api/feedback/",
        {**FEEDBACK_BODY, "message": "<p>Charts are confusing</p>"},
        format="json",
    )
    assert r.status_code == 201, r.data
    record = Feedback.objects.get()
    assert "<" not in record.message
    assert "Charts are confusing" in record.message


def test_feedback_rejects_sensitive_financial_fields(authenticated_client):
    r = authenticated_client.post(
        "/api/feedback/",
        {**FEEDBACK_BODY, "balance": "1000.00", "plaid_token": "secret"},
        format="json",
    )
    assert r.status_code == 400
    assert Feedback.objects.count() == 0


def test_feedback_does_not_list_other_users(authenticated_client, user):
    other = User.objects.create_user(username="other_feedback", password="testpass123")
    Feedback.objects.create(user=other, message="other person's note", platform="android")
    r = authenticated_client.get("/api/feedback/")
    assert r.status_code == 405
    mail.outbox.clear()
    authenticated_client.post("/api/feedback/", FEEDBACK_BODY, format="json")
    mine = Feedback.objects.filter(user=user)
    theirs = Feedback.objects.filter(user=other)
    assert mine.count() == 1
    assert theirs.count() == 1
    assert theirs.get().message != mine.get().message


def test_feedback_rate_limit(authenticated_client):
    cache.clear()
    statuses = [
        authenticated_client.post(
            "/api/feedback/",
            {**FEEDBACK_BODY, "message": f"note {i}"},
            format="json",
        ).status_code
        for i in range(6)
    ]
    assert statuses[:5] == [201] * 5
    assert statuses[5] == 429
    assert Feedback.objects.count() == 5
    cache.clear()


def test_feedback_email_uses_env_fallback(settings):
    settings.FEEDBACK_EMAIL_TO = ""
    assert get_feedback_email_to() == "feedback@example.com"
    settings.FEEDBACK_EMAIL_TO = "  feedback@flowsight.com "
    assert get_feedback_email_to() == "feedback@flowsight.com"


def test_sanitize_feedback_message_caps_and_strips_controls():
    assert sanitize_feedback_message("  hello\x00world  ") == "helloworld"
    assert len(sanitize_feedback_message("a" * 9000)) == FEEDBACK_MESSAGE_MAX_LENGTH


def test_review_prompt_requires_authentication(api_client):
    assert api_client.get("/api/review-prompt/").status_code in (401, 403)
    assert api_client.patch("/api/review-prompt/", {"record_session": True}, format="json").status_code in (
        401,
        403,
    )


def test_review_prompt_records_sessions(authenticated_client, user):
    r = authenticated_client.get("/api/review-prompt/")
    assert r.status_code == 200
    body = r.json()
    assert body["session_count"] == 0
    assert body["first_eligible_use_at"] is None
    assert "balance" not in body

    first = authenticated_client.patch("/api/review-prompt/", {"record_session": True}, format="json")
    assert first.status_code == 200
    assert first.json()["session_count"] == 1
    assert first.json()["first_eligible_use_at"]

    second = authenticated_client.patch("/api/review-prompt/", {"record_session": True}, format="json")
    assert second.json()["session_count"] == 1

    state = ReviewPromptState.objects.get(user=user)
    state.last_session_at = timezone.now() - timedelta(hours=1)
    state.save(update_fields=["last_session_at"])
    third = authenticated_client.patch("/api/review-prompt/", {"record_session": True}, format="json")
    assert third.json()["session_count"] == 2


def test_review_prompt_mark_shown_and_complete(authenticated_client):
    authenticated_client.patch("/api/review-prompt/", {"mark_prompt_shown": True}, format="json")
    r = authenticated_client.patch(
        "/api/review-prompt/",
        {
            "enjoyment_response": "positive",
            "review_asked_at": True,
            "review_flow_completed": True,
        },
        format="json",
    )
    assert r.status_code == 200
    body = r.json()
    assert body["enjoyment_response"] == "positive"
    assert body["review_flow_completed"] is True
    assert body["review_asked_at"]
    assert len(body["enjoyment_prompt_ats"]) == 1
