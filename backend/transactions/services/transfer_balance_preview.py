"""Canonical transfer balance preview — no persistence."""
from __future__ import annotations

import logging
import time
from datetime import date, timedelta
from decimal import Decimal
from typing import Any, Collection, Optional

from django.utils import timezone

from accounts.models import Account
from accounts.services.balances import credit_owed_from_signed_balance
from core.utils import get_households_for_user
from timeline.services.balance_cache import (
    TimelineBalanceCache,
    get_active_balance_cache,
    timeline_balance_cache_scope,
)
from timeline.services.ledger import (
    _credit_card_balance_through_date,
    _liability_balance_through_date,
    build_timeline,
)
from timeline.services.transfer_simulation import transfer_ephemeral_events

logger = logging.getLogger(__name__)


def _decimal(val: Any) -> Decimal:
    if val is None:
        return Decimal("0")
    if isinstance(val, Decimal):
        return val
    return Decimal(str(val))


def _fmt(val: Decimal | None) -> str | None:
    if val is None:
        return None
    return str(val.quantize(Decimal("0.01")))


def _signed_balance_through_date(
    account: Account,
    as_of_date: date,
    rows: list[dict],
    *,
    exclude_transaction_ids: Collection[int] | None = None,
) -> Decimal:
    """Signed ledger balance through end of as_of_date including projected same-day legs."""
    cache = get_active_balance_cache()
    if account.account_type == Account.AccountType.CREDIT:
        return _credit_card_balance_through_date(
            account.pk,
            as_of_date,
            rows,
            include_row_leg_without_txn=True,
            include_db_postings_on_as_of_date=True,
            exclude_transaction_ids=exclude_transaction_ids,
        )
    if account.account_type == Account.AccountType.OTHER:
        return _liability_balance_through_date(
            account.pk,
            as_of_date,
            rows,
            include_row_leg_without_txn=True,
            include_db_postings_on_as_of_date=True,
            exclude_transaction_ids=exclude_transaction_ids,
        )
    if cache is not None:
        return cache.balance_through_date(
            account.pk,
            as_of_date,
            rows,
            include_row_leg_without_txn=True,
            include_db_postings_on_as_of_date=True,
            exclude_transaction_ids=exclude_transaction_ids,
            credit_style=False,
        )
    # Fallback without cache (tests / edge cases)
    sb = Decimal(str(account.starting_balance)) if account.starting_balance is not None else Decimal("0")
    ex = set(exclude_transaction_ids or ())
    from transactions.models import Transaction
    from transactions.services.matching import ledger_visible_transactions

    txns = ledger_visible_transactions(
        Transaction.objects.filter(account_id=account.pk, date__lte=as_of_date)
    )
    if ex:
        txns = txns.exclude(pk__in=ex)
    balance = sb + sum((Decimal(str(a)) for a in txns.values_list("amount", flat=True)), start=Decimal("0"))
    for r in rows:
        if r.get("account_id") != account.pk:
            continue
        rd = r.get("date")
        if rd is None:
            continue
        if isinstance(rd, str):
            rd = date.fromisoformat(rd[:10])
        if rd is None or rd > as_of_date or r.get("transaction_id") is not None:
            continue
        balance += Decimal(str(r.get("amount") or 0))
    return balance


def _projection_window(transfer_date: date) -> tuple[date, date, date]:
    today = timezone.localdate()
    as_of = max(transfer_date, today)
    start = as_of - timedelta(days=90)
    end = as_of + timedelta(days=1)
    return start, end, as_of


def _preload_accounts(cache: TimelineBalanceCache, accounts: list[Account], end: date, start: date) -> None:
    cache.preload_accounts(accounts)
    cache.preload_transactions([a.pk for a in accounts], end, min_as_of=start)


def preview_transfer_balances(
    user,
    *,
    from_account_id: int,
    to_account_id: int | None,
    amount: Decimal,
    transfer_date: date,
    exclude_transaction_ids: list[int] | None = None,
) -> dict[str, Any]:
    """
    Preview signed balances before/after a hypothetical transfer on transfer_date.

    Uses canonical timeline + balance_through_date semantics. Does not persist.
    For edits, pass exclude_transaction_ids for both linked legs so the existing
    transfer is replaced rather than double-counted.
    """
    amt = abs(_decimal(amount)).quantize(Decimal("0.01"))
    if amt < 0:
        raise ValueError("Amount must be zero or greater")

    households = get_households_for_user(user)
    from_acc = Account.objects.filter(pk=from_account_id, household__in=households).first()
    if not from_acc:
        raise ValueError("Source account not found")

    to_acc: Account | None = None
    if to_account_id is not None:
        to_acc = Account.objects.filter(pk=to_account_id, household__in=households).first()
        if not to_acc:
            raise ValueError("Destination account not found")
        if from_acc.household_id != to_acc.household_id:
            raise ValueError("Accounts must belong to the same household")
        if from_account_id == to_account_id:
            raise ValueError("From and to accounts must differ")

    start, end, as_of = _projection_window(transfer_date)
    exclude = list(exclude_transaction_ids or [])
    household_id = from_acc.household_id

    accounts = [from_acc] + ([to_acc] if to_acc is not None else [])

    t0 = time.perf_counter()

    with timeline_balance_cache_scope() as cache:
        _preload_accounts(cache, accounts, end, start)

        t_before = time.perf_counter()
        rows_before = build_timeline(
            user,
            start,
            end,
            household_id=household_id,
            as_of_date=as_of,
            projection_only=True,
            caller="transfer_balance_preview_before",
        )
        t_after_before = time.perf_counter()

        source_before = _signed_balance_through_date(
            from_acc, transfer_date, rows_before, exclude_transaction_ids=exclude
        )

        dest_before: Decimal | None = None
        if to_acc is not None:
            dest_before = _signed_balance_through_date(
                to_acc, transfer_date, rows_before, exclude_transaction_ids=exclude
            )
        t_after_extract_before = time.perf_counter()

        if amt == 0:
            # Before-only preview so destination owed can show before an amount is typed.
            t_before_after = t_after_extract_before
            t_after_after = t_after_extract_before
            source_after = source_before
            dest_after: Decimal | None = dest_before
        else:
            ephemeral = (
                transfer_ephemeral_events(
                    from_account=from_acc,
                    to_account=to_acc,
                    amount=amt,
                    transfer_date=transfer_date,
                )
                if to_acc is not None
                else []
            )

            t_before_after = time.perf_counter()
            rows_after = build_timeline(
                user,
                start,
                end,
                household_id=household_id,
                as_of_date=as_of,
                ephemeral_events=ephemeral or None,
                projection_only=True,
                caller="transfer_balance_preview_after",
            )
            t_after_after = time.perf_counter()

            source_after = _signed_balance_through_date(
                from_acc, transfer_date, rows_after, exclude_transaction_ids=exclude
            )

            dest_after = None
            if to_acc is not None:
                dest_after = _signed_balance_through_date(
                    to_acc, transfer_date, rows_after, exclude_transaction_ids=exclude
                )
        t_after_extract = time.perf_counter()

    if logger.isEnabledFor(logging.DEBUG):
        logger.debug(
            "transfer_balance_preview timing ms: total=%.1f before_timeline=%.1f "
            "balance_extract_before=%.1f after_timeline=%.1f balance_extract_after=%.1f",
            (t_after_extract - t0) * 1000,
            (t_after_before - t_before) * 1000,
            (t_after_extract_before - t_after_before) * 1000,
            (t_after_after - t_before_after) * 1000,
            (t_after_extract - t_after_after) * 1000,
        )

    result: dict[str, Any] = {
        "from_account_id": from_account_id,
        "to_account_id": to_account_id,
        "amount": str(amt),
        "transfer_date": transfer_date.isoformat(),
        "source_balance_before": _fmt(source_before),
        "source_balance_after": _fmt(source_after),
    }

    if to_acc is not None and dest_before is not None and dest_after is not None:
        result["destination_balance_before"] = _fmt(dest_before)
        result["destination_balance_after"] = _fmt(dest_after)
        if to_acc.account_type == Account.AccountType.CREDIT:
            result["destination_balance_owed_before"] = _fmt(credit_owed_from_signed_balance(dest_before))
            result["destination_balance_owed_after"] = _fmt(credit_owed_from_signed_balance(dest_after))

    return result
