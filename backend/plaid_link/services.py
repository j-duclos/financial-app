"""Plaid link exchange, account provisioning, and transactions sync."""
from __future__ import annotations

import logging
import os
import time
from datetime import date, timedelta
from decimal import Decimal
from typing import Any
from urllib.parse import urlparse, urlunparse

from django.db import transaction as db_transaction
from django.db.models import Max, Q
from django.utils import timezone
from plaid import ApiException
from plaid.model.accounts_get_request import AccountsGetRequest
from plaid.model.country_code import CountryCode
from plaid.model.item_public_token_exchange_request import ItemPublicTokenExchangeRequest
from plaid.model.item_remove_request import ItemRemoveRequest
from plaid.model.link_token_create_request import LinkTokenCreateRequest
from plaid.model.link_token_create_request_user import LinkTokenCreateRequestUser
from plaid.model.products import Products
from plaid.model.transactions_refresh_request import TransactionsRefreshRequest
from plaid.model.transactions_sync_request import TransactionsSyncRequest

from accounts.models import Account
from accounts.services.credit_card import classify_plaid_credit_card_type
from common.services.cache import invalidate_financial_cache_for_household
from core.phone_e164 import normalize_to_e164
from timeline.models import RecurringRule, RecurringRuleSkip
from transactions.models import Transaction, TransactionMatch
from transactions.services.matching import (
    match_imported_transaction,
    normalize_description,
    reconcile_orphan_matched_plaid_imports,
)

from .crypto import (
    PlaidTokenDecryptError,
    decrypt_plaid_access_token,
    decrypt_secret,
    encrypt_secret,
)
from .models import PlaidItem, PlaidLinkedAccount
from .plaid_api_client import _clean_cred, get_plaid_client, plaid_api_env

logger = logging.getLogger(__name__)

PLAID_SYNC_MIN_INTERVAL_SECONDS = int(os.environ.get("PLAID_SYNC_MIN_INTERVAL_SECONDS", "300"))


def plaid_sync_min_interval_seconds() -> int:
    return max(0, PLAID_SYNC_MIN_INTERVAL_SECONDS)


def should_skip_plaid_item_sync(plaid_item: PlaidItem, *, force: bool = False) -> bool:
    """Skip auto-sync when this login was synced recently (manual sync passes force=True)."""
    if force or not plaid_item.last_sync_at:
        return False
    elapsed = (timezone.now() - plaid_item.last_sync_at).total_seconds()
    return elapsed < plaid_sync_min_interval_seconds()


def _item_has_syncable_accounts(plaid_item: PlaidItem) -> bool:
    for la in plaid_item.linked_accounts.select_related("account"):
        if la.account.allows_plaid_sync():
            return True
    return False


def sync_all_plaid_items_for_user(
    user,
    *,
    household_id: int | None = None,
    force: bool = False,
) -> dict[str, Any]:
    """
    Import transactions for every linked Plaid login the user can access.

    Skips logins synced within PLAID_SYNC_MIN_INTERVAL_SECONDS unless force=True.
    """
    from core.utils import get_households_for_user

    households = get_households_for_user(user)
    if household_id is not None:
        households = households.filter(pk=household_id)
    items = list(
        PlaidItem.objects.filter(household__in=households)
        .prefetch_related("linked_accounts__account")
        .order_by("pk")
    )

    item_results: list[dict[str, Any]] = []
    totals: dict[str, int] = {
        "added": 0,
        "modified": 0,
        "removed": 0,
        "merged": 0,
        "skipped_items": 0,
        "synced_items": 0,
        "failed_items": 0,
    }

    for item in items:
        label = (item.institution_name or "Bank").strip() or "Bank"
        if not item.linked_accounts.exists():
            continue
        if not _item_has_syncable_accounts(item):
            item_results.append(
                {
                    "id": item.id,
                    "institution_name": label,
                    "skipped": True,
                    "reason": "sync_disabled",
                }
            )
            totals["skipped_items"] += 1
            continue
        if should_skip_plaid_item_sync(item, force=force):
            item_results.append(
                {
                    "id": item.id,
                    "institution_name": label,
                    "skipped": True,
                    "reason": "recently_synced",
                    "last_sync_at": item.last_sync_at.isoformat() if item.last_sync_at else None,
                }
            )
            totals["skipped_items"] += 1
            continue

        try:
            counts = sync_transactions_for_item(item)
        except (ApiException, PlaidTokenDecryptError, RuntimeError) as exc:
            logger.exception("sync_all failed for plaid_item pk=%s", item.pk)
            item_results.append(
                {
                    "id": item.id,
                    "institution_name": label,
                    "error": str(exc),
                }
            )
            totals["failed_items"] += 1
            continue

        totals["synced_items"] += 1
        for key in ("added", "modified", "removed", "merged"):
            totals[key] += int(counts.get(key) or 0)
        item_results.append(
            {
                "id": item.id,
                "institution_name": label,
                "skipped": False,
                **counts,
            }
        )

    return {"items": item_results, "totals": totals}


def _safe_match_imported_transaction(row: Transaction) -> None:
    """Never let matching logic abort Plaid sync (DB or scoring edge cases)."""
    try:
        match_imported_transaction(row)
    except Exception:
        logger.exception("match_imported_transaction failed for transaction pk=%s", row.pk)


def _rematch_unmatched_imports_for_plaid_item(plaid_item: PlaidItem) -> None:
    """
    Retry matching for Plaid rows still UNMATCHED on this item's accounts.

    Picks up planned/rule rows that appeared after the import synced (match_imported_transaction
    only runs when the Plaid row is added or modified).
    """
    account_pks = list(plaid_item.linked_accounts.values_list("account_id", flat=True))
    if not account_pks:
        return
    qs = Transaction.objects.filter(
        account_id__in=account_pks,
        source=Transaction.Source.PLAID,
        import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
    ).exclude(plaid_transaction_id__isnull=True).exclude(plaid_transaction_id="")
    for imp in qs.iterator(chunk_size=200):
        _safe_match_imported_transaction(imp)


def _apply_plaid_defaults_to_existing(existing: Transaction, defaults: dict[str, Any]) -> None:
    """
    Apply Plaid /transactions/sync fields to a row we already store.

    If this import is already linked to a planned row (TransactionMatch), do not reset
    ``import_match_status`` to UNMATCHED — Plaid sends ``modified`` often and defaults would
    otherwise clear MATCHED metadata on every sync.
    """
    to_apply = dict(defaults)
    if TransactionMatch.objects.filter(imported_transaction_id=existing.pk).exists():
        to_apply.pop("import_match_status", None)
    for key, val in to_apply.items():
        setattr(existing, key, val)


def _link_redirect_uri() -> str | None:
    """
    Server default from PLAID_REDIRECT_URI. Used when the link-token request omits redirect_uri.
    When the browser sends redirect_uri, that value wins (see resolve_plaid_link_redirect_uri).
    """
    raw = _clean_cred(os.environ.get("PLAID_REDIRECT_URI"))
    if not raw:
        return None
    return normalize_browser_plaid_redirect_uri(raw)


def normalize_browser_plaid_redirect_uri(raw: str) -> str:
    """
    redirect_uri sent from the web app (current tunnel or localhost).
    Path must be /plaid/oauth-return (recommended), /accounts, or legacy /transactions; no query string.
    """
    s = (raw or "").strip()
    if not s:
        raise RuntimeError("redirect_uri is empty.")
    if "?" in s or "#" in s:
        raise RuntimeError("redirect_uri must not include ? or #.")
    if len(s) > 512:
        raise RuntimeError("redirect_uri is too long.")
    p = urlparse(s)
    if p.scheme not in ("http", "https"):
        raise RuntimeError("redirect_uri must use http:// or https://.")
    if not p.netloc:
        raise RuntimeError("redirect_uri is missing a host.")
    host = (p.hostname or "").lower()
    path = (p.path or "").rstrip("/") or "/"
    if path not in ("/accounts", "/transactions", "/plaid/oauth-return"):
        raise RuntimeError(
            "redirect_uri path must be /plaid/oauth-return (recommended), /accounts, or legacy /transactions. "
            "Example: https://your-frontend.example/plaid/oauth-return"
        )
    env = plaid_api_env()
    if p.scheme == "http":
        if env != "sandbox" or host not in ("localhost", "127.0.0.1"):
            raise RuntimeError(
                "redirect_uri may use http:// only for localhost or 127.0.0.1 when PLAID_ENV=sandbox."
            )
    return urlunparse((p.scheme.lower(), p.netloc, path, "", "", ""))


def resolve_plaid_link_redirect_uri(client_supplied: str | None) -> str | None:
    """Prefer browser-supplied redirect (tunnel / prod origin); else PLAID_REDIRECT_URI env."""
    s = (client_supplied or "").strip()
    if s:
        return normalize_browser_plaid_redirect_uri(s)
    return _link_redirect_uri()

# Posted date vs manual entry date often differ by a few days (authorization vs settlement).
MANUAL_MERGE_DATE_WINDOW_DAYS = 5


def _phone_from_env() -> str | None:
    """Optional PLAID_LINK_USER_PHONE in .env for server-wide testing defaults."""
    raw = _clean_cred(os.environ.get("PLAID_LINK_USER_PHONE"))
    return normalize_to_e164(raw) if raw else None


def _map_account_type(plaid_type: str | None, subtype: str | None) -> str:
    t = (plaid_type or "").lower()
    st = (subtype or "").lower()
    if t == "credit":
        return Account.AccountType.CREDIT
    if t == "depository":
        if st == "savings":
            return Account.AccountType.SAVINGS
        return Account.AccountType.CHECKING
    if t == "investment" or t == "brokerage":
        return Account.AccountType.INVESTMENT
    if t == "loan":
        return Account.AccountType.OTHER
    return Account.AccountType.OTHER


def create_link_token(
    *,
    client_user_id: str,
    phone_number: str | None = None,
    email_address: str | None = None,
    link_redirect_uri: str | None = None,
) -> str:
    """
    Prefills Link ``user`` with phone/email when provided — improves SMS MFA eligibility vs typing in iframe.
    Order: explicit ``phone_number`` → PLAID_LINK_USER_PHONE env fallback.

    ``link_redirect_uri``: from the web client (``VITE_PLAID_REDIRECT_URI`` or origin + ``/plaid/oauth-return``)
    work without editing server env. Must still be allowlisted in the Plaid Dashboard.
    """
    client = get_plaid_client()
    phone = (phone_number or "").strip() or None
    if not phone:
        phone = _phone_from_env()
    email = (email_address or "").strip() or None

    user_kw: dict[str, Any] = {"client_user_id": client_user_id}
    if phone:
        user_kw["phone_number"] = phone
    if email:
        user_kw["email_address"] = email
    redirect_uri = resolve_plaid_link_redirect_uri(link_redirect_uri)
    req_kw: dict[str, Any] = dict(
        products=[Products("transactions")],
        client_name="Budget App",
        language="en",
        country_codes=[CountryCode("US")],
        user=LinkTokenCreateRequestUser(**user_kw),
    )
    if redirect_uri:
        req_kw["redirect_uri"] = redirect_uri
    req = LinkTokenCreateRequest(**req_kw)
    resp = client.link_token_create(req)
    return resp.link_token


def _normalize_plaid_mask(mask: str | None) -> str:
    if not mask:
        return ""
    digits = "".join(c for c in str(mask) if c.isdigit())
    return digits[-4:] if len(digits) >= 4 else digits


def find_manual_account_for_plaid(
    household_id: int,
    *,
    account_type: str,
    plaid_mask: str,
    institution_name: str,
) -> Account | None:
    """
    Prefer linking Plaid to an existing manual Account when **last_four + account_type** match.
    Names are intentionally ignored — users label accounts freely.
    If multiple rows share the same last four, institution string is used to narrow (still fuzzy).
    """
    norm = _normalize_plaid_mask(plaid_mask)
    if len(norm) != 4:
        return None

    # Include accounts already linked to Plaid — re-link must reuse the same row, not create duplicates.
    qs = Account.objects.plaid_linkable().filter(
        household_id=household_id,
        account_type=account_type,
        last_four=norm,
    ).order_by("id")
    count = qs.count()
    if count == 0:
        return None
    if count == 1:
        return qs.first()

    needle = (institution_name or "").strip().lower()
    if needle:
        for acct in qs:
            hay = (acct.institution or "").strip().lower()
            if hay and (hay == needle or needle in hay or hay in needle):
                return acct
    return qs.first()


def _detach_stale_plaid_link(acct: Account, *, for_item: PlaidItem) -> None:
    """Remove an account's Plaid mapping when re-attaching to a new Item."""
    try:
        la = acct.plaid_link
    except PlaidLinkedAccount.DoesNotExist:
        return
    if la.item_id == for_item.pk:
        return
    old_item = la.item
    la.delete()
    if not old_item.linked_accounts.exists():
        remove_plaid_item_from_plaid(old_item)
        old_item.delete()


def exchange_public_token(
    *,
    public_token: str,
    household_id: int,
) -> PlaidItem:
    """
    Exchange a Link public_token for an access token, persist the Item, and attach Plaid accounts.

    For each Plaid account: reuse an existing household Account when **account type + last four digits**
    match (see Account.last_four). Otherwise create a new Account. Names are never used for matching.
    """
    client = get_plaid_client()
    ex = client.item_public_token_exchange(ItemPublicTokenExchangeRequest(public_token=public_token))
    access_token = ex.access_token
    item_id = ex.item_id

    ag = client.accounts_get(AccountsGetRequest(access_token=access_token))
    agd = ag.to_dict()
    item_info = (agd.get("item") or {}) if isinstance(agd.get("item"), dict) else {}
    institution_id = item_info.get("institution_id") or ""
    institution_name = item_info.get("institution_name") or ""

    accounts = agd.get("accounts") or []

    with db_transaction.atomic():
        plaid_item = PlaidItem.objects.create(
            household_id=household_id,
            item_id=item_id,
            access_token_cipher=encrypt_secret(access_token),
            institution_id=institution_id or "",
            institution_name=institution_name or "",
        )
        max_pos = (
            Account.objects.filter(household_id=household_id).aggregate(m=Max("position")).get("m") or 0
        )
        pos = int(max_pos)
        prefix = institution_name or "Bank"
        for acc in accounts:
            aid = acc.get("account_id")
            name = (acc.get("name") or "Account").strip()
            official = (acc.get("official_name") or "").strip()
            core = official or name
            inst = (institution_name or "").strip() or prefix
            if inst and core.lower().startswith(inst.lower()):
                label = core[:255]
            elif inst:
                label = f"{inst} · {core}"[:255]
            else:
                label = core[:255]
            acct_type = _map_account_type(acc.get("type"), acc.get("subtype"))
            mask = str(acc.get("mask") or "").strip()[:16]

            matched = find_manual_account_for_plaid(
                household_id,
                account_type=acct_type,
                plaid_mask=mask,
                institution_name=institution_name or "",
            )
            if matched:
                acct = matched
                _detach_stale_plaid_link(acct, for_item=plaid_item)
                if not (acct.institution or "").strip() and institution_name:
                    acct.institution = institution_name[:255]
                    acct.save(update_fields=["institution", "updated_at"])
                lf = _normalize_plaid_mask(mask)
                if lf and len(lf) == 4 and not (acct.last_four or "").strip():
                    acct.last_four = lf
                    acct.save(update_fields=["last_four", "updated_at"])
            else:
                pos += 1
                lf_new = _normalize_plaid_mask(mask)
                acct = Account.objects.create(
                    household_id=household_id,
                    account_type=acct_type,
                    name=label[:255],
                    institution=institution_name[:255] if institution_name else prefix[:255],
                    position=pos,
                    last_four=lf_new if len(lf_new) == 4 else "",
                )
            PlaidLinkedAccount.objects.create(
                item=plaid_item,
                plaid_account_id=str(aid),
                mask=mask,
                account=acct,
            )

    return plaid_item


def _plaid_txn_to_defaults(txn: dict[str, Any], account_pk: int) -> dict[str, Any] | None:
    if txn.get("pending"):
        return None
    plaid_id = txn.get("transaction_id")
    if not plaid_id:
        return None
    raw_amt = txn.get("amount")
    if raw_amt is None:
        return None
    our_amount = -Decimal(str(raw_amt))
    if our_amount == 0:
        return None
    payee = (txn.get("merchant_name") or txn.get("name") or "").strip() or "Unknown"
    memo = ""
    if isinstance(txn.get("original_description"), str):
        memo = txn["original_description"].strip()
    if not memo and isinstance(txn.get("name"), str) and txn.get("name") != payee:
        memo = txn["name"].strip()
    date_s = txn.get("date") or txn.get("authorized_date")
    if not date_s:
        return None
    if isinstance(date_s, date):
        d = date_s
    else:
        parts = str(date_s).split("-")
        if len(parts) != 3:
            return None
        d = date(int(parts[0]), int(parts[1]), int(parts[2]))
    raw_name = (txn.get("name") or "").strip()
    np = normalize_description(f"{payee} {raw_name}")
    defaults = {
        "plaid_transaction_id": str(plaid_id),
        "account_id": account_pk,
        "date": d,
        "posted_date": d,
        "payee": payee[:255],
        "memo": (memo or "")[:2000],
        "imported_description": (raw_name or memo or "")[:2000],
        "normalized_payee": np[:512],
        "amount": our_amount,
        "source": Transaction.Source.PLAID,
        "cleared": True,
        "status": Transaction.Status.CLEARED,
        "import_match_status": Transaction.ImportMatchStatus.UNMATCHED,
        "transaction_type": Transaction.TransactionType.OTHER,
    }
    acct = Account.objects.filter(pk=account_pk).first()
    if acct and acct.is_credit_card():
        defaults["transaction_type"] = classify_plaid_credit_card_type(
            our_amount, payee, memo
        )
    return defaults


def reconcile_linked_account_ids_with_plaid(plaid_item: PlaidItem, client, access_token: str) -> None:
    """
    Align stored plaid_account_id / mask with Plaid's current accounts/get response.

    Some institutions rotate account_id strings; transactions/sync then fails with errors like
    "no valid accounts were found for this item" until IDs match again.
    """
    try:
        ag = client.accounts_get(AccountsGetRequest(access_token=access_token)).to_dict()
    except ApiException:
        return
    remote_accounts = [a for a in (ag.get("accounts") or []) if isinstance(a, dict)]
    remote_ids = {str(a.get("account_id")) for a in remote_accounts if a.get("account_id")}

    for la in plaid_item.linked_accounts.select_related("account"):
        cur = str(la.plaid_account_id)
        if cur in remote_ids:
            for rad in remote_accounts:
                if str(rad.get("account_id")) == cur:
                    rm = str(rad.get("mask") or "").strip()[:16]
                    if rm and rm != (la.mask or ""):
                        la.mask = rm
                        la.save(update_fields=["mask"])
                    break
            continue

        mask = (la.mask or "").strip()
        want_type = la.account.account_type
        for rad in remote_accounts:
            rm = str(rad.get("mask") or "").strip()
            if mask and rm != mask:
                continue
            if _map_account_type(rad.get("type"), rad.get("subtype")) != want_type:
                continue
            new_id = str(rad.get("account_id") or "")
            if not new_id:
                continue
            la.plaid_account_id = new_id
            if rm:
                la.mask = rm[:16]
            la.save(update_fields=["plaid_account_id", "mask"])
            remote_ids.add(new_id)
            break


def sync_transactions_for_item(plaid_item: PlaidItem) -> dict[str, int]:
    """
    Ask Plaid to refresh transaction data when supported, then run /transactions/sync
    until caught up. If nothing changes on the first pass (common right after linking),
    waits briefly and syncs again — refresh is sometimes asynchronous.
    """
    skipped_accounts = 0
    client = get_plaid_client()
    access_token = decrypt_plaid_access_token(plaid_item.access_token_cipher)

    reconcile_linked_account_ids_with_plaid(plaid_item, client, access_token)

    try:
        client.transactions_refresh(TransactionsRefreshRequest(access_token=access_token))
    except ApiException:
        pass

    def run_sync_pages() -> dict[str, int]:
        nonlocal skipped_accounts
        plaid_item.refresh_from_db(fields=["transactions_cursor"])
        cursor = plaid_item.transactions_cursor or None
        added = modified = removed = 0
        id_to_account_pk = {}
        for la in plaid_item.linked_accounts.select_related("account"):
            acct = la.account
            if acct.allows_plaid_sync():
                id_to_account_pk[str(la.plaid_account_id)] = la.account_id
            else:
                skipped_accounts += 1

        while True:
            kwargs: dict[str, Any] = {"access_token": access_token, "count": 500}
            if cursor:
                kwargs["cursor"] = cursor
            resp = client.transactions_sync(TransactionsSyncRequest(**kwargs))
            data = resp.to_dict()
            next_cursor = data.get("next_cursor") or ""
            has_more = bool(data.get("has_more"))

            for txn in data.get("removed") or []:
                tid = txn.get("transaction_id") if isinstance(txn, dict) else None
                if not tid:
                    continue
                n, _ = Transaction.objects.filter(plaid_transaction_id=str(tid)).delete()
                removed += n

            for txn in list(data.get("added") or []) + list(data.get("modified") or []):
                if not isinstance(txn, dict):
                    continue
                plaid_account_id = txn.get("account_id")
                aid_key = str(plaid_account_id)
                account_pk = id_to_account_pk.get(aid_key) if plaid_account_id else None
                if account_pk is None:
                    continue
                defaults = _plaid_txn_to_defaults(txn, account_pk)
                if not defaults:
                    continue
                pid = defaults.pop("plaid_transaction_id")
                existing = Transaction.objects.filter(plaid_transaction_id=pid).first()
                if existing:
                    _apply_plaid_defaults_to_existing(existing, defaults)
                    existing.save()
                    modified += 1
                    _safe_match_imported_transaction(existing)
                    continue

                created = Transaction.objects.create(plaid_transaction_id=pid, **defaults)
                added += 1
                _safe_match_imported_transaction(created)

            cursor = next_cursor
            plaid_item.transactions_cursor = cursor or ""
            plaid_item.save(update_fields=["transactions_cursor", "updated_at"])

            if not has_more:
                break

        return {"added": added, "modified": modified, "removed": removed, "merged": 0}

    try:
        totals = run_sync_pages()
    except ApiException:
        reconcile_linked_account_ids_with_plaid(plaid_item, client, access_token)
        totals = run_sync_pages()

    if totals["added"] == totals["modified"] == totals["removed"] == 0:
        time.sleep(2)
        reconcile_linked_account_ids_with_plaid(plaid_item, client, access_token)
        extra = run_sync_pages()
        totals["added"] += extra["added"]
        totals["modified"] += extra["modified"]
        totals["removed"] += extra["removed"]

    try:
        _rematch_unmatched_imports_for_plaid_item(plaid_item)
    except Exception:
        logger.exception("_rematch_unmatched_imports_for_plaid_item failed for plaid_item pk=%s", plaid_item.pk)

    try:
        account_pks = list(plaid_item.linked_accounts.values_list("account_id", flat=True))
        for aid in account_pks:
            reconcile_orphan_matched_plaid_imports(account_id=aid)
    except Exception:
        logger.exception("reconcile_orphan_matched_plaid_imports failed for plaid_item pk=%s", plaid_item.pk)

    totals["skipped_sync_disabled_accounts"] = skipped_accounts
    plaid_item.last_sync_at = timezone.now()
    plaid_item.save(update_fields=["last_sync_at", "updated_at"])
    invalidate_financial_cache_for_household(plaid_item.household_id)
    return totals


def disconnect_plaid_linked_account(linked_account: PlaidLinkedAccount) -> Account:
    """Remove Plaid mapping for one app account; keep the account and its transactions."""
    account = linked_account.account
    account.plaid_sync_enabled = False
    account.save(update_fields=["plaid_sync_enabled", "updated_at"])
    linked_account.delete()
    return account


def remove_plaid_item_from_plaid(plaid_item: PlaidItem) -> None:
    """Revoke the Item at Plaid (best effort)."""
    try:
        client = get_plaid_client()
        token = decrypt_plaid_access_token(plaid_item.access_token_cipher)
        client.item_remove(ItemRemoveRequest(access_token=token))
    except (ApiException, PlaidTokenDecryptError):
        pass
