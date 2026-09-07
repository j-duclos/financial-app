from datetime import timedelta

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient

from recommendations.models import RecommendationPreference
from recommendations.preferences import SNOOZE_DAYS

User = get_user_model()

REC_ID = "move-money-2-1"


@pytest.fixture
def other_user(db):
    return User.objects.create_user(username="otherrecuser", password="testpass123")


@pytest.fixture
def other_client(other_user):
    client = APIClient()
    client.force_authenticate(user=other_user)
    return client


def test_preferences_require_auth(api_client):
    assert api_client.get("/api/recommendations/preferences/").status_code == 401
    assert api_client.post(f"/api/recommendations/{REC_ID}/snooze/").status_code == 401


def test_authenticated_user_can_snooze(authenticated_client, user):
    r = authenticated_client.post(f"/api/recommendations/{REC_ID}/snooze/")
    assert r.status_code == 200, r.data
    body = r.json()
    assert REC_ID in body["snoozed"]
    assert REC_ID not in body["dismissed"]
    pref = RecommendationPreference.objects.get(user=user, recommendation_id=REC_ID)
    assert pref.state == RecommendationPreference.State.SNOOZED
    assert pref.snoozed_until is not None
    delta = pref.snoozed_until - timezone.now()
    assert timedelta(days=SNOOZE_DAYS - 1) < delta <= timedelta(days=SNOOZE_DAYS, minutes=1)


def test_snooze_expires_after_7_days(authenticated_client, user):
    authenticated_client.post(f"/api/recommendations/{REC_ID}/snooze/")
    pref = RecommendationPreference.objects.get(user=user, recommendation_id=REC_ID)
    pref.snoozed_until = timezone.now() - timedelta(seconds=1)
    pref.save(update_fields=["snoozed_until"])
    r = authenticated_client.get("/api/recommendations/preferences/")
    assert r.status_code == 200
    body = r.json()
    assert REC_ID not in body["snoozed"]
    assert REC_ID not in body["dismissed"]
    assert not RecommendationPreference.objects.filter(
        user=user, recommendation_id=REC_ID
    ).exists()


def test_dismiss_persists(authenticated_client, user):
    r = authenticated_client.post(f"/api/recommendations/{REC_ID}/dismiss/")
    assert r.status_code == 200
    assert REC_ID in r.json()["dismissed"]
    listed = authenticated_client.get("/api/recommendations/preferences/")
    assert REC_ID in listed.json()["dismissed"]
    pref = RecommendationPreference.objects.get(user=user, recommendation_id=REC_ID)
    assert pref.state == RecommendationPreference.State.DISMISSED
    assert pref.snoozed_until is None


def test_restore_works(authenticated_client, user):
    authenticated_client.post(f"/api/recommendations/{REC_ID}/dismiss/")
    r = authenticated_client.post(f"/api/recommendations/{REC_ID}/restore/")
    assert r.status_code == 200
    assert REC_ID not in r.json()["dismissed"]
    assert not RecommendationPreference.objects.filter(
        user=user, recommendation_id=REC_ID
    ).exists()


def test_unsnooze_works(authenticated_client, user):
    authenticated_client.post(f"/api/recommendations/{REC_ID}/snooze/")
    r = authenticated_client.post(f"/api/recommendations/{REC_ID}/unsnooze/")
    assert r.status_code == 200
    assert REC_ID not in r.json()["snoozed"]
    assert not RecommendationPreference.objects.filter(
        user=user, recommendation_id=REC_ID
    ).exists()


def test_preferences_are_user_scoped(authenticated_client, other_client, user, other_user):
    authenticated_client.post(f"/api/recommendations/{REC_ID}/dismiss/")
    mine = authenticated_client.get("/api/recommendations/preferences/").json()
    theirs = other_client.get("/api/recommendations/preferences/").json()
    assert REC_ID in mine["dismissed"]
    assert REC_ID not in theirs["dismissed"]
    assert RecommendationPreference.objects.filter(user=user, recommendation_id=REC_ID).exists()
    assert not RecommendationPreference.objects.filter(
        user=other_user, recommendation_id=REC_ID
    ).exists()


def test_survival_recommendation_cannot_be_dismissed_or_snoozed(authenticated_client):
    snooze = authenticated_client.post("/api/recommendations/survival-mode/snooze/")
    dismiss = authenticated_client.post("/api/recommendations/survival-mode/dismiss/")
    assert snooze.status_code == 400
    assert dismiss.status_code == 400
    assert not RecommendationPreference.objects.filter(recommendation_id="survival-mode").exists()
