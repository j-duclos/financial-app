"""Complimentary Premium invitations. Raw tokens are never stored or logged."""
from __future__ import annotations

import hashlib
import logging
import secrets
from datetime import timedelta
from typing import Any

from django.db import transaction
from django.utils import timezone

from billing.models import ComplimentaryPremiumInvitation
from core.email_identity import is_email_verified, normalize_email
from core.utils import get_user_profile

logger = logging.getLogger(__name__)

INVITATION_TTL = timedelta(days=7)
TOKEN_BYTES = 32
EMAIL_MISMATCH_DETAIL = "This invitation was sent to a different email address."
UNAVAILABLE_DETAIL = "This invitation is no longer valid."
VERIFY_DETAIL = "Verify the invited email address to activate complimentary Premium."


class InvitationError(Exception):
    def __init__(self, code: str, detail: str):
        self.code = code
        self.detail = detail
        super().__init__(detail)


def hash_invitation_token(raw_token: str) -> str:
    token = (raw_token or "").strip()
    if not token:
        return ""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def generate_invitation_token() -> str:
    return secrets.token_urlsafe(TOKEN_BYTES)


def default_invitation_expiry():
    return timezone.now() + INVITATION_TTL


def invitation_url(raw_token: str) -> str:
    from urllib.parse import quote, urlencode

    from core.frontend_origin import get_frontend_origin

    origin = get_frontend_origin()
    if not origin:
        return ""
    return f"{origin}/invite?{urlencode({'token': raw_token}, quote_via=quote)}"


def _lookup(raw_token: str) -> ComplimentaryPremiumInvitation | None:
    digest = hash_invitation_token(raw_token)
    if not digest:
        return None
    return ComplimentaryPremiumInvitation.objects.filter(token_hash=digest).first()


def _redeemable_reason(invite: ComplimentaryPremiumInvitation) -> str | None:
    now = timezone.now()
    if invite.accepted_at:
        return "accepted"
    if invite.revoked_at:
        return "revoked"
    if invite.expires_at <= now:
        return "expired"
    return None


def create_invitation(
    *,
    email: str,
    complimentary_premium_until,
    expires_at=None,
    created_by=None,
    send_email: bool = True,
) -> tuple[ComplimentaryPremiumInvitation, str]:
    normalized = normalize_email(email)
    if not normalized or "@" not in normalized:
        raise InvitationError("invalid_email", "Enter a valid email address.")
    until = complimentary_premium_until
    if until is None or until <= timezone.now():
        raise InvitationError("invalid_until", "Complimentary Premium expiration must be in the future.")
    expiry = expires_at or default_invitation_expiry()
    if expiry <= timezone.now():
        raise InvitationError("invalid_expiry", "Invitation link expiration must be in the future.")

    raw = generate_invitation_token()
    invite = ComplimentaryPremiumInvitation.objects.create(
        email=normalized,
        token_hash=hash_invitation_token(raw),
        complimentary_premium_until=until,
        expires_at=expiry,
        created_by=created_by if getattr(created_by, "pk", None) else None,
    )
    logger.info(
        "complimentary_invite_created invitation_id=%s created_by_id=%s recipient_domain=%s",
        invite.pk,
        getattr(created_by, "pk", None),
        normalized.rsplit("@", 1)[-1],
    )
    if send_email:
        send_invitation_email(invite, raw)
    return invite, raw


def send_invitation_email(invite: ComplimentaryPremiumInvitation, raw_token: str) -> bool:
    from core.mail import send_complimentary_premium_invitation_email

    url = invitation_url(raw_token)
    if not url:
        logger.error("complimentary_invite_missing_frontend_origin invitation_id=%s", invite.pk)
        return False
    sent = send_complimentary_premium_invitation_email(
        to_email=invite.email,
        invite_url=url,
        complimentary_until=invite.complimentary_premium_until,
    )
    if sent:
        invite.sent_at = timezone.now()
        invite.save(update_fields=["sent_at"])
        logger.info("complimentary_invite_email_sent invitation_id=%s", invite.pk)
    return sent


def resend_invitation(invite: ComplimentaryPremiumInvitation, *, created_by=None) -> str:
    if invite.accepted_at:
        raise InvitationError("accepted", "This invitation has already been accepted.")
    if invite.revoked_at:
        raise InvitationError("revoked", "This invitation was revoked.")
    raw = generate_invitation_token()
    invite.token_hash = hash_invitation_token(raw)
    invite.expires_at = default_invitation_expiry()
    if created_by is not None and getattr(created_by, "pk", None):
        invite.created_by = created_by
    invite.save(update_fields=["token_hash", "expires_at", "created_by"])
    logger.info("complimentary_invite_resent invitation_id=%s", invite.pk)
    send_invitation_email(invite, raw)
    return raw


def revoke_invitation(invite: ComplimentaryPremiumInvitation) -> ComplimentaryPremiumInvitation:
    if invite.accepted_at:
        raise InvitationError("accepted", "Accepted invitations cannot be revoked.")
    if not invite.revoked_at:
        invite.revoked_at = timezone.now()
        invite.save(update_fields=["revoked_at"])
        logger.info("complimentary_invite_revoked invitation_id=%s", invite.pk)
    return invite


def preview_invitation(raw_token: str) -> dict[str, Any]:
    invite = _lookup(raw_token)
    if invite is None:
        return {"status": "invalid"}
    reason = _redeemable_reason(invite)
    if reason:
        payload: dict[str, Any] = {"status": reason}
        if reason == "accepted":
            payload["complimentary_premium_until"] = invite.complimentary_premium_until.isoformat()
        return payload
    return {
        "status": "pending",
        "email": invite.email,
        "complimentary_premium_until": invite.complimentary_premium_until.isoformat(),
        "expires_at": invite.expires_at.isoformat(),
    }


def _apply_grant(user, until) -> None:
    profile = get_user_profile(user)
    profile.complimentary_premium_until = until
    profile.save(update_fields=["complimentary_premium_until", "updated_at"])
    user.profile = profile
    user._profile = profile


def accept_invitation(user, raw_token: str) -> ComplimentaryPremiumInvitation:
    digest = hash_invitation_token(raw_token)
    if not digest:
        raise InvitationError("invalid", UNAVAILABLE_DETAIL)

    with transaction.atomic():
        invite = (
            ComplimentaryPremiumInvitation.objects.select_for_update()
            .filter(token_hash=digest)
            .first()
        )
        if invite is None:
            raise InvitationError("invalid", UNAVAILABLE_DETAIL)

        user_email = normalize_email(getattr(user, "email", ""))
        if user_email != invite.email:
            logger.info(
                "complimentary_invite_email_mismatch invitation_id=%s user_id=%s",
                invite.pk,
                getattr(user, "pk", None),
            )
            raise InvitationError("email_mismatch", EMAIL_MISMATCH_DETAIL)

        if invite.accepted_at:
            if invite.accepted_by_id == getattr(user, "pk", None):
                return invite
            raise InvitationError("accepted", UNAVAILABLE_DETAIL)

        reason = _redeemable_reason(invite)
        if reason == "revoked":
            raise InvitationError("revoked", UNAVAILABLE_DETAIL)
        if reason == "expired":
            raise InvitationError("expired", "This invitation has expired.")
        if reason:
            raise InvitationError(reason, UNAVAILABLE_DETAIL)

        if not is_email_verified(user):
            raise InvitationError("email_verification_required", VERIFY_DETAIL)

        now = timezone.now()
        _apply_grant(user, invite.complimentary_premium_until)
        invite.accepted_at = now
        invite.accepted_by = user
        invite.save(update_fields=["accepted_at", "accepted_by"])
        logger.info(
            "complimentary_invite_accepted invitation_id=%s user_id=%s",
            invite.pk,
            user.pk,
        )
        return invite


def claim_pending_invitations_for_verified_user(user) -> ComplimentaryPremiumInvitation | None:
    """Claim the newest pending invite for the user's verified email (no token required)."""
    if user is None or not is_email_verified(user):
        return None
    email = normalize_email(getattr(user, "email", ""))
    if not email:
        return None
    now = timezone.now()
    with transaction.atomic():
        invite = (
            ComplimentaryPremiumInvitation.objects.select_for_update()
            .filter(
                email=email,
                accepted_at__isnull=True,
                revoked_at__isnull=True,
                expires_at__gt=now,
            )
            .order_by("-created_at")
            .first()
        )
        if invite is None:
            return None
        _apply_grant(user, invite.complimentary_premium_until)
        invite.accepted_at = now
        invite.accepted_by = user
        invite.save(update_fields=["accepted_at", "accepted_by"])
        logger.info(
            "complimentary_invite_auto_claimed invitation_id=%s user_id=%s",
            invite.pk,
            user.pk,
        )
        return invite


def _iso(value) -> str | None:
    if value is None:
        return None
    return value.isoformat()


def invitation_staff_payload(invite: ComplimentaryPremiumInvitation) -> dict[str, Any]:
    """Admin list/detail payload. Never includes tokens or token hashes."""
    accepted_user = None
    user = invite.accepted_by
    if user is not None:
        accepted_user = {
            "id": user.pk,
            "username": user.get_username(),
            "email": normalize_email(getattr(user, "email", "")),
        }
    return {
        "id": invite.pk,
        "email": invite.email,
        "status": invite.status_label(),
        "complimentary_premium_until": _iso(invite.complimentary_premium_until),
        "expires_at": _iso(invite.expires_at),
        "created_at": _iso(invite.created_at),
        "accepted_at": _iso(invite.accepted_at),
        "accepted_user": accepted_user,
        "created_by_id": invite.created_by_id,
    }


def list_invitations_for_staff(*, search: str = "", status: str = ""):
    qs = ComplimentaryPremiumInvitation.objects.select_related("accepted_by", "created_by").all()
    needle = (search or "").strip()
    if needle:
        qs = qs.filter(email__icontains=needle)
    wanted = (status or "").strip().lower()
    now = timezone.now()
    if wanted == "accepted":
        qs = qs.filter(accepted_at__isnull=False)
    elif wanted == "revoked":
        qs = qs.filter(accepted_at__isnull=True, revoked_at__isnull=False)
    elif wanted == "expired":
        qs = qs.filter(accepted_at__isnull=True, revoked_at__isnull=True, expires_at__lte=now)
    elif wanted == "pending":
        qs = qs.filter(accepted_at__isnull=True, revoked_at__isnull=True, expires_at__gt=now)
    return qs
