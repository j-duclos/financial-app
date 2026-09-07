"""Registration, email verification, and password reset."""
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from django.core import mail, signing
from django.core.cache import cache

from core.auth_tokens import (
    make_password_reset_token,
    make_password_reset_uid,
    make_verification_token,
)
from core.email_identity import is_email_verified, mark_email_verified
from core.mail import NEUTRAL_PASSWORD_RESET_DETAIL

pytestmark = pytest.mark.django_db

User = get_user_model()

REGISTER_PASSWORD = "UniqueHorseStaple9"


def _register(api_client, *, username="newuser", email="newuser@example.com", password=REGISTER_PASSWORD):
    return api_client.post(
        "/api/auth/register/",
        {"username": username, "email": email, "password": password},
        format="json",
    )


def test_register_requires_email(api_client):
    r = api_client.post(
        "/api/auth/register/",
        {"username": "noemail", "password": REGISTER_PASSWORD},
        format="json",
    )
    assert r.status_code == 400
    assert "email" in r.json()


def test_register_rejects_blank_email(api_client):
    r = api_client.post(
        "/api/auth/register/",
        {"username": "blankmail", "email": "   ", "password": REGISTER_PASSWORD},
        format="json",
    )
    assert r.status_code == 400
    assert "email" in r.json()


def test_register_accepts_valid_email_and_sends_verification(api_client):
    mail.outbox.clear()
    r = _register(api_client)
    assert r.status_code == 201, r.data
    body = r.json()
    assert "access" in body
    assert "refresh" in body
    assert "password" not in body
    assert body["user"]["username"] == "newuser"
    user = User.objects.get(username="newuser")
    assert user.email == "newuser@example.com"
    assert is_email_verified(user) is False
    assert len(mail.outbox) == 1
    assert mail.outbox[0].to == ["newuser@example.com"]
    assert "Verify your email" in mail.outbox[0].subject
    assert "/verify-email?" in mail.outbox[0].body
    assert "UniqueHorseStaple9" not in mail.outbox[0].body
    token = make_verification_token(user)
    assert token not in str(body)


def test_register_rejects_duplicate_email_case_insensitively(api_client, user):
    user.email = "Taken@Example.com"
    user.save(update_fields=["email"])
    r = _register(api_client, username="other", email="taken@example.com")
    assert r.status_code == 400
    assert "email" in r.json()
    assert User.objects.filter(username="other").exists() is False


def test_register_rejects_weak_password(api_client):
    r = _register(api_client, password="password")
    assert r.status_code == 400
    assert "password" in r.json()


def test_legacy_user_without_email_can_still_login(api_client, user):
    assert user.email == ""
    r = api_client.post(
        "/api/auth/token/",
        {"username": user.username, "password": "testpass123"},
        format="json",
    )
    assert r.status_code == 200
    assert "access" in r.json()


def test_valid_token_verifies_email(api_client):
    _register(api_client)
    user = User.objects.get(username="newuser")
    token = make_verification_token(user)
    r = api_client.post("/api/auth/verify-email/", {"token": token}, format="json")
    assert r.status_code == 200
    assert r.json()["status"] == "verified"
    user.refresh_from_db()
    assert is_email_verified(user) is True
    again = api_client.post("/api/auth/verify-email/", {"token": token}, format="json")
    assert again.status_code == 200
    assert again.json()["status"] == "already_verified"


def test_invalid_verification_token_rejected(api_client):
    r = api_client.post("/api/auth/verify-email/", {"token": "not-a-real-token"}, format="json")
    assert r.status_code == 400
    assert r.json()["status"] == "invalid"


def test_expired_verification_token_rejected(api_client, user):
    user.email = "expire@example.com"
    user.save(update_fields=["email"])
    token = make_verification_token(user)
    with patch("core.auth_tokens.signing.loads", side_effect=signing.SignatureExpired("expired")):
        r = api_client.post("/api/auth/verify-email/", {"token": token}, format="json")
    assert r.status_code == 400
    assert r.json()["status"] == "expired"


def test_resend_verification(authenticated_client, user):
    mail.outbox.clear()
    user.email = "resend@example.com"
    user.save(update_fields=["email"])
    r = authenticated_client.post("/api/auth/resend-verification/", {}, format="json")
    assert r.status_code == 200
    assert r.json()["detail"] == "Verification email sent."
    assert len(mail.outbox) == 1
    assert mail.outbox[0].to == ["resend@example.com"]


def test_resend_already_verified(authenticated_client, user):
    mail.outbox.clear()
    user.email = "done@example.com"
    user.save(update_fields=["email"])
    mark_email_verified(user)
    r = authenticated_client.post("/api/auth/resend-verification/", {}, format="json")
    assert r.status_code == 200
    assert "already verified" in r.json()["detail"].lower()
    assert mail.outbox == []


def test_forgot_password_neutral_for_existing_and_missing(api_client, user):
    mail.outbox.clear()
    user.email = "known@example.com"
    user.save(update_fields=["email"])
    existing = api_client.post(
        "/api/auth/forgot-password/",
        {"email": "known@example.com"},
        format="json",
    )
    missing = api_client.post(
        "/api/auth/forgot-password/",
        {"email": "nobody@example.com"},
        format="json",
    )
    assert existing.status_code == 200
    assert missing.status_code == 200
    assert existing.json() == missing.json()
    assert existing.json()["detail"] == NEUTRAL_PASSWORD_RESET_DETAIL
    assert "token" not in existing.json()
    assert "uid" not in existing.json()
    assert len(mail.outbox) == 1
    body = mail.outbox[0].body
    assert "/reset-password?" in body
    assert "uid=" in body
    assert "token=" in body
    assert "testpass123" not in body


def test_reset_password_success_and_token_cannot_be_reused(api_client, user):
    user.email = "reset@example.com"
    user.save(update_fields=["email"])
    uid = make_password_reset_uid(user)
    token = make_password_reset_token(user)
    r = api_client.post(
        "/api/auth/reset-password/",
        {
            "uid": uid,
            "token": token,
            "new_password": REGISTER_PASSWORD,
            "new_password_confirm": REGISTER_PASSWORD,
        },
        format="json",
    )
    assert r.status_code == 200
    assert r.json()["detail"] == "Your password has been reset."
    user.refresh_from_db()
    assert user.check_password(REGISTER_PASSWORD)
    login = api_client.post(
        "/api/auth/token/",
        {"username": user.username, "password": REGISTER_PASSWORD},
        format="json",
    )
    assert login.status_code == 200
    reuse = api_client.post(
        "/api/auth/reset-password/",
        {
            "uid": uid,
            "token": token,
            "new_password": "AnotherHorseStaple9",
            "new_password_confirm": "AnotherHorseStaple9",
        },
        format="json",
    )
    assert reuse.status_code == 400


def test_reset_password_invalid_token(api_client, user):
    r = api_client.post(
        "/api/auth/reset-password/",
        {
            "uid": make_password_reset_uid(user),
            "token": "bogus-token",
            "new_password": REGISTER_PASSWORD,
            "new_password_confirm": REGISTER_PASSWORD,
        },
        format="json",
    )
    assert r.status_code == 400


def test_reset_password_mismatch(api_client, user):
    r = api_client.post(
        "/api/auth/reset-password/",
        {
            "uid": make_password_reset_uid(user),
            "token": make_password_reset_token(user),
            "new_password": REGISTER_PASSWORD,
            "new_password_confirm": "DifferentHorseStaple9",
        },
        format="json",
    )
    assert r.status_code == 400
    assert "new_password_confirm" in r.json()
    user.refresh_from_db()
    assert user.check_password("testpass123")


def test_reset_password_weak(api_client, user):
    r = api_client.post(
        "/api/auth/reset-password/",
        {
            "uid": make_password_reset_uid(user),
            "token": make_password_reset_token(user),
            "new_password": "password",
            "new_password_confirm": "password",
        },
        format="json",
    )
    assert r.status_code == 400
    assert "new_password" in r.json()


def test_forgot_password_throttle(api_client):
    # DRF binds DEFAULT_THROTTLE_RATES on the throttle class at import time,
    # so override_settings(REST_FRAMEWORK=...) does not change the live rate.
    # Assert the configured 5/hour anon limit instead.
    cache.clear()
    statuses = [
        api_client.post(
            "/api/auth/forgot-password/",
            {"email": f"n{i}@example.com"},
            format="json",
        ).status_code
        for i in range(6)
    ]
    assert statuses[:5] == [200] * 5
    assert statuses[5] == 429
    cache.clear()


def test_profile_exposes_email_verification_state(authenticated_client, user):
    user.email = "profile@example.com"
    user.save(update_fields=["email"])
    r = authenticated_client.get("/api/profile/")
    assert r.status_code == 200
    body = r.json()
    assert body["email"] == "profile@example.com"
    assert body["email_verified"] is False
    assert "password" not in body


def test_change_email_requires_authentication(api_client):
    cache.clear()
    r = api_client.post(
        "/api/profile/change-email/",
        {"email": "new@example.com", "current_password": "testpass123"},
        format="json",
    )
    assert r.status_code in (401, 403)


def test_change_email_requires_correct_password(authenticated_client, user):
    mail.outbox.clear()
    r = authenticated_client.post(
        "/api/profile/change-email/",
        {"email": "new@example.com", "current_password": "wrong-password"},
        format="json",
    )
    assert r.status_code == 400
    assert "current_password" in r.json()
    user.refresh_from_db()
    assert user.email == ""
    assert mail.outbox == []


def test_change_email_rejects_duplicate_case_insensitively(authenticated_client, user):
    User.objects.create_user(username="takenmail", email="Taken@Example.com", password="testpass123")
    r = authenticated_client.post(
        "/api/profile/change-email/",
        {"email": "taken@example.com", "current_password": "testpass123"},
        format="json",
    )
    assert r.status_code == 400
    assert "email" in r.json()
    user.refresh_from_db()
    assert user.email == ""


def test_legacy_blank_email_user_can_establish_email(authenticated_client, user):
    mail.outbox.clear()
    assert user.email == ""
    r = authenticated_client.post(
        "/api/profile/change-email/",
        {"email": "First@Example.com", "current_password": "testpass123"},
        format="json",
    )
    assert r.status_code == 200, r.data
    assert r.json()["detail"] == "Email updated. Check your new email to verify it."
    assert r.json()["email"] == "first@example.com"
    assert r.json()["email_verified"] is False
    user.refresh_from_db()
    assert user.email == "first@example.com"
    assert is_email_verified(user) is False
    assert len(mail.outbox) == 1
    assert mail.outbox[0].to == ["first@example.com"]
    assert "/verify-email?" in mail.outbox[0].body


def test_change_email_clears_verification_and_invalidates_old_token(authenticated_client, user):
    mail.outbox.clear()
    user.email = "old@example.com"
    user.save(update_fields=["email"])
    mark_email_verified(user)
    old_token = make_verification_token(user)
    assert is_email_verified(user) is True
    r = authenticated_client.post(
        "/api/profile/change-email/",
        {"email": "new@example.com", "current_password": "testpass123"},
        format="json",
    )
    assert r.status_code == 200, r.data
    user.refresh_from_db()
    assert user.email == "new@example.com"
    assert is_email_verified(user) is False
    stale = authenticated_client.post("/api/auth/verify-email/", {"token": old_token}, format="json")
    assert stale.status_code == 400
    assert stale.json()["status"] == "invalid"
    new_token = make_verification_token(user)
    verified = authenticated_client.post(
        "/api/auth/verify-email/", {"token": new_token}, format="json"
    )
    assert verified.status_code == 200
    assert verified.json()["status"] == "verified"
    user.refresh_from_db()
    assert is_email_verified(user) is True
    recipients = [msg.to[0] for msg in mail.outbox]
    assert "new@example.com" in recipients
    assert "old@example.com" in recipients
    verify_bodies = [msg.body for msg in mail.outbox if "Verify your email" in msg.subject]
    assert verify_bodies
    assert "/verify-email?" in verify_bodies[0]


def test_login_is_throttled(api_client):
    cache.clear()
    statuses = [
        api_client.post(
            "/api/auth/token/",
            {"username": "missing", "password": "wrong"},
            format="json",
        ).status_code
        for _ in range(11)
    ]
    assert 429 in statuses
    cache.clear()


def test_register_is_throttled(api_client):
    cache.clear()
    statuses = [
        _register(api_client, username=f"throttleuser{i}", email=f"throttle{i}@example.com").status_code
        for i in range(11)
    ]
    assert 429 in statuses
    cache.clear()

