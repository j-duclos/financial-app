from datetime import timedelta
from urllib.parse import parse_qs, urlparse

import pytest
from django.contrib.auth import get_user_model
from django.core import mail
from django.test import Client, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from billing.invitations import (
    EMAIL_MISMATCH_DETAIL,
    InvitationError,
    accept_invitation,
    create_invitation,
    hash_invitation_token,
    preview_invitation,
    resend_invitation,
    revoke_invitation,
)
from billing.models import BillingSubscription, ComplimentaryPremiumInvitation
from billing.services import get_billing_status_payload, get_entitlements, user_has_premium
from billing.tests.helpers import grant_premium
from core.auth_tokens import make_verification_token
from core.email_identity import mark_email_verified
from core.utils import get_user_profile

User = get_user_model()


def _until(**kwargs):
    return timezone.now() + timedelta(**kwargs)


def make_invite(email="beta@example.com", send_email=True, **kwargs):
    until = kwargs.pop("until", None) or _until(days=60)
    return create_invitation(
        email=email,
        complimentary_premium_until=until,
        send_email=send_email,
        **kwargs,
    )


def _verified(user, email):
    user.email = email
    user.save(update_fields=["email"])
    mark_email_verified(user)
    return user


@pytest.mark.django_db
@override_settings(FRONTEND_ORIGIN="https://flowsight360.com")
def test_admin_can_create_invitation_and_email_is_sent():
    admin = User.objects.create_superuser("inv-admin", "admin@example.com", "adminpass123")
    client = Client()
    assert client.login(username="inv-admin", password="adminpass123")
    add_url = reverse("admin:billing_complimentarypremiuminvitation_add")
    page = client.get(add_url)
    assert page.status_code == 200
    csrf = client.cookies.get("csrftoken")
    until = _until(days=45)
    expires = _until(days=7)
    response = client.post(
        add_url,
        {
            "csrfmiddlewaretoken": csrf.value if csrf else "",
            "email": "Beta@Example.com",
            "complimentary_premium_until": until.strftime("%Y-%m-%dT%H:%M"),
            "expires_at": expires.strftime("%Y-%m-%dT%H:%M"),
            "_save": "Save",
        },
        follow=True,
    )
    assert response.status_code == 200
    invite = ComplimentaryPremiumInvitation.objects.get(email="beta@example.com")
    assert invite.created_by_id == admin.pk
    assert invite.token_hash
    assert len(invite.token_hash) == 64
    assert invite.status_label() == "pending"
    assert len(mail.outbox) == 1
    msg = mail.outbox[0]
    assert msg.subject == "You're invited to FlowSight Premium"
    assert msg.to == ["beta@example.com"]
    assert "Accept invitation" in msg.body
    assert "/invite?token=" in msg.body
    parsed = urlparse([line.strip() for line in msg.body.splitlines() if "/invite?token=" in line][0])
    token = parse_qs(parsed.query)["token"][0]
    assert token not in invite.token_hash
    assert invite.token_hash == hash_invitation_token(token)
    assert token not in str(ComplimentaryPremiumInvitation.objects.values())


@pytest.mark.django_db
def test_invitation_token_is_not_stored_plaintext():
    invite, raw = make_invite(send_email=False)
    assert raw
    assert raw not in invite.token_hash
    stored = ComplimentaryPremiumInvitation.objects.get(pk=invite.pk)
    assert stored.token_hash == hash_invitation_token(raw)
    assert raw not in stored.token_hash
    assert list(ComplimentaryPremiumInvitation.objects.filter(token_hash=raw)) == []


@pytest.mark.django_db
def test_valid_invitation_can_be_viewed(api_client):
    invite, raw = make_invite(send_email=False)
    r = api_client.get("/api/billing/invitations/preview/", {"token": raw})
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "pending"
    assert body["email"] == "beta@example.com"
    assert body["complimentary_premium_until"] == invite.complimentary_premium_until.isoformat()
    assert "has_account" not in body
    assert "token_hash" not in body
    assert invite.token_hash not in str(body)


@pytest.mark.django_db
def test_new_user_can_claim_invitation_after_verification(api_client):
    invite, raw = make_invite(email="newbeta@example.com", send_email=False, until=_until(days=40))
    r = api_client.post(
        "/api/auth/register/",
        {
            "username": "newbeta",
            "password": "UniqueHorseStaple9",
            "email": "NewBeta@example.com",
        },
        format="json",
    )
    assert r.status_code == 201
    created = User.objects.get(username="newbeta")
    assert user_has_premium(created) is False
    client = APIClient()
    client.force_authenticate(user=created)
    blocked = client.post("/api/billing/invitations/accept/", {"token": raw}, format="json")
    assert blocked.status_code == 403
    assert blocked.json()["code"] == "email_verification_required"
    token = make_verification_token(created)
    verified = api_client.post("/api/auth/verify-email/", {"token": token}, format="json")
    assert verified.status_code == 200
    created.refresh_from_db()
    assert user_has_premium(created) is True
    invite.refresh_from_db()
    assert invite.accepted_by_id == created.pk
    profile = get_user_profile(created)
    assert profile.complimentary_premium_until == invite.complimentary_premium_until
    status = client.get("/api/billing/status/")
    assert status.json()["complimentary_premium"] is True
    assert status.json()["is_premium"] is True
    assert status.json()["entitlements"]["plaid_bank_sync"] is True
    billing = BillingSubscription.objects.get(user=created)
    assert billing.stripe_customer_id is None
    assert billing.stripe_subscription_id is None


@pytest.mark.django_db
def test_existing_user_can_claim_invitation(authenticated_client, user):
    _verified(user, "beta@example.com")
    invite, raw = make_invite(email="BETA@example.com", send_email=False, until=_until(days=21))
    r = authenticated_client.post("/api/billing/invitations/accept/", {"token": raw}, format="json")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "accepted"
    assert body["is_premium"] is True
    assert body["plan"] == "PREMIUM"
    invite.refresh_from_db()
    assert invite.accepted_by_id == user.pk
    assert get_user_profile(user).complimentary_premium_until == invite.complimentary_premium_until
    assert user_has_premium(user) is True
    entitlements = get_entitlements(user)
    assert entitlements["is_premium"] is True
    assert entitlements["payment_planner_full"] is True


@pytest.mark.django_db
def test_wrong_email_cannot_claim_invitation(authenticated_client, user):
    _verified(user, "other@example.com")
    _invite, raw = make_invite(email="beta@example.com", send_email=False)
    r = authenticated_client.post("/api/billing/invitations/accept/", {"token": raw}, format="json")
    assert r.status_code == 403
    assert r.json()["detail"] == EMAIL_MISMATCH_DETAIL
    assert user_has_premium(user) is False
    assert ComplimentaryPremiumInvitation.objects.get().accepted_at is None


@pytest.mark.django_db
def test_case_insensitive_email_matching(authenticated_client, user):
    _verified(user, "Beta.Tester@Example.COM")
    _invite, raw = make_invite(email="beta.tester@example.com", send_email=False)
    r = authenticated_client.post("/api/billing/invitations/accept/", {"token": raw}, format="json")
    assert r.status_code == 200
    assert user_has_premium(user) is True


@pytest.mark.django_db
def test_expired_invitation_cannot_be_claimed(authenticated_client, user):
    _verified(user, "beta@example.com")
    invite, raw = make_invite(send_email=False)
    ComplimentaryPremiumInvitation.objects.filter(pk=invite.pk).update(
        expires_at=timezone.now() - timedelta(minutes=1)
    )
    r = authenticated_client.post("/api/billing/invitations/accept/", {"token": raw}, format="json")
    assert r.status_code == 400
    assert r.json()["code"] == "expired"
    assert user_has_premium(user) is False


@pytest.mark.django_db
def test_revoked_invitation_cannot_be_claimed(authenticated_client, user):
    _verified(user, "beta@example.com")
    invite, raw = make_invite(send_email=False)
    revoke_invitation(invite)
    r = authenticated_client.post("/api/billing/invitations/accept/", {"token": raw}, format="json")
    assert r.status_code == 400
    assert r.json()["code"] == "revoked"
    preview = preview_invitation(raw)
    assert preview["status"] == "revoked"


@pytest.mark.django_db
def test_used_invitation_cannot_be_reused(authenticated_client, user):
    _verified(user, "beta@example.com")
    _invite, raw = make_invite(send_email=False)
    first = authenticated_client.post("/api/billing/invitations/accept/", {"token": raw}, format="json")
    assert first.status_code == 200
    second = authenticated_client.post("/api/billing/invitations/accept/", {"token": raw}, format="json")
    assert second.status_code == 200
    other = User.objects.create_user(username="otherbeta", password="testpass123", email="beta@example.com")
    # unique email - change other
    other.email = "imposter@example.com"
    other.save(update_fields=["email"])
    mark_email_verified(other)
    other_client = APIClient()
    other_client.force_authenticate(user=other)
    stolen = other_client.post("/api/billing/invitations/accept/", {"token": raw}, format="json")
    assert stolen.status_code in (400, 403)
    assert user_has_premium(other) is False


@pytest.mark.django_db
def test_double_redemption_is_prevented(user):
    _verified(user, "beta@example.com")
    invite, raw = make_invite(send_email=False)
    first = accept_invitation(user, raw)
    assert first.accepted_at
    again = accept_invitation(user, raw)
    assert again.pk == first.pk
    assert ComplimentaryPremiumInvitation.objects.filter(accepted_at__isnull=False).count() == 1


@pytest.mark.django_db
def test_acceptance_preserves_premium_expiration_without_stripe(authenticated_client, user):
    until = _until(days=33)
    _verified(user, "beta@example.com")
    invite, raw = make_invite(send_email=False, until=until)
    authenticated_client.post("/api/billing/invitations/accept/", {"token": raw}, format="json")
    profile = get_user_profile(user)
    assert profile.complimentary_premium_until == invite.complimentary_premium_until
    payload = get_billing_status_payload(user)
    assert payload["complimentary_premium"] is True
    assert payload["has_stripe_customer"] is False
    row = BillingSubscription.objects.get(user=user)
    assert row.stripe_customer_id is None
    assert row.stripe_subscription_id is None
    assert row.status == "inactive"


@pytest.mark.django_db
def test_existing_stripe_subscriber_remains_unaffected(authenticated_client, user):
    billing = grant_premium(user)
    billing.stripe_subscription_id = "sub_live"
    billing.save(update_fields=["stripe_subscription_id", "updated_at"])
    snapshot = {
        "customer": billing.stripe_customer_id,
        "subscription": billing.stripe_subscription_id,
        "status": billing.status,
    }
    _verified(user, "beta@example.com")
    _invite, raw = make_invite(send_email=False)
    r = authenticated_client.post("/api/billing/invitations/accept/", {"token": raw}, format="json")
    assert r.status_code == 200
    billing.refresh_from_db()
    assert billing.stripe_customer_id == snapshot["customer"]
    assert billing.stripe_subscription_id == snapshot["subscription"]
    assert billing.status == snapshot["status"]
    assert user_has_premium(user) is True


@pytest.mark.django_db
@override_settings(FRONTEND_ORIGIN="https://flowsight360.com")
def test_resend_issues_new_token_without_changing_premium_until():
    invite, raw = make_invite(send_email=True)
    until = invite.complimentary_premium_until
    mail.outbox.clear()
    new_raw = resend_invitation(invite)
    invite.refresh_from_db()
    assert new_raw != raw
    assert invite.token_hash == hash_invitation_token(new_raw)
    assert invite.token_hash != hash_invitation_token(raw)
    assert invite.complimentary_premium_until == until
    assert preview_invitation(raw)["status"] in {"invalid", "expired", "revoked"}
    assert preview_invitation(new_raw)["status"] == "pending"
    assert len(mail.outbox) == 1
    assert new_raw in mail.outbox[0].body
    assert raw not in mail.outbox[0].body


@pytest.mark.django_db
def test_unauthenticated_cannot_accept(api_client):
    _invite, raw = make_invite(send_email=False)
    r = api_client.post("/api/billing/invitations/accept/", {"token": raw}, format="json")
    assert r.status_code in (401, 403)


@pytest.mark.django_db
def test_no_public_invitation_create_endpoint(authenticated_client):
    r = authenticated_client.post(
        "/api/billing/invitations/",
        {"email": "x@example.com"},
        format="json",
    )
    assert r.status_code in (404, 405)


@pytest.mark.django_db
def test_preview_does_not_reveal_account_existence(api_client, user):
    user.email = "beta@example.com"
    user.save(update_fields=["email"])
    _invite, raw = make_invite(email="beta@example.com", send_email=False)
    body = api_client.get("/api/billing/invitations/preview/", {"token": raw}).json()
    assert "account" not in str(body).lower() or "has_account" not in body
    assert body.get("user_id") is None
    bogus = api_client.get("/api/billing/invitations/preview/", {"token": "not-a-real-token"})
    assert bogus.json()["status"] == "invalid"
    assert "email" not in bogus.json()


@pytest.mark.django_db
def test_accept_ignores_email_in_request_body(authenticated_client, user):
    _verified(user, "other@example.com")
    invite, raw = make_invite(email="beta@example.com", send_email=False)
    r = authenticated_client.post(
        "/api/billing/invitations/accept/",
        {"token": raw, "email": "beta@example.com"},
        format="json",
    )
    assert r.status_code == 403
    assert r.json()["detail"] == EMAIL_MISMATCH_DETAIL
    invite.refresh_from_db()
    assert invite.accepted_at is None
    assert user_has_premium(user) is False


@pytest.mark.django_db
def test_ordinary_user_cannot_access_invitation_admin(user):
    client = Client()
    assert client.login(username=user.username, password="testpass123")
    add_url = reverse("admin:billing_complimentarypremiuminvitation_add")
    assert client.get(add_url).status_code in (302, 403)
    assert client.post(add_url, {"email": "x@example.com"}, follow=False).status_code in (302, 403)
    assert ComplimentaryPremiumInvitation.objects.count() == 0
