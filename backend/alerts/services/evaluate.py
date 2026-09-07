from __future__ import annotations

import hashlib
import logging
import time
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from typing import Any, Iterable

from django.core.cache import cache
from django.utils import timezone

from accounts.models import Account
from accounts.services.balances import credit_owed_from_signed_balance
from alerts.models import ProjectedFundsAlert
from core.models import Household, HouseholdMembership
from timeline.models import RecurringRule
from timeline.services.ledger import (
    is_shadowed_by_matched_rule_sibling,
    is_superseded_planned_row,
)
from timeline.services.ledger_section_balances import signed_timeline_ledger_amount
from transactions.models import Transaction

logger = logging.getLogger("alerts.projected_funds")

ALERT_HORIZON_DAYS = 7
_DIRTY_CACHE_PREFIX = "projected_funds_alerts:dirty:"
_DIRTY_TTL_SECONDS = 60 * 60 * 6
_EVAL_LOCK_PREFIX = "projected_funds_alerts:lock:"
_EVAL_LOCK_SECONDS = 120
_MONEY_Q = Decimal("0.01")
_WORSEN_SHORTFALL = Decimal("50.00")

_CASH_TYPES = frozenset(
    {
        Account.AccountType.CHECKING,
        Account.AccountType.SAVINGS,
        Account.AccountType.CASH,
    }
)


@dataclass(frozen=True)
class DetectedRisk:
    household_id: int
    account_id: int
    occurrence_date: date
    fingerprint: str
    alert_type: str
    severity: str
    amount: Decimal
    projected_balance_before: Decimal
    projected_balance_after: Decimal
    shortfall: Decimal
    payee: str
    transaction_id: int | None
    rule_id: int | None


def mark_projected_funds_alerts_dirty(household_id: int | None) -> None:
    """Mark a household for bounded re-evaluation (no timeline work here)."""
    if household_id is None:
        return
    cache.set(f"{_DIRTY_CACHE_PREFIX}{int(household_id)}", "1", timeout=_DIRTY_TTL_SECONDS)


def _clear_dirty(household_id: int) -> None:
    cache.delete(f"{_DIRTY_CACHE_PREFIX}{int(household_id)}")


def _is_dirty(household_id: int) -> bool:
    return bool(cache.get(f"{_DIRTY_CACHE_PREFIX}{int(household_id)}"))


def _money(value: Decimal | str | int | float) -> Decimal:
    return Decimal(str(value)).quantize(_MONEY_Q)


def _row_date(row: dict[str, Any]) -> date | None:
    raw = row.get("date")
    if isinstance(raw, date):
        return raw
    if raw is None:
        return None
    try:
        return date.fromisoformat(str(raw)[:10])
    except ValueError:
        return None


def _eligible_account(account: Account) -> bool:
    if account.is_credit_card():
        return True
    return account.account_type in _CASH_TYPES


def _occurrence_identity(row: dict[str, Any]) -> str:
    tid = row.get("transaction_id")
    if tid is not None:
        return f"txn:{int(tid)}"
    rule_id = row.get("rule_id")
    if rule_id is not None:
        return f"rule:{int(rule_id)}"
    desc = str(row.get("description") or row.get("payee") or "").strip().lower()
    amt = str(_money(row.get("amount") or 0))
    source = str(row.get("source") or "").lower()
    digest = hashlib.sha256(f"{source}|{desc}|{amt}".encode("utf-8")).hexdigest()[:16]
    return f"synth:{digest}"


def fingerprint_for_row(*, household_id: int, account_id: int, row: dict[str, Any]) -> str:
    occ = _row_date(row)
    occ_s = occ.isoformat() if occ else "none"
    return f"{int(household_id)}:{int(account_id)}:{_occurrence_identity(row)}:{occ_s}"


def _severity_for_date(occurrence_date: date, today: date) -> str:
    if occurrence_date <= today:
        return ProjectedFundsAlert.Severity.CRITICAL
    return ProjectedFundsAlert.Severity.AT_RISK


def _skip_debit_row(row: dict[str, Any], account_rows: list[dict[str, Any]]) -> bool:
    if str(row.get("source") or "").lower() == "interest":
        return True
    status = str(row.get("status") or "").upper()
    if status in ("CLEARED", "RECONCILED"):
        return True
    match_status = str(row.get("import_match_status") or "").lower()
    if match_status == "matched":
        return True
    if str(row.get("plaid_transaction_id") or "").strip() and status != "PLANNED":
        return True
    if is_superseded_planned_row(row, account_rows):
        return True
    if is_shadowed_by_matched_rule_sibling(row, account_rows):
        return True
    return False


def _credit_available(limit: Decimal, signed_balance: Decimal) -> Decimal:
    owed = credit_owed_from_signed_balance(signed_balance)
    return _money(limit - owed)


def detect_risks_from_timeline(
    rows: list[dict[str, Any]],
    *,
    household_id: int,
    accounts_by_id: dict[int, Account],
    today: date,
) -> list[DetectedRisk]:
    """Walk canonical ``balance_after`` values. Does not rebuild forecast math."""
    horizon_end = today + timedelta(days=ALERT_HORIZON_DAYS)
    by_account: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        aid = row.get("account_id")
        if aid is None:
            continue
        by_account[int(aid)].append(row)

    detected: list[DetectedRisk] = []
    seen_fingerprints: set[str] = set()

    for account_id, account_rows in by_account.items():
        account = accounts_by_id.get(account_id)
        if account is None or not _eligible_account(account):
            continue
        credit_limit = _money(account.credit_limit or 0) if account.is_credit_card() else None

        for row in account_rows:
            occ = _row_date(row)
            if occ is None or occ < today or occ > horizon_end:
                continue
            signed = signed_timeline_ledger_amount(row)
            if signed >= 0:
                continue
            if _skip_debit_row(row, account_rows):
                continue
            raw_after = row.get("balance_after")
            if raw_after is None:
                continue
            after = _money(raw_after)
            before = _money(after - signed)
            amount = _money(abs(signed))

            if account.is_credit_card():
                available_after = _credit_available(credit_limit or Decimal("0"), after)
                if available_after >= 0:
                    continue
                alert_type = ProjectedFundsAlert.AlertType.CREDIT_LIMIT_RISK
                projected_before = _credit_available(credit_limit or Decimal("0"), before)
                projected_after = available_after
                shortfall = _money(abs(available_after))
            else:
                if after >= 0:
                    continue
                alert_type = ProjectedFundsAlert.AlertType.INSUFFICIENT_FUNDS
                projected_before = before
                projected_after = after
                shortfall = _money(abs(after))

            fp = fingerprint_for_row(household_id=household_id, account_id=account_id, row=row)
            if fp in seen_fingerprints:
                continue
            seen_fingerprints.add(fp)
            tid = row.get("transaction_id")
            rid = row.get("rule_id")
            payee = str(row.get("description") or row.get("payee") or "").strip()[:255]
            detected.append(
                DetectedRisk(
                    household_id=household_id,
                    account_id=account_id,
                    occurrence_date=occ,
                    fingerprint=fp,
                    alert_type=alert_type,
                    severity=_severity_for_date(occ, today),
                    amount=amount,
                    projected_balance_before=projected_before,
                    projected_balance_after=projected_after,
                    shortfall=shortfall,
                    payee=payee,
                    transaction_id=int(tid) if tid is not None else None,
                    rule_id=int(rid) if rid is not None else None,
                )
            )
    return detected


def candidate_household_ids(today: date) -> list[int]:
    horizon_end = today + timedelta(days=ALERT_HORIZON_DAYS)
    ids: set[int] = set()
    ids.update(
        Transaction.objects.filter(
            date__gte=today,
            date__lte=horizon_end,
            amount__lt=0,
            status=Transaction.Status.PLANNED,
        )
        .values_list("account__household_id", flat=True)
        .distinct()
    )
    ids.update(
        RecurringRule.objects.filter(
            active=True,
            direction__in=(RecurringRule.Direction.EXPENSE, RecurringRule.Direction.TRANSFER),
        )
        .values_list("household_id", flat=True)
        .distinct()
    )
    return sorted(i for i in ids if i is not None)


def _member_user_for_household(household_id: int):
    membership = (
        HouseholdMembership.objects.filter(household_id=household_id)
        .select_related("user")
        .order_by("id")
        .first()
    )
    return membership.user if membership else None


def _load_accounts(household_id: int) -> dict[int, Account]:
    return {
        acc.pk: acc
        for acc in Account.objects.filter(household_id=household_id, is_hidden=False)
    }


def persist_detected_risks(
    household_id: int,
    detected: Iterable[DetectedRisk],
    *,
    now=None,
) -> dict[str, int]:
    now = now or timezone.now()
    by_fp = {item.fingerprint: item for item in detected}
    existing = {
        alert.fingerprint: alert
        for alert in ProjectedFundsAlert.objects.filter(household_id=household_id)
    }
    created = 0
    updated = 0
    reactivated = 0
    resolved = 0

    for fp, item in by_fp.items():
        alert = existing.get(fp)
        fields = {
            "household_id": item.household_id,
            "account_id": item.account_id,
            "transaction_id": item.transaction_id,
            "rule_id": item.rule_id,
            "occurrence_date": item.occurrence_date,
            "alert_type": item.alert_type,
            "severity": item.severity,
            "amount": item.amount,
            "projected_balance_before": item.projected_balance_before,
            "projected_balance_after": item.projected_balance_after,
            "shortfall": item.shortfall,
            "payee": item.payee,
            "last_evaluated_at": now,
        }
        if alert is None:
            ProjectedFundsAlert.objects.create(fingerprint=fp, **fields)
            created += 1
            continue
        was_resolved = alert.resolved_at is not None
        update_fields = [
            "account_id",
            "transaction_id",
            "rule_id",
            "occurrence_date",
            "alert_type",
            "severity",
            "amount",
            "projected_balance_before",
            "projected_balance_after",
            "shortfall",
            "payee",
            "last_evaluated_at",
        ]
        for key, value in fields.items():
            setattr(alert, key, value)
        if was_resolved:
            alert.resolved_at = None
            update_fields.append("resolved_at")
            reactivated += 1
        else:
            updated += 1
        alert.save(update_fields=update_fields)

    active_fps = set(by_fp)
    still_open = ProjectedFundsAlert.objects.filter(
        household_id=household_id,
        resolved_at__isnull=True,
    ).exclude(fingerprint__in=active_fps)
    resolved = still_open.update(resolved_at=now, last_evaluated_at=now)
    return {
        "created": created,
        "updated": updated,
        "reactivated": reactivated,
        "resolved": resolved,
        "active": len(by_fp),
    }


def evaluate_projected_funds_alerts_for_household(
    household_id: int,
    *,
    today: date | None = None,
    send_notifications: bool = False,
) -> dict[str, Any]:
    """Build a 7-day canonical timeline and upsert/resolve alerts for one household."""
    started = time.perf_counter()
    today = today or timezone.localdate()
    lock_key = f"{_EVAL_LOCK_PREFIX}{household_id}"
    if not cache.add(lock_key, "1", timeout=_EVAL_LOCK_SECONDS):
        return {"household_id": household_id, "skipped": "locked"}

    try:
        user = _member_user_for_household(household_id)
        if user is None:
            return {"household_id": household_id, "skipped": "no_members"}

        from timeline.services.canonical_timeline_cache import get_or_build_canonical_forecast_timeline

        rows, cache_hit = get_or_build_canonical_forecast_timeline(
            user,
            today=today,
            forecast_days=ALERT_HORIZON_DAYS,
            household_id=household_id,
            caller="projected_funds_alerts",
        )
        accounts_by_id = _load_accounts(household_id)
        detected = detect_risks_from_timeline(
            rows,
            household_id=household_id,
            accounts_by_id=accounts_by_id,
            today=today,
        )
        stats = persist_detected_risks(household_id, detected)
        _clear_dirty(household_id)
        notify_stats: dict[str, int] = {}
        if send_notifications:
            from alerts.services.notify import send_due_projected_funds_notifications

            notify_stats = send_due_projected_funds_notifications(
                household_id=household_id,
                today=today,
            )
        elapsed_ms = (time.perf_counter() - started) * 1000
        logger.info(
            "projected_funds_alerts household_id=%s elapsed_ms=%.0f cache_hit=%s "
            "rows=%s active=%s created=%s updated=%s reactivated=%s resolved=%s notify=%s",
            household_id,
            elapsed_ms,
            cache_hit,
            len(rows),
            stats["active"],
            stats["created"],
            stats["updated"],
            stats["reactivated"],
            stats["resolved"],
            notify_stats,
        )
        return {
            "household_id": household_id,
            "elapsed_ms": round(elapsed_ms),
            "cache_hit": cache_hit,
            "row_count": len(rows),
            **stats,
            "notify": notify_stats,
        }
    finally:
        cache.delete(lock_key)


def evaluate_projected_funds_alerts(
    *,
    household_id: int | None = None,
    today: date | None = None,
    send_notifications: bool = True,
) -> dict[str, Any]:
    """Hourly evaluator: bounded 7-day timeline, then notifications when due."""
    started = time.perf_counter()
    today = today or timezone.localdate()
    if household_id is not None:
        ids = [household_id]
    else:
        ids = candidate_household_ids(today)
    results = []
    for hid in ids:
        if not Household.objects.filter(pk=hid).exists():
            continue
        results.append(
            evaluate_projected_funds_alerts_for_household(
                hid,
                today=today,
                send_notifications=send_notifications,
            )
        )
    elapsed_ms = (time.perf_counter() - started) * 1000
    logger.info(
        "projected_funds_alerts batch elapsed_ms=%.0f households=%s",
        elapsed_ms,
        len(results),
    )
    return {
        "elapsed_ms": round(elapsed_ms),
        "households": len(results),
        "results": results,
    }


def ensure_household_alerts_fresh(household_id: int) -> None:
    """Re-run the 7-day evaluator after financial mutations (dirty flag only)."""
    if not _is_dirty(household_id):
        return
    evaluate_projected_funds_alerts_for_household(
        household_id,
        send_notifications=False,
    )


def risk_worsened(alert: ProjectedFundsAlert, previous_shortfall: Decimal | None) -> bool:
    if previous_shortfall is None:
        return False
    return alert.shortfall - previous_shortfall >= _WORSEN_SHORTFALL
