"""
Lightweight extended cash-risk scan beyond the selected Forecast Window.

Uses the canonical forecast engine (build_forecast_projection_timeline + the same
first-negative walk as dashboard) but returns only the earliest cash shortfall in
EXTENDED_CASH_RISK_DAYS. Dashboard and Action Center share this result; the scan is
not keyed on the page Forecast Window.

When a detailed forecast has already been computed, reuse its ending balances and
scan only the remaining days. Fallback: one projection-only timeline from as-of
through the extended horizon (still exclude_reconciled_past — no reconciled history).
"""
from __future__ import annotations

import time
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from django.core.cache import cache

from accounts.models import Account
from accounts.services.lowest_projected_cash import (
    account_eligible_for_lowest_projected_cash,
    get_first_cash_shortfall_from_forecasts,
)
from common.services.cache import (
    EXTENDED_CASH_RISK_BUILD_LOCK_SECONDS,
    EXTENDED_CASH_RISK_CACHE_SECONDS,
    EXTENDED_CASH_RISK_SEED_POLL_SECONDS,
    EXTENDED_CASH_RISK_SEED_WAIT_SECONDS,
    get_extended_cash_risk_cache_key,
    get_extended_cash_risk_seed_cache_key,
)
from common.services.forecast_horizon import EXTENDED_CASH_RISK_DAYS
from common.services.profiler import log_perf, perf_enabled, perf_print
from core.utils import get_households_for_user
from timeline.services.ledger import (
    _timeline_row_date,
    build_forecast_projection_timeline,
    forecast_account_balance_metrics,
    is_superseded_planned_row,
    timeline_opening_balance_for_account,
)
from timeline.services.ledger_section_balances import (
    signed_timeline_ledger_amount,
    transactions_ledger_walk_rows,
)
from transactions.services.reconciliation import ledger_today_balance_before_pending


def _decimal(val) -> Decimal:
    if isinstance(val, Decimal):
        return val
    return Decimal(str(val))


@dataclass(frozen=True)
class ExtendedCashRiskAccount:
    account_id: int
    account_name: str
    projected_balance: Decimal


@dataclass(frozen=True)
class ExtendedCashRiskResult:
    """Earliest projected cash-account negative in the extended warning period."""

    as_of: date
    horizon_days: int = EXTENDED_CASH_RISK_DAYS
    account_id: int | None = None
    account_name: str | None = None
    first_negative_date: date | None = None
    projected_balance: Decimal | None = None
    days_from_as_of: int | None = None
    additional_accounts: tuple[ExtendedCashRiskAccount, ...] = field(default_factory=tuple)

    @property
    def has_risk(self) -> bool:
        return self.first_negative_date is not None and self.account_id is not None

    def to_api(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "as_of": self.as_of.isoformat(),
            "horizon_days": self.horizon_days,
            "risk": None,
        }
        if not self.has_risk:
            return payload
        payload["risk"] = {
            "account_id": self.account_id,
            "account_name": self.account_name,
            "first_negative_date": self.first_negative_date.isoformat(),
            "projected_balance": str(self.projected_balance.quantize(Decimal("0.01"))),
            "days_from_as_of": self.days_from_as_of,
            "additional_accounts": [
                {
                    "account_id": extra.account_id,
                    "account_name": extra.account_name,
                    "projected_balance": str(
                        extra.projected_balance.quantize(Decimal("0.01"))
                    ),
                }
                for extra in self.additional_accounts
            ],
        }
        return payload


def looking_ahead_beyond_window(result: ExtendedCashRiskResult, window_days: int) -> bool:
    """True when the first 6-month shortfall is after the selected Forecast Window."""
    if not result.has_risk or result.days_from_as_of is None:
        return False
    return result.days_from_as_of > window_days


def _empty_result(as_of: date) -> ExtendedCashRiskResult:
    return ExtendedCashRiskResult(as_of=as_of, horizon_days=EXTENDED_CASH_RISK_DAYS)


def _resolve_scope(user) -> tuple[list[int], list[Account], dict[int, Account]]:
    households = list(get_households_for_user(user))
    household_ids = [h.id for h in households]
    accounts = list(
        Account.objects.non_deleted()
        .filter(household_id__in=household_ids, is_hidden=False)
        .select_related("household")
    )
    return household_ids, accounts, {a.id: a for a in accounts}


def _result_from_hits(
    as_of: date,
    hits: list[ExtendedCashRiskAccount],
    first_negative_date: date,
    accounts_by_id: dict[int, Account],
) -> ExtendedCashRiskResult:
    ordered = sorted(hits, key=lambda h: (h.projected_balance, h.account_id))
    primary = ordered[0]
    additional = tuple(ordered[1:])
    account = accounts_by_id.get(primary.account_id)
    name = primary.account_name or (
        account.effective_display_name if account else ""
    )
    return ExtendedCashRiskResult(
        as_of=as_of,
        horizon_days=EXTENDED_CASH_RISK_DAYS,
        account_id=primary.account_id,
        account_name=name,
        first_negative_date=first_negative_date,
        projected_balance=primary.projected_balance,
        days_from_as_of=(first_negative_date - as_of).days,
        additional_accounts=additional,
    )


def _result_from_shortfall(
    as_of: date,
    shortfall: dict[str, Any],
    *,
    forecasts: dict[int, dict[str, Any]] | None = None,
    accounts_by_id: dict[int, Account] | None = None,
) -> ExtendedCashRiskResult:
    first_date = date.fromisoformat(str(shortfall["date"])[:10])
    primary_id = shortfall.get("account_id")
    hits: list[ExtendedCashRiskAccount] = [
        ExtendedCashRiskAccount(
            account_id=int(primary_id),
            account_name=str(shortfall.get("account_name") or ""),
            projected_balance=_decimal(shortfall["amount"]),
        )
    ]
    if forecasts and primary_id is not None:
        for aid, summary in forecasts.items():
            if aid == primary_id:
                continue
            first = (summary.get("first_negative_date") or "")[:10]
            raw = summary.get("first_negative_balance")
            if first != first_date.isoformat() or raw is None:
                continue
            amount = _decimal(raw)
            if amount >= 0:
                continue
            account = (accounts_by_id or {}).get(aid)
            hits.append(
                ExtendedCashRiskAccount(
                    account_id=aid,
                    account_name=account.effective_display_name if account else "",
                    projected_balance=amount,
                )
            )
    return _result_from_hits(as_of, hits, first_date, accounts_by_id or {})


def scan_first_negative_cash(
    rows: list[dict],
    *,
    opening: dict[int, Decimal],
    eligible_ids: set[int],
    accounts_by_id: dict[int, Account],
    start_date: date,
    end_date: date,
    as_of: date,
) -> ExtendedCashRiskResult:
    """
    Chronological first-negative walk across eligible cash accounts.

    Stops after the first day any eligible account crosses below zero. Same-day
    additional accounts are collected before returning. Does not keep walking
    through the rest of the horizon.
    """
    if not eligible_ids or start_date > end_date:
        return _empty_result(as_of)

    running = {aid: opening.get(aid, Decimal("0")) for aid in eligible_ids}
    already: list[ExtendedCashRiskAccount] = []
    for aid, bal in running.items():
        if bal < Decimal("0"):
            account = accounts_by_id.get(aid)
            already.append(
                ExtendedCashRiskAccount(
                    account_id=aid,
                    account_name=account.effective_display_name if account else "",
                    projected_balance=bal,
                )
            )
    if already:
        return _result_from_hits(as_of, already, start_date, accounts_by_id)

    best_date: date | None = None
    best_hits: dict[int, ExtendedCashRiskAccount] = {}

    for aid in eligible_ids:
        account = accounts_by_id.get(aid)
        if account is not None:
            try:
                anchor = ledger_today_balance_before_pending(account, start_date)
            except Exception:
                anchor = opening.get(aid, Decimal("0"))
        else:
            anchor = opening.get(aid, Decimal("0"))
        walk = transactions_ledger_walk_rows(
            rows, account_id=aid, today=start_date, end_date=end_date
        )
        running = anchor
        for row in walk:
            rd = _timeline_row_date(row.get("date"))
            if rd is None:
                continue
            running = (running + signed_timeline_ledger_amount(row)).quantize(Decimal("0.01"))
            if running < Decimal("0"):
                if best_date is None or rd < best_date:
                    best_date = rd
                    best_hits = {
                        aid: ExtendedCashRiskAccount(
                            account_id=aid,
                            account_name=account.effective_display_name if account else "",
                            projected_balance=running,
                        )
                    }
                elif rd == best_date and aid not in best_hits:
                    best_hits[aid] = ExtendedCashRiskAccount(
                        account_id=aid,
                        account_name=account.effective_display_name if account else "",
                        projected_balance=running,
                    )
                break

    if best_date is not None and best_hits:
        return _result_from_hits(as_of, list(best_hits.values()), best_date, accounts_by_id)

    return _empty_result(as_of)


def ending_balances_from_detailed_forecast(
    timeline_rows: list[dict],
    accounts: list[Account],
    *,
    today: date,
    window_end: date,
    forecasts: dict[int, dict[str, Any]] | None = None,
) -> dict[int, Decimal]:
    """Projected end-of-window balances for every forecast-participating account."""
    endings: dict[int, Decimal] = {}
    for account in accounts:
        if not account.participates_in_forecast():
            continue
        summary = (forecasts or {}).get(account.id) or {}
        raw = summary.get("projected_balance_at_window_end")
        if raw is not None:
            endings[account.id] = _decimal(raw)
            continue
        metrics = forecast_account_balance_metrics(
            timeline_rows,
            account_id=account.id,
            today=today,
            end_date=window_end,
            minimum_buffer=Decimal("0"),
        )
        endings[account.id] = metrics["ending"]
    return endings


def remember_detailed_forecast_for_extended_risk(
    user,
    *,
    as_of_date: date,
    household_ids: list[int],
    accounts: list[Account],
    forecasts: dict[int, dict[str, Any]],
    timeline_rows: list[dict],
    window_days: int,
    first_cash_shortfall: dict[str, Any] | None = None,
) -> None:
    """
    Store a compact seed (and the result when already known) after a detailed forecast.

    Does not run the extended scan — keeps Dashboard / Action Center first paint on
    the selected window only.
    """
    accounts_by_id = {a.id: a for a in accounts}
    if first_cash_shortfall is None:
        first_cash_shortfall = get_first_cash_shortfall_from_forecasts(
            accounts_by_id, forecasts
        )

    seed_key = get_extended_cash_risk_seed_cache_key(
        user_id=user.pk,
        household_ids=household_ids,
        as_of_date=as_of_date,
    )
    result_key = get_extended_cash_risk_cache_key(
        user_id=user.pk,
        household_ids=household_ids,
        as_of_date=as_of_date,
    )

    if first_cash_shortfall:
        result = _result_from_shortfall(
            as_of_date,
            first_cash_shortfall,
            forecasts=forecasts,
            accounts_by_id=accounts_by_id,
        )
        cache.set(result_key, result.to_api(), timeout=EXTENDED_CASH_RISK_CACHE_SECONDS)
        cache.set(
            seed_key,
            {
                "as_of": as_of_date.isoformat(),
                "window_days": window_days,
                "window_end": (as_of_date + timedelta(days=window_days)).isoformat(),
                "first_cash_shortfall": first_cash_shortfall,
            },
            timeout=EXTENDED_CASH_RISK_CACHE_SECONDS,
        )
        return

    window_end = as_of_date + timedelta(days=window_days)
    endings = ending_balances_from_detailed_forecast(
        timeline_rows,
        accounts,
        today=as_of_date,
        window_end=window_end,
        forecasts=forecasts,
    )
    cache.set(
        seed_key,
        {
            "as_of": as_of_date.isoformat(),
            "window_days": window_days,
            "window_end": window_end.isoformat(),
            "ending_balances": {str(aid): str(bal) for aid, bal in endings.items()},
            "first_cash_shortfall": None,
        },
        timeout=EXTENDED_CASH_RISK_CACHE_SECONDS,
    )
    if window_days >= EXTENDED_CASH_RISK_DAYS:
        cache.set(
            result_key,
            _empty_result(as_of_date).to_api(),
            timeout=EXTENDED_CASH_RISK_CACHE_SECONDS,
        )


def _openings_from_timeline(
    rows: list[dict],
    accounts: list[Account],
    today: date,
) -> dict[int, Decimal]:
    openings: dict[int, Decimal] = {}
    for account in accounts:
        if not account.participates_in_forecast():
            continue
        opening = timeline_opening_balance_for_account(rows, account.id, today)
        if opening is None:
            from transactions.services.reconciliation import ledger_today_balance_before_pending

            opening = ledger_today_balance_before_pending(account, today)
        openings[account.id] = opening
    return openings


def _eligible_ids(accounts: list[Account]) -> set[int]:
    return {a.id for a in accounts if account_eligible_for_lowest_projected_cash(a)}


def _continuation_scan(
    user,
    *,
    as_of: date,
    window_end: date,
    horizon_end: date,
    openings: dict[int, Decimal],
    accounts: list[Account],
    accounts_by_id: dict[int, Account],
) -> ExtendedCashRiskResult:
    start_date = window_end + timedelta(days=1)
    if start_date > horizon_end:
        return _empty_result(as_of)
    rows = build_forecast_projection_timeline(
        user,
        today=as_of,
        start_date=start_date,
        end_date=horizon_end,
        caller="extended_cash_risk",
        opening_balances=openings,
    )
    return scan_first_negative_cash(
        rows,
        opening=openings,
        eligible_ids=_eligible_ids(accounts),
        accounts_by_id=accounts_by_id,
        start_date=start_date,
        end_date=horizon_end,
        as_of=as_of,
    )


def _fallback_full_scan(
    user,
    *,
    as_of: date,
    horizon_end: date,
    accounts: list[Account],
    accounts_by_id: dict[int, Account],
) -> ExtendedCashRiskResult:
    """
    Correct fallback when no detailed-forecast seed exists.

    Still uses projection_only + exclude_reconciled_past (no reconciled history).
    This duplicates days already covered if a detailed window was computed but not
    seeded — prefer remember_detailed_forecast_for_extended_risk on those paths.
    """
    rows = build_forecast_projection_timeline(
        user,
        today=as_of,
        end_date=horizon_end,
        caller="extended_cash_risk",
    )
    openings = _openings_from_timeline(rows, accounts, as_of)
    return scan_first_negative_cash(
        rows,
        opening=openings,
        eligible_ids=_eligible_ids(accounts),
        accounts_by_id=accounts_by_id,
        start_date=as_of,
        end_date=horizon_end,
        as_of=as_of,
    )


def _wait_for_extended_cash_risk_seed(seed_key: str) -> dict[str, Any] | None:
    """Briefly poll for a dashboard-seeded forecast continuation payload."""
    deadline = time.monotonic() + EXTENDED_CASH_RISK_SEED_WAIT_SECONDS
    while time.monotonic() < deadline:
        seed = cache.get(seed_key)
        if isinstance(seed, dict):
            if perf_enabled():
                perf_print("[PERF] extended_cash_risk seed=HIT_AFTER_WAIT")
            return seed
        time.sleep(EXTENDED_CASH_RISK_SEED_POLL_SECONDS)
    seed = cache.get(seed_key)
    return seed if isinstance(seed, dict) else None


def _wait_for_extended_cash_risk_result(result_key: str) -> dict[str, Any] | None:
    deadline = time.monotonic() + EXTENDED_CASH_RISK_SEED_WAIT_SECONDS
    while time.monotonic() < deadline:
        cached = cache.get(result_key)
        if isinstance(cached, dict):
            return cached
        time.sleep(EXTENDED_CASH_RISK_SEED_POLL_SECONDS)
    cached = cache.get(result_key)
    return cached if isinstance(cached, dict) else None


def get_extended_cash_risk(
    user,
    *,
    as_of_date: date | None = None,
) -> dict[str, Any]:
    """Canonical 6-month first-cash-negative result shared by Dashboard and Action Center."""
    today = as_of_date or date.today()
    household_ids, accounts, accounts_by_id = _resolve_scope(user)
    result_key = get_extended_cash_risk_cache_key(
        user_id=user.pk,
        household_ids=household_ids,
        as_of_date=today,
    )
    cached = cache.get(result_key)
    if isinstance(cached, dict):
        log_perf("extended_cash_risk", cache="HIT", user=user.pk)
        return cached

    seed_key = get_extended_cash_risk_seed_cache_key(
        user_id=user.pk,
        household_ids=household_ids,
        as_of_date=today,
    )
    seed = cache.get(seed_key)
    if not isinstance(seed, dict):
        seed = _wait_for_extended_cash_risk_seed(seed_key)
    horizon_end = today + timedelta(days=EXTENDED_CASH_RISK_DAYS)

    lock_key = f"{result_key}:lock"
    got_lock = cache.add(lock_key, "1", timeout=EXTENDED_CASH_RISK_BUILD_LOCK_SECONDS)
    if not got_lock:
        waited = _wait_for_extended_cash_risk_result(result_key)
        if waited is not None:
            log_perf("extended_cash_risk", cache="HIT_AFTER_WAIT", user=user.pk)
            return waited

    try:
        cached = cache.get(result_key)
        if isinstance(cached, dict):
            log_perf("extended_cash_risk", cache="HIT", user=user.pk)
            return cached

        if isinstance(seed, dict) and seed.get("first_cash_shortfall"):
            if perf_enabled():
                perf_print("[PERF] extended_cash_risk seed=HIT")
            result = _result_from_shortfall(
                today,
                seed["first_cash_shortfall"],
                accounts_by_id=accounts_by_id,
            )
            payload = result.to_api()
            cache.set(result_key, payload, timeout=EXTENDED_CASH_RISK_CACHE_SECONDS)
            return payload

        if isinstance(seed, dict) and seed.get("window_end") and seed.get("ending_balances"):
            if perf_enabled():
                perf_print("[PERF] extended_cash_risk seed=HIT")
            window_end = date.fromisoformat(str(seed["window_end"])[:10])
            if window_end >= horizon_end:
                payload = _empty_result(today).to_api()
                cache.set(result_key, payload, timeout=EXTENDED_CASH_RISK_CACHE_SECONDS)
                return payload
            openings = {
                int(aid): _decimal(bal) for aid, bal in seed["ending_balances"].items()
            }
            if perf_enabled():
                perf_print(
                    f"[PERF] extended_cash_risk continuation "
                    f"from={window_end.isoformat()} to={horizon_end.isoformat()}"
                )
            result = _continuation_scan(
                user,
                as_of=today,
                window_end=window_end,
                horizon_end=horizon_end,
                openings=openings,
                accounts=accounts,
                accounts_by_id=accounts_by_id,
            )
            payload = result.to_api()
            cache.set(result_key, payload, timeout=EXTENDED_CASH_RISK_CACHE_SECONDS)
            log_perf("extended_cash_risk", cache="MISS_CONTINUATION", user=user.pk)
            return payload

        if perf_enabled():
            perf_print("[PERF] extended_cash_risk seed=MISS fallback_full_scan")
        result = _fallback_full_scan(
            user,
            as_of=today,
            horizon_end=horizon_end,
            accounts=accounts,
            accounts_by_id=accounts_by_id,
        )
        payload = result.to_api()
        cache.set(result_key, payload, timeout=EXTENDED_CASH_RISK_CACHE_SECONDS)
        log_perf("extended_cash_risk", cache="MISS_FALLBACK", user=user.pk)
        return payload
    finally:
        if got_lock:
            cache.delete(lock_key)
