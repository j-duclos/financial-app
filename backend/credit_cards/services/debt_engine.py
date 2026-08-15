"""
Household debt payoff engine: multi-card simulation, strategies, what-if, milestones.

Architecture:
    load credit cards
           ↓
    bulk load current balances ONCE (caller) / optional per-card fallback
           ↓
    immutable opening debt state
           ↓
    ┌────────────────────┬──────────────────────┐
    │ selected strategy  │ minimum-only baseline│
    │ pure Python        │ pure Python (cached) │
    └────────────────────┴──────────────────────┘
           ↓
    current-state metrics + simulated results
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass, replace
from datetime import date
from decimal import Decimal
from typing import Any

from django.core.cache import cache

from accounts.models import Account
from accounts.services.credit_card import ledger_owed_balance
from common.services.cache import (
    DEBT_PAYOFF_PROJECTION_CACHE_SECONDS,
    get_debt_payoff_projection_cache_key,
)
from common.services.profiler import perf_enabled, perf_print
from credit_cards.services.payoff import (
    _effective_apr,
    calculate_monthly_interest,
    project_credit_card_payoff,
)

DEBT_STRATEGIES = frozenset({"avalanche", "snowball", "utilization_target", "custom"})
PAYOFF_MODES = frozenset({"survival", "aggressive", "credit_score", "balanced"})
UTILIZATION_TARGET_PCT = Decimal("30")
MINIMUM_BASELINE_CACHE_VERSION = "v1"


def _quantize(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"))


def _money(value: Decimal) -> str:
    return str(_quantize(value))


def _add_month(d: date) -> date:
    y, m = d.year, d.month + 1
    if m > 12:
        y, m = y + 1, 1
    day = min(d.day, _days_in_month(y, m))
    return date(y, m, day)


def _days_in_month(year: int, month: int) -> int:
    if month == 12:
        return (date(year + 1, 1, 1) - date(year, 12, 1)).days
    return (date(year, month + 1, 1) - date(year, month, 1)).days


@dataclass
class CardState:
    account: Account
    balance: Decimal
    apr: Decimal
    minimum: Decimal
    credit_limit: Decimal
    priority: int = 0

    @property
    def utilization(self) -> Decimal:
        if self.credit_limit <= 0:
            return Decimal("0")
        return _quantize(self.balance / self.credit_limit * Decimal("100"))


@dataclass
class _PayoffLoopResult:
    total_interest: Decimal
    total_paid: Decimal
    timeline: list[dict[str, Any]]
    months: int
    debt_free_date: date | None
    payoff_order: list[int]
    first_month_planned: dict[int, Decimal]
    monthly_budget: Decimal


def _copy_card_states(states: list[CardState]) -> list[CardState]:
    """Shallow-copy CardState rows so simulation can mutate balances independently."""
    return [replace(state) for state in states]


def _owed_from_inputs(
    card: Account,
    as_of: date,
    balance_by_account: dict | None,
) -> Decimal:
    if balance_by_account is not None:
        from accounts.services.balances import credit_owed_from_signed_balance

        return credit_owed_from_signed_balance(
            balance_by_account.get(card.pk, Decimal("0"))
        )
    return ledger_owed_balance(card, as_of)


def _minimum_payment(card: Account, balance: Decimal) -> Decimal:
    configured = Decimal(str(card.minimum_payment_amount or 0))
    if configured > 0:
        return _quantize(min(configured, balance))
    if balance <= 0:
        return Decimal("0")
    return _quantize(max(Decimal("25"), balance * Decimal("0.02")))


def _load_card_states(
    cards: list[Account],
    *,
    as_of: date,
    balance_by_account: dict | None = None,
) -> list[CardState]:
    """Build opening CardState rows. Does not query the ledger when a balance map is provided."""
    states: list[CardState] = []
    for card in cards:
        if not card.is_credit_card():
            continue
        owed = _owed_from_inputs(card, as_of, balance_by_account)
        if owed < 0:
            owed = Decimal("0")
        limit = Decimal(str(card.credit_limit or 0))
        states.append(
            CardState(
                account=card,
                balance=_quantize(owed),
                apr=_effective_apr(card),
                minimum=_minimum_payment(card, owed),
                credit_limit=limit,
            )
        )
    return [s for s in states if s.balance > 0]


def _focus_order(states: list[CardState], strategy: str, custom_order: list[int] | None) -> list[CardState]:
    active = [s for s in states if s.balance > 0]
    if strategy == "snowball":
        return sorted(active, key=lambda s: (s.balance, -s.apr))
    if strategy == "utilization_target":
        return sorted(
            active,
            key=lambda s: (-s.utilization, -s.apr, s.balance),
        )
    if strategy == "custom" and custom_order:
        order_map = {aid: i for i, aid in enumerate(custom_order)}
        return sorted(active, key=lambda s: order_map.get(s.account.pk, 999))
    return sorted(active, key=lambda s: (-s.apr, s.balance))


def _monthly_budget(
    states: list[CardState],
    mode: str,
    *,
    extra_monthly: Decimal,
) -> Decimal:
    mins = sum((s.minimum for s in states if s.balance > 0), Decimal("0"))
    extra = extra_monthly

    if mode == "survival":
        return _quantize(mins)
    if mode == "aggressive":
        return _quantize(mins + extra)
    if mode == "credit_score":
        return _quantize(mins + extra)
    if mode == "balanced":
        return _quantize(mins + extra * Decimal("0.6"))
    return _quantize(mins + extra)


def _household_utilization(states: list[CardState]) -> Decimal:
    limits = sum((s.credit_limit for s in states), Decimal("0"))
    if limits <= 0:
        return Decimal("0")
    owed = sum((s.balance for s in states if s.balance > 0), Decimal("0"))
    return _quantize(owed / limits * Decimal("100"))


def _run_payoff_loop(
    states: list[CardState],
    *,
    strategy: str,
    mode: str,
    extra_monthly: Decimal,
    custom_order: list[int] | None,
    today: date,
    max_months: int,
    lump_sum_by_account: dict[int, Decimal] | None = None,
) -> _PayoffLoopResult:
    """
    Mutate ``states`` month-by-month. Callers must pass a copy of opening state.

    No SQL: APR, minimums, and balances are already on CardState / Account.
    """
    if lump_sum_by_account:
        for st in states:
            lump = lump_sum_by_account.get(st.account.pk, Decimal("0"))
            if lump > 0:
                st.balance = _quantize(max(Decimal("0"), st.balance - lump))

    states[:] = [s for s in states if s.balance > 0]
    if not states:
        return _PayoffLoopResult(
            total_interest=Decimal("0"),
            total_paid=Decimal("0"),
            timeline=[],
            months=0,
            debt_free_date=today,
            payoff_order=[],
            first_month_planned={},
            monthly_budget=Decimal("0"),
        )

    monthly_budget = _monthly_budget(states, mode, extra_monthly=extra_monthly)
    total_interest = Decimal("0")
    total_paid = Decimal("0")
    timeline: list[dict[str, Any]] = []
    cursor = today
    months = 0
    debt_free_date: date | None = None
    payoff_order: list[int] = []
    cards_paid_off: set[int] = set()
    first_month_planned: dict[int, Decimal] = {}

    while any(s.balance > 0 for s in states) and months < max_months:
        months += 1
        month_interest = Decimal("0")
        month_paid = Decimal("0")

        for st in states:
            if st.balance <= 0:
                continue
            interest = calculate_monthly_interest(st.account, st.balance) if st.apr > 0 else Decimal("0")
            st.balance = _quantize(st.balance + interest)
            month_interest += interest

        active = [s for s in states if s.balance > 0]
        mins_total = sum(s.minimum for s in active)
        budget = max(monthly_budget, mins_total)
        payments: dict[int, Decimal] = {s.account.pk: s.minimum for s in active}
        remaining = budget - mins_total

        focus_list = _focus_order(active, strategy, custom_order)
        for st in focus_list:
            if remaining <= 0:
                break
            add = min(remaining, st.balance)
            payments[st.account.pk] = _quantize(payments[st.account.pk] + add)
            remaining -= add

        if months == 1:
            for st in active:
                first_month_planned[st.account.pk] = payments[st.account.pk]

        month_balances: dict[str, str] = {}
        for st in active:
            pay = min(payments.get(st.account.pk, Decimal("0")), st.balance)
            st.balance = _quantize(st.balance - pay)
            month_paid += pay
            month_balances[str(st.account.pk)] = _money(st.balance)
            if st.balance <= 0 and st.account.pk not in cards_paid_off:
                cards_paid_off.add(st.account.pk)
                payoff_order.append(st.account.pk)

        total_interest += month_interest
        total_paid += month_paid
        timeline.append(
            {
                "month": months,
                "date": cursor.isoformat(),
                "total_balance": _money(sum(s.balance for s in states)),
                "interest_charged": _money(month_interest),
                "total_paid": _money(month_paid),
                "balances_by_account": month_balances,
            }
        )
        cursor = _add_month(cursor)
        if not any(s.balance > 0 for s in states):
            debt_free_date = cursor
            break

    return _PayoffLoopResult(
        total_interest=total_interest,
        total_paid=total_paid,
        timeline=timeline,
        months=months,
        debt_free_date=debt_free_date,
        payoff_order=payoff_order,
        first_month_planned=first_month_planned,
        monthly_budget=monthly_budget,
    )


def _minimum_baseline_cache_key(
    opening_states: list[CardState],
    as_of: date,
    max_months: int,
) -> str:
    parts = [MINIMUM_BASELINE_CACHE_VERSION, as_of.isoformat(), str(max_months)]
    for s in sorted(opening_states, key=lambda row: row.account.pk):
        acc = s.account
        parts.append(
            f"{acc.pk}:{s.balance}:{s.apr}:{s.minimum}:{s.credit_limit}:"
            f"{acc.promotional_apr}:{acc.promotional_end_date}:"
            f"{acc.minimum_payment_amount}"
        )
    digest = hashlib.md5("|".join(parts).encode(), usedforsecurity=False).hexdigest()
    return f"debt_min_baseline:{MINIMUM_BASELINE_CACHE_VERSION}:{digest}"


def _simulate_minimums_only(
    opening_states: list[CardState],
    *,
    as_of: date,
    max_months: int,
) -> Decimal:
    """Minimum-payment baseline from opening state. No SQL. Cached by debt fingerprint."""
    if not opening_states:
        return Decimal("0")
    key = _minimum_baseline_cache_key(opening_states, as_of, max_months)
    cached = cache.get(key)
    if cached is not None:
        return Decimal(str(cached))
    sim = _copy_card_states(opening_states)
    result = _run_payoff_loop(
        sim,
        strategy="avalanche",
        mode="survival",
        extra_monthly=Decimal("0"),
        custom_order=None,
        today=as_of,
        max_months=max_months,
        lump_sum_by_account=None,
    )
    interest = _quantize(result.total_interest)
    cache.set(key, str(interest), timeout=DEBT_PAYOFF_PROJECTION_CACHE_SECONDS)
    return interest


def _simulate_interest_only(
    cards: list[Account],
    *,
    strategy: str,
    mode: str,
    extra_monthly: Decimal,
    as_of: date,
    max_months: int,
    balance_by_account: dict | None = None,
) -> Decimal:
    """Backward-compatible wrapper; prefers opening states + baseline cache."""
    opening = _load_card_states(cards, as_of=as_of, balance_by_account=balance_by_account)
    return _simulate_minimums_only(opening, as_of=as_of, max_months=max_months)


def simulate_household_debt(
    cards: list[Account],
    *,
    strategy: str = "avalanche",
    mode: str = "aggressive",
    extra_monthly: Decimal = Decimal("0"),
    lump_sum_by_account: dict[int, Decimal] | None = None,
    custom_order: list[int] | None = None,
    as_of: date | None = None,
    max_months: int = 360,
    _skip_baseline: bool = False,
    balance_by_account: dict | None = None,
) -> dict[str, Any]:
    today = as_of or date.today()
    if strategy not in DEBT_STRATEGIES:
        strategy = "avalanche"
    if mode not in PAYOFF_MODES:
        mode = "aggressive"

    opening_states = _load_card_states(
        cards,
        as_of=today,
        balance_by_account=balance_by_account,
    )
    if not opening_states:
        return _empty_plan(today, paid_off=True)

    # Current-condition metrics: opening/current debt, never post-simulation.
    total_debt = sum((s.balance for s in opening_states), Decimal("0"))
    weighted_apr = _weighted_apr(opening_states)
    monthly_burn = sum(
        (calculate_monthly_interest(s.account, s.balance) for s in opening_states),
        Decimal("0"),
    )

    simulation_states = _copy_card_states(opening_states)
    loop = _run_payoff_loop(
        simulation_states,
        strategy=strategy,
        mode=mode,
        extra_monthly=extra_monthly,
        custom_order=custom_order,
        today=today,
        max_months=max_months,
        lump_sum_by_account=lump_sum_by_account,
    )

    baseline_interest = Decimal("0")
    if not _skip_baseline:
        baseline_interest = _simulate_minimums_only(
            opening_states,
            as_of=today,
            max_months=max_months,
        )
        interest_saved = max(Decimal("0"), _quantize(baseline_interest - loop.total_interest))
    else:
        interest_saved = Decimal("0")

    events = _simulation_events(
        opening_states,
        loop.timeline,
        loop.payoff_order,
        loop.debt_free_date,
        loop.months,
    )
    card_summaries = _build_card_summaries(
        cards,
        opening_states,
        loop.payoff_order,
        today,
        loop.debt_free_date,
        planned_monthly_payments=loop.first_month_planned,
        balance_by_account=balance_by_account,
    )
    milestones = _build_milestones(
        opening_states,
        loop.payoff_order,
        events,
        loop.debt_free_date,
    )
    recommendations = _build_recommendations(
        opening_states,
        strategy,
        interest_saved,
        loop.monthly_budget,
        custom_order=custom_order,
    )
    utilization_forecast = _utilization_forecast(opening_states, loop.timeline)

    return {
        "as_of": today.isoformat(),
        "strategy": strategy,
        "mode": mode,
        "extra_monthly": _money(extra_monthly),
        "monthly_payment_budget": _money(loop.monthly_budget),
        "total_debt": _money(total_debt),
        "weighted_apr": _money(weighted_apr),
        "monthly_interest_burn": _money(monthly_burn),
        "debt_free_date": loop.debt_free_date.isoformat() if loop.debt_free_date else None,
        "months_to_debt_free": loop.months if loop.debt_free_date else None,
        "debt_free_possible": loop.debt_free_date is not None,
        "total_interest": _money(loop.total_interest),
        "total_paid": _money(loop.total_paid),
        "total_interest_minimums_only": _money(baseline_interest),
        "interest_saved_vs_minimums": _money(interest_saved),
        "payoff_order": loop.payoff_order,
        "cards": card_summaries,
        "timeline": loop.timeline[:60],
        "milestones": milestones,
        "recommendations": recommendations,
        "utilization_forecast": utilization_forecast,
    }


def _weighted_apr(states: list[CardState]) -> Decimal:
    """Balance-weighted APR from the given states: sum(bal_i * apr_i) / sum(bal_i)."""
    total = sum(s.balance for s in states)
    if total <= 0:
        return Decimal("0")
    weighted = sum(s.balance * s.apr for s in states) / total
    return _quantize(weighted)


def _simulation_events(
    opening_states: list[CardState],
    timeline: list[dict[str, Any]],
    payoff_order: list[int],
    debt_free_date: date | None,
    months: int,
) -> dict[str, int | None]:
    """Lightweight milestone months from the existing timeline (no extra snapshots)."""
    events: dict[str, int | None] = {
        "first_card_eliminated_month": None,
        "utilization_below_50_month": None,
        "utilization_below_30_month": None,
        "debt_free_month": months if debt_free_date is not None else None,
    }
    for row in timeline:
        month = int(row["month"])
        bals = row.get("balances_by_account") or {}
        if events["first_card_eliminated_month"] is None:
            for aid in payoff_order:
                raw = bals.get(str(aid))
                if raw is not None and Decimal(raw) <= 0:
                    events["first_card_eliminated_month"] = month
                    break
        util = _household_util_from_balances(opening_states, bals)
        if events["utilization_below_50_month"] is None and util < Decimal("50"):
            events["utilization_below_50_month"] = month
        if events["utilization_below_30_month"] is None and util < Decimal("30"):
            events["utilization_below_30_month"] = month
    if not timeline and debt_free_date is not None:
        events["debt_free_month"] = 0
        events["first_card_eliminated_month"] = 0
        events["utilization_below_50_month"] = 0
        events["utilization_below_30_month"] = 0
    return events


def _household_util_from_balances(
    opening_states: list[CardState],
    balances_by_account: dict[str, str],
) -> Decimal:
    limits = sum((s.credit_limit for s in opening_states), Decimal("0"))
    if limits <= 0:
        return Decimal("0")
    owed = Decimal("0")
    for s in opening_states:
        raw = balances_by_account.get(str(s.account.pk))
        if raw is not None:
            owed += Decimal(raw)
    return _quantize(owed / limits * Decimal("100"))


def _build_card_summaries(
    all_cards: list[Account],
    opening_states: list[CardState],
    payoff_order: list[int],
    today: date,
    debt_free_date: date | None,
    *,
    planned_monthly_payments: dict[int, Decimal] | None = None,
    balance_by_account: dict | None = None,
) -> list[dict[str, Any]]:
    opening_by_id = {s.account.pk: s for s in opening_states}
    order_rank = {aid: i + 1 for i, aid in enumerate(payoff_order)}
    summaries: list[dict[str, Any]] = []

    for card in all_cards:
        if not card.is_credit_card():
            continue
        opening = opening_by_id.get(card.pk)
        if opening is not None:
            owed = opening.balance
        else:
            owed = _owed_from_inputs(card, today, balance_by_account)
        if owed <= 0 and card.pk not in payoff_order:
            continue
        apr = opening.apr if opening is not None else _effective_apr(card)
        limit = opening.credit_limit if opening is not None else Decimal(str(card.credit_limit or 0))
        util = _quantize(owed / limit * Decimal("100")) if limit > 0 else None
        min_pay = opening.minimum if opening is not None else _minimum_payment(card, owed)
        planned = (planned_monthly_payments or {}).get(card.pk)
        pay_amt = _quantize(planned) if planned is not None and planned > 0 else min_pay
        suggested = pay_amt
        single = project_credit_card_payoff(
            card,
            "custom_amount",
            custom_amount=pay_amt,
            start_date=today,
            starting_balance=owed,
        )
        months_remaining = single.get("months_to_payoff") if single.get("payoff_possible") else None

        summaries.append(
            {
                "account_id": card.pk,
                "name": card.effective_display_name,
                "balance": _money(owed),
                "apr": _money(apr),
                "credit_limit": _money(limit) if limit > 0 else None,
                "utilization_percent": _money(util) if util is not None else None,
                "minimum_payment": _money(min_pay),
                "suggested_payment": _money(suggested),
                "payoff_date": single.get("payoff_date"),
                "months_remaining": months_remaining,
                "total_projected_interest": single.get("total_interest"),
                "interest_this_month": _money(calculate_monthly_interest(card, owed)),
                "payoff_order": order_rank.get(card.pk),
                "promotional_apr": (
                    str(card.promotional_apr) if card.promotional_apr is not None else None
                ),
                "promotional_end_date": (
                    card.promotional_end_date.isoformat() if card.promotional_end_date else None
                ),
                "autopay_enabled": card.autopay_enabled,
            }
        )
    summaries.sort(key=lambda x: x.get("payoff_order") or 999)
    return summaries


def _build_milestones(
    opening_states: list[CardState],
    payoff_order: list[int],
    events: dict[str, int | None],
    debt_free_date: date | None,
) -> list[dict[str, Any]]:
    """
    ``achieved`` is current/opening status, not the simulated end state.

    Future months (when the plan reaches the milestone) come from simulation events.
    """
    opening_util = _household_utilization(opening_states)
    opening_debt = sum((s.balance for s in opening_states), Decimal("0"))
    milestones: list[dict[str, Any]] = []

    if payoff_order or events.get("first_card_eliminated_month") is not None:
        first_month = events.get("first_card_eliminated_month")
        description = "Your first account reaches zero balance in this plan."
        if first_month:
            description = (
                f"Your first account reaches zero balance in month {first_month} of this plan."
            )
        milestones.append(
            {
                "id": "first_card_paid",
                "label": "First card eliminated",
                "achieved": False,
                "description": description,
                "month": first_month,
            }
        )

    util_50_month = events.get("utilization_below_50_month")
    util_50_desc = "Household revolving utilization drops under half of limits."
    if opening_util >= Decimal("50") and util_50_month:
        util_50_desc = (
            f"Household revolving utilization drops under half of limits "
            f"(month {util_50_month} in this plan)."
        )
    milestones.append(
        {
            "id": "util_below_50",
            "label": "Utilization below 50%",
            "achieved": opening_util < Decimal("50"),
            "description": util_50_desc,
            "month": util_50_month,
        }
    )

    util_30_month = events.get("utilization_below_30_month")
    util_30_desc = "Strong credit profile territory for most scoring models."
    if opening_util >= UTILIZATION_TARGET_PCT and util_30_month:
        util_30_desc = (
            f"Strong credit profile territory for most scoring models "
            f"(month {util_30_month} in this plan)."
        )
    milestones.append(
        {
            "id": "util_below_30",
            "label": "Utilization below 30%",
            "achieved": opening_util < UTILIZATION_TARGET_PCT,
            "description": util_30_desc,
            "month": util_30_month,
        }
    )

    debt_free_month = events.get("debt_free_month")
    debt_free_desc = "All credit card balances paid off."
    if opening_debt > 0 and debt_free_date and debt_free_month:
        debt_free_desc = f"All credit card balances paid off (month {debt_free_month} in this plan)."
    milestones.append(
        {
            "id": "debt_free",
            "label": "Debt-free month",
            "achieved": opening_debt <= 0,
            "description": debt_free_desc,
            "month": debt_free_month,
        }
    )
    return milestones


def _build_recommendations(
    opening_states: list[CardState],
    strategy: str,
    interest_saved: Decimal,
    monthly_budget: Decimal,
    *,
    custom_order: list[int] | None = None,
) -> list[dict[str, Any]]:
    recs: list[dict[str, Any]] = []
    active = [s for s in opening_states if s.balance > 0]
    if not active:
        return recs
    focus = _focus_order(active, strategy, custom_order)[0]
    recs.append(
        {
            "id": "focus_high_apr",
            "priority": "high",
            "message": f"Pay {focus.account.effective_display_name} first to attack "
            f"{_money(focus.apr)}% APR debt.",
        }
    )
    if interest_saved > 0:
        recs.append(
            {
                "id": "interest_saved",
                "priority": "medium",
                "message": f"This plan saves about ${_money(interest_saved)} vs minimum payments only.",
            }
        )
    high_util = [s for s in opening_states if s.utilization > UTILIZATION_TARGET_PCT]
    if high_util:
        worst = max(high_util, key=lambda s: s.utilization)
        recs.append(
            {
                "id": "utilization",
                "priority": "medium",
                "message": f"Bring {worst.account.effective_display_name} below 30% utilization "
                "to improve your credit profile.",
            }
        )
    return recs


def _utilization_forecast(states: list[CardState], timeline: list) -> list[dict[str, Any]]:
    forecast: list[dict[str, Any]] = []
    limits = {s.account.pk: s.credit_limit for s in states}
    for row in timeline[:12]:
        by_account: dict[str, str] = {}
        for aid, bal_str in (row.get("balances_by_account") or {}).items():
            limit = limits.get(int(aid), Decimal("0"))
            if limit > 0:
                pct = _quantize(Decimal(bal_str) / limit * Decimal("100"))
                by_account[aid] = _money(pct)
        forecast.append(
            {
                "month": row["month"],
                "date": row.get("date"),
                "by_account": by_account,
            }
        )
    return forecast


def _debt_payoff_projection_fingerprint(
    cards: list[Account],
    balance_by_account: dict | None,
    *,
    strategy: str = "avalanche",
    mode: str = "aggressive",
    extra_monthly: Decimal = Decimal("100"),
) -> str:
    parts = [strategy, mode, str(extra_monthly)]
    for card in sorted(cards, key=lambda a: a.pk):
        if not card.is_credit_card():
            continue
        owed = _owed_from_inputs(card, date.today(), balance_by_account)
        parts.append(
            f"{card.pk}:{owed}:{_effective_apr(card)}:"
            f"{card.minimum_payment_amount}:{card.credit_limit}:"
            f"{card.promotional_apr}:{card.promotional_end_date}"
        )
    digest = hashlib.md5("|".join(parts).encode(), usedforsecurity=False).hexdigest()
    return digest[:16]


def get_cached_debt_payoff_projection(
    user_id: int,
    household_ids: list[int],
    cards: list[Account],
    *,
    balance_by_account: dict | None = None,
    as_of: date | None = None,
    strategy: str = "avalanche",
    mode: str = "aggressive",
    extra_monthly: Decimal = Decimal("100"),
) -> dict[str, Any] | None:
    """Return cached payoff projection when fresh; never runs simulation."""
    today = as_of or date.today()
    fingerprint = _debt_payoff_projection_fingerprint(
        cards,
        balance_by_account,
        strategy=strategy,
        mode=mode,
        extra_monthly=extra_monthly,
    )
    cache_key = get_debt_payoff_projection_cache_key(
        user_id=user_id,
        household_ids=household_ids,
        fingerprint=fingerprint,
        as_of_date=today,
    )
    cached = cache.get(cache_key)
    if isinstance(cached, dict):
        if perf_enabled():
            perf_print("[PERF] dashboard_debt_payoff_projection cache=HIT")
        return cached
    if perf_enabled():
        perf_print(
            "[PERF] dashboard_debt_payoff_projection cache=MISS "
            "simulation_skipped_in_fast_endpoint=true"
        )
    return None


def _cache_debt_payoff_projection(
    user_id: int,
    household_ids: list[int],
    cards: list[Account],
    projection: dict[str, Any],
    *,
    balance_by_account: dict | None = None,
    as_of: date | None = None,
    strategy: str = "avalanche",
    mode: str = "aggressive",
    extra_monthly: Decimal = Decimal("100"),
) -> None:
    today = as_of or date.today()
    fingerprint = _debt_payoff_projection_fingerprint(
        cards,
        balance_by_account,
        strategy=strategy,
        mode=mode,
        extra_monthly=extra_monthly,
    )
    cache_key = get_debt_payoff_projection_cache_key(
        user_id=user_id,
        household_ids=household_ids,
        fingerprint=fingerprint,
        as_of_date=today,
    )
    cache.set(cache_key, projection, timeout=DEBT_PAYOFF_PROJECTION_CACHE_SECONDS)


def _empty_plan(today: date, *, paid_off: bool = False) -> dict[str, Any]:
    return {
        "as_of": today.isoformat(),
        "strategy": "avalanche",
        "mode": "aggressive",
        "extra_monthly": "0.00",
        "monthly_payment_budget": "0.00",
        "total_debt": "0.00",
        "weighted_apr": "0.00",
        "monthly_interest_burn": "0.00",
        "debt_free_date": today.isoformat() if paid_off else None,
        "months_to_debt_free": 0 if paid_off else None,
        "debt_free_possible": paid_off,
        "total_interest": "0.00",
        "total_paid": "0.00",
        "total_interest_minimums_only": "0.00",
        "interest_saved_vs_minimums": "0.00",
        "payoff_order": [],
        "cards": [],
        "timeline": [],
        "milestones": [
            {
                "id": "debt_free",
                "label": "Debt-free",
                "achieved": True,
                "description": "No credit card balances.",
            }
        ],
        "recommendations": [],
        "utilization_forecast": [],
    }


def build_dashboard_debt_summary(
    cards: list[Account],
    *,
    as_of: date | None = None,
    balance_by_account: dict | None = None,
    user_id: int | None = None,
    household_ids: list[int] | None = None,
    debt_metrics: dict[str, Any] | None = None,
    strategy: str = "avalanche",
    mode: str = "aggressive",
    extra_monthly: Decimal = Decimal("100"),
) -> dict[str, Any]:
    today = as_of or date.today()

    if debt_metrics is None:
        from insights.services.dashboard_summary import calculate_dashboard_debt_metrics

        debt_metrics = calculate_dashboard_debt_metrics(
            [c for c in cards if c.is_credit_card()],
            balance_by_account,
            today=today,
        )

    total_debt = debt_metrics.get("total_debt", Decimal("0"))
    if total_debt <= 0:
        return {
            "label": "No credit card debt",
            "debt_free_date": today.isoformat(),
            "total_debt": "0.00",
            "monthly_interest_burn": "0.00",
            "interest_saved_vs_minimums": None,
            "message": None,
            "planner_url": "/credit-cards",
            "plan": _empty_plan(today, paid_off=True),
        }

    projection: dict[str, Any] | None = None
    if user_id is not None and household_ids is not None:
        projection = get_cached_debt_payoff_projection(
            user_id,
            household_ids,
            cards,
            balance_by_account=balance_by_account,
            as_of=today,
            strategy=strategy,
            mode=mode,
            extra_monthly=extra_monthly,
        )

    if projection is not None:
        plan = projection.get("plan") or {}
    else:
        plan = simulate_household_debt(
            cards,
            strategy=strategy,
            mode=mode,
            extra_monthly=extra_monthly,
            as_of=today,
            balance_by_account=balance_by_account,
        )
        projection = {
            "debt_free_date": plan.get("debt_free_date"),
            "months_to_debt_free": plan.get("months_to_debt_free"),
            "debt_free_possible": plan.get("debt_free_possible"),
            "interest_saved_vs_minimums": plan.get("interest_saved_vs_minimums"),
            "plan": plan,
        }
        if user_id is not None and household_ids is not None:
            _cache_debt_payoff_projection(
                user_id,
                household_ids,
                cards,
                projection,
                balance_by_account=balance_by_account,
                as_of=today,
                strategy=strategy,
                mode=mode,
                extra_monthly=extra_monthly,
            )

    debt_free_date = projection.get("debt_free_date")
    if debt_free_date:
        d = date.fromisoformat(str(debt_free_date)[:10])
        label = f"Debt-free projected: {d.strftime('%b %Y')}"
    elif projection.get("debt_free_possible") is False:
        label = "Payoff needs higher payments"
    else:
        label = "Open planner for payoff date"

    saved = projection.get("interest_saved_vs_minimums")
    msg = None
    if saved and Decimal(str(saved)) > 0:
        msg = f"Your plan saves ${saved} interest vs minimums only"

    return {
        "label": label,
        "debt_free_date": debt_free_date,
        "total_debt": str(total_debt),
        "monthly_interest_burn": str(debt_metrics["estimated_monthly_interest"]),
        "interest_saved_vs_minimums": saved,
        "message": msg,
        "planner_url": "/credit-cards",
        "plan": plan,
    }
