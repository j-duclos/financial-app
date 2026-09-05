"""Canonical credit-card minimum-payment source policy.

Every consumer (DTI, Payment Planner, autopay, forecast, account health) must use
``resolve_effective_minimum_payment`` or the compatibility field it maintains
(``Account.minimum_payment_amount``). Do not implement a second priority order.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from accounts.models import Account

TWOPLACES = Decimal("0.01")
ZERO = Decimal("0.00")

SOURCE_PLAID = "plaid"
SOURCE_MANUAL = "manual"
SOURCE_NONE = "none"

FRESHNESS_FRESH = "fresh"
FRESHNESS_STALE = "stale"
FRESHNESS_MANUAL = "manual"
FRESHNESS_UNAVAILABLE = "unavailable"
FRESHNESS_UNSUPPORTED = "unsupported"
FRESHNESS_REAUTH = "reauthorization_required"
FRESHNESS_SYNC_FAILED = "sync_failed"
FRESHNESS_PRODUCT_NOT_ENABLED = "product_not_enabled"

SYNC_OK = "ok"
SYNC_UNSUPPORTED = "unsupported"
SYNC_REAUTH = "reauthorization_required"
SYNC_FAILED = "failed"
SYNC_MISSING = "missing_liability"
SYNC_PRODUCT_NOT_ENABLED = "product_not_enabled"
SYNC_CURRENCY_MISMATCH = "currency_mismatch"

WARNING_ZERO_WITH_BALANCE = "provider_minimum_zero_with_balance"
WARNING_UNAVAILABLE = "minimum_unavailable"
WARNING_STALE = "provider_minimum_stale"
WARNING_REAUTH = "reauthorization_required"
WARNING_UNSUPPORTED = "provider_unsupported"

MODE_AUTOMATIC = Account.MinimumPaymentMode.AUTOMATIC
MODE_MANUAL = Account.MinimumPaymentMode.MANUAL


def money_from_provider(value: Any) -> Decimal | None:
    """Convert a Plaid numeric to Decimal money. None stays None; never invents 0."""
    if value is None:
        return None
    if isinstance(value, Decimal):
        return value.quantize(TWOPLACES, rounding=ROUND_HALF_UP)
    try:
        return Decimal(f"{float(value):.2f}")
    except (TypeError, ValueError):
        return None


def as_money(value: Any) -> Decimal | None:
    if value is None or value == "":
        return None
    if isinstance(value, Decimal):
        return value.quantize(TWOPLACES, rounding=ROUND_HALF_UP)
    return Decimal(str(value)).quantize(TWOPLACES, rounding=ROUND_HALF_UP)


def freshness_period() -> timedelta:
    days = int(getattr(settings, "MINIMUM_PAYMENT_FRESHNESS_DAYS", 45))
    return timedelta(days=max(1, days))


def is_provider_zero_usable(
    *,
    provider_minimum: Decimal | None,
    statement_balance: Decimal | None = None,
    current_owed: Decimal | None = None,
) -> bool:
    """Whether a reported zero is a usable required minimum.

    A positive amount is always usable. A zero is usable only when the card
    appears paid off (no statement balance and no current owed). Null is never
    usable. This does not estimate an issuer minimum from balance.
    """
    if provider_minimum is None:
        return False
    if provider_minimum > ZERO:
        return True
    if provider_minimum < ZERO:
        return False
    stmt = as_money(statement_balance) or ZERO
    owed = as_money(current_owed) or ZERO
    return stmt <= ZERO and owed <= ZERO


@dataclass(frozen=True)
class EffectiveMinimum:
    amount: Decimal | None
    source: str
    freshness: str
    warning_code: str | None
    warning_message: str | None
    provider_amount: Decimal | None
    manual_amount: Decimal | None
    observed_at: datetime | None

    @property
    def usable(self) -> bool:
        return self.amount is not None and self.amount > ZERO


def _observed_is_fresh(observed_at: datetime | None, *, now: datetime | None = None) -> bool:
    if observed_at is None:
        return False
    now = now or timezone.now()
    if timezone.is_naive(observed_at):
        observed_at = timezone.make_aware(observed_at, timezone.get_current_timezone())
    return now - observed_at <= freshness_period()


def resolve_effective_minimum_payment(
    account: Account,
    *,
    current_owed: Decimal | None = None,
    now: datetime | None = None,
) -> EffectiveMinimum:
    """Return the effective minimum according to mode and stored provider/manual values."""
    now = now or timezone.now()
    mode = getattr(account, "minimum_payment_mode", None) or MODE_MANUAL
    manual = as_money(getattr(account, "manual_minimum_payment_amount", None))
    stored = as_money(getattr(account, "minimum_payment_amount", None))
    if manual is None and stored is not None and stored > ZERO:
        # Legacy rows may only have the compatibility field populated.
        manual = stored
    provider = as_money(getattr(account, "provider_minimum_payment_amount", None))
    observed = getattr(account, "provider_minimum_payment_observed_at", None)
    sync_status = (getattr(account, "provider_minimum_payment_sync_status", None) or "").strip()
    stmt = as_money(getattr(account, "statement_balance", None))
    owed = as_money(current_owed)
    if owed is None:
        owed = as_money(getattr(account, "current_balance", None))

    provider_fresh = _observed_is_fresh(observed, now=now)
    provider_usable = False
    zero_conflict = False
    if provider is not None:
        if provider > ZERO:
            provider_usable = True
        elif provider == ZERO:
            if is_provider_zero_usable(
                provider_minimum=provider, statement_balance=stmt, current_owed=owed
            ):
                provider_usable = True
            else:
                zero_conflict = True

    if mode == MODE_MANUAL:
        warning = None
        code = None
        if provider_usable and manual is not None and provider != manual:
            warning = (
                f"Institution last reported {provider} while the manual minimum is {manual}."
            )
        return EffectiveMinimum(
            amount=manual,
            source=SOURCE_MANUAL if manual is not None else SOURCE_NONE,
            freshness=FRESHNESS_MANUAL if manual is not None else FRESHNESS_UNAVAILABLE,
            warning_code=WARNING_UNAVAILABLE if manual is None else None,
            warning_message=warning,
            provider_amount=provider,
            manual_amount=manual,
            observed_at=observed,
        )

    freshness = FRESHNESS_UNAVAILABLE
    if sync_status == SYNC_UNSUPPORTED:
        freshness = FRESHNESS_UNSUPPORTED
    elif sync_status == SYNC_REAUTH:
        freshness = FRESHNESS_REAUTH
    elif sync_status == SYNC_PRODUCT_NOT_ENABLED:
        freshness = FRESHNESS_PRODUCT_NOT_ENABLED
    elif sync_status == SYNC_FAILED:
        freshness = FRESHNESS_SYNC_FAILED
    elif provider_usable and provider_fresh:
        freshness = FRESHNESS_FRESH
    elif provider_usable:
        freshness = FRESHNESS_STALE

    warning_code = None
    warning_message = None
    if zero_conflict:
        warning_code = WARNING_ZERO_WITH_BALANCE
        warning_message = (
            "Plaid reported no required minimum while this account still has a balance."
        )
    elif sync_status == SYNC_REAUTH:
        warning_code = WARNING_REAUTH
        warning_message = "Reconnect this bank login to refresh the institution minimum."
    elif sync_status == SYNC_UNSUPPORTED:
        warning_code = WARNING_UNSUPPORTED
        warning_message = "This institution does not provide credit-card minimum payments."
    elif provider_usable and not provider_fresh:
        warning_code = WARNING_STALE
        warning_message = "Last institution minimum is older than the freshness window; refresh recommended."
    elif not provider_usable and manual is None:
        warning_code = WARNING_UNAVAILABLE
        warning_message = "Minimum unavailable — enter manually or refresh from the institution."

    if provider_usable:
        amount = provider
        source = SOURCE_PLAID
        if freshness == FRESHNESS_UNAVAILABLE:
            freshness = FRESHNESS_STALE if not provider_fresh else FRESHNESS_FRESH
    elif manual is not None:
        amount = manual
        source = SOURCE_MANUAL
        if freshness in (FRESHNESS_UNAVAILABLE,):
            freshness = FRESHNESS_MANUAL
    else:
        amount = None
        source = SOURCE_NONE

    return EffectiveMinimum(
        amount=amount,
        source=source,
        freshness=freshness,
        warning_code=warning_code,
        warning_message=warning_message,
        provider_amount=provider,
        manual_amount=manual,
        observed_at=observed,
    )


def persist_resolved_minimum(
    account: Account,
    resolved: EffectiveMinimum,
    extra_updates: dict | None = None,
    *,
    invalidate: bool | None = None,
) -> bool:
    """Write the compatibility field. Returns True if the effective amount changed.

    Uses QuerySet.update so Account post_save does not fire for metadata-only writes.
    """
    previous = as_money(account.minimum_payment_amount)
    new_amount = resolved.amount if resolved.amount is not None else ZERO
    changed = previous != new_amount
    updates = {
        "minimum_payment_amount": new_amount,
        "updated_at": timezone.now(),
    }
    if extra_updates:
        updates.update(extra_updates)
    Account.objects.filter(pk=account.pk).update(**updates)
    for key, value in updates.items():
        setattr(account, key, value)
    should_invalidate = changed if invalidate is None else invalidate
    if should_invalidate:
        household_id = account.household_id

        def _invalidate() -> None:
            from common.services.cache import invalidate_financial_cache_for_household

            invalidate_financial_cache_for_household(household_id)

        if transaction.get_connection().in_atomic_block:
            transaction.on_commit(_invalidate)
        else:
            _invalidate()
    return changed


def apply_user_minimum_settings(
    account: Account,
    *,
    mode: str | None = None,
    manual_amount: Decimal | None = None,
    set_manual: bool = False,
) -> EffectiveMinimum:
    """Apply a deliberate user mode/manual change and resolve the effective minimum."""
    extra: dict = {}
    if mode is not None:
        extra["minimum_payment_mode"] = mode
        account.minimum_payment_mode = mode
    if set_manual:
        extra["manual_minimum_payment_amount"] = manual_amount
        account.manual_minimum_payment_amount = manual_amount
    resolved = resolve_effective_minimum_payment(account)
    persist_resolved_minimum(account, resolved, extra_updates=extra, invalidate=True)
    return resolved


def apply_plaid_credit_liability(
    account: Account,
    liability: Any,
    *,
    observed_at: datetime,
    current_owed: Decimal | None = None,
    currency_ok: bool = True,
) -> dict[str, Any]:
    """Store provider fields from a Plaid CreditCardLiability and resolve effective min.

    Does not overwrite manual mode. Does not replace a previous valid provider
    minimum with null. Returns a per-account result dict.
    """
    warning = None
    if not account.is_credit_card():
        return {"account_id": account.id, "updated": False, "reason": "not_credit"}
    if account.status != Account.Status.ACTIVE or not account.is_active:
        return {"account_id": account.id, "updated": False, "reason": "inactive"}
    if not currency_ok:
        extra = {
            "provider_minimum_payment_sync_status": SYNC_CURRENCY_MISMATCH,
            "provider_minimum_payment_sync_message": "Provider currency does not match this account.",
        }
        resolved = resolve_effective_minimum_payment(account, current_owed=current_owed)
        persist_resolved_minimum(account, resolved, extra_updates=extra, invalidate=False)
        return {
            "account_id": account.id,
            "updated": False,
            "reason": "currency_mismatch",
            "warning": {
                "code": SYNC_CURRENCY_MISMATCH,
                "account_id": account.id,
                "message": extra["provider_minimum_payment_sync_message"],
            },
        }

    reported = money_from_provider(getattr(liability, "minimum_payment_amount", None))
    statement_balance = money_from_provider(getattr(liability, "last_statement_balance", None))
    statement_date = getattr(liability, "last_statement_issue_date", None)
    due_date = getattr(liability, "next_payment_due_date", None)
    previous_provider = as_money(account.provider_minimum_payment_amount)

    extra: dict = {
        "provider_minimum_payment_source": SOURCE_PLAID,
        "provider_minimum_payment_observed_at": observed_at,
        "provider_minimum_payment_sync_status": SYNC_OK,
        "provider_minimum_payment_sync_message": "",
    }
    if statement_date is not None:
        extra["provider_minimum_payment_statement_date"] = statement_date
        account.provider_minimum_payment_statement_date = statement_date
    if due_date is not None:
        extra["provider_minimum_payment_due_date"] = due_date
        account.provider_minimum_payment_due_date = due_date
        if account.minimum_payment_mode == MODE_AUTOMATIC:
            extra["next_payment_due_date"] = due_date
            account.next_payment_due_date = due_date

    if reported is None:
        extra["provider_minimum_payment_sync_status"] = SYNC_MISSING
        extra["provider_minimum_payment_sync_message"] = (
            "Institution omitted a minimum payment; the previous valid value was kept."
        )
    else:
        zero_ok = is_provider_zero_usable(
            provider_minimum=reported,
            statement_balance=statement_balance
            if statement_balance is not None
            else as_money(account.statement_balance),
            current_owed=current_owed if current_owed is not None else as_money(account.current_balance),
        )
        if reported == ZERO and not zero_ok:
            warning = {
                "code": WARNING_ZERO_WITH_BALANCE,
                "account_id": account.id,
                "message": (
                    "Plaid reported no required minimum while this account still has a balance."
                ),
            }
            extra["provider_minimum_payment_sync_message"] = warning["message"]
            if previous_provider is None:
                extra["provider_minimum_payment_amount"] = reported
                account.provider_minimum_payment_amount = reported
        else:
            extra["provider_minimum_payment_amount"] = reported
            account.provider_minimum_payment_amount = reported

    for key, value in extra.items():
        if key not in ("next_payment_due_date",):
            setattr(account, key, value)

    resolved = resolve_effective_minimum_payment(account, current_owed=current_owed, now=observed_at)
    changed = persist_resolved_minimum(account, resolved, extra_updates=extra)
    return {
        "account_id": account.id,
        "updated": True,
        "effective_changed": changed,
        "effective_amount": str(resolved.amount) if resolved.amount is not None else None,
        "warning": warning,
    }


def apply_item_liability_status(
    accounts: list[Account],
    *,
    status: str,
    message: str,
) -> None:
    """Record an Item-level liabilities outcome without changing stored amounts."""
    extra = {
        "provider_minimum_payment_sync_status": status,
        "provider_minimum_payment_sync_message": message[:255],
    }
    for account in accounts:
        if not account.is_credit_card():
            continue
        if account.status != Account.Status.ACTIVE or not account.is_active:
            continue
        resolved = resolve_effective_minimum_payment(account)
        persist_resolved_minimum(account, resolved, extra_updates=extra, invalidate=False)


def serialize_minimum_payment(account: Account, resolved: EffectiveMinimum | None = None) -> dict:
    resolved = resolved or resolve_effective_minimum_payment(account)

    def money_str(value: Decimal | None) -> str | None:
        if value is None:
            return None
        return str(value.quantize(TWOPLACES))

    observed = resolved.observed_at
    observed_iso = None
    if observed is not None:
        if timezone.is_naive(observed):
            observed = timezone.make_aware(observed, timezone.get_current_timezone())
        observed_iso = observed.isoformat()
    stmt = getattr(account, "provider_minimum_payment_statement_date", None)
    due = getattr(account, "provider_minimum_payment_due_date", None)
    return {
        "minimum_payment_amount": money_str(resolved.amount),
        "effective_minimum_payment_amount": money_str(resolved.amount),
        "minimum_payment_mode": account.minimum_payment_mode or MODE_MANUAL,
        "minimum_payment_source": resolved.source,
        "manual_minimum_payment_amount": money_str(resolved.manual_amount),
        "provider_minimum_payment_amount": money_str(resolved.provider_amount),
        "provider_minimum_payment_observed_at": observed_iso,
        "provider_minimum_payment_statement_date": stmt.isoformat() if stmt else None,
        "provider_minimum_payment_due_date": due.isoformat() if due else None,
        "provider_minimum_payment_sync_status": account.provider_minimum_payment_sync_status or "",
        "provider_minimum_payment_sync_message": account.provider_minimum_payment_sync_message or "",
        "minimum_payment_freshness": resolved.freshness,
        "minimum_payment_warning": resolved.warning_message,
        "minimum_payment_warning_code": resolved.warning_code,
    }
