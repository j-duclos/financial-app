from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
from datetime import date, timedelta
from decimal import Decimal
from typing import Callable

from django.conf import settings
from django.utils import timezone

from alerts.models import ProjectedFundsAlert, PushDevice
from alerts.services.copy import alert_body, alert_title
from alerts.services.evaluate import _WORSEN_SHORTFALL
from core.models import HouseholdMembership
from core.utils import get_user_profile

logger = logging.getLogger("alerts.projected_funds")

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
_PUSH_SEVERITIES = frozenset(
    {
        ProjectedFundsAlert.Severity.AT_RISK,
        ProjectedFundsAlert.Severity.CRITICAL,
    }
)

PushSender = Callable[[list[dict]], list[dict]]


def _expo_token_valid(token: str) -> bool:
    token = (token or "").strip()
    return token.startswith("ExponentPushToken[") or token.startswith("ExpoPushToken[")


def default_expo_sender(messages: list[dict]) -> list[dict]:
    if not messages:
        return []
    if getattr(settings, "PROJECTED_FUNDS_PUSH_DRY_RUN", False):
        return [{"status": "ok", "id": "dry-run"} for _ in messages]
    body = json.dumps(messages).encode("utf-8")
    headers = {
        "Accept": "application/json",
        "Accept-Encoding": "gzip, deflate",
        "Content-Type": "application/json",
    }
    token = getattr(settings, "EXPO_ACCESS_TOKEN", "") or ""
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(EXPO_PUSH_URL, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            payload = json.loads(resp.read().decode("utf-8") or "{}")
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        logger.exception("expo push send failed count=%s", len(messages))
        return [{"status": "error"} for _ in messages]
    data = payload.get("data")
    if isinstance(data, list):
        return data
    return [{"status": "error"} for _ in messages]


def _threshold_for_days(days_until: int) -> str | None:
    if days_until <= 0:
        return "day_of"
    if days_until == 1:
        return "1d"
    if days_until == 3:
        return "3d"
    return None


def _pref_allows_threshold(profile, threshold: str) -> bool:
    if profile is None:
        return True
    if not getattr(profile, "projected_funds_alerts_enabled", True):
        return False
    if not getattr(profile, "projected_funds_push_enabled", True):
        return False
    if threshold == "3d":
        return bool(getattr(profile, "notify_3_days_before", True))
    if threshold == "1d":
        return bool(getattr(profile, "notify_1_day_before", True))
    if threshold == "day_of":
        return bool(getattr(profile, "notify_day_of", True))
    return False


def _already_sent(alert: ProjectedFundsAlert, threshold: str) -> bool:
    if threshold == "3d":
        return alert.notified_3d_at is not None
    if threshold == "1d":
        return alert.notified_1d_at is not None
    if threshold == "day_of":
        return alert.notified_day_of_at is not None
    return True


def _mark_sent(alert: ProjectedFundsAlert, threshold: str, now) -> None:
    if threshold == "3d":
        alert.notified_3d_at = now
    elif threshold == "1d":
        alert.notified_1d_at = now
    elif threshold == "day_of":
        alert.notified_day_of_at = now
    alert.last_notified_shortfall = alert.shortfall


def _should_send(alert: ProjectedFundsAlert, today: date, profile) -> str | None:
    if alert.resolved_at is not None or alert.dismissed_at is not None:
        return None
    if alert.severity not in _PUSH_SEVERITIES:
        return None
    days_until = (alert.occurrence_date - today).days
    threshold = _threshold_for_days(days_until)
    if threshold is None:
        return None
    if not _pref_allows_threshold(profile, threshold):
        return None
    if not _already_sent(alert, threshold):
        return threshold
    previous = alert.last_notified_shortfall
    if previous is not None and alert.shortfall - previous >= _WORSEN_SHORTFALL:
        return threshold
    return None


def _deep_link(alert: ProjectedFundsAlert) -> str:
    return f"/action-center?alert={alert.pk}"


def send_due_projected_funds_notifications(
    *,
    household_id: int | None = None,
    today: date | None = None,
    sender: PushSender | None = None,
) -> dict[str, int]:
    today = today or timezone.localdate()
    sender = sender or default_expo_sender
    now = timezone.now()
    qs = ProjectedFundsAlert.objects.filter(
        resolved_at__isnull=True,
        dismissed_at__isnull=True,
        severity__in=_PUSH_SEVERITIES,
        occurrence_date__gte=today - timedelta(days=1),
        occurrence_date__lte=today + timedelta(days=3),
    ).select_related("account", "household")
    if household_id is not None:
        qs = qs.filter(household_id=household_id)

    sent = 0
    skipped = 0
    devices_touched = 0
    invalid = 0

    for alert in qs:
        members = list(
            HouseholdMembership.objects.filter(household_id=alert.household_id).select_related(
                "user"
            )
        )
        account_name = alert.account.effective_display_name
        title = alert_title(alert, account_name)
        body = alert_body(alert, today=today)
        any_sent = False
        for membership in members:
            profile = get_user_profile(membership.user)
            threshold = _should_send(alert, today, profile)
            if threshold is None:
                skipped += 1
                continue
            devices = list(
                PushDevice.objects.filter(user=membership.user, enabled=True)
            )
            messages = []
            device_by_index: list[PushDevice] = []
            for device in devices:
                if not _expo_token_valid(device.expo_push_token):
                    device.enabled = False
                    device.save(update_fields=["enabled", "last_seen_at"])
                    invalid += 1
                    continue
                messages.append(
                    {
                        "to": device.expo_push_token,
                        "title": title,
                        "body": body,
                        "sound": "default",
                        "data": {
                            "type": "projected_funds_alert",
                            "alertId": alert.pk,
                            "url": _deep_link(alert),
                        },
                    }
                )
                device_by_index.append(device)
            if not messages:
                continue
            receipts = sender(messages)
            for idx, receipt in enumerate(receipts):
                status = str((receipt or {}).get("status") or "")
                if status == "error":
                    details = str((receipt or {}).get("details", {}).get("error") or "")
                    if "DeviceNotRegistered" in details or "InvalidCredentials" in details:
                        device_by_index[idx].enabled = False
                        device_by_index[idx].save(update_fields=["enabled", "last_seen_at"])
                        invalid += 1
                else:
                    devices_touched += 1
                    any_sent = True
        if any_sent:
            days_until = (alert.occurrence_date - today).days
            threshold = _threshold_for_days(days_until) or "day_of"
            _mark_sent(alert, threshold, now)
            alert.save(
                update_fields=[
                    "notified_3d_at",
                    "notified_1d_at",
                    "notified_day_of_at",
                    "last_notified_shortfall",
                    "last_evaluated_at",
                ]
            )
            sent += 1

    return {
        "alerts_notified": sent,
        "skipped": skipped,
        "devices": devices_touched,
        "invalid_tokens": invalid,
    }
