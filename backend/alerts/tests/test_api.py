from datetime import date, timedelta
from decimal import Decimal

import pytest

from accounts.models import Account
from alerts.models import ProjectedFundsAlert, PushDevice
from alerts.services.evaluate import evaluate_projected_funds_alerts_for_household
from core.models import Household, HouseholdMembership
from django.contrib.auth import get_user_model
from transactions.models import Transaction

User = get_user_model()
TODAY = date(2026, 9, 7)


def _seed_alert(user, household):
    account = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Main Checking",
        currency="USD",
        starting_balance=Decimal("100.00"),
        include_in_forecast=True,
    )
    Transaction.objects.create(
        account=account,
        date=TODAY + timedelta(days=1),
        payee="Rent",
        amount=Decimal("-400.00"),
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.ONE_TIME,
    )
    evaluate_projected_funds_alerts_for_household(
        household.id, today=TODAY, send_notifications=False
    )
    return ProjectedFundsAlert.objects.get(household=household)


@pytest.mark.django_db
def test_alerts_require_auth(api_client):
    assert api_client.get("/api/alerts/").status_code == 401


@pytest.mark.django_db
def test_list_and_dismiss_alert(authenticated_client, user, household):
    alert = _seed_alert(user, household)
    listed = authenticated_client.get("/api/alerts/?active=1")
    assert listed.status_code == 200
    results = listed.json()["results"]
    assert len(results) == 1
    assert results[0]["id"] == alert.id
    assert results[0]["shortfall"] == "300.00"
    assert results[0]["projected_balance_before"] == "100.00"
    assert results[0]["projected_balance_after"] == "-300.00"
    assert results[0]["account_name"] == "Main Checking"
    assert "title" in results[0]
    patched = authenticated_client.patch(
        f"/api/alerts/{alert.id}/", {"dismissed": True, "read": True}, format="json"
    )
    assert patched.status_code == 200
    assert patched.json()["dismissed_at"] is not None
    assert patched.json()["read_at"] is not None
    active = authenticated_client.get("/api/alerts/?active=1")
    assert active.json()["results"] == []


@pytest.mark.django_db
def test_alerts_are_household_scoped(authenticated_client, user, household):
    _seed_alert(user, household)
    other = User.objects.create_user(username="other-alert", password="testpass123")
    other_hh = Household.objects.create(name="Other")
    HouseholdMembership.objects.create(
        household=other_hh, user=other, role=HouseholdMembership.Role.OWNER
    )
    _seed_alert(other, other_hh)
    listed = authenticated_client.get("/api/alerts/?active=1")
    ids = {row["id"] for row in listed.json()["results"]}
    assert ProjectedFundsAlert.objects.filter(household=household).get().id in ids
    assert ProjectedFundsAlert.objects.filter(household=other_hh).get().id not in ids


@pytest.mark.django_db
def test_push_device_register_and_delete(authenticated_client, user):
    created = authenticated_client.post(
        "/api/push-devices/",
        {
            "expo_push_token": "ExponentPushToken[abc123]",
            "platform": "ios",
            "device_id": "phone-1",
        },
        format="json",
    )
    assert created.status_code == 201, created.data
    device_id = created.json()["id"]
    again = authenticated_client.post(
        "/api/push-devices/",
        {
            "expo_push_token": "ExponentPushToken[abc123]",
            "platform": "ios",
        },
        format="json",
    )
    assert again.status_code == 201
    assert again.json()["id"] == device_id
    assert PushDevice.objects.filter(user=user).count() == 1
    deleted = authenticated_client.delete(f"/api/push-devices/{device_id}/")
    assert deleted.status_code == 204
    assert PushDevice.objects.filter(user=user).count() == 0


@pytest.mark.django_db
def test_push_device_cannot_see_other_users_tokens(authenticated_client, user):
    other = User.objects.create_user(username="other-push", password="testpass123")
    foreign = PushDevice.objects.create(
        user=other,
        expo_push_token="ExponentPushToken[secret]",
        platform=PushDevice.Platform.ANDROID,
    )
    listed = authenticated_client.get("/api/push-devices/")
    assert listed.json()["results"] == []
    stolen = authenticated_client.delete(f"/api/push-devices/{foreign.id}/")
    assert stolen.status_code in (403, 404)
    assert PushDevice.objects.filter(pk=foreign.id).exists()


@pytest.mark.django_db
def test_profile_notification_preferences_round_trip(authenticated_client, user):
    r = authenticated_client.patch(
        "/api/profile/",
        {
            "projected_funds_alerts_enabled": True,
            "projected_funds_web_alerts": False,
            "projected_funds_push_enabled": False,
            "notify_3_days_before": False,
            "notify_1_day_before": True,
            "notify_day_of": True,
        },
        format="json",
    )
    assert r.status_code == 200, r.data
    body = r.json()
    assert body["projected_funds_web_alerts"] is False
    assert body["projected_funds_push_enabled"] is False
    assert body["notify_3_days_before"] is False
    assert body["notify_day_of"] is True
