"""Base vs scenario comparison metrics for the what-if sandbox."""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from typing import Any, Optional

from django.utils import timezone

from accounts.models import Account
from accounts.services.available_to_spend import (
    account_supports_available_to_spend,
    calculate_forecast_summaries_for_accounts,
    dashboard_safe_to_spend_aggregate,
)
from accounts.services.balances import compute_net_worth
from core.utils import get_households_for_user
from timeline.models import (
    RecurringRule,
    Scenario,
    ScenarioCategoryShock,
    ScenarioOneTimeEvent,
    ScenarioRuleOverride,
    ScenarioAddedRecurring,
)
from timeline.services.calendar import build_timeline_calendar
from timeline.services.ledger import (
    build_timeline,
    dedupe_future_rule_occurrence_rows,
    forecast_lowest_balance_from_rows,
    is_superseded_planned_row,
)
from timeline.services.scenario_timeline import build_scenario_timeline_from_base


def _horizon_to_end(today: date, horizon: str) -> date:
    if horizon == "14d":
        return today + timedelta(days=14)
    if horizon == "3m":
        return today + timedelta(days=90)
    if horizon == "6m":
        return today + timedelta(days=180)
    if horizon == "12m":
        return today + timedelta(days=365)
    if horizon == "18m":
        return today + timedelta(days=548)
    if horizon == "24m":
        return today + timedelta(days=730)
    if horizon == "36m":
        return today + timedelta(days=1095)
    return today + timedelta(days=180)


def _decimal(val) -> Decimal:
    if val is None:
        return Decimal("0")
    if isinstance(val, Decimal):
        return val
    return Decimal(str(val))


def _cash_account_ids(accounts: list[Account]) -> set[int]:
    return {
        a.id
        for a in accounts
        if a.participates_in_forecast() and account_supports_available_to_spend(a)
    }


def _affected_accounts_from_scenario(
    scenario: Scenario,
    accounts_by_id: dict[int, Account],
) -> tuple[set[int], set[int], set[int]]:
    """Return (all_affected, cash_affected, credit_affected) account ids."""
    all_affected: set[int] = set()
    cash_affected: set[int] = set()
    credit_affected: set[int] = set()

    def _classify(aid: int | None) -> None:
        if aid is None:
            return
        all_affected.add(aid)
        acc = accounts_by_id.get(aid)
        if not acc:
            return
        if acc.account_type == Account.AccountType.CREDIT:
            credit_affected.add(aid)
        elif account_supports_available_to_spend(acc):
            cash_affected.add(aid)

    for ov in ScenarioRuleOverride.objects.filter(scenario=scenario).select_related(
        "rule", "rule__account", "override_account"
    ):
        rule = ov.rule
        _classify(ov.override_account_id or rule.account_id)
        if rule.transfer_to_account_id:
            _classify(rule.transfer_to_account_id)
            # Transfer rules: the source account pays — only cash-affected if amount/active changed.
            if ov.override_amount is not None or ov.override_active is not None:
                _classify(rule.account_id)

    for ev in ScenarioOneTimeEvent.objects.filter(scenario=scenario).select_related(
        "account", "transfer_to_account"
    ):
        _classify(ev.account_id)
        if ev.transfer_to_account_id:
            _classify(ev.transfer_to_account_id)

    for added in ScenarioAddedRecurring.objects.filter(scenario=scenario).select_related(
        "account", "transfer_to_account"
    ):
        _classify(added.account_id)
        if added.transfer_to_account_id:
            _classify(added.transfer_to_account_id)

    if ScenarioCategoryShock.objects.filter(scenario=scenario).exists():
        for aid, acc in accounts_by_id.items():
            if account_supports_available_to_spend(acc):
                cash_affected.add(aid)

    return all_affected, cash_affected, credit_affected


def _lowest_cash_balances(
    rows: list[dict],
    cash_ids: set[int],
    today: date,
    end_date: date,
    track_ids: set[int] | None = None,
) -> tuple[Decimal | None, date | None, int | None]:
    """Lowest future balance — same walk as Transactions ledger / timeline calendar."""
    if not cash_ids:
        return None, None, None
    track = track_ids if track_ids else cash_ids
    return forecast_lowest_balance_from_rows(
        rows, account_ids=track, today=today, end_date=end_date
    )


def _first_problem_date_from_calendar(
    calendar: dict[str, Any],
    today: date,
) -> str | None:
    """First day cash dips negative ahead — not the lowest-balance date."""
    day = _first_negative_day(calendar, today)
    if day:
        return day.get("date")
    summary = calendar.get("summary") or {}
    risk = summary.get("next_risk_date")
    return str(risk) if risk else None


def _affected_rule_ids(scenario: Scenario) -> set[int]:
    return set(
        ScenarioRuleOverride.objects.filter(scenario=scenario).values_list("rule_id", flat=True)
    )


def _compute_traceable_credit_charge_delta(
    forecast_changes: list[dict[str, Any]],
    forecast_change_groups: list[dict[str, Any]],
    scenario: Scenario,
    credit_affected: set[int],
) -> dict[str, Any]:
    """
    Sum subscription/bill deltas on credit accounts from user-edited rules only.
    Excludes interest and aggregate ending-balance effects so the UI math matches
    (per-occurrence delta × occurrence count).
    """
    affected_rules = _affected_rule_ids(scenario)
    total = Decimal("0")
    occurrence_count = 0
    per_occurrence = Decimal("0")
    event_label: str | None = None
    account_name: str | None = None

    for group in forecast_change_groups:
        rid = group.get("rule_id")
        aid = group.get("account_id")
        if rid is None or rid not in affected_rules:
            continue
        if aid not in credit_affected:
            continue
        delta = _decimal(group.get("total_delta"))
        if delta >= 0:
            continue
        total += abs(delta)
        occurrence_count += int(group.get("occurrence_count") or 0)
        per_occurrence = abs(_decimal(group.get("delta_per_occurrence")))
        event_label = group.get("event")
        account_name = group.get("account_name")

    for change in forecast_changes:
        if change.get("rule_id") is not None:
            continue
        if (change.get("source") or "") == "interest":
            continue
        aid = change.get("account_id")
        if aid not in credit_affected:
            continue
        if change.get("source") != "scenario_event":
            continue
        delta = _decimal(change.get("delta"))
        if delta >= 0:
            continue
        total += abs(delta)
        occurrence_count += 1
        if per_occurrence == 0:
            per_occurrence = abs(delta)
        event_label = event_label or change.get("event")
        account_name = account_name or change.get("account_name")

    return {
        "traceable_credit_charge_delta": _amount_str(total) if total > 0 else None,
        "traceable_occurrence_count": occurrence_count if occurrence_count > 0 else None,
        "traceable_per_occurrence": _amount_str(per_occurrence) if per_occurrence > 0 else None,
        "traceable_event": event_label,
        "traceable_account_name": account_name,
    }


def _amount_str(val) -> str:
    return str(_decimal(val).quantize(Decimal("0.01")))


def _ending_cash(
    rows: list[dict],
    accounts: list[Account],
    scope_account_ids: set[int] | None = None,
) -> Decimal:
    cash_ids = {
        a.id
        for a in accounts
        if a.participates_in_forecast()
        and getattr(a, "account_type", None) in (
            Account.AccountType.CHECKING,
            Account.AccountType.SAVINGS,
            Account.AccountType.CASH,
        )
    }
    if scope_account_ids:
        cash_ids &= scope_account_ids
    last_by_account: dict[int, Decimal] = {}
    for r in rows:
        aid = r.get("account_id")
        if aid in cash_ids:
            last_by_account[aid] = _decimal(r.get("running_balance"))
    return sum(last_by_account.values(), Decimal("0"))


def _account_type_balance(rows: list[dict], account_type: str) -> Decimal:
    last: dict[int, Decimal] = {}
    for r in rows:
        aid = r.get("account_id")
        acc_type = (r.get("account_type") or "").upper()
        if acc_type == account_type.upper():
            last[aid] = _decimal(r.get("running_balance"))
    return sum(last.values(), Decimal("0"))


def _enrich_rows_with_account_type(rows: list[dict], accounts_by_id: dict[int, Account]) -> list[dict]:
    out = []
    for r in rows:
        row = dict(r)
        acc = accounts_by_id.get(row.get("account_id"))
        if acc:
            row["account_type"] = acc.account_type
        out.append(row)
    return out


def _ending_credit_owed_on_account(rows: list[dict], account_id: int) -> Decimal | None:
    """Balance owed at end of projected rows (credit running_balance ≤ 0)."""
    for r in reversed(rows):
        if r.get("account_id") == account_id:
            bal = _decimal(r.get("running_balance"))
            return abs(min(bal, Decimal("0")))
    return None


def _credit_utilization_at_horizon(
    base_rows: list[dict],
    scenario_rows: list[dict],
    accounts: list[Account],
) -> list[dict[str, Any]]:
    """Per-card utilization at end of the comparison horizon (base vs scenario)."""
    out: list[dict[str, Any]] = []
    for acc in accounts:
        if acc.account_type != Account.AccountType.CREDIT:
            continue
        limit = _decimal(acc.credit_limit or 0)
        if limit <= 0:
            continue
        base_owed = _ending_credit_owed_on_account(base_rows, acc.id) or Decimal("0")
        scenario_owed = _ending_credit_owed_on_account(scenario_rows, acc.id) or Decimal("0")
        if abs(base_owed - scenario_owed) < Decimal("0.01"):
            continue
        base_util = (base_owed / limit * Decimal("100")).quantize(Decimal("0.1"))
        scenario_util = (scenario_owed / limit * Decimal("100")).quantize(Decimal("0.1"))
        out.append(
            {
                "account_id": acc.id,
                "account_name": acc.name,
                "base_balance_owed": str(base_owed.quantize(Decimal("0.01"))),
                "scenario_balance_owed": str(scenario_owed.quantize(Decimal("0.01"))),
                "base_utilization_percent": str(base_util),
                "scenario_utilization_percent": str(scenario_util),
            }
        )
    out.sort(key=lambda x: x["account_name"])
    return out


def _metrics_from_calendar(
    calendar: dict[str, Any],
    rows: list[dict],
    accounts: list[Account],
    user,
    today: date,
    end_date: date,
) -> dict[str, Any]:
    summary = calendar.get("summary") or {}
    accounts_by_id = {a.id: a for a in accounts}
    enriched = _enrich_rows_with_account_type(rows, accounts_by_id)

    forecast_accounts = [a for a in accounts if a.participates_in_forecast()]
    horizon_days = max((end_date - today).days, 7)
    forecasts = calculate_forecast_summaries_for_accounts(
        user, forecast_accounts, as_of_date=today, days=min(horizon_days, 90)
    )
    sts = dashboard_safe_to_spend_aggregate(forecasts, accounts_by_id)

    risk_days, first_risk_date, last_risk_date = _risk_date_span(calendar, today)

    credit_debt = Decimal("0")
    savings = Decimal("0")
    for a in accounts:
        bal = None
        for r in reversed(enriched):
            if r.get("account_id") == a.id:
                bal = _decimal(r.get("running_balance"))
                break
        if bal is None:
            continue
        if a.account_type == Account.AccountType.CREDIT:
            credit_debt += abs(min(bal, Decimal("0")))
        elif a.account_type == Account.AccountType.SAVINGS:
            savings += max(bal, Decimal("0"))

    net_worth_accounts = list(
        Account.objects.for_net_worth().filter(
            pk__in=[a.id for a in accounts], is_hidden=False
        )
    )
    net_worth = compute_net_worth(net_worth_accounts, end_date)

    transfer_total = _decimal(summary.get("total_transfers") if "total_transfers" in summary else None)
    if transfer_total == 0:
        transfer_total = sum(
            _decimal(d.get("transfer_total"))
            for d in calendar.get("days") or []
        )

    return {
        "ending_cash": str(_ending_cash(enriched, accounts).quantize(Decimal("0.01"))),
        "lowest_projected_balance": summary.get("lowest_balance"),
        "lowest_projected_balance_date": summary.get("lowest_balance_date"),
        "safe_to_spend": sts.get("total_safe_to_spend"),
        "total_income": summary.get("total_income"),
        "total_expenses": summary.get("total_expenses"),
        "total_transfers": str(transfer_total.quantize(Decimal("0.01"))),
        "credit_debt_after_horizon": str(credit_debt.quantize(Decimal("0.01"))),
        "savings_after_horizon": str(savings.quantize(Decimal("0.01"))),
        "net_worth_after_horizon": str(net_worth.quantize(Decimal("0.01"))),
        "risk_days": risk_days,
        "first_risk_date": first_risk_date or summary.get("next_risk_date"),
        "last_risk_date": last_risk_date,
    }


def _risk_date_span(
    calendar: dict[str, Any],
    today: date,
) -> tuple[int, str | None, str | None]:
    """Count has_risk days from today onward; return (count, first_date, last_date)."""
    first: str | None = None
    last: str | None = None
    count = 0
    for day in calendar.get("days") or []:
        if not day.get("has_risk"):
            continue
        d_iso = day.get("date")
        if not d_iso:
            continue
        rd = _parse_row_date(d_iso)
        if rd is None or rd < today:
            continue
        date_str = d_iso if isinstance(d_iso, str) else rd.isoformat()
        count += 1
        if first is None:
            first = date_str
        last = date_str
    return count, first, last


NON_NUMERIC_METRICS = frozenset({
    "first_risk_date",
    "last_risk_date",
    "lowest_projected_balance_date",
})


def _parse_row_date(val) -> date | None:
    if val is None:
        return None
    if isinstance(val, date):
        return val
    try:
        return date.fromisoformat(str(val)[:10])
    except ValueError:
        return None


def _forecast_row_key(row: dict) -> tuple:
    rd = _parse_row_date(row.get("date"))
    aid = row.get("account_id")
    txn_id = row.get("transaction_id")
    rule_id = row.get("rule_id")
    source = row.get("source") or ""
    desc = (row.get("description") or "").strip()
    if txn_id is not None:
        return ("txn", int(txn_id), aid)
    if rule_id is not None:
        return ("rule", int(rule_id), rd, aid)
    if source == "scenario_event":
        return ("scenario_event", rd, aid, desc)
    return ("other", rd, aid, desc, source)


def _effect_kind_for_row(row: dict, accounts_by_id: dict[int, Account]) -> str:
    aid = row.get("account_id")
    acc = accounts_by_id.get(aid) if aid else None
    if not acc:
        return "cash_flow"
    if acc.is_credit_card():
        return "debt"
    if acc.account_type == Account.AccountType.SAVINGS:
        return "savings"
    category = (row.get("category_name") or "").lower()
    if "transfer" in category or row.get("type") == "TRANSFER":
        return "transfer_only"
    return "cash_flow"


def _future_forecast_rows(rows: list[dict], today: date) -> list[dict]:
    """Future-only rows, excluding superseded planned duplicates."""
    by_account: dict[int, list[dict]] = {}
    for r in rows:
        aid = r.get("account_id")
        if aid is not None:
            by_account.setdefault(aid, []).append(r)

    out: list[dict] = []
    for r in rows:
        rd = _parse_row_date(r.get("date"))
        if rd is None or rd < today:
            continue
        aid = r.get("account_id")
        account_rows = by_account.get(aid, []) if aid else []
        if aid and is_superseded_planned_row(r, account_rows):
            continue
        out.append(r)
    return out


def _index_rows_by_key(rows: list[dict]) -> dict[tuple, dict]:
    indexed: dict[tuple, dict] = {}
    for row in rows:
        key = _forecast_row_key(row)
        indexed[key] = row
    return indexed


def _compute_forecast_changes(
    base_rows: list[dict],
    scenario_rows: list[dict],
    accounts: list[Account],
    today: date,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    accounts_by_id = {a.id: a for a in accounts}
    base_index = _index_rows_by_key(_future_forecast_rows(base_rows, today))
    scenario_index = _index_rows_by_key(_future_forecast_rows(scenario_rows, today))
    all_keys = set(base_index) | set(scenario_index)

    changes: list[dict[str, Any]] = []
    for key in sorted(all_keys, key=lambda k: (str(k[1]) if len(k) > 1 else "", str(k))):
        base_row = base_index.get(key)
        scenario_row = scenario_index.get(key)
        base_amt = _decimal(base_row.get("amount")) if base_row else Decimal("0")
        scenario_amt = _decimal(scenario_row.get("amount")) if scenario_row else Decimal("0")
        if base_amt == scenario_amt:
            continue

        ref = scenario_row or base_row
        if not ref:
            continue
        rd = _parse_row_date(ref.get("date"))
        rule_id = ref.get("rule_id")
        changes.append(
            {
                "date": rd.isoformat() if rd else None,
                "account_id": ref.get("account_id"),
                "account_name": ref.get("account_name") or "",
                "event": (ref.get("description") or "—").strip(),
                "base_amount": _amount_str(base_amt),
                "scenario_amount": _amount_str(scenario_amt),
                "delta": _amount_str(scenario_amt - base_amt),
                "effect_kind": _effect_kind_for_row(ref, accounts_by_id),
                "rule_id": rule_id,
                "is_recurring": rule_id is not None,
                "source": ref.get("source"),
            }
        )

    rule_ids = {c["rule_id"] for c in changes if c.get("rule_id") is not None}
    rule_meta: dict[int, RecurringRule] = {}
    if rule_ids:
        rule_meta = {r.id: r for r in RecurringRule.objects.filter(pk__in=rule_ids)}

    groups_by_rule: dict[int, list[dict]] = {}
    standalone: list[dict] = []
    for ch in changes:
        rid = ch.get("rule_id")
        if rid is not None:
            groups_by_rule.setdefault(rid, []).append(ch)
        else:
            standalone.append(ch)

    groups: list[dict[str, Any]] = []
    for rid, items in groups_by_rule.items():
        items.sort(key=lambda x: x.get("date") or "")
        deltas = [_decimal(i["delta"]) for i in items]
        per_occurrence = deltas[0] if deltas else Decimal("0")
        if len(set(deltas)) == 1:
            per_occurrence = deltas[0]
        else:
            per_occurrence = sum(deltas, Decimal("0")) / len(deltas)
        total_delta = sum(deltas, Decimal("0"))
        first = items[0]
        rule = rule_meta.get(rid)
        freq_label = "monthly"
        if rule:
            freq = rule.frequency
            if freq in (RecurringRule.Frequency.WEEKLY,):
                freq_label = "weekly"
            elif freq in (RecurringRule.Frequency.BIWEEKLY,):
                freq_label = "biweekly"
            elif freq in (RecurringRule.Frequency.YEARLY,):
                freq_label = "yearly"
        groups.append(
            {
                "event": first.get("event"),
                "account_id": first.get("account_id"),
                "account_name": first.get("account_name"),
                "rule_id": rid,
                "frequency": freq_label,
                "occurrence_count": len(items),
                "delta_per_occurrence": _amount_str(per_occurrence),
                "total_delta": _amount_str(total_delta),
                "first_date": first.get("date"),
                "effect_kind": first.get("effect_kind"),
                "base_amount": first.get("base_amount"),
                "scenario_amount": first.get("scenario_amount"),
            }
        )

    for ch in standalone:
        groups.append(
            {
                "event": ch.get("event"),
                "account_id": ch.get("account_id"),
                "account_name": ch.get("account_name"),
                "rule_id": None,
                "frequency": "one_time",
                "occurrence_count": 1,
                "delta_per_occurrence": ch.get("delta"),
                "total_delta": ch.get("delta"),
                "first_date": ch.get("date"),
                "effect_kind": ch.get("effect_kind"),
                "base_amount": ch.get("base_amount"),
                "scenario_amount": ch.get("scenario_amount"),
            }
        )

    groups.sort(key=lambda g: g.get("first_date") or "")
    changes.sort(key=lambda c: (c.get("date") or "", c.get("event") or ""))
    return changes, groups


def _day_on_or_after(calendar: dict[str, Any], target: str | None) -> dict[str, Any] | None:
    if not target:
        return None
    for day in calendar.get("days") or []:
        if day.get("date") == target:
            return day
    return None


def _first_negative_day(calendar: dict[str, Any], today: date) -> dict[str, Any] | None:
    for day in calendar.get("days") or []:
        d_iso = day.get("date")
        if not d_iso:
            continue
        rd = _parse_row_date(d_iso)
        if rd is None or rd < today:
            continue
        ending = _decimal(day.get("ending_balance"))
        lowest = _decimal(day.get("lowest_balance"))
        # Skip days that end in the black — matches what you see on the Transactions ledger.
        if ending >= 0 and lowest >= 0:
            continue
        if day.get("is_negative") or lowest < 0:
            return day
    return None


def _compute_risk_explanation(
    base_calendar: dict[str, Any],
    scenario_calendar: dict[str, Any],
    base_rows: list[dict],
    scenario_rows: list[dict],
    scenario: Scenario,
    accounts: list[Account],
    today: date,
    end_date: date,
) -> dict[str, Any]:
    accounts_by_id = {a.id: a for a in accounts}
    cash_ids = _cash_account_ids(accounts)
    _, cash_affected, credit_affected = _affected_accounts_from_scenario(scenario, accounts_by_id)

    credit_only = bool(credit_affected) and not cash_affected

    base_low, base_low_date, base_low_aid = _lowest_cash_balances(
        base_rows, cash_ids, today, end_date
    )
    scenario_low, scenario_low_date, scenario_low_aid = _lowest_cash_balances(
        scenario_rows, cash_ids, today, end_date
    )

    if cash_affected:
        track = cash_affected
        base_low, base_low_date, base_low_aid = _lowest_cash_balances(
            base_rows, cash_ids, today, end_date, track
        )
        scenario_low, scenario_low_date, scenario_low_aid = _lowest_cash_balances(
            scenario_rows, cash_ids, today, end_date, track
        )
    else:
        track = None

    base_first_problem_date = _first_problem_date_from_calendar(base_calendar, today)
    scenario_first_problem_date = _first_problem_date_from_calendar(scenario_calendar, today)

    base_low_num = base_low if base_low is not None else Decimal("0")
    scenario_low_num = scenario_low if scenario_low is not None else Decimal("0")
    cash_low_delta = abs(scenario_low_num - base_low_num)

    if credit_only and cash_low_delta <= Decimal("0.01"):
        impact_scope = "credit_only"
        is_risky = False
        first_problem_day = None
        trigger_account_id = None
        trigger_account_name = None
        triggering_event = None
        shortfall = Decimal("0")
        amount_needed = Decimal("0")
    else:
        impact_scope = "credit_only" if credit_only else ("mixed" if credit_affected else "cash")
        # Risky only when this change makes cash worse — not when the plan still dips below
        # zero but improves (e.g. canceling a bill while already running tight).
        new_cash_overdraft = scenario_low_num < 0 and base_low_num >= 0
        worsened_low = scenario_low_num < base_low_num - Decimal("0.005")
        is_risky = new_cash_overdraft or worsened_low
        # More income / lower expenses must not flag as risky when cash low point improved.
        if scenario_low_num >= base_low_num - Decimal("0.005"):
            is_risky = False

        first_problem_day = _first_negative_day(scenario_calendar, today)
        if first_problem_day is None and (scenario_calendar.get("summary") or {}).get("next_risk_date"):
            first_problem_day = _day_on_or_after(
                scenario_calendar, (scenario_calendar.get("summary") or {}).get("next_risk_date")
            )

        if credit_only and not is_risky:
            first_problem_day = None

        scenario_summary = scenario_calendar.get("summary") or {}
        lowest_day = _day_on_or_after(scenario_calendar, scenario_low_date.isoformat() if scenario_low_date else None)
        trigger_day = lowest_day or first_problem_day

        shortfall = Decimal("0")
        if scenario_low_num < 0:
            shortfall = abs(scenario_low_num)

        amount_needed = shortfall
        if trigger_day and trigger_day.get("amount_needed_to_zero"):
            amount_needed = max(amount_needed, _decimal(trigger_day.get("amount_needed_to_zero")))

        triggering_event = None
        trigger_account_id = scenario_low_aid
        trigger_account_name = (
            accounts_by_id[scenario_low_aid].effective_display_name
            if scenario_low_aid and scenario_low_aid in accounts_by_id
            else None
        )
        if trigger_day:
            triggering_event = trigger_day.get("lowest_projected_balance_after_description")
            day_aid = trigger_day.get("lowest_projected_balance_account_id")
            day_name = trigger_day.get("lowest_projected_balance_account_name")
            if day_aid:
                trigger_account_id = day_aid
            if day_name:
                trigger_account_name = day_name
            if not triggering_event and first_problem_day:
                txs = first_problem_day.get("transactions") or []
                for txn in txs:
                    bal_after = txn.get("balance_after")
                    if bal_after is not None and _decimal(bal_after) < 0:
                        triggering_event = txn.get("description")
                        trigger_account_id = txn.get("account_id")
                        trigger_account_name = txn.get("account_name")
                        break

        if credit_only and not is_risky:
            triggering_event = None

        if not is_risky:
            first_problem_day = None

    first_problem_date = (
        first_problem_day.get("date") if first_problem_day else None
    )
    if credit_only and not is_risky:
        first_problem_date = None
    if not is_risky:
        first_problem_date = None

    return {
        "is_risky": bool(is_risky),
        "impact_scope": impact_scope,
        "cash_lowest_unchanged": credit_only and cash_low_delta <= Decimal("0.01"),
        "first_problem_date": first_problem_date,
        "base_first_problem_date": base_first_problem_date,
        "scenario_first_problem_date": scenario_first_problem_date,
        "first_problem_account_id": trigger_account_id if is_risky else None,
        "first_problem_account_name": trigger_account_name if is_risky else None,
        "triggering_event": triggering_event if is_risky else None,
        "base_lowest_balance": _amount_str(base_low) if base_low is not None else None,
        "base_lowest_balance_date": base_low_date.isoformat() if base_low_date else None,
        "scenario_lowest_balance": _amount_str(scenario_low) if scenario_low is not None else None,
        "scenario_lowest_balance_date": scenario_low_date.isoformat() if scenario_low_date else None,
        "shortfall_amount": _amount_str(shortfall) if shortfall > 0 else None,
        "amount_needed_to_stay_safe": _amount_str(amount_needed) if amount_needed > 0 else None,
    }


def _delta(base_val, scenario_val, key: str) -> Optional[str]:
    if key in NON_NUMERIC_METRICS:
        return None
    if base_val is None and scenario_val is None:
        return None
    try:
        b = _decimal(base_val)
        s = _decimal(scenario_val)
    except Exception:
        return None
    return str((s - b).quantize(Decimal("0.01")))


def build_scenario_comparison(
    user,
    scenario_id: int,
    *,
    horizon: str = "12m",
    household_id: Optional[int] = None,
    as_of_date: Optional[date] = None,
) -> dict[str, Any]:
    today = as_of_date or timezone.localdate()
    end_date = _horizon_to_end(today, horizon)
    households = get_households_for_user(user)
    if household_id:
        households = households.filter(pk=household_id)
    scenario = Scenario.objects.filter(household__in=households, pk=scenario_id).first()
    if not scenario:
        raise ValueError("Scenario not found")

    accounts = list(
        Account.objects.filter(household_id=scenario.household_id, is_hidden=False).order_by("name")
    )
    accounts_by_id = {a.id: a for a in accounts}
    _, cash_affected, _ = _affected_accounts_from_scenario(scenario, accounts_by_id)
    # Scope calendar to the one cash account this plan touches (matches Transactions ledger view).
    calendar_account_id = next(iter(cash_affected)) if len(cash_affected) == 1 else None

    forecastable_ids = {a.id for a in accounts if a.participates_in_forecast()}

    # Base = real forecast ledger (same as Transactions). Scenario = patch that ledger.
    base_rows = build_timeline(
        user,
        start_date=today,
        end_date=end_date,
        scenario_id=None,
        household_id=household_id or scenario.household_id,
        as_of_date=today,
        projection_only=False,
    )
    base_rows = dedupe_future_rule_occurrence_rows(base_rows, today)

    scenario_rows = build_scenario_timeline_from_base(
        base_rows,
        scenario,
        today=today,
        end_date=end_date,
        forecastable_account_ids=forecastable_ids,
    )

    base_calendar = build_timeline_calendar(
        user,
        start_date=today,
        end_date=end_date,
        scenario_id=None,
        account_id=calendar_account_id,
        household_id=household_id or scenario.household_id,
        as_of_date=today,
        timeline_rows=base_rows,
    )
    scenario_calendar = build_timeline_calendar(
        user,
        start_date=today,
        end_date=end_date,
        scenario_id=None,
        account_id=calendar_account_id,
        household_id=household_id or scenario.household_id,
        as_of_date=today,
        timeline_rows=scenario_rows,
    )

    base_m = _metrics_from_calendar(base_calendar, base_rows, accounts, user, today, end_date)
    scenario_m = _metrics_from_calendar(scenario_calendar, scenario_rows, accounts, user, today, end_date)

    ending_scope = cash_affected if cash_affected else None
    base_m["ending_cash"] = str(
        _ending_cash(base_rows, accounts, ending_scope).quantize(Decimal("0.01"))
    )
    scenario_m["ending_cash"] = str(
        _ending_cash(scenario_rows, accounts, ending_scope).quantize(Decimal("0.01"))
    )

    metric_keys = list(base_m.keys())
    comparison: dict[str, Any] = {}
    for key in metric_keys:
        comparison[key] = {
            "base": base_m[key],
            "scenario": scenario_m[key],
            "delta": _delta(base_m[key], scenario_m[key], key),
        }

    verdict = _build_verdict(comparison)
    forecast_changes, forecast_change_groups = _compute_forecast_changes(
        base_rows, scenario_rows, accounts, today
    )
    risk_explanation = _compute_risk_explanation(
        base_calendar,
        scenario_calendar,
        base_rows,
        scenario_rows,
        scenario,
        accounts,
        today,
        end_date,
    )
    _, _, credit_affected = _affected_accounts_from_scenario(
        scenario, {a.id: a for a in accounts}
    )
    risk_explanation.update(
        _compute_traceable_credit_charge_delta(
            forecast_changes,
            forecast_change_groups,
            scenario,
            credit_affected,
        )
    )

    if forecast_changes and all(_decimal(c.get("delta") or 0) >= 0 for c in forecast_changes):
        scenario_low_val = _decimal(
            risk_explanation.get("scenario_lowest_balance")
            or scenario_m.get("lowest_projected_balance")
            or 0
        )
        base_low_val = _decimal(
            risk_explanation.get("base_lowest_balance") or base_m.get("lowest_projected_balance") or 0
        )
        if scenario_low_val >= base_low_val - Decimal("0.01"):
            risk_explanation["is_risky"] = False
            risk_explanation["first_problem_date"] = None

    credit_utilization_at_horizon = _credit_utilization_at_horizon(
        base_rows, scenario_rows, accounts
    )

    return {
        "scenario_id": scenario_id,
        "scenario_name": scenario.name,
        "horizon": horizon,
        "start_date": today.isoformat(),
        "end_date": end_date.isoformat(),
        "metrics": comparison,
        "summary": verdict,
        "forecast_changes": forecast_changes,
        "forecast_change_groups": forecast_change_groups,
        "risk_explanation": risk_explanation,
        "credit_utilization_at_horizon": credit_utilization_at_horizon,
    }


def _build_verdict(comparison: dict[str, Any]) -> dict[str, Any]:
    ending_delta = _decimal(comparison.get("ending_cash", {}).get("delta"))
    risk_delta = int(_decimal(comparison.get("risk_days", {}).get("delta") or 0))
    debt_delta = _decimal(comparison.get("credit_debt_after_horizon", {}).get("delta"))

    if ending_delta > 0 and risk_delta <= 0:
        overall = "better"
    elif ending_delta < 0 or risk_delta > 0:
        overall = "worse" if risk_delta <= 0 else "riskier"
    else:
        overall = "neutral"

    messages: list[str] = []
    if risk_delta > 0:
        messages.append(
            f"This scenario creates {risk_delta} additional risk day{'s' if risk_delta != 1 else ''}."
        )
    elif risk_delta < 0:
        messages.append(
            f"This scenario removes {abs(risk_delta)} risk day{'s' if abs(risk_delta) != 1 else ''}."
        )
    if debt_delta < 0:
        messages.append(f"This scenario improves debt by {format(abs(debt_delta), ',.2f')}.")
    elif debt_delta > 0:
        messages.append(f"This scenario increases debt by {format(debt_delta, ',.2f')}.")

    return {"overall": overall, "messages": messages}


def evaluate_affordability(
    user,
    *,
    account_id: int,
    amount: Decimal,
    event_date: date,
    description: str = "What-if purchase",
    household_id: Optional[int] = None,
    horizon: str = "6m",
    as_of_date: Optional[date] = None,
) -> dict[str, Any]:
    """
    In-memory what-if: base timeline vs base + one-time expense on event_date.
    Does not persist anything.
    """
    from types import SimpleNamespace

    from timeline.models import ScenarioOneTimeEvent

    today = as_of_date or timezone.localdate()
    end_date = _horizon_to_end(today, horizon)
    amt = abs(_decimal(amount))

    base_calendar = build_timeline_calendar(
        user,
        start_date=today,
        end_date=end_date,
        account_id=account_id,
        household_id=household_id,
        as_of_date=today,
    )
    base_summary = base_calendar.get("summary") or {}
    base_lowest = _decimal(base_summary.get("lowest_balance"))

    ephemeral = SimpleNamespace(
        direction=ScenarioOneTimeEvent.Direction.EXPENSE,
        date=event_date,
        account_id=account_id,
        account=None,
        category=None,
        category_id=None,
        description=description,
        amount=amt,
        id=0,
    )

    whatif_rows = build_timeline(
        user,
        start_date=today,
        end_date=end_date,
        account_id=account_id,
        household_id=household_id,
        as_of_date=today,
        ephemeral_events=[ephemeral],
    )

    lowest = None
    lowest_date = None
    for r in whatif_rows:
        if r.get("account_id") != account_id:
            continue
        bal = _decimal(r.get("running_balance"))
        rd = r.get("date")
        if hasattr(rd, "isoformat") and not isinstance(rd, date):
            rd = date.fromisoformat(str(rd)[:10])
        if lowest is None or bal < lowest:
            lowest = bal
            lowest_date = rd.isoformat() if hasattr(rd, "isoformat") else str(rd)

    buffer = Decimal("0")
    can_afford = lowest is not None and lowest >= buffer

    households = get_households_for_user(user)
    accounts = list(Account.objects.filter(household__in=households, pk=account_id))
    forecast_accounts = [a for a in accounts if a.participates_in_forecast()]
    forecasts = calculate_forecast_summaries_for_accounts(
        user, forecast_accounts, as_of_date=today, days=min((end_date - today).days, 90)
    )
    accounts_by_id = {a.id: a for a in accounts}
    sts_after = dashboard_safe_to_spend_aggregate(forecasts, accounts_by_id)

    return {
        "affordable": can_afford,
        "lowest_projected_balance": str(lowest.quantize(Decimal("0.01"))) if lowest is not None else None,
        "lowest_projected_balance_date": lowest_date,
        "safe_to_spend_after": sts_after.get("total_safe_to_spend"),
        "base_lowest_projected_balance": str(base_lowest.quantize(Decimal("0.01"))),
        "amount": str(amt.quantize(Decimal("0.01"))),
        "date": event_date.isoformat(),
        "account_id": account_id,
        "description": description,
    }
