"""Plaid Liabilities sync for credit-card minimum payments.

One /liabilities/get call per Item. Accounts are matched only by immutable
Plaid account_id → PlaidLinkedAccount.plaid_account_id.
"""
from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from typing import Any

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from plaid import ApiException
from plaid.model.liabilities_get_request import LiabilitiesGetRequest

from accounts.models import Account
from accounts.services.minimum_payment import (
    SYNC_FAILED,
    SYNC_MISSING,
    SYNC_OK,
    SYNC_PRODUCT_NOT_ENABLED,
    SYNC_REAUTH,
    SYNC_UNSUPPORTED,
    apply_item_liability_status,
    apply_plaid_credit_liability,
)
from .crypto import PlaidTokenDecryptError, decrypt_plaid_access_token
from .models import PlaidItem, PlaidLinkedAccount
from .plaid_api_client import get_plaid_client

logger = logging.getLogger(__name__)

STATUS_SUCCESS = "success"
STATUS_UNSUPPORTED = "unsupported"
STATUS_REAUTH = "reauthorization_required"
STATUS_PRODUCT_NOT_ENABLED = "product_not_enabled"
STATUS_FAILED = "failed"
STATUS_DISABLED = "disabled"
STATUS_NO_CREDIT = "no_eligible_accounts"

WARNING_UNMAPPED_LIABILITY = "unmapped_liability"
WARNING_CURRENCY_MISMATCH = "currency_mismatch"
WARNING_MISSING_LIABILITY = "missing_liability"

_UNSUPPORTED_CODES = frozenset(
    {
        "PRODUCTS_NOT_SUPPORTED",
        "PRODUCT_NOT_SUPPORTED",
        "INSTITUTION_NOT_SUPPORTED",
        "NO_LIABILITY_ACCOUNTS",
    }
)
_REAUTH_CODES = frozenset(
    {
        "ADDITIONAL_CONSENT_REQUIRED",
        "ITEM_LOGIN_REQUIRED",
        "ITEM_LOCKED",
        "PENDING_EXPIRATION",
        "USER_PERMISSION_REVOKED",
        "ITEM_NOT_SUPPORTED",
    }
)
_PRODUCT_CODES = frozenset(
    {
        "INVALID_PRODUCT",
        "PRODUCT_NOT_READY",
        "PRODUCT_NOT_ENABLED",
        "PRODUCTS_NOT_SUPPORTED",
    }
)
_DISCONNECTED_CODES = frozenset(
    {
        "INVALID_ACCESS_TOKEN",
        "ITEM_NOT_FOUND",
        "INVALID_ACCOUNT_ID",
    }
)


def liabilities_enabled() -> bool:
    return bool(getattr(settings, "PLAID_ENABLE_LIABILITIES", False))


def classify_liabilities_error(exc: ApiException) -> tuple[str, str]:
    """Map a Plaid ApiException to a structured liabilities status (never a generic 500)."""
    raw_body = exc.body
    if isinstance(raw_body, (bytes, bytearray)):
        raw_body = raw_body.decode("utf-8", errors="replace")
    parsed: dict = {}
    if isinstance(raw_body, str) and raw_body.strip():
        try:
            parsed = json.loads(raw_body)
        except json.JSONDecodeError:
            parsed = {}
    code = str((parsed or {}).get("error_code") or "").upper()
    msg = str((parsed or {}).get("error_message") or raw_body or exc)
    if code in _UNSUPPORTED_CODES or "not supported" in msg.lower():
        return STATUS_UNSUPPORTED, "This institution does not provide credit-card liabilities."
    if code in _REAUTH_CODES or code == "ADDITIONAL_CONSENT_REQUIRED":
        return STATUS_REAUTH, "Reconnect this bank login to enable credit-card minimum payments."
    if code in _PRODUCT_CODES:
        return STATUS_PRODUCT_NOT_ENABLED, "Plaid Liabilities is not enabled for this environment."
    if code in _DISCONNECTED_CODES:
        return STATUS_FAILED, "This bank connection is no longer valid."
    if code == "RATE_LIMIT_EXCEEDED":
        return STATUS_FAILED, "Plaid rate limit reached while refreshing liabilities."
    if "timeout" in msg.lower():
        return STATUS_FAILED, "Plaid liabilities request timed out."
    return STATUS_FAILED, "Could not refresh credit-card minimums from the institution."


@dataclass
class LiabilitySyncResult:
    item_id: int
    status: str
    observed_at: datetime
    accounts_seen: int = 0
    accounts_updated: int = 0
    accounts_unchanged: int = 0
    accounts_missing_liability: int = 0
    warnings: list[dict[str, Any]] = field(default_factory=list)
    elapsed_ms: int = 0
    message: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "item_id": self.item_id,
            "status": self.status,
            "observed_at": self.observed_at.isoformat(),
            "accounts_seen": self.accounts_seen,
            "accounts_updated": self.accounts_updated,
            "accounts_unchanged": self.accounts_unchanged,
            "accounts_missing_liability": self.accounts_missing_liability,
            "warnings": self.warnings,
            "elapsed_ms": self.elapsed_ms,
            "message": self.message,
        }


def _eligible_credit_links(plaid_item: PlaidItem) -> list[PlaidLinkedAccount]:
    links = list(
        plaid_item.linked_accounts.select_related("account").filter(
            account__account_type=Account.AccountType.CREDIT,
        )
    )
    eligible = []
    for link in links:
        account = link.account
        if account.household_id != plaid_item.household_id:
            continue
        if account.status != Account.Status.ACTIVE or not account.is_active:
            continue
        if not account.is_credit_card():
            continue
        eligible.append(link)
    return eligible


def _currency_ok(account: Account, iso_code: str | None) -> bool:
    if not iso_code:
        return True
    expected = (account.currency or "").strip().upper()
    if not expected:
        return True
    return expected == str(iso_code).strip().upper()


def _credit_liabilities(response) -> list[Any]:
    liabilities = getattr(response, "liabilities", None)
    if liabilities is None:
        return []
    credit = getattr(liabilities, "credit", None) or []
    return list(credit)


def _provider_currency_by_account_id(response) -> dict[str, str | None]:
    out: dict[str, str | None] = {}
    for remote in getattr(response, "accounts", None) or []:
        remote_id = getattr(remote, "account_id", None)
        if not remote_id:
            continue
        balances = getattr(remote, "balances", None)
        iso = getattr(balances, "iso_currency_code", None) if balances is not None else None
        out[str(remote_id)] = iso
    return out


def sync_credit_card_liabilities_for_item(
    plaid_item: PlaidItem,
    *,
    client=None,
) -> dict[str, Any]:
    """Fetch credit liabilities once for this Item and apply the canonical minimum policy."""
    started = time.monotonic()
    observed_at = timezone.now()
    result = LiabilitySyncResult(
        item_id=plaid_item.pk,
        status=STATUS_SUCCESS,
        observed_at=observed_at,
    )

    if not liabilities_enabled():
        result.status = STATUS_DISABLED
        result.message = "Plaid Liabilities is not enabled in this environment."
        result.elapsed_ms = int((time.monotonic() - started) * 1000)
        return result.to_dict()

    links = _eligible_credit_links(plaid_item)
    if not links:
        result.status = STATUS_NO_CREDIT
        result.message = "No eligible credit-card accounts on this connection."
        result.elapsed_ms = int((time.monotonic() - started) * 1000)
        PlaidItem.objects.filter(pk=plaid_item.pk).update(
            liabilities_last_sync_at=observed_at,
            liabilities_sync_status=STATUS_NO_CREDIT,
        )
        return result.to_dict()

    by_plaid_id = {str(link.plaid_account_id): link for link in links}
    result.accounts_seen = len(links)

    try:
        access_token = decrypt_plaid_access_token(plaid_item.access_token_cipher)
        api = client or get_plaid_client()
        response = api.liabilities_get(LiabilitiesGetRequest(access_token=access_token))
    except PlaidTokenDecryptError:
        result.status = STATUS_FAILED
        result.message = "Could not read the stored bank connection."
        _record_item_status(plaid_item, result, links, started)
        return result.to_dict()
    except ApiException as exc:
        status, message = classify_liabilities_error(exc)
        result.status = status
        result.message = message
        mapped = {
            STATUS_UNSUPPORTED: SYNC_UNSUPPORTED,
            STATUS_REAUTH: SYNC_REAUTH,
            STATUS_PRODUCT_NOT_ENABLED: SYNC_PRODUCT_NOT_ENABLED,
        }.get(status, SYNC_FAILED)
        apply_item_liability_status(
            [link.account for link in links],
            status=mapped,
            message=message,
        )
        _record_item_status(plaid_item, result, links, started)
        return result.to_dict()

    credit_rows = _credit_liabilities(response)
    currency_by_id = _provider_currency_by_account_id(response)
    seen_plaid_ids: set[str] = set()

    with transaction.atomic():
        for liability in credit_rows:
            plaid_account_id = getattr(liability, "account_id", None)
            if not plaid_account_id:
                result.warnings.append(
                    {
                        "code": WARNING_UNMAPPED_LIABILITY,
                        "account_id": None,
                        "message": "A credit liability was returned without a Plaid account id.",
                    }
                )
                continue
            key = str(plaid_account_id)
            seen_plaid_ids.add(key)
            link = by_plaid_id.get(key)
            if link is None:
                result.warnings.append(
                    {
                        "code": WARNING_UNMAPPED_LIABILITY,
                        "account_id": None,
                        "message": "A returned liability did not match a local Plaid account id.",
                    }
                )
                continue
            account = link.account
            iso = currency_by_id.get(key)
            applied = apply_plaid_credit_liability(
                account,
                liability,
                observed_at=observed_at,
                current_owed=account.current_balance,
                currency_ok=_currency_ok(account, iso),
            )
            if applied.get("warning"):
                result.warnings.append(applied["warning"])
            if applied.get("updated"):
                if applied.get("effective_changed"):
                    result.accounts_updated += 1
                else:
                    result.accounts_unchanged += 1
            else:
                result.accounts_unchanged += 1
                if applied.get("warning"):
                    pass

        for link in links:
            if str(link.plaid_account_id) in seen_plaid_ids:
                continue
            result.accounts_missing_liability += 1
            account = link.account
            apply_item_liability_status(
                [account],
                status=SYNC_MISSING,
                message="Institution did not return a liability record for this card.",
            )
            result.warnings.append(
                {
                    "code": WARNING_MISSING_LIABILITY,
                    "account_id": account.id,
                    "message": "No Plaid liability record was returned for this credit account.",
                }
            )
            result.accounts_unchanged += 1

    _record_item_status(plaid_item, result, links, started)
    return result.to_dict()


def _record_item_status(
    plaid_item: PlaidItem,
    result: LiabilitySyncResult,
    links: list[PlaidLinkedAccount],
    started: float,
) -> None:
    result.elapsed_ms = int((time.monotonic() - started) * 1000)
    item_status = {
        STATUS_SUCCESS: SYNC_OK,
        STATUS_UNSUPPORTED: SYNC_UNSUPPORTED,
        STATUS_REAUTH: SYNC_REAUTH,
        STATUS_PRODUCT_NOT_ENABLED: SYNC_PRODUCT_NOT_ENABLED,
        STATUS_NO_CREDIT: STATUS_NO_CREDIT,
    }.get(result.status, SYNC_FAILED)
    PlaidItem.objects.filter(pk=plaid_item.pk).update(
        liabilities_last_sync_at=result.observed_at,
        liabilities_sync_status=item_status,
    )
    warning_codes = sorted({str(w.get("code") or "") for w in result.warnings if w.get("code")})
    logger.info(
        "[PERF] plaid liabilities item_pk=%s status=%s seen=%s updated=%s unchanged=%s missing=%s warnings=%s elapsed_ms=%s",
        plaid_item.pk,
        result.status,
        result.accounts_seen,
        result.accounts_updated,
        result.accounts_unchanged,
        result.accounts_missing_liability,
        ",".join(warning_codes) or "none",
        result.elapsed_ms,
    )


def maybe_sync_credit_card_liabilities_for_item(
    plaid_item: PlaidItem,
    *,
    force: bool = False,
) -> dict[str, Any] | None:
    """Best-effort liabilities refresh that never raises into transaction sync."""
    if not liabilities_enabled():
        return None
    if not force and plaid_item.liabilities_last_sync_at:
        min_interval = max(0, int(os.environ.get("PLAID_SYNC_MIN_INTERVAL_SECONDS", "300")))
        elapsed = (timezone.now() - plaid_item.liabilities_last_sync_at).total_seconds()
        if elapsed < min_interval:
            return None
    try:
        return sync_credit_card_liabilities_for_item(plaid_item)
    except Exception:
        logger.exception(
            "liabilities sync failed for plaid_item pk=%s; transaction sync is unaffected",
            plaid_item.pk,
        )
        return {
            "item_id": plaid_item.pk,
            "status": STATUS_FAILED,
            "message": "Liabilities refresh failed; transaction import is unchanged.",
        }


def sync_credit_card_liabilities_for_household(household_id: int) -> dict[str, Any]:
    items = list(
        PlaidItem.objects.filter(household_id=household_id)
        .prefetch_related("linked_accounts__account")
        .order_by("pk")
    )
    results = [sync_credit_card_liabilities_for_item(item) for item in items]
    return {
        "household_id": household_id,
        "items": results,
        "item_count": len(results),
    }
