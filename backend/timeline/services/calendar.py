"""
Financial calendar: daily cash-flow summaries and risk heatmap from timeline rows.

Reuses transfer classification from dashboard_upcoming so net totals exclude internal
transfers while transfers still appear in day detail lists.

Field sources (each day payload)
--------------------------------
income_total
    Sum of amounts where ``is_income_for_dashboard_totals`` is true
    (``insights.services.dashboard_upcoming.is_income_for_dashboard_totals``).
    Built in ``build_timeline_calendar`` day loop.

expense_total
    Absolute sum of amounts where ``is_expense_for_dashboard_totals`` is true
    (``insights.services.dashboard_upcoming.is_expense_for_dashboard_totals``).
    Stored as a positive magnitude. Built in ``build_timeline_calendar`` day loop.

transfer_total
    Absolute sum of internal-transfer outflows (``is_transfer`` and amount < 0).
    Built in ``build_timeline_calendar`` day loop. Transfers do not affect income/expense.

ending_balance
    Last canonical per-account ``balance_after`` (forecast) or ``running_balance``
    (historical) on that date via ``_row_canonical_balance``, carried forward on quiet
    days through ``running[aid]``. Household scope sums cash accounts.
    Created in ``build_timeline_calendar``.

lowest_balance
    Intra-day minimum of canonical account balances that day, else EOD / ending.
    Created in ``build_timeline_calendar``.

presentation_status
    Canonical cell status: healthy | warning | critical.
    ``_calendar_presentation_status`` — future only; past always healthy.
    critical = worst scoped cash balance < 0;
    warning = balance >= 0 but < configured minimum_buffer;
    healthy = otherwise.

risk_level / has_risk / heat_level / is_negative
    Derived from ``presentation_status`` (not independent risk engines).
    ``_presentation_to_legacy_fields``. heat_level labels remain for scanability only.

below_buffer_amount
    From ``insights.services.day_lowest_balance.calculate_day_lowest_marker``
    (``_amount_needed_to_buffer``), emitted only when the lowest marker is shown.

Balance rule
------------
Calendar does **not** recalculate balances from amounts. Event and day balances are
read from canonical ``balance_after`` (future/today) / ``running_balance`` (historical)
via ``_row_canonical_balance`` and carried forward on quiet days. Seeding uses prior-row
canonical balances or ``Account.starting_balance``.

API endpoints
-------------
``GET /api/timeline/calendar/`` — full payload (``TimelineCalendarView``)
``GET /api/timeline/calendar/summary/`` — summary cards (``TimelineCalendarSummaryView``)
``GET /api/timeline/calendar/chunk/`` — month slice (``TimelineCalendarChunkView``)
All built by ``build_timeline_calendar`` (+ cache in ``calendar_cache``).

Source rows
-----------
Historical lookback: ``build_timeline`` (posted / past planned display rows with
``running_balance``).
Forecast window: ``get_or_build_canonical_forecast_timeline`` (rows with
``balance_after``).
Day totals classify each event with dashboard_upcoming income/expense/transfer helpers.
"""
from __future__ import annotations

import logging
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal
from typing import Any, Optional

from accounts.models import Account
from accounts.services.available_to_spend import (
    ALLOWED_FORECAST_DAYS,
    RISK_STATUS_CRITICAL,
    RISK_STATUS_RISK,
    _decimal,
    account_supports_available_to_spend,
)
from core.utils import get_households_for_user
from insights.services.dashboard_summary import _classify_timeline_kind
from insights.services.dashboard_upcoming import (
    _day_risk_reason,
    _serialize_transaction,
    is_expense_for_dashboard_totals,
    is_income_for_dashboard_totals,
    load_transfer_rule_context,
)
from insights.services.day_heat import (
    AccountDayBalance,
    account_balances_from_txn_lows,
)
from insights.services.day_credit_warnings import scan_credit_day_warnings
from insights.services.day_biggest_drivers import compute_biggest_drivers
from insights.services.day_lowest_balance import (
    account_balance_rows_from_transactions,
    calculate_day_lowest_marker,
    calculate_day_lowest_marker_from_snapshots,
    carry_forward_lowest_markers,
)
from insights.services.day_recovery import attach_recovery_to_days
from timeline.services.ledger import (
    build_timeline,
    forecast_account_balance_metrics,
    row_participates_in_ledger_walk,
    timeline_row_process_order,
)

logger = logging.getLogger(__name__)


def _parse_date(val) -> date | None:
    if val is None:
        return None
    if isinstance(val, date):
        return val
    try:
        return date.fromisoformat(str(val)[:10])
    except ValueError:
        return None


def _risk_level_for_balance(balance: Decimal, buffer: Decimal) -> str:
    if balance < Decimal("0"):
        return "critical"
    if buffer > 0 and balance < buffer:
        return "watch"
    return "none"


def _risk_reason_for_level(level: str, balance: Decimal, buffer: Decimal, day: date) -> str | None:
    if level == "none":
        return None
    ds = day.isoformat()
    if level == "critical":
        return f"Projected balance drops below zero on {ds}."
    if level == "watch":
        return f"Projected balance falls below your {buffer} buffer on {ds}."
    return None


def _timeline_row_to_event(
    row: dict[str, Any],
    accounts_by_id: dict[int, Account],
    transfer_rule_ids: set[int],
    transfer_rule_targets: dict[int, int],
) -> dict[str, Any]:
    kind = _classify_timeline_kind(
        row, accounts_by_id, transfer_rule_ids, transfer_rule_targets
    )
    amount = row.get("amount")
    return {
        "id": row.get("transaction_id") or f"r-{row.get('rule_id')}-{row.get('date')}",
        "date": row["date"] if isinstance(row["date"], str) else row["date"].isoformat(),
        "account_id": row.get("account_id"),
        "account_name": row.get("account_name") or "",
        "description": row.get("description") or "—",
        "amount": str(_decimal(amount).quantize(Decimal("0.01"))) if amount is not None else None,
        "kind": kind,
        "category": row.get("category_name"),
        "rule_id": row.get("rule_id"),
        "transaction_id": row.get("transaction_id"),
        "status": row.get("status"),
        "source": row.get("source") or row.get("txn_source"),
        "projected_balance": row.get("balance_after") or row.get("running_balance"),
        "balance_after": row.get("balance_after") or row.get("running_balance"),
        "is_risk": False,
        "transaction_type": row.get("transaction_type"),
        "transfer_group_id": row.get("transfer_group_id"),
    }


def _index_rows_by_account_date(rows: list[dict]) -> dict[tuple[int, date], list[dict]]:
    """Group original timeline rows by account and calendar date (one pass)."""
    indexed: dict[tuple[int, date], list[dict]] = defaultdict(list)
    for row in rows:
        account_id = row.get("account_id")
        row_date = _parse_date(row.get("date"))
        if account_id is None or row_date is None:
            continue
        indexed[(int(account_id), row_date)].append(row)
    return indexed


def _effective_buffer(account_id: int | None, accounts_by_id: dict[int, Account], cash_ids: list[int]) -> Decimal:
    if account_id is not None:
        acc = accounts_by_id.get(account_id)
        return _decimal(acc.minimum_buffer or 0) if acc else Decimal("0")
    total = Decimal("0")
    for aid in cash_ids:
        acc = accounts_by_id.get(aid)
        if acc:
            total += _decimal(acc.minimum_buffer or 0)
    return total


def _cash_account_ids(accounts: list[Account]) -> list[int]:
    return [
        a.id
        for a in accounts
        if a.participates_in_forecast() and account_supports_available_to_spend(a)
    ]


def _historical_risk_reason_for_level(
    level: str, balance: Decimal, buffer: Decimal, day: date
) -> str | None:
    if level == "none":
        return None
    ds = day.isoformat()
    if level == "critical":
        return f"Balance dropped below zero on {ds}."
    if level == "watch":
        return f"Balance fell below your {buffer} buffer on {ds}."
    return None


def _row_canonical_balance(row: dict, *, is_forecast: bool | None = None) -> Decimal | None:
    """Read canonical ledger balance — never recompute from amounts.

    Forecast/today (``is_forecast=True``): prefer ``balance_after``.
    Historical (``is_forecast=False``): prefer ``running_balance``.
    When ``is_forecast`` is None (seed scans): prefer ``balance_after``, else ``running_balance``.
    """
    ba = row.get("balance_after")
    rb = row.get("running_balance")
    if is_forecast is False:
        if rb is not None:
            return _decimal(rb)
        if ba is not None:
            return _decimal(ba)
        return None
    if is_forecast is True:
        if ba is not None:
            return _decimal(ba)
        if rb is not None:
            return _decimal(rb)
        return None
    if ba is not None:
        return _decimal(ba)
    if rb is not None:
        return _decimal(rb)
    return None


def _calendar_event_risk_flag(
    *,
    canonical_balance: Decimal | None,
    is_forecast_day: bool,
) -> bool:
    """Use canonical ledger balance_after only — never dashboard buffer heuristics."""
    if not is_forecast_day or canonical_balance is None:
        return False
    return canonical_balance < 0


def _calendar_presentation_status(
    *,
    is_forecast_day: bool,
    account_balances: list[AccountDayBalance],
) -> str:
    """Canonical day status from future account balances only.

    critical = any scoped cash balance < 0
    warning = balance >= 0 but < minimum_buffer
    healthy = otherwise (and always for past days)
    """
    if not is_forecast_day:
        return "healthy"
    if not account_balances:
        return "healthy"
    worst = min(account_balances, key=lambda a: a.balance)
    if worst.balance < Decimal("0"):
        return "critical"
    if worst.minimum_buffer > 0 and worst.balance < worst.minimum_buffer:
        return "warning"
    return "healthy"


def _presentation_to_legacy_fields(
    presentation_status: str,
    *,
    has_activity: bool,
    account_balances: list[AccountDayBalance],
    day: date,
    buffer: Decimal,
    is_forecast_day: bool,
) -> dict[str, Any]:
    """Collapse risk_level / has_risk / heat_level / is_negative from one status."""
    is_negative = presentation_status == "critical"
    if presentation_status == "critical":
        risk_level = "critical"
        heat_level = "dangerous"
        heat_label = "Dangerous"
        has_risk = True
    elif presentation_status == "warning":
        risk_level = "watch"
        heat_level = "tight"
        heat_label = "Tight"
        has_risk = True
    else:
        risk_level = "none"
        heat_level = "healthy" if has_activity else "neutral"
        heat_label = "Healthy" if has_activity else "Neutral"
        has_risk = False

    worst = min(account_balances, key=lambda a: a.balance) if account_balances else None
    affected = worst.account_name if worst else None
    reason_fn = _risk_reason_for_level if is_forecast_day else _historical_risk_reason_for_level
    ending = worst.balance if worst is not None else Decimal("0")
    risk_reason = reason_fn(risk_level, ending, buffer, day)
    if risk_reason is None and presentation_status == "warning" and worst is not None:
        needed = (worst.minimum_buffer - worst.balance).quantize(Decimal("0.01"))
        risk_reason = f"Below buffer: {worst.account_name} ${needed}"
    if risk_reason is None and presentation_status == "critical" and worst is not None:
        risk_reason = f"{worst.account_name} projected {worst.balance.quantize(Decimal('0.01'))}"

    return {
        "presentation_status": presentation_status,
        "risk_level": risk_level,
        "has_risk": has_risk,
        "heat_level": heat_level,
        "heat_label": heat_label,
        "heat_reason": risk_reason,
        "is_negative": is_negative,
        "affected_account_name": affected,
        "risk_reason": risk_reason,
    }


def _seed_running_from_canonical(
    rows: list[dict],
    *,
    scope_ids: list[int],
    start_date: date,
    rows_by_account_date: dict[tuple[int, date], list[dict]],
    accounts_by_id: dict[int, Account],
    forecast_ledger_rows: list[dict],
) -> dict[int, Decimal]:
    """Seed per-account EOD carry from canonical balances only — never amount math.

    Prefers last ``balance_after`` / ``running_balance`` on rows strictly before
    ``start_date``. Falls back to last forecast-row canonical balance before
    ``start_date``, then ``Account.starting_balance``.
    """
    running: dict[int, Decimal] = {}
    for row in rows:
        rd = _parse_date(row.get("date"))
        aid = row.get("account_id")
        if rd is None or aid is None or int(aid) not in scope_ids or rd >= start_date:
            continue
        account_rows = rows_by_account_date.get((int(aid), rd), [])
        if not row_participates_in_ledger_walk(row, account_rows):
            continue
        rb = _row_canonical_balance(row)
        if rb is not None:
            running[int(aid)] = rb

    for row in forecast_ledger_rows:
        rd = _parse_date(row.get("date"))
        aid = row.get("account_id")
        if rd is None or aid is None or int(aid) not in scope_ids or rd >= start_date:
            continue
        rb = _row_canonical_balance(row)
        if rb is not None:
            running[int(aid)] = rb

    for aid in scope_ids:
        if aid in running:
            continue
        acc = accounts_by_id.get(aid)
        if acc is None:
            continue
        running[aid] = _decimal(acc.starting_balance or 0)

    return running


def _annotate_first_account_shortfall_dates(
    days: list[dict[str, Any]], today: date
) -> None:
    """Record each cash account's first future negative date without rewriting day markers.

    Day-local ``lowest_projected_balance`` / ``_date`` stay on the day they were measured
    (so Sep 4 can show -522.54 after Hulu). ``first_account_shortfall_date`` is used only
    for \"First cash shortfall\" copy vs later shortfalls.
    """
    today_iso = today.isoformat()
    first_neg_date: dict[int, str] = {}
    for day in days:
        day_iso = day.get("date") or ""
        if day_iso < today_iso:
            continue
        for txn in day.get("transactions") or []:
            aid = txn.get("account_id")
            bal_raw = txn.get("balance_after")
            if aid is None or bal_raw is None:
                continue
            try:
                aid_i = int(aid)
                bal = _decimal(bal_raw)
            except (TypeError, ValueError):
                continue
            if bal < 0 and aid_i not in first_neg_date:
                first_neg_date[aid_i] = day_iso

    for day in days:
        raw_aid = day.get("lowest_projected_balance_account_id")
        if raw_aid is None:
            day["first_account_shortfall_date"] = None
            continue
        try:
            aid_i = int(raw_aid)
        except (TypeError, ValueError):
            day["first_account_shortfall_date"] = None
            continue
        day["first_account_shortfall_date"] = first_neg_date.get(aid_i)


def _bind_day_markers_to_canonical_events(days: list[dict[str, Any]]) -> None:
    """Force marker balance/account/description to one calendar event's balance_after.

    Prevents heat/snapshot mixups like Chase balance + Main \"after Electric\".
    """
    for day in days:
        if not day.get("show_lowest_balance_marker"):
            continue
        tid = day.get("lowest_projected_balance_transaction_id")
        aid = day.get("lowest_projected_balance_account_id")
        events = day.get("transactions") or []
        focus: dict[str, Any] | None = None
        if tid is not None:
            tid_s = str(tid)
            for ev in events:
                if str(ev.get("id")) != tid_s and str(ev.get("transaction_id") or "") != tid_s:
                    continue
                if aid is not None and ev.get("account_id") is not None:
                    try:
                        if int(ev["account_id"]) != int(aid):
                            continue
                    except (TypeError, ValueError):
                        continue
                focus = ev
                break
        if focus is None and aid is not None:
            # Fall back to the worst (lowest) balance_after on that account that day.
            candidates = []
            for ev in events:
                if ev.get("account_id") is None or ev.get("balance_after") is None:
                    continue
                try:
                    if int(ev["account_id"]) != int(aid):
                        continue
                except (TypeError, ValueError):
                    continue
                candidates.append(ev)
            if candidates:
                focus = min(candidates, key=lambda e: _decimal(e.get("balance_after")))
        if focus is None or focus.get("balance_after") is None:
            # Incomplete marker — do not show a mismatched risk card.
            day["show_lowest_balance_marker"] = False
            day["lowest_projected_balance"] = None
            day["lowest_projected_balance_account_id"] = None
            day["lowest_projected_balance_account_name"] = None
            day["lowest_projected_balance_transaction_id"] = None
            day["lowest_projected_balance_after_description"] = None
            day["lowest_projected_balance_date"] = None
            day["below_buffer_amount"] = None
            continue
        day["lowest_projected_balance"] = str(
            _decimal(focus["balance_after"]).quantize(Decimal("0.01"))
        )
        day["lowest_projected_balance_account_name"] = focus.get("account_name") or day.get(
            "lowest_projected_balance_account_name"
        )
        if focus.get("account_id") is not None:
            try:
                day["lowest_projected_balance_account_id"] = int(focus["account_id"])
            except (TypeError, ValueError):
                pass
        day["lowest_projected_balance_after_description"] = (
            (focus.get("description") or "").strip() or None
        )
        if focus.get("transaction_id") is not None:
            day["lowest_projected_balance_transaction_id"] = focus.get("transaction_id")
        elif focus.get("id") is not None:
            day["lowest_projected_balance_transaction_id"] = focus.get("id")
        day["lowest_projected_balance_date"] = day.get("date")


def _normalize_forecast_days(today: date, end_date: date, forecast_days: int | None) -> int:
    if forecast_days is not None:
        raw = forecast_days
    else:
        raw = max((end_date - today).days, 7)
    if raw in ALLOWED_FORECAST_DAYS:
        return raw
    return min(ALLOWED_FORECAST_DAYS, key=lambda d: (abs(d - raw), -d))


def _load_calendar_timeline_rows(
    user,
    *,
    start_date: date,
    end_date: date,
    forecast_days: int,
    today: date,
    scenario_id: Optional[int],
    household_id: Optional[int],
    as_of_date: Optional[date],
    ephemeral_events: Optional[list],
    projection_only: bool,
    timeline_rows: Optional[list[dict]],
) -> tuple[list[dict], list[dict]]:
    """Historical display rows + canonical forecast rows (no duplicate forecast engine).

    Returns ``(merged_rows, forecast_ledger_rows)``. Risk metrics must use
    ``forecast_ledger_rows`` only — historical display rows may lack canonical
    ``balance_after`` on past planned occurrences.
    """
    if timeline_rows is not None:
        forecast_ledger_rows = [
            row
            for row in timeline_rows
            if (rd := _parse_date(row.get("date"))) is not None and rd >= today
        ]
        return timeline_rows, forecast_ledger_rows

    forecast_end = today + timedelta(days=forecast_days)
    effective_end = min(end_date, forecast_end)
    merged: list[dict] = []
    forecast_ledger_rows: list[dict] = []

    if start_date < today:
        hist_end = min(today - timedelta(days=1), end_date)
        if start_date <= hist_end:
            historical = build_timeline(
                user,
                start_date=start_date,
                end_date=hist_end,
                scenario_id=scenario_id,
                account_id=None,
                household_id=household_id,
                as_of_date=as_of_date,
                ephemeral_events=ephemeral_events,
                projection_only=projection_only,
                exclude_reconciled_past=False,
                caller="timeline_calendar_history",
            )
            merged.extend(historical)

    if today <= effective_end:
        from timeline.services.canonical_timeline_cache import (
            get_or_build_canonical_forecast_timeline,
        )

        forecast_rows, _ = get_or_build_canonical_forecast_timeline(
            user,
            today=today,
            forecast_days=forecast_days,
            household_id=household_id,
            scenario_id=scenario_id,
            caller="timeline_calendar",
        )
        forecast_ledger_rows = list(forecast_rows)
        for row in forecast_rows:
            rd = _parse_date(row.get("date"))
            if rd is not None and today <= rd <= effective_end:
                merged.append(row)

    return merged, forecast_ledger_rows


def build_timeline_calendar(
    user,
    *,
    start_date: date,
    end_date: date,
    scenario_id: Optional[int] = None,
    account_id: Optional[int] = None,
    household_id: Optional[int] = None,
    as_of_date: Optional[date] = None,
    ephemeral_events: Optional[list] = None,
    projection_only: bool = False,
    timeline_rows: Optional[list[dict]] = None,
    forecast_days: Optional[int] = None,
) -> dict[str, Any]:
    today = as_of_date or date.today()
    resolved_forecast_days = _normalize_forecast_days(today, end_date, forecast_days)
    rows, forecast_ledger_rows = _load_calendar_timeline_rows(
        user,
        start_date=start_date,
        end_date=end_date,
        forecast_days=resolved_forecast_days,
        today=today,
        scenario_id=scenario_id,
        household_id=household_id,
        as_of_date=as_of_date,
        ephemeral_events=ephemeral_events,
        projection_only=projection_only,
        timeline_rows=timeline_rows,
    )
    if account_id is not None:
        rows = [r for r in rows if r.get("account_id") == account_id]

    households = list(get_households_for_user(user))
    household_ids = [h.id for h in households]
    if household_id:
        household_ids = [household_id] if household_id in household_ids else []
        households = [h for h in households if h.id in household_ids]
    accounts = list(
        Account.objects.filter(household_id__in=household_ids)
        .select_related("household")
        .order_by("name")
    )
    accounts_by_id = {a.id: a for a in accounts}
    cash_ids = _cash_account_ids(accounts)
    if account_id is not None:
        scope_ids = [account_id]
    else:
        scope_ids = cash_ids

    transfer_rule_ids, transfer_rule_targets, transfer_rule_sources = load_transfer_rule_context(
        households, household_ids=household_ids
    )

    rows_by_account_date = _index_rows_by_account_date(rows)

    # Normalize row dates and filter superseded planned rows using per-account/date indexes
    by_date_all: dict[str, list[dict]] = defaultdict(list)

    for row in rows:
        rd = _parse_date(row.get("date"))
        if rd is None or rd < start_date or rd > end_date:
            continue
        date_iso = rd.isoformat()
        aid = row.get("account_id")
        account_rows = (
            rows_by_account_date.get((int(aid), rd), []) if aid is not None else []
        )
        if aid and not row_participates_in_ledger_walk(row, account_rows):
            continue
        row = dict(row)
        row["date"] = date_iso
        by_date_all[date_iso].append(row)

    buffer = _effective_buffer(account_id, accounts_by_id, cash_ids)

    days_out: list[dict[str, Any]] = []
    global_lowest = None
    global_lowest_date = None
    next_risk_date = None
    total_income = Decimal("0")
    total_expenses = Decimal("0")
    best_balance = None
    best_date = None

    running = _seed_running_from_canonical(
        rows,
        scope_ids=scope_ids,
        start_date=start_date,
        rows_by_account_date=rows_by_account_date,
        accounts_by_id=accounts_by_id,
        forecast_ledger_rows=forecast_ledger_rows,
    )

    d = start_date
    while d <= end_date:
        date_iso = d.isoformat()
        day_rows = by_date_all.get(date_iso, [])
        is_forecast_day = d >= today

        income = Decimal("0")
        expense = Decimal("0")
        transfer = Decimal("0")
        events: list[dict[str, Any]] = []
        marker_txns: list[dict[str, Any]] = []
        day_lowest = None
        eod_by_account: dict[int, Decimal] = {}

        for row in sorted(day_rows, key=timeline_row_process_order):
            ev = _timeline_row_to_event(
                row, accounts_by_id, transfer_rule_ids, transfer_rule_targets
            )
            txn = _serialize_transaction(
                ev,
                transfer_rule_ids=transfer_rule_ids,
                transfer_rule_targets=transfer_rule_targets,
                transfer_rule_sources=transfer_rule_sources,
                accounts_by_id=accounts_by_id,
            )
            amt = _decimal(row.get("amount") or 0)
            aid = row.get("account_id")
            canonical_bal: Decimal | None = None

            if aid in scope_ids:
                rb = _row_canonical_balance(row, is_forecast=is_forecast_day)
                if rb is not None:
                    canonical_bal = rb
                    acct_bal = rb
                    if day_lowest is None or acct_bal < day_lowest:
                        day_lowest = acct_bal
                    txn["balance_after"] = str(acct_bal.quantize(Decimal("0.01")))
                    eod_by_account[int(aid)] = acct_bal
                    marker_txns.append(txn)
                elif is_forecast_day and row.get("balance_after") is None:
                    logger.error(
                        "canonical calendar row missing balance_after account=%s date=%s desc=%r",
                        aid,
                        date_iso,
                        row.get("description"),
                    )

            events.append(
                {
                    "id": txn.get("id"),
                    "date": date_iso,
                    "account_id": aid,
                    "description": txn.get("description"),
                    "account_name": txn.get("account_name"),
                    "amount": txn.get("amount"),
                    "category": txn.get("category"),
                    "kind": txn.get("kind"),
                    "source": txn.get("source"),
                    "status": txn.get("status") or row.get("status"),
                    "rule_id": txn.get("rule_id") or row.get("rule_id"),
                    "transaction_id": txn.get("transaction_id") or row.get("transaction_id"),
                    "reconciled": bool(row.get("reconciled")),
                    "cleared": bool(row.get("cleared")),
                    "balance_after": txn.get("balance_after"),
                    "is_transfer": txn.get("is_transfer", False),
                    "is_internal_transfer": bool(txn.get("is_internal_transfer")),
                    "is_credit_card_payment": bool(txn.get("is_credit_card_payment")),
                    "risk_flag": _calendar_event_risk_flag(
                        canonical_balance=canonical_bal,
                        is_forecast_day=is_forecast_day,
                    ),
                    "transfer_from_account_name": txn.get("transfer_from_account_name"),
                    "transfer_to_account_name": txn.get("transfer_to_account_name"),
                }
            )

            if is_income_for_dashboard_totals(
                ev,
                transfer_rule_ids=transfer_rule_ids,
                transfer_rule_targets=transfer_rule_targets,
                accounts_by_id=accounts_by_id,
            ):
                income += amt
            elif is_expense_for_dashboard_totals(
                ev,
                transfer_rule_ids=transfer_rule_ids,
                transfer_rule_targets=transfer_rule_targets,
                accounts_by_id=accounts_by_id,
            ):
                expense += abs(amt)
            elif (
                txn.get("is_transfer")
                and amt < 0
            ):
                transfer += abs(amt)

        for aid in scope_ids:
            if aid in eod_by_account:
                running[aid] = eod_by_account[aid]

        net = income - expense

        if account_id is not None:
            ending = running.get(account_id, Decimal("0"))
        else:
            ending = sum(
                (running.get(aid, Decimal("0")) for aid in scope_ids),
                Decimal("0"),
            )

        eod_worst: Decimal | None = None
        for aid in scope_ids:
            bal = running.get(aid, Decimal("0"))
            if eod_worst is None or bal < eod_worst:
                eod_worst = bal

        # Use intra-day low (matches Transactions ledger), not only end-of-day balances.
        if day_lowest is not None:
            lowest = day_lowest
        elif account_id is not None:
            lowest = ending
        else:
            lowest = eod_worst if eod_worst is not None else ending

        if day_rows and d >= today:
            total_income += income
            total_expenses += expense

        account_snapshots: list[AccountDayBalance] = []
        for aid in scope_ids:
            acc = accounts_by_id.get(aid)
            if not acc or acc.is_credit_card() or not account_supports_available_to_spend(acc):
                continue
            bal = running.get(aid, Decimal("0"))
            account_snapshots.append(
                AccountDayBalance(
                    account_name=acc.effective_display_name,
                    balance=bal,
                    minimum_buffer=_decimal(acc.minimum_buffer or 0),
                )
            )

        if marker_txns:
            balance_rows = account_balance_rows_from_transactions(marker_txns)
            heat_balances = account_balances_from_txn_lows(
                balance_rows, accounts_by_id
            )
        else:
            heat_balances = account_snapshots

        # One presentation status from canonical balances — heat/risk fields derive from it.
        presentation_status = _calendar_presentation_status(
            is_forecast_day=is_forecast_day,
            account_balances=heat_balances,
        )
        legacy = _presentation_to_legacy_fields(
            presentation_status,
            has_activity=bool(day_rows),
            account_balances=heat_balances,
            day=d,
            buffer=buffer,
            is_forecast_day=is_forecast_day,
        )
        credit_balance_warnings = scan_credit_day_warnings(
            marker_txns, accounts_by_id
        )
        lowest_marker = calculate_day_lowest_marker(
            marker_txns,
            accounts_by_id,
            date_iso=date_iso,
            heat_level=legacy["heat_level"],
            scope_account_id=account_id,
        )
        if not lowest_marker["show_lowest_balance_marker"] and legacy["heat_level"] in (
            "tight",
            "dangerous",
        ):
            snapshot_marker = calculate_day_lowest_marker_from_snapshots(
                account_snapshots,
                accounts_by_id,
                date_iso=date_iso,
                heat_level=legacy["heat_level"],
                scope_account_id=account_id,
            )
            if snapshot_marker["show_lowest_balance_marker"]:
                lowest_marker = snapshot_marker

        risk_level = legacy["risk_level"]
        risk_reason = legacy["risk_reason"]
        if not risk_reason and day_rows:
            risk_reason = _day_risk_reason(date_iso, events, {}, accounts_by_id)
            if not is_forecast_day and risk_reason and "projected" in risk_reason.lower():
                risk_reason = risk_reason.replace(" projected", "").replace("Projected ", "")

        has_risk = legacy["has_risk"]

        # Summary lowest is forward-looking only (exclude historical days in the range).
        if d >= today and (global_lowest is None or lowest < global_lowest):
            global_lowest = lowest
            global_lowest_date = date_iso

        if has_risk and next_risk_date is None and d >= today:
            next_risk_date = date_iso

        if d >= today and (best_balance is None or ending > best_balance):
            best_balance = ending
            best_date = date_iso

        account_balance_map = {
            str(aid): str(running.get(aid, Decimal("0")).quantize(Decimal("0.01")))
            for aid in scope_ids
        }

        days_out.append(
            {
                "date": date_iso,
                "is_forecast": is_forecast_day,
                "balance_scope": "account" if account_id is not None else "household_cash",
                "income_total": str(income.quantize(Decimal("0.01"))),
                "expense_total": str(expense.quantize(Decimal("0.01"))),
                "transfer_total": str(transfer.quantize(Decimal("0.01"))),
                "net_total": str(net.quantize(Decimal("0.01"))),
                "ending_balance": str(ending.quantize(Decimal("0.01"))),
                "_account_balances": account_balance_map,
                "lowest_balance": str((lowest if lowest is not None else ending).quantize(Decimal("0.01"))),
                "presentation_status": legacy["presentation_status"],
                "risk_level": risk_level,
                "risk_reason": risk_reason,
                "has_risk": has_risk,
                "heat_level": legacy["heat_level"],
                "heat_label": legacy["heat_label"],
                "heat_reason": legacy["heat_reason"] or risk_reason,
                "affected_account_name": legacy["affected_account_name"],
                # Account-risk marker fields are atomic — never fill balance from heat
                # while keeping another account's after_description (caused Chase/Main mixups).
                "lowest_projected_balance": (
                    lowest_marker["lowest_projected_balance"]
                    if lowest_marker.get("show_lowest_balance_marker")
                    else None
                ),
                "below_buffer_amount": (
                    lowest_marker["below_buffer_amount"]
                    if lowest_marker.get("show_lowest_balance_marker")
                    else None
                ),
                "is_negative": legacy["is_negative"],
                "lowest_projected_balance_account_id": (
                    lowest_marker["lowest_projected_balance_account_id"]
                    if lowest_marker.get("show_lowest_balance_marker")
                    else None
                ),
                "lowest_projected_balance_account_name": (
                    lowest_marker["lowest_projected_balance_account_name"]
                    if lowest_marker.get("show_lowest_balance_marker")
                    else None
                ),
                "lowest_projected_balance_transaction_id": (
                    lowest_marker["lowest_projected_balance_transaction_id"]
                    if lowest_marker.get("show_lowest_balance_marker")
                    else None
                ),
                "lowest_projected_balance_after_description": (
                    lowest_marker["lowest_projected_balance_after_description"]
                    if lowest_marker.get("show_lowest_balance_marker")
                    else None
                ),
                "lowest_projected_balance_date": (
                    lowest_marker["lowest_projected_balance_date"]
                    if lowest_marker.get("show_lowest_balance_marker")
                    else None
                ),
                "amount_needed_to_zero": lowest_marker["amount_needed_to_zero"],
                "amount_needed_to_buffer": lowest_marker["amount_needed_to_buffer"],
                "show_lowest_balance_marker": lowest_marker["show_lowest_balance_marker"],
                "credit_balance_warnings": credit_balance_warnings,
                "biggest_drivers": compute_biggest_drivers(events),
                "transactions": events,
                # Public alias for carry_forward "still negative?" checks.
                "account_balances": account_balance_map,
            }
        )
        d += timedelta(days=1)

    _bind_day_markers_to_canonical_events(days_out)
    carry_forward_lowest_markers(days_out)
    _annotate_first_account_shortfall_dates(days_out, today)
    attach_recovery_to_days(days_out, accounts_by_id=accounts_by_id)

    scenario_name = None
    if scenario_id:
        from timeline.models import Scenario

        sc = Scenario.objects.filter(pk=scenario_id).first()
        scenario_name = sc.name if sc else None

    risky_accounts: list[dict[str, Any]] = []
    if account_id is None and cash_ids:
        from accounts.services.available_to_spend import _risk_status
        from transactions.services.reconciliation import ledger_today_balance_before_pending

        forecast_end = today + timedelta(days=resolved_forecast_days)
        for aid in cash_ids:
            acc = accounts_by_id.get(aid)
            if not acc:
                continue
            metrics = forecast_account_balance_metrics(
                forecast_ledger_rows,
                account_id=aid,
                today=today,
                end_date=forecast_end,
                minimum_buffer=_decimal(acc.minimum_buffer or 0),
            )
            lowest = metrics["lowest"]
            lowest_date = metrics["lowest_date"]
            minimum_buffer = _decimal(acc.minimum_buffer or 0)
            current_balance = ledger_today_balance_before_pending(acc, today)
            available = lowest - minimum_buffer
            status = _risk_status(lowest, available, minimum_buffer, current_balance)
            if status in (RISK_STATUS_CRITICAL, RISK_STATUS_RISK):
                risk_date = metrics["first_negative_date"] if status == RISK_STATUS_CRITICAL else (
                    metrics["first_below_buffer_date"] or lowest_date
                )
                risky_accounts.append(
                    {
                        "account_id": aid,
                        "account_name": acc.effective_display_name,
                        "lowest_projected_balance": str(
                            _decimal(lowest).quantize(Decimal("0.01"))
                        ),
                        "risk_date": risk_date.isoformat() if risk_date is not None else None,
                        "risk_status": status,
                    }
                )
        risky_accounts.sort(
            key=lambda x: (
                0 if x.get("risk_status") == RISK_STATUS_CRITICAL else 1,
                x.get("risk_date") or "9999-12-31",
            )
        )
        risky_accounts = risky_accounts[:3]

    # Prefer canonical ATS/Home risk date from forecast metrics (same source as Home).
    # Fall back to first day-loop presentation risk only when no risky_accounts (e.g. account filter).
    if risky_accounts and risky_accounts[0].get("risk_date"):
        next_risk_date = risky_accounts[0]["risk_date"]

    return {
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "scenario_id": scenario_id,
        "scenario_name": scenario_name,
        "account_id": account_id,
        "summary": {
            "lowest_balance": str(global_lowest.quantize(Decimal("0.01"))) if global_lowest is not None else None,
            "lowest_balance_date": global_lowest_date,
            "next_risk_date": next_risk_date,
            "best_balance": str(best_balance.quantize(Decimal("0.01"))) if best_balance is not None else None,
            "best_balance_date": best_date,
            "total_income": str(total_income.quantize(Decimal("0.01"))),
            "total_expenses": str(total_expenses.quantize(Decimal("0.01"))),
            "total_net": str((total_income - total_expenses).quantize(Decimal("0.01"))),
            "risky_accounts": risky_accounts,
            "safe_until": _compute_safe_until(days_out, today),
        },
        "days": days_out,
    }


_CALENDAR_DAY_REQUIRED = {
    "date",
    "income_total",
    "expense_total",
    "transfer_total",
    "net_total",
    "ending_balance",
    "lowest_balance",
    "presentation_status",
    "risk_level",
    "has_risk",
    "heat_level",
    "transactions",
}


def public_calendar_day(day: dict[str, Any]) -> dict[str, Any]:
    """Drop internal continuation fields and empty optional metadata before sending a day."""
    out: dict[str, Any] = {}
    for key, value in day.items():
        if str(key).startswith("_"):
            continue
        if key not in _CALENDAR_DAY_REQUIRED and (
            value is None or value == [] or value == ""
        ):
            continue
        out[key] = value
    out.setdefault("transactions", [])
    return out


def public_calendar_payload(full: dict[str, Any]) -> dict[str, Any]:
    return {
        **{key: value for key, value in full.items() if key != "days"},
        "days": [public_calendar_day(day) for day in full.get("days") or []],
    }


def calendar_summary_payload(full: dict[str, Any]) -> dict[str, Any]:
    """Summary cards only — no detailed day cells."""
    return {
        "start_date": full["start_date"],
        "end_date": full["end_date"],
        "scenario_id": full.get("scenario_id"),
        "scenario_name": full.get("scenario_name"),
        "account_id": full.get("account_id"),
        "summary": full.get("summary") or {},
    }


def calendar_chunk_payload(
    full: dict[str, Any],
    chunk_start: date,
    chunk_end: date,
) -> dict[str, Any]:
    """Slice canonical days for one month chunk, with ending continuation state."""
    start_iso = chunk_start.isoformat()
    end_iso = chunk_end.isoformat()
    days: list[dict[str, Any]] = []
    last_balances: dict[str, str] = {}
    last_date = end_iso
    for day in full.get("days") or []:
        day_iso = day.get("date") or ""
        if day_iso < start_iso or day_iso > end_iso:
            continue
        last_balances = day.get("_account_balances") or {}
        last_date = day_iso
        days.append(public_calendar_day(day))
    return {
        "start_date": start_iso,
        "end_date": end_iso,
        "range_start": full["start_date"],
        "range_end": full["end_date"],
        "scenario_id": full.get("scenario_id"),
        "scenario_name": full.get("scenario_name"),
        "account_id": full.get("account_id"),
        "days": days,
        "continuation": {
            "end_date": last_date,
            "balances_by_account": last_balances,
        },
    }


def _compute_safe_until(days_out: list[dict[str, Any]], today: date) -> dict[str, Any] | None:
    """Cash remaining after obligations until the next projected income (matches frontend)."""
    if not days_out:
        return None
    today_iso = today.isoformat()
    today_day = next((day for day in days_out if day.get("date") == today_iso), None)
    anchor = today_day or days_out[0]
    current_balance = _decimal(anchor.get("ending_balance")) - _decimal(anchor.get("net_total"))
    next_income_date = None
    for day in days_out:
        if (day.get("date") or "") < today_iso:
            continue
        has_income_txn = any(
            _decimal(txn.get("amount")) > 0 and not txn.get("is_transfer")
            for txn in day.get("transactions") or []
        )
        if _decimal(day.get("income_total")) > 0 or has_income_txn:
            next_income_date = day.get("date")
            break
    obligations = Decimal("0")
    running = current_balance
    unsafe_date = None
    for day in days_out:
        day_iso = day.get("date") or ""
        if day_iso < today_iso:
            continue
        if next_income_date and day_iso >= next_income_date:
            break
        outflow = max(Decimal("0"), _decimal(day.get("expense_total")))
        obligations += outflow
        running -= outflow
        if unsafe_date is None and running < 0:
            unsafe_date = day_iso
    return {
        "next_income_date": next_income_date,
        "safe_amount": str((current_balance - obligations).quantize(Decimal("0.01"))),
        "unsafe_date": unsafe_date,
        "obligations_before_income": str(obligations.quantize(Decimal("0.01"))),
        "current_balance": str(current_balance.quantize(Decimal("0.01"))),
    }
