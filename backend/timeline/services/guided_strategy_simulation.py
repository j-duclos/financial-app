"""
Hypothetical Debt First vs. Save First overlay for What-If scenarios.

Runs in memory on a copy of the scenario timeline. Never creates or mutates
Transaction, RecurringRule, Transfer, or Account rows.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import ROUND_DOWN, ROUND_HALF_UP, Decimal
from typing import Any, Iterable

from accounts.models import Account
from accounts.services.balances import credit_owed_from_signed_balance
from common.services.profiler import perf_print
from credit_cards.services.debt_engine import DebtPrioritySnapshot, rank_debt_accounts_for_payoff
from credit_cards.services.payoff import _effective_apr
from timeline.models import ScenarioGuidedStrategy
from timeline.services.ledger import (
    _interest_for_cycle_from_rows,
    _timeline_row_date,
    _timeline_row_meta,
    is_superseded_planned_row,
    timeline_rows_chronological_key,
)

logger = logging.getLogger(__name__)

GUIDED_STRATEGY_ROW_SOURCE = "scenario_guided_strategy"
CENTS = Decimal("0.01")
ZERO = Decimal("0")
HUNDRED = Decimal("100")
INTEREST_NOISE = Decimal("0.01")

ACTUAL_TXN_SOURCES = frozenset({"actual", "plaid", "import", "bank"})
REDIRECTABLE_ROW_SOURCES = frozenset({"rule", "scenario_event", "scenario_added_recurring"})
POSTED_STATUSES = frozenset({"CLEARED", "RECONCILED"})
IMPORT_MATCHED_STATUSES = frozenset({"matched", "linked", "confirmed"})

GUIDED_OCCURRENCE_STATUSES = frozenset(
    {
        "redirected",
        "split",
        "resumed_savings",
        "buffer_limited",
        "skipped",
    }
)


def _money(value: Decimal) -> Decimal:
    return value.quantize(CENTS, rounding=ROUND_HALF_UP)


def _money_floor(value: Decimal) -> Decimal:
    return value.quantize(CENTS, rounding=ROUND_DOWN)


def _money_str(value: Decimal) -> str:
    return str(_money(value))


def _signed(row: dict) -> Decimal:
    amt = row.get("amount")
    if isinstance(amt, Decimal):
        return amt
    return Decimal(str(amt or 0))


def _row_source(row: dict) -> str:
    return (row.get("source") or "").lower()


@dataclass
class GuidedStrategySnapshot:
    """Prefetched strategy fields used by the occurrence loop (no ORM access)."""

    strategy_id: int
    scenario_id: int
    strategy_type: str
    source_account: Account
    savings_account: Account
    debt_accounts: list[Account]
    debt_by_id: dict[int, Account]
    debt_account_ids: frozenset[int]
    rule_ids: frozenset[int]
    start_date: date
    minimum_cash_buffer: Decimal
    allocation_percent: Decimal
    payoff_strategy: str
    custom_order: list[int]
    resume_savings_after_payoff: bool


@dataclass
class GuidedOccurrenceTrace:
    date: date
    rule_id: int
    original_amount: Decimal
    affordable_amount: Decimal
    redirected_to_debt: Decimal
    sent_to_savings: Decimal
    left_in_source: Decimal
    source_balance_before: Decimal
    source_balance_after: Decimal
    status: str


@dataclass
class GuidedDebtPaymentTrace:
    date: date
    source_account_id: int
    debt_account_id: int
    amount: Decimal
    original_transfer_rule_id: int
    original_transfer_amount: Decimal
    priority_at_payment: int


@dataclass
class GuidedStrategyTrace:
    snapshot: GuidedStrategySnapshot
    occurrences: list[GuidedOccurrenceTrace] = field(default_factory=list)
    debt_payments: list[GuidedDebtPaymentTrace] = field(default_factory=list)
    total_planned_for_savings: Decimal = ZERO
    total_redirected_to_debt: Decimal = ZERO
    total_sent_to_savings: Decimal = ZERO
    total_left_in_source_due_to_buffer: Decimal = ZERO
    total_unallocated_after_payoff: Decimal = ZERO
    savings_resumed_date: date | None = None
    debt_free_date: date | None = None
    selected_occurrence_count: int = 0
    elapsed_ms: float = 0.0


def snapshot_from_strategy(strategy: ScenarioGuidedStrategy) -> GuidedStrategySnapshot:
    debt_accounts = list(strategy.included_debt_accounts.all())
    rules = list(strategy.savings_transfer_rules.all())
    custom_order: list[int] = []
    if strategy.payoff_strategy == ScenarioGuidedStrategy.PayoffStrategy.CUSTOM:
        custom_order = [
            row.account_id
            for row in sorted(
                strategy.debt_priorities.all(),
                key=lambda row: (row.priority, row.pk or 0),
            )
        ]
    return GuidedStrategySnapshot(
        strategy_id=strategy.pk,
        scenario_id=strategy.scenario_id,
        strategy_type=strategy.strategy_type,
        source_account=strategy.source_account,
        savings_account=strategy.savings_account,
        debt_accounts=debt_accounts,
        debt_by_id={acc.pk: acc for acc in debt_accounts},
        debt_account_ids=frozenset(acc.pk for acc in debt_accounts),
        rule_ids=frozenset(rule.pk for rule in rules),
        start_date=strategy.start_date,
        minimum_cash_buffer=_money(Decimal(str(strategy.minimum_cash_buffer))),
        allocation_percent=_money(Decimal(str(strategy.allocation_percent))),
        payoff_strategy=strategy.payoff_strategy,
        custom_order=custom_order,
        resume_savings_after_payoff=bool(strategy.resume_savings_after_payoff),
    )


def is_historical_or_posted_row(row: dict) -> bool:
    """True for bank-posted activity that must not be redirected.

    Timeline rows for materialized *planned* rules use ``source="actual"`` with
    ``txn_source="rule"``. Those are still forecast occurrences. Historical
    activity is identified by reconcile/import metadata and txn_source, not by
    the timeline ``source`` field alone.
    """
    if row.get("reconciled"):
        return True
    if row.get("plaid_transaction_id"):
        return True
    txn_source = (row.get("txn_source") or "").lower()
    if txn_source in ACTUAL_TXN_SOURCES:
        return True
    status = (row.get("status") or "").upper()
    if status in POSTED_STATUSES:
        return True
    ims = (row.get("import_match_status") or "").lower()
    if ims in IMPORT_MATCHED_STATUSES:
        return True
    return False


def is_redirectable_forecast_row(
    row: dict,
    *,
    today: date,
    start_date: date,
    end_date: date,
) -> bool:
    rd = _timeline_row_date(row.get("date"))
    if rd is None or rd < today or rd < start_date or rd > end_date:
        return False
    if is_historical_or_posted_row(row):
        return False
    row_source = _row_source(row)
    txn_source = (row.get("txn_source") or "").lower()
    if row_source in REDIRECTABLE_ROW_SOURCES:
        return True
    if row.get("rule_id") is not None and txn_source == "rule":
        return True
    return False


def _is_source_leg(row: dict, snapshot: GuidedStrategySnapshot) -> bool:
    """Source-account occurrence of a selected savings-transfer rule.

    Canonical forecast may emit two signed legs or a single rule row on the
    source account (including a positive amount when the transfer category
    branch is not used). Identification is by rule_id + account_id, not sign
    or description.
    """
    if row.get("rule_id") not in snapshot.rule_ids:
        return False
    if row.get("account_id") != snapshot.source_account.pk:
        return False
    dest = row.get("transfer_to_account")
    if dest is not None and int(dest) != snapshot.savings_account.pk:
        return False
    return True


def _is_dest_leg(row: dict, snapshot: GuidedStrategySnapshot) -> bool:
    if row.get("rule_id") not in snapshot.rule_ids:
        return False
    if row.get("account_id") != snapshot.savings_account.pk:
        return False
    row_type = (row.get("type") or "").upper()
    amt = _signed(row)
    if row_type == "OUTFLOW":
        return False
    if row_type == "INFLOW":
        return True
    return amt > ZERO


def _occurrence_key(row: dict) -> tuple[int, date] | None:
    rule_id = row.get("rule_id")
    rd = _timeline_row_date(row.get("date"))
    if rule_id is None or rd is None:
        return None
    return (int(rule_id), rd)


def _priority_snapshots(
    snapshot: GuidedStrategySnapshot,
    running: dict[int, Decimal],
) -> list[DebtPrioritySnapshot]:
    out: list[DebtPrioritySnapshot] = []
    for acc in snapshot.debt_accounts:
        owed = credit_owed_from_signed_balance(running.get(acc.pk, ZERO))
        limit = Decimal(str(acc.credit_limit or 0))
        utilization = ZERO
        if limit > 0 and owed > ZERO:
            utilization = _money(owed / limit * HUNDRED)
        out.append(
            DebtPrioritySnapshot(
                account_id=acc.pk,
                owed=owed,
                apr=_effective_apr(acc),
                utilization=utilization,
            )
        )
    return out


def _selected_debts_paid(snapshot: GuidedStrategySnapshot, running: dict[int, Decimal]) -> bool:
    return all(
        credit_owed_from_signed_balance(running.get(aid, ZERO)) <= ZERO
        for aid in snapshot.debt_account_ids
    )


def _occurrence_status(
    *,
    original: Decimal,
    affordable: Decimal,
    redirected: Decimal,
    sent_to_savings: Decimal,
    debts_already_paid: bool,
) -> str:
    if affordable <= ZERO:
        return "skipped"
    if affordable < original:
        return "buffer_limited"
    if debts_already_paid and redirected <= ZERO:
        return "resumed_savings"
    if redirected > ZERO and sent_to_savings > ZERO:
        return "split"
    if redirected > ZERO:
        return "redirected"
    return "resumed_savings"


def _guided_leg(
    *,
    d: date,
    description: str,
    account: Account,
    amount: Decimal,
    row_type: str,
    snapshot: GuidedStrategySnapshot,
    kind: str,
    occurrence_key: str,
    rule_id: int,
    original_amount: Decimal,
    dest_account_id: int | None,
    debt_account_id: int | None,
    priority_at_payment: int | None,
    group_id: str,
    sort_seq: int,
) -> dict[str, Any]:
    return {
        "date": d,
        "description": description,
        "account_id": account.pk,
        "account_name": account.effective_display_name,
        "category_id": None,
        "category_name": (
            "Credit Card Payment" if kind == "debt_payment" else "Bank Transfer"
        ),
        "amount": amount,
        "type": row_type,
        "status": "planned",
        "source": GUIDED_STRATEGY_ROW_SOURCE,
        "rule_id": rule_id,
        "transaction_id": None,
        "sort_key": (d, 3, sort_seq),
        **_timeline_row_meta(None),
        "guided_strategy_id": snapshot.strategy_id,
        "guided_kind": kind,
        "guided_occurrence_key": occurrence_key,
        "original_transfer_rule_id": rule_id,
        "original_transfer_amount": _money_str(original_amount),
        "guided_debt_account_id": debt_account_id,
        "priority_at_payment": priority_at_payment,
        "transfer_to_account": dest_account_id,
        "transfer_group_id": group_id,
    }


def _apply_amount(
    running: dict[int, Decimal],
    account_id: int,
    amount: Decimal,
    opening: dict[int, Decimal],
) -> None:
    running[account_id] = running.get(account_id, opening.get(account_id, ZERO)) + amount


def _adjust_selected_interest_row(
    row: dict,
    snapshot: GuidedStrategySnapshot,
    output_rows: list[dict],
    remaining: Iterable[dict],
    opening: dict[int, Decimal],
) -> dict | None:
    """Replace canonical projected interest with ADB from the guided row set (no double-add)."""
    aid = row.get("account_id")
    if aid not in snapshot.debt_account_ids:
        return row
    if _row_source(row) != "interest":
        return row
    cycle_end = _timeline_row_date(row.get("date"))
    if cycle_end is None:
        return row
    acc = snapshot.debt_by_id.get(aid)
    if acc is None:
        return row
    apr = _effective_apr(acc)
    if apr <= ZERO:
        return None
    preview = list(output_rows)
    for other in remaining:
        if other is row:
            continue
        other_date = _timeline_row_date(other.get("date"))
        if other_date is None or other_date > cycle_end:
            continue
        if other.get("account_id") == aid and _row_source(other) == "interest":
            continue
        if _is_source_leg(other, snapshot) or _is_dest_leg(other, snapshot):
            continue
        preview.append(other)
    interest = _interest_for_cycle_from_rows(aid, cycle_end, apr, preview, opening)
    if interest is None or interest <= ZERO:
        return None
    adjusted = dict(row)
    adjusted["amount"] = -_money(interest)
    adjusted["type"] = "OUTFLOW"
    return adjusted


def apply_debt_first_vs_save_first(
    rows: list[dict],
    snapshot: GuidedStrategySnapshot,
    *,
    today: date,
    end_date: date,
    opening_balances: dict[int, Decimal],
) -> tuple[list[dict], GuidedStrategyTrace]:
    """
    Replace selected source→savings occurrences with guided allocations.

    Affordability uses the in-memory source ledger immediately before each
    occurrence, including earlier same-day rows in canonical order:

        affordable = min(original, max(0, floor(source_before - buffer)))
    """
    started = time.perf_counter()
    rows_by_account: dict[int, list[dict]] = {}
    for row in rows:
        aid = row.get("account_id")
        if aid is None:
            continue
        rows_by_account.setdefault(int(aid), []).append(row)

    ordered = sorted(rows, key=timeline_rows_chronological_key)
    source_id = snapshot.source_account.pk
    savings_id = snapshot.savings_account.pk
    tracked_ids = {source_id, savings_id, *snapshot.debt_account_ids}
    running = {aid: opening_balances.get(aid, ZERO) for aid in tracked_ids}
    opening = dict(running)

    pending_source_keys: set[tuple[int, date]] = set()
    for row in ordered:
        if not is_redirectable_forecast_row(
            row, today=today, start_date=snapshot.start_date, end_date=end_date
        ):
            continue
        if _is_source_leg(row, snapshot):
            key = _occurrence_key(row)
            if key is not None:
                pending_source_keys.add(key)

    processed_keys: set[tuple[int, date]] = set()
    output: list[dict] = []
    sort_seq = 0
    trace = GuidedStrategyTrace(snapshot=snapshot)

    def participates(row: dict) -> bool:
        if "financially_active" in row:
            return bool(row["financially_active"])
        aid = row.get("account_id")
        acct_rows = rows_by_account.get(int(aid), []) if aid is not None else []
        return not is_superseded_planned_row(row, acct_rows)

    def maybe_mark_debt_free(on_date: date) -> None:
        if trace.debt_free_date is not None:
            return
        if _selected_debts_paid(snapshot, running):
            trace.debt_free_date = on_date

    def emit_and_apply(generated: list[dict]) -> None:
        for gen in generated:
            aid = gen.get("account_id")
            rd = _timeline_row_date(gen.get("date"))
            if aid in tracked_ids and rd is not None and rd >= today:
                _apply_amount(running, int(aid), _signed(gen), opening)
            output.append(gen)

    def process_occurrence(source_row: dict, key: tuple[int, date]) -> None:
        nonlocal sort_seq
        rd = key[1]
        rule_id = key[0]
        original = abs(_signed(source_row))
        original = _money(original)
        trace.total_planned_for_savings += original
        trace.selected_occurrence_count += 1
        source_before = running.get(source_id, opening.get(source_id, ZERO))
        available = source_before - snapshot.minimum_cash_buffer
        if available <= ZERO:
            affordable = ZERO
        else:
            affordable = min(original, _money_floor(available))
            if affordable < ZERO:
                affordable = ZERO
        buffer_left = original - affordable
        trace.total_left_in_source_due_to_buffer += buffer_left

        debts_paid_before = _selected_debts_paid(snapshot, running)
        redirect_budget = ZERO
        regular_savings = ZERO
        if affordable > ZERO:
            redirect_budget = _money(affordable * snapshot.allocation_percent / HUNDRED)
            if redirect_budget > affordable:
                redirect_budget = affordable
            regular_savings = affordable - redirect_budget

        redirected = ZERO
        unused_redirect = redirect_budget
        payments: list[tuple[Account, Decimal, int]] = []
        if redirect_budget > ZERO and not debts_paid_before:
            ranked_ids = rank_debt_accounts_for_payoff(
                _priority_snapshots(snapshot, running),
                snapshot.payoff_strategy,
                snapshot.custom_order,
            )
            remaining = redirect_budget
            for priority, aid in enumerate(ranked_ids, start=1):
                if remaining <= ZERO:
                    break
                acc = snapshot.debt_by_id.get(aid)
                if acc is None:
                    continue
                owed = credit_owed_from_signed_balance(running.get(aid, ZERO))
                if owed <= ZERO:
                    continue
                payment = min(remaining, owed)
                payment = min(_money(payment), owed, remaining)
                if payment <= ZERO:
                    continue
                payments.append((acc, payment, priority))
                remaining -= payment
                redirected += payment
            unused_redirect = remaining

        savings_from_redirect = ZERO
        unallocated = ZERO
        if unused_redirect > ZERO:
            if snapshot.resume_savings_after_payoff:
                savings_from_redirect = unused_redirect
            else:
                unallocated = unused_redirect
                trace.total_unallocated_after_payoff += unallocated

        sent_to_savings = regular_savings + savings_from_redirect
        left_in_source = buffer_left + unallocated
        if debts_paid_before and snapshot.resume_savings_after_payoff and sent_to_savings > ZERO:
            if trace.savings_resumed_date is None:
                trace.savings_resumed_date = rd
        elif (not debts_paid_before) and savings_from_redirect > ZERO:
            if trace.savings_resumed_date is None:
                trace.savings_resumed_date = rd

        occurrence_key = f"{rule_id}:{rd.isoformat()}"
        original_desc = str(source_row.get("description") or "").strip()
        generated: list[dict] = []
        if sent_to_savings > ZERO:
            sort_seq += 1
            group_id = f"gs:{snapshot.strategy_id}:{occurrence_key}:savings"
            savings_desc = original_desc or (
                f"Transfer to {snapshot.savings_account.effective_display_name}"
            )
            generated.append(
                _guided_leg(
                    d=rd,
                    description=savings_desc,
                    account=snapshot.source_account,
                    amount=-sent_to_savings,
                    row_type="OUTFLOW",
                    snapshot=snapshot,
                    kind="savings_transfer",
                    occurrence_key=occurrence_key,
                    rule_id=rule_id,
                    original_amount=original,
                    dest_account_id=savings_id,
                    debt_account_id=None,
                    priority_at_payment=None,
                    group_id=group_id,
                    sort_seq=sort_seq,
                )
            )
            sort_seq += 1
            generated.append(
                _guided_leg(
                    d=rd,
                    description=savings_desc,
                    account=snapshot.savings_account,
                    amount=sent_to_savings,
                    row_type="INFLOW",
                    snapshot=snapshot,
                    kind="savings_transfer",
                    occurrence_key=occurrence_key,
                    rule_id=rule_id,
                    original_amount=original,
                    dest_account_id=None,
                    debt_account_id=None,
                    priority_at_payment=None,
                    group_id=group_id,
                    sort_seq=sort_seq,
                )
            )
        for acc, payment, priority in payments:
            sort_seq += 1
            group_id = f"gs:{snapshot.strategy_id}:{occurrence_key}:debt:{acc.pk}"
            debt_desc = f"Guided extra payment to {acc.effective_display_name}"
            generated.append(
                _guided_leg(
                    d=rd,
                    description=debt_desc,
                    account=snapshot.source_account,
                    amount=-payment,
                    row_type="OUTFLOW",
                    snapshot=snapshot,
                    kind="debt_payment",
                    occurrence_key=occurrence_key,
                    rule_id=rule_id,
                    original_amount=original,
                    dest_account_id=acc.pk,
                    debt_account_id=acc.pk,
                    priority_at_payment=priority,
                    group_id=group_id,
                    sort_seq=sort_seq,
                )
            )
            sort_seq += 1
            generated.append(
                _guided_leg(
                    d=rd,
                    description=debt_desc,
                    account=acc,
                    amount=payment,
                    row_type="INFLOW",
                    snapshot=snapshot,
                    kind="debt_payment",
                    occurrence_key=occurrence_key,
                    rule_id=rule_id,
                    original_amount=original,
                    dest_account_id=None,
                    debt_account_id=acc.pk,
                    priority_at_payment=priority,
                    group_id=group_id,
                    sort_seq=sort_seq,
                )
            )
            trace.debt_payments.append(
                GuidedDebtPaymentTrace(
                    date=rd,
                    source_account_id=source_id,
                    debt_account_id=acc.pk,
                    amount=payment,
                    original_transfer_rule_id=rule_id,
                    original_transfer_amount=original,
                    priority_at_payment=priority,
                )
            )

        emit_and_apply(generated)
        source_after = running.get(source_id, source_before)
        trace.occurrences.append(
            GuidedOccurrenceTrace(
                date=rd,
                rule_id=rule_id,
                original_amount=original,
                affordable_amount=affordable,
                redirected_to_debt=redirected,
                sent_to_savings=sent_to_savings,
                left_in_source=left_in_source,
                source_balance_before=source_before,
                source_balance_after=source_after,
                status=_occurrence_status(
                    original=original,
                    affordable=affordable,
                    redirected=redirected,
                    sent_to_savings=sent_to_savings,
                    debts_already_paid=debts_paid_before,
                ),
            )
        )
        trace.total_redirected_to_debt += redirected
        trace.total_sent_to_savings += sent_to_savings
        maybe_mark_debt_free(rd)

    remaining_index = 0
    while remaining_index < len(ordered):
        row = ordered[remaining_index]
        remaining_index += 1
        rd = _timeline_row_date(row.get("date"))
        key = _occurrence_key(row)

        if key is not None and key in pending_source_keys:
            if key in processed_keys:
                continue
            if _is_source_leg(row, snapshot) or _is_dest_leg(row, snapshot):
                if _is_source_leg(row, snapshot) and not is_redirectable_forecast_row(
                    row, today=today, start_date=snapshot.start_date, end_date=end_date
                ):
                    pass
                else:
                    source_row = row if _is_source_leg(row, snapshot) else None
                    if source_row is None:
                        for look in ordered:
                            look_key = _occurrence_key(look)
                            if look_key == key and _is_source_leg(look, snapshot):
                                source_row = look
                                break
                    if source_row is not None and is_redirectable_forecast_row(
                        source_row,
                        today=today,
                        start_date=snapshot.start_date,
                        end_date=end_date,
                    ):
                        processed_keys.add(key)
                        process_occurrence(source_row, key)
                        continue

        adjusted = row
        if (
            rd is not None
            and rd >= today
            and row.get("account_id") in snapshot.debt_account_ids
            and _row_source(row) == "interest"
        ):
            adjusted = _adjust_selected_interest_row(
                row,
                snapshot,
                output,
                ordered[remaining_index - 1 :],
                opening,
            )
            if adjusted is None:
                continue

        if (
            rd is not None
            and rd >= today
            and adjusted.get("account_id") in tracked_ids
            and participates(adjusted)
        ):
            _apply_amount(running, int(adjusted["account_id"]), _signed(adjusted), opening)
            if adjusted.get("account_id") in snapshot.debt_account_ids:
                maybe_mark_debt_free(rd)
        output.append(adjusted)

    elapsed_ms = (time.perf_counter() - started) * 1000
    trace.elapsed_ms = elapsed_ms
    logger.debug(
        "guided strategy scenario_id=%s horizon_end=%s occurrences=%s debt_payments=%s "
        "redirected=%s savings=%s buffer_limited=%s elapsed_ms=%.1f",
        snapshot.scenario_id,
        end_date.isoformat(),
        trace.selected_occurrence_count,
        len(trace.debt_payments),
        _money_str(trace.total_redirected_to_debt),
        _money_str(trace.total_sent_to_savings),
        _money_str(trace.total_left_in_source_due_to_buffer),
        elapsed_ms,
    )
    perf_print(
        "[PERF] guided_strategy "
        f"scenario_id={snapshot.scenario_id} "
        f"horizon_end={end_date.isoformat()} "
        f"occurrences={trace.selected_occurrence_count} "
        f"debt_payments={len(trace.debt_payments)} "
        f"redirected={_money_str(trace.total_redirected_to_debt)} "
        f"savings={_money_str(trace.total_sent_to_savings)} "
        f"buffer_limited={_money_str(trace.total_left_in_source_due_to_buffer)} "
        f"elapsed_ms={elapsed_ms:.1f}"
    )
    return output, trace


def _sum_projected_interest(
    rows: list[dict],
    account_ids: set[int],
    *,
    today: date,
    end_date: date,
) -> Decimal:
    total = ZERO
    for row in rows:
        if row.get("account_id") not in account_ids:
            continue
        if _row_source(row) != "interest":
            continue
        rd = _timeline_row_date(row.get("date"))
        if rd is None or rd < today or rd > end_date:
            continue
        amt = _signed(row)
        if amt < ZERO:
            total += abs(amt)
    return _money(total)


def _end_of_day_balances(
    rows: list[dict],
    account_ids: set[int],
    opening: dict[int, Decimal],
    *,
    today: date,
    end_date: date,
) -> dict[date, dict[int, Decimal]]:
    running = {aid: opening.get(aid, ZERO) for aid in account_ids}
    relevant = []
    for row in rows:
        aid = row.get("account_id")
        rd = _timeline_row_date(row.get("date"))
        if aid not in account_ids or rd is None or rd < today or rd > end_date:
            continue
        relevant.append(row)
    relevant.sort(key=timeline_rows_chronological_key)
    by_date: dict[date, dict[int, Decimal]] = {}
    idx = 0
    current = today
    while current <= end_date:
        while idx < len(relevant):
            row = relevant[idx]
            rd = _timeline_row_date(row.get("date"))
            if rd is None or rd > current:
                break
            if rd == current:
                running[int(row["account_id"])] = running.get(int(row["account_id"]), ZERO) + _signed(row)
            idx += 1
        by_date[current] = dict(running)
        current += timedelta(days=1)
    return by_date


def _first_catch_up_date(
    guided: dict[date, Decimal],
    baseline: dict[date, Decimal],
) -> date | None:
    """First date guided >= baseline after previously trailing."""
    trailed = False
    for d in sorted(guided.keys()):
        g = guided[d]
        b = baseline.get(d, ZERO)
        if g < b:
            trailed = True
        elif trailed and g >= b:
            return d
    return None


def _lowest_source(
    rows: list[dict],
    source_id: int,
    *,
    today: date,
    end_date: date,
) -> tuple[Decimal | None, date | None]:
    lowest: Decimal | None = None
    lowest_date: date | None = None
    for row in rows:
        if row.get("account_id") != source_id:
            continue
        rd = _timeline_row_date(row.get("date"))
        if rd is None or rd < today or rd > end_date:
            continue
        bal = row.get("running_balance")
        if bal is None:
            continue
        value = bal if isinstance(bal, Decimal) else Decimal(str(bal))
        if lowest is None or value < lowest:
            lowest = value
            lowest_date = rd
    return lowest, lowest_date


def _debt_free_date_from_rows(
    rows: list[dict],
    snapshot: GuidedStrategySnapshot,
    opening: dict[int, Decimal],
    *,
    today: date,
    end_date: date,
) -> date | None:
    running = {aid: opening.get(aid, ZERO) for aid in snapshot.debt_account_ids}
    if _selected_debts_paid(snapshot, running):
        return today
    relevant = []
    for row in rows:
        aid = row.get("account_id")
        rd = _timeline_row_date(row.get("date"))
        if aid not in snapshot.debt_account_ids or rd is None:
            continue
        if rd < today or rd > end_date:
            continue
        relevant.append(row)
    relevant.sort(key=timeline_rows_chronological_key)
    for row in relevant:
        rd = _timeline_row_date(row.get("date"))
        if rd is None:
            continue
        aid = int(row["account_id"])
        running[aid] = running.get(aid, ZERO) + _signed(row)
        if _selected_debts_paid(snapshot, running):
            return rd
    return None


def _ending_from_rows(rows: list[dict], account_id: int, opening: Decimal) -> Decimal:
    last = None
    for row in reversed(rows):
        if row.get("account_id") == account_id:
            last = row
            break
    if last is None:
        return opening
    rb = last.get("running_balance")
    if rb is not None:
        return rb if isinstance(rb, Decimal) else Decimal(str(rb))
    total = opening
    for row in rows:
        if row.get("account_id") == account_id:
            total += _signed(row)
    return total


def build_guided_strategy_result(
    trace: GuidedStrategyTrace,
    *,
    today: date,
    end_date: date,
    base_rows: list[dict],
    scenario_rows: list[dict],
    opening_balances: dict[int, Decimal],
) -> dict[str, Any]:
    """Assemble the comparison payload. Timeline rows remain the authority."""
    snapshot = trace.snapshot
    source_id = snapshot.source_account.pk
    savings_id = snapshot.savings_account.pk
    debt_ids = set(snapshot.debt_account_ids)
    tracked = {source_id, savings_id, *debt_ids}

    base_savings = _ending_from_rows(
        base_rows, savings_id, opening_balances.get(savings_id, ZERO)
    )
    guided_savings = _ending_from_rows(
        scenario_rows, savings_id, opening_balances.get(savings_id, ZERO)
    )
    base_debt = sum(
        (
            credit_owed_from_signed_balance(
                _ending_from_rows(base_rows, aid, opening_balances.get(aid, ZERO))
            )
            for aid in debt_ids
        ),
        ZERO,
    )
    guided_debt = sum(
        (
            credit_owed_from_signed_balance(
                _ending_from_rows(scenario_rows, aid, opening_balances.get(aid, ZERO))
            )
            for aid in debt_ids
        ),
        ZERO,
    )

    base_interest = _sum_projected_interest(base_rows, debt_ids, today=today, end_date=end_date)
    guided_interest = _sum_projected_interest(
        scenario_rows, debt_ids, today=today, end_date=end_date
    )
    interest_avoided = base_interest - guided_interest
    if abs(interest_avoided) < INTEREST_NOISE:
        interest_avoided = ZERO
    if interest_avoided < ZERO:
        interest_avoided = ZERO

    eod_base = _end_of_day_balances(
        base_rows, tracked, opening_balances, today=today, end_date=end_date
    )
    eod_guided = _end_of_day_balances(
        scenario_rows, tracked, opening_balances, today=today, end_date=end_date
    )
    guided_net: dict[date, Decimal] = {}
    base_net: dict[date, Decimal] = {}
    guided_sav: dict[date, Decimal] = {}
    base_sav: dict[date, Decimal] = {}
    for d in sorted(eod_guided.keys()):
        g_sav = eod_guided[d].get(savings_id, ZERO)
        b_sav = eod_base.get(d, {}).get(savings_id, ZERO)
        g_debt = sum(
            (credit_owed_from_signed_balance(eod_guided[d].get(aid, ZERO)) for aid in debt_ids),
            ZERO,
        )
        b_debt = sum(
            (
                credit_owed_from_signed_balance(eod_base.get(d, {}).get(aid, ZERO))
                for aid in debt_ids
            ),
            ZERO,
        )
        guided_sav[d] = g_sav
        base_sav[d] = b_sav
        # Net-position break-even: guided (savings - selected debt) vs baseline.
        guided_net[d] = g_sav - g_debt
        base_net[d] = b_sav - b_debt

    net_break_even = _first_catch_up_date(guided_net, base_net)
    savings_catch_up = _first_catch_up_date(guided_sav, base_sav)

    lowest, lowest_date = _lowest_source(
        scenario_rows, source_id, today=today, end_date=end_date
    )
    debt_free = _debt_free_date_from_rows(
        scenario_rows, snapshot, opening_balances, today=today, end_date=end_date
    )
    if debt_free is None:
        debt_free = trace.debt_free_date
    if guided_debt > ZERO:
        debt_free = None

    payoff_dates: dict[int, date | None] = {aid: None for aid in debt_ids}
    running_debt = {aid: opening_balances.get(aid, ZERO) for aid in debt_ids}
    for row in sorted(scenario_rows, key=timeline_rows_chronological_key):
        aid = row.get("account_id")
        if aid not in debt_ids:
            continue
        rd = _timeline_row_date(row.get("date"))
        if rd is None or rd < today or rd > end_date:
            continue
        running_debt[int(aid)] = running_debt.get(int(aid), ZERO) + _signed(row)
        if payoff_dates[int(aid)] is None and credit_owed_from_signed_balance(
            running_debt[int(aid)]
        ) <= ZERO:
            payoff_dates[int(aid)] = rd

    guided_payments_by_account: dict[int, Decimal] = {aid: ZERO for aid in debt_ids}
    for payment in trace.debt_payments:
        guided_payments_by_account[payment.debt_account_id] = (
            guided_payments_by_account.get(payment.debt_account_id, ZERO) + payment.amount
        )

    debt_accounts_out = []
    for acc in snapshot.debt_accounts:
        opening_owed = credit_owed_from_signed_balance(opening_balances.get(acc.pk, ZERO))
        ending_owed = credit_owed_from_signed_balance(
            _ending_from_rows(scenario_rows, acc.pk, opening_balances.get(acc.pk, ZERO))
        )
        debt_accounts_out.append(
            {
                "account_id": acc.pk,
                "name": acc.effective_display_name,
                "opening_owed": _money_str(opening_owed),
                "ending_owed": _money_str(ending_owed),
                "guided_payments": _money_str(guided_payments_by_account.get(acc.pk, ZERO)),
                "payoff_date": (
                    payoff_dates[acc.pk].isoformat()
                    if payoff_dates[acc.pk] is not None and ending_owed <= ZERO
                    else None
                ),
            }
        )

    return {
        "strategy_type": snapshot.strategy_type,
        "start_date": snapshot.start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "source_account_id": source_id,
        "savings_account_id": savings_id,
        "payoff_strategy": snapshot.payoff_strategy,
        "allocation_percent": _money_str(snapshot.allocation_percent),
        "minimum_cash_buffer": _money_str(snapshot.minimum_cash_buffer),
        "baseline": {
            "savings_at_horizon": _money_str(base_savings),
            "selected_debt_at_horizon": _money_str(base_debt),
        },
        "debt_first": {
            "savings_at_horizon": _money_str(guided_savings),
            "selected_debt_at_horizon": _money_str(guided_debt),
        },
        "total_planned_for_savings": _money_str(trace.total_planned_for_savings),
        "total_redirected_to_debt": _money_str(trace.total_redirected_to_debt),
        "total_sent_to_savings": _money_str(trace.total_sent_to_savings),
        "total_left_in_source_due_to_buffer": _money_str(
            trace.total_left_in_source_due_to_buffer
        ),
        "total_unallocated_after_payoff": _money_str(trace.total_unallocated_after_payoff),
        "interest_avoided_within_horizon": _money_str(interest_avoided),
        "debt_free_date": debt_free.isoformat() if debt_free else None,
        "savings_resumed_date": (
            trace.savings_resumed_date.isoformat() if trace.savings_resumed_date else None
        ),
        "net_position_break_even_date": (
            net_break_even.isoformat() if net_break_even else None
        ),
        "savings_balance_catch_up_date": (
            savings_catch_up.isoformat() if savings_catch_up else None
        ),
        "break_even_date": net_break_even.isoformat() if net_break_even else None,
        "lowest_source_balance": _money_str(lowest) if lowest is not None else None,
        "lowest_source_balance_date": lowest_date.isoformat() if lowest_date else None,
        "debt_payments": [
            {
                "date": p.date.isoformat(),
                "source_account_id": p.source_account_id,
                "debt_account_id": p.debt_account_id,
                "amount": _money_str(p.amount),
                "original_transfer_rule_id": p.original_transfer_rule_id,
                "original_transfer_amount": _money_str(p.original_transfer_amount),
                "priority_at_payment": p.priority_at_payment,
            }
            for p in trace.debt_payments
        ],
        "transfer_occurrences": [
            {
                "date": occ.date.isoformat(),
                "rule_id": occ.rule_id,
                "original_amount": _money_str(occ.original_amount),
                "affordable_amount": _money_str(occ.affordable_amount),
                "redirected_to_debt": _money_str(occ.redirected_to_debt),
                "sent_to_savings": _money_str(occ.sent_to_savings),
                "left_in_source": _money_str(occ.left_in_source),
                "source_balance_before": _money_str(occ.source_balance_before),
                "source_balance_after": _money_str(occ.source_balance_after),
                "status": occ.status,
            }
            for occ in trace.occurrences
        ],
        "debt_accounts": debt_accounts_out,
    }
