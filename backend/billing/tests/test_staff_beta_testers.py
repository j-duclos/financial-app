from datetime import timedelta
from urllib.parse import parse_qs, urlparse

import pytest
from django.contrib.auth import get_user_model
from django.core import mail
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from billing.invitations import create_invitation, hash_invitation_token
from billing.models import ComplimentaryPremiumInvitation
from billing.tests.helpers import grant_premium
from core.email_identity import mark_email_verified
from core.utils import get_user_profile

User = get_user_model()

LIST_URL = "/api/billing/staff/beta-testers/"
CREATE_URL = "/api/billing/staff/beta-testers/invitations/"


def _until(days=60):
    return timezone.now() + timedelta(days=days)


def _staff_user():
    return User.objects.create_user(
        username="beta-staff",
        email="staff@example.com",
        password="staffpass123",
        is_staff=True,
    )


def _staff_client():
    user = _staff_user()
    client = APIClient()
    client.force_authenticate(user=user)
    return client, user


def _secret_keys(payload) -> list[str]:
    found = []

    def walk(value, path=""):
        if isinstance(value, dict):
            for key, inner in value.items():
                lower = str(key).lower()
                if "token" in lower:
                    found.append(f"{path}{key}")
                walk(inner, f"{path}{key}.")
        elif isinstance(value, list):
            for i, inner in enumerate(value):
                walk(inner, f"{path}{i}.")

    walk(payload)
    return found


@pytest.mark.django_db
def test_non_admin_cannot_access_staff_beta_tester_api(authenticated_client):
    assert authenticated_client.get(LIST_URL).status_code == 403
    assert (
        authenticated_client.post(
            CREATE_URL,
            {"email": "x@example.com", "complimentary_premium_until": _until().isoformat()},
            format="json",
        ).status_code
        == 403
    )


@pytest.mark.django_db
def test_unauthenticated_cannot_access_staff_beta_tester_api(api_client):
    assert api_client.get(LIST_URL).status_code in (401, 403)


@pytest.mark.django_db
@override_settings(FRONTEND_ORIGIN="https://flowsight360.com")
def test_admin_can_list_and_create_invitation():
    client, admin = _staff_client()
    empty = client.get(LIST_URL)
    assert empty.status_code == 200
    assert empty.json()["results"] == []
    until = _until(days=45)
    created = client.post(
        CREATE_URL,
        {"email": "Beta@Example.com", "complimentary_premium_until": until.isoformat()},
        format="json",
    )
    assert created.status_code == 201
    body = created.json()
    assert body["email"] == "beta@example.com"
    assert body["status"] == "pending"
    assert body["detail"] == "Beta invitation sent to beta@example.com."
    assert _secret_keys(body) == []
    assert "token_hash" not in body
    assert len(mail.outbox) == 1
    listed = client.get(LIST_URL)
    assert listed.status_code == 200
    assert listed.json()["count"] == 1
    row = listed.json()["results"][0]
    assert row["email"] == "beta@example.com"
    assert row["id"] == ComplimentaryPremiumInvitation.objects.get().pk
    assert row["created_by_id"] == admin.pk
    assert _secret_keys(listed.json()) == []
    stored = ComplimentaryPremiumInvitation.objects.get()
    assert stored.token_hash
    assert stored.token_hash not in str(listed.json())
    token = [line for line in mail.outbox[0].body.splitlines() if "token=" in line][0]
    assert token.strip() not in str(listed.json())
    assert token.strip() not in str(created.json())


@pytest.mark.django_db
def test_create_requires_valid_email():
    client, _admin = _staff_client()
    missing = client.post(
        CREATE_URL,
        {"complimentary_premium_until": _until().isoformat()},
        format="json",
    )
    assert missing.status_code == 400
    bad = client.post(
        CREATE_URL,
        {"email": "not-an-email", "complimentary_premium_until": _until().isoformat()},
        format="json",
    )
    assert bad.status_code == 400


@pytest.mark.django_db
@override_settings(FRONTEND_ORIGIN="https://flowsight360.com")
def test_admin_can_resend_pending_invitation_and_rotates_token():
    client, _admin = _staff_client()
    invite, raw = create_invitation(
        email="resend@example.com",
        complimentary_premium_until=_until(),
        send_email=False,
    )
    old_hash = invite.token_hash
    mail.outbox.clear()
    r = client.post(f"{CREATE_URL}{invite.pk}/resend/", {}, format="json")
    assert r.status_code == 200
    invite.refresh_from_db()
    assert invite.token_hash != old_hash
    url = next(line.strip() for line in mail.outbox[0].body.splitlines() if "token=" in line)
    new_raw = parse_qs(urlparse(url).query)["token"][0]
    assert invite.token_hash == hash_invitation_token(new_raw)
    assert hash_invitation_token(raw) != invite.token_hash
    assert _secret_keys(r.json()) == []


@pytest.mark.django_db
def test_admin_can_revoke_pending_invitation_and_it_cannot_be_accepted(authenticated_client, user):
    client, _admin = _staff_client()
    invite, raw = create_invitation(
        email="beta@example.com",
        complimentary_premium_until=_until(),
        send_email=False,
    )
    r = client.post(f"{CREATE_URL}{invite.pk}/revoke/", {}, format="json")
    assert r.status_code == 200
    assert r.json()["status"] == "revoked"
    user.email = "beta@example.com"
    user.save(update_fields=["email"])
    mark_email_verified(user)
    taken = authenticated_client.post("/api/billing/invitations/accept/", {"token": raw}, format="json")
    assert taken.status_code == 400
    invite.refresh_from_db()
    assert invite.accepted_at is None
    profile = get_user_profile(user)
    assert profile.complimentary_premium_until is None


@pytest.mark.django_db
def test_accepted_invitation_appears_in_staff_list(user):
    client, _admin = _staff_client()
    user.email = "accepted@example.com"
    user.save(update_fields=["email"])
    mark_email_verified(user)
    invite, raw = create_invitation(
        email="accepted@example.com",
        complimentary_premium_until=_until(days=20),
        send_email=False,
    )
    taker = APIClient()
    taker.force_authenticate(user=user)
    assert taker.post("/api/billing/invitations/accept/", {"token": raw}, format="json").status_code == 200
    listed = client.get(LIST_URL, {"status": "accepted"})
    assert listed.status_code == 200
    assert listed.json()["count"] == 1
    row = listed.json()["results"][0]
    assert row["status"] == "accepted"
    assert row["accepted_user"]["id"] == user.pk
    assert row["accepted_user"]["email"] == "accepted@example.com"
    assert row["accepted_at"]


@pytest.mark.django_db
def test_expired_invitation_appears_in_staff_list():
    client, _admin = _staff_client()
    invite, _raw = create_invitation(
        email="expired@example.com",
        complimentary_premium_until=_until(),
        send_email=False,
    )
    ComplimentaryPremiumInvitation.objects.filter(pk=invite.pk).update(
        expires_at=timezone.now() - timedelta(hours=1)
    )
    listed = client.get(LIST_URL, {"status": "expired"})
    assert listed.json()["count"] == 1
    assert listed.json()["results"][0]["status"] == "expired"


@pytest.mark.django_db
def test_admin_can_extend_complimentary_premium_without_altering_stripe(user):
    client, _admin = _staff_client()
    billing = grant_premium(user)
    snapshot = {
        "customer": billing.stripe_customer_id,
        "subscription": billing.stripe_subscription_id,
        "status": billing.status,
        "plan": billing.plan,
    }
    new_until = _until(days=120)
    r = client.patch(
        f"{LIST_URL}users/{user.pk}/complimentary-premium/",
        {"complimentary_premium_until": new_until.isoformat()},
        format="json",
    )
    assert r.status_code == 200
    assert "token" not in str(r.json()).lower()
    profile = get_user_profile(user)
    profile.refresh_from_db()
    assert profile.complimentary_premium_until == new_until
    billing.refresh_from_db()
    assert billing.stripe_customer_id == snapshot["customer"]
    assert billing.stripe_subscription_id == snapshot["subscription"]
    assert billing.status == snapshot["status"]
    assert billing.plan == snapshot["plan"]


@pytest.mark.django_db
def test_ordinary_user_cannot_extend_complimentary_premium(authenticated_client, user):
    r = authenticated_client.patch(
        f"{LIST_URL}users/{user.pk}/complimentary-premium/",
        {"complimentary_premium_until": _until().isoformat()},
        format="json",
    )
    assert r.status_code == 403
    assert get_user_profile(user).complimentary_premium_until is None
