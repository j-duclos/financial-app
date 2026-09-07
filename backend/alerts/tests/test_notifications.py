from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.utils import timezone

from accounts.models import Account
from alerts.models import ProjectedFundsAlert, PushDevice
from alerts.services.evaluate import evaluate_projected_funds_alerts_for_household
from alerts.services.notify import send_due_projected_funds_notifications
from common.services.cache import invalidate_financial_cache_for_household
from core.utils import get_user_profile
from transactions.models import Transaction

TODAY = date(2026, 9, 7)


def _setup_risk(household, *, days: int = 3, balance: str = "300.00"):
    account = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Main Checking",
        currency="USD",
        starting_balance=Decimal(balance),
        include_in_forecast=True,
    )
    txn = Transaction.objects.create(
        account=account,
        date=TODAY + timedelta(days=days),
        payee="Rent",
        amount=Decimal("-500.00"),
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.ONE_TIME,
        planned_date=TODAY + timedelta(days=days),
    )
    evaluate_projected_funds_alerts_for_household(
        household.id, today=TODAY, send_notifications=False
    )
    return account, txn, ProjectedFundsAlert.objects.get(household=household)


def _device(user, token="ExponentPushToken[test-device-a]"):
    return PushDevice.objects.create(
        user=user,
        expo_push_token=token,
        platform=PushDevice.Platform.IOS,
        enabled=True,
    )


@pytest.mark.django_db
def test_alert_created_and_resolved(user, household):
    _setup_risk(household, days=3)
    assert ProjectedFundsAlert.objects.filter(resolved_at__isnull=True).exists()
    Transaction.objects.create(
        account=Account.objects.get(household=household),
        date=TODAY + timedelta(days=1),
        payee="Paycheck",
        amount=Decimal("1000.00"),
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.ONE_TIME,
    )
    invalidate_financial_cache_for_household(household.id)
    evaluate_projected_funds_alerts_for_household(
        household.id, today=TODAY, send_notifications=False
    )
    assert ProjectedFundsAlert.objects.get().resolved_at is not None


@pytest.mark.django_db
def test_three_day_one_day_and_day_of_each_send_once(user, household):
    _setup_risk(household, days=3)
    _device(user)
    captured: list[list[dict]] = []

    def sender(messages):
        captured.append(messages)
        return [{"status": "ok"} for _ in messages]

    send_due_projected_funds_notifications(household_id=household.id, today=TODAY, sender=sender)
    send_due_projected_funds_notifications(household_id=household.id, today=TODAY, sender=sender)
    alert = ProjectedFundsAlert.objects.get()
    assert alert.notified_3d_at is not None
    assert len(captured) == 1

    send_due_projected_funds_notifications(
        household_id=household.id, today=TODAY + timedelta(days=2), sender=sender
    )
    send_due_projected_funds_notifications(
        household_id=household.id, today=TODAY + timedelta(days=2), sender=sender
    )
    alert.refresh_from_db()
    assert alert.notified_1d_at is not None

    send_due_projected_funds_notifications(
        household_id=household.id, today=TODAY + timedelta(days=3), sender=sender
    )
    send_due_projected_funds_notifications(
        household_id=household.id, today=TODAY + timedelta(days=3), sender=sender
    )
    alert.refresh_from_db()
    assert alert.notified_day_of_at is not None
    assert len(captured) == 3
    assert "Main Checking" in captured[0][0]["title"]
    assert "alertId" in captured[0][0]["data"]
    assert captured[0][0]["data"]["url"] == f"/action-center?alert={alert.pk}"


@pytest.mark.django_db
def test_duplicate_cron_does_not_resend(user, household):
    _setup_risk(household, days=1)
    _device(user)
    calls = {"n": 0}

    def sender(messages):
        calls["n"] += 1
        return [{"status": "ok"} for _ in messages]

    send_due_projected_funds_notifications(household_id=household.id, today=TODAY, sender=sender)
    send_due_projected_funds_notifications(household_id=household.id, today=TODAY, sender=sender)
    evaluate_projected_funds_alerts_for_household(
        household.id, today=TODAY, send_notifications=False
    )
    send_due_projected_funds_notifications(household_id=household.id, today=TODAY, sender=sender)
    assert calls["n"] == 1


@pytest.mark.django_db
def test_dismissed_alert_does_not_push(user, household):
    _setup_risk(household, days=0)
    _device(user)
    alert = ProjectedFundsAlert.objects.get()
    alert.dismissed_at = timezone.now()
    alert.save(update_fields=["dismissed_at"])
    captured = []
    send_due_projected_funds_notifications(
        household_id=household.id,
        today=TODAY,
        sender=lambda messages: captured.append(messages) or [{"status": "ok"}],
    )
    assert captured == []


@pytest.mark.django_db
def test_resolved_alert_stops_notifications(user, household):
    account, _txn, alert = _setup_risk(household, days=1)
    _device(user)
    alert.resolved_at = timezone.now()
    alert.save(update_fields=["resolved_at"])
    captured = []
    send_due_projected_funds_notifications(
        household_id=household.id,
        today=TODAY,
        sender=lambda messages: captured.append(messages) or [{"status": "ok"}],
    )
    assert captured == []


@pytest.mark.django_db
def test_multiple_devices_receive_same_alert(user, household):
    _setup_risk(household, days=0)
    _device(user, "ExponentPushToken[one]")
    _device(user, "ExponentPushToken[two]")
    captured: list[dict] = []

    def sender(messages):
        captured.extend(messages)
        return [{"status": "ok"} for _ in messages]

    send_due_projected_funds_notifications(household_id=household.id, today=TODAY, sender=sender)
    tokens = {m["to"] for m in captured}
    assert tokens == {"ExponentPushToken[one]", "ExponentPushToken[two]"}


@pytest.mark.django_db
def test_disabled_push_preference_is_respected(user, household):
    _setup_risk(household, days=0)
    _device(user)
    profile = get_user_profile(user)
    profile.projected_funds_push_enabled = False
    profile.save(update_fields=["projected_funds_push_enabled"])
    captured = []
    send_due_projected_funds_notifications(
        household_id=household.id,
        today=TODAY,
        sender=lambda messages: captured.append(messages) or [{"status": "ok"}],
    )
    assert captured == []


@pytest.mark.django_db
def test_invalid_or_denied_device_is_disabled(user, household):
    _setup_risk(household, days=0)
    bad = PushDevice.objects.create(
        user=user,
        expo_push_token="not-a-token",
        platform=PushDevice.Platform.IOS,
        enabled=True,
    )
    send_due_projected_funds_notifications(
        household_id=household.id,
        today=TODAY,
        sender=lambda messages: [{"status": "ok"} for _ in messages],
    )
    bad.refresh_from_db()
    assert bad.enabled is False


@pytest.mark.django_db
def test_deep_link_targets_action_center_alert(user, household):
    _setup_risk(household, days=0)
    _device(user)
    captured = []
    send_due_projected_funds_notifications(
        household_id=household.id,
        today=TODAY,
        sender=lambda messages: captured.append(messages) or [{"status": "ok"} for _ in messages],
    )
    alert = ProjectedFundsAlert.objects.get()
    assert captured[0][0]["data"]["url"] == f"/action-center?alert={alert.id}"
    assert "plaid" not in captured[0][0]["body"].lower()
    assert "token" not in captured[0][0]["data"]
