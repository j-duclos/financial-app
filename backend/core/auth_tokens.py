"""Signed, expiring tokens for email verification and password reset.

Verification uses Django's signing.dumps/loads (no custom token table).
Password reset uses Django's PasswordResetTokenGenerator so a successful
reset invalidates the token via the password hash.
"""
from __future__ import annotations

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.tokens import default_token_generator
from django.core import signing
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode

from core.email_identity import normalize_email

User = get_user_model()

VERIFY_SALT = "core.email-verify"


class TokenError(Exception):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def verification_max_age() -> int:
    return int(getattr(settings, "EMAIL_VERIFICATION_MAX_AGE", 60 * 60 * 48))


def make_verification_token(user) -> str:
    email = normalize_email(user.email)
    return signing.dumps({"uid": user.pk, "email": email}, salt=VERIFY_SALT)


def read_verification_token(token: str):
    if not token or not str(token).strip():
        raise TokenError("invalid")
    try:
        payload = signing.loads(
            str(token).strip(),
            salt=VERIFY_SALT,
            max_age=verification_max_age(),
        )
    except signing.SignatureExpired as exc:
        raise TokenError("expired") from exc
    except signing.BadSignature as exc:
        raise TokenError("invalid") from exc
    if not isinstance(payload, dict):
        raise TokenError("invalid")
    uid = payload.get("uid")
    email = normalize_email(payload.get("email"))
    if uid is None or not email:
        raise TokenError("invalid")
    user = User.objects.filter(pk=uid).first()
    if user is None or normalize_email(user.email) != email:
        raise TokenError("invalid")
    return user


def make_password_reset_uid(user) -> str:
    return urlsafe_base64_encode(force_bytes(user.pk))


def make_password_reset_token(user) -> str:
    return default_token_generator.make_token(user)


def read_password_reset_user(uid: str, token: str):
    if not uid or not token:
        raise TokenError("invalid")
    try:
        user_id = force_str(urlsafe_base64_decode(str(uid).strip()))
        user = User.objects.filter(pk=int(user_id)).first()
    except (ValueError, OverflowError, TypeError) as exc:
        raise TokenError("invalid") from exc
    if user is None:
        raise TokenError("invalid")
    if not default_token_generator.check_token(user, str(token).strip()):
        raise TokenError("invalid")
    return user
