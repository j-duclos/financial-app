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
from accounts.services.account_health import _target_utilization_percent
from accounts.services.account_health_constants import DEFAULT_TARGET_UTILIZATION_PERCENT
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
# Industry scoring breakpoint (independent of the user's configured target).
INDUSTRY_UTILIZATION_50_PCT = Decimal("50")
MINIMUM_BASELINE_CACHE_VERSION = "v2"

# Simulation termination statuses (household + baseline).
STATUS_DEBT_FREE = "debt_free"
STATUS_NON_AMORTIZING = "non_amortizing"
STATUS_UNRESOLVED = "unresolved"
BASELINE_PAYOFFABLE = "payoffable"
BASELINE_NOT_PAYOFFABLE = "baseline_not_payoffable"


def _quantize(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"))


def _ensure_finite(value: Decimal) -> Decimal:
    """Reject NaN/Infinity so API contracts never serialize non-finite numbers."""
    if not isinstance(value, Decimal):
        value = Decimal(str(value))
    if value.is_nan() or value.is_infinite():
        raise ValueError("non-finite decimal in debt engine")
    return value


def _money(value: Decimal) -> str:
    return str(_quantize(_ensure_finite(value)))


def _money_or_none(value: Decimal | None) -> str | None:
    if value is None:
        return None
    return _money(value)


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
    status: str = STATUS_DEBT_FREE
    non_amortizing_account_ids: list[int] | None = None


@dataclass
class _BaselineResult:
    status: str
    total_interest: Decimal | None
    non_amortizing_account_ids: list[int]


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


def _household_utilization_target(states: list[CardState]) -> Decimal:
    """Limit-weighted average of each card's configured utilization target."""
    limits = sum((s.credit_limit for s in states if s.credit_limit > 0), Decimal("0"))
    if limits <= 0:
        return DEFAULT_TARGET_UTILIZATION_PERCENT
    weighted = sum(
        (s.credit_limit * _target_utilization_percent(s.account) for s in states if s.credit_limit > 0),
        Decimal("0"),
    )
    return _quantize(weighted / limits)


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

    Termination:
      - all balances <= 0 → debt_free
      - no card receives payment above its accrued interest → non_amortizing
      - max_months reached with balances remaining → unresolved
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
            status=STATUS_DEBT_FREE,
            non_amortizing_account_ids=[],
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
    status = STATUS_UNRESOLVED
    non_amortizing_ids: list[int] = []

    while any(s.balance > 0 for s in states) and months < max_months:
        months += 1
        month_interest = Decimal("0")
        month_paid = Decimal("0")
        interests: dict[int, Decimal] = {}

        for st in states:
            if st.balance <= 0:
                continue
            interest = (
                calculate_monthly_interest(st.account, st.balance)
                if st.apr > 0
                else Decimal("0")
            )
            interests[st.account.pk] = interest
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

        any_principal_reduction = False
        month_balances: dict[str, str] = {}
        for st in active:
            pay = min(payments.get(st.account.pk, Decimal("0")), st.balance)
            interest = interests.get(st.account.pk, Decimal("0"))
            if pay > interest:
                any_principal_reduction = True
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
            status = STATUS_DEBT_FREE
            break

        if not any_principal_reduction:
            # Every remaining debt has payment <= accrued interest — will not shrink.
            non_amortizing_ids = [
                st.account.pk
                for st in active
                if payments.get(st.account.pk, Decimal("0"))
                <= interests.get(st.account.pk, Decimal("0"))
            ]
            status = STATUS_NON_AMORTIZING
            break
    else:
        if debt_free_date is None and status != STATUS_NON_AMORTIZING:
            status = STATUS_UNRESOLVED
            non_amortizing_ids = [
                s.account.pk for s in states if s.balance > 0
            ]

    return _PayoffLoopResult(
        total_interest=_ensure_finite(total_interest),
        total_paid=_ensure_finite(total_paid),
        timeline=timeline,
        months=months,
        debt_free_date=debt_free_date,
        payoff_order=payoff_order,
        first_month_planned=first_month_planned,
        monthly_budget=monthly_budget,
        status=status,
        non_amortizing_account_ids=non_amortizing_ids,
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


def _opening_non_amortizing_under_minimums(states: list[CardState]) -> list[int]:
    """
    Cards whose configured minimum does not cover current monthly interest.

    Under a true minimums-only baseline these debts do not shrink on their own;
    a finite interest-savings comparison against that baseline is not meaningful.
    """
    ids: list[int] = []
    for s in states:
        if s.balance <= 0 or s.apr <= 0:
            continue
        interest = calculate_monthly_interest(s.account, s.balance)
        if interest > 0 and s.minimum <= interest:
            ids.append(s.account.pk)
    return ids


def _simulate_minimums_only(
    opening_states: list[CardState],
    *,
    as_of: date,
    max_months: int,
) -> _BaselineResult:
    """
    Minimum-payment baseline from opening state. No SQL. Cached by debt fingerprint.

    Only returns a finite interest total when the baseline actually reaches debt-free.
    Non-amortizing or unresolved baselines never invent a huge interest figure.
    """
    if not opening_states:
        return _BaselineResult(
            status=BASELINE_PAYOFFABLE,
            total_interest=Decimal("0"),
            non_amortizing_account_ids=[],
        )

    opening_non_amort = _opening_non_amortizing_under_minimums(opening_states)
    if opening_non_amort:
        return _BaselineResult(
            status=BASELINE_NOT_PAYOFFABLE,
            total_interest=None,
            non_amortizing_account_ids=opening_non_amort,
        )

    key = _minimum_baseline_cache_key(opening_states, as_of, max_months)
    cached = cache.get(key)
    if isinstance(cached, dict) and cached.get("status"):
        interest_raw = cached.get("total_interest")
        return _BaselineResult(
            status=str(cached["status"]),
            total_interest=Decimal(str(interest_raw)) if interest_raw is not None else None,
            non_amortizing_account_ids=[int(x) for x in cached.get("non_amortizing_account_ids") or []],
        )
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
    if result.debt_free_date is not None and result.status == STATUS_DEBT_FREE:
        baseline = _BaselineResult(
            status=BASELINE_PAYOFFABLE,
            total_interest=_quantize(result.total_interest),
            non_amortizing_account_ids=[],
        )
    else:
        baseline = _BaselineResult(
            status=BASELINE_NOT_PAYOFFABLE,
            total_interest=None,
            non_amortizing_account_ids=list(result.non_amortizing_account_ids or []),
        )
    cache.set(
        key,
        {
            "status": baseline.status,
            "total_interest": str(baseline.total_interest) if baseline.total_interest is not None else None,
            "non_amortizing_account_ids": baseline.non_amortizing_account_ids,
        },
        timeout=DEBT_PAYOFF_PROJECTION_CACHE_SECONDS,
    )
    return baseline


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
    baseline = _simulate_minimums_only(opening, as_of=as_of, max_months=max_months)
    return baseline.total_interest if baseline.total_interest is not None else Decimal("0")


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

    baseline_interest: Decimal | None = Decimal("0")
    baseline_status = BASELINE_PAYOFFABLE
    baseline_non_amortizing: list[int] = []
    if not _skip_baseline:
        baseline = _simulate_minimums_only(
            opening_states,
            as_of=today,
            max_months=max_months,
        )
        baseline_status = baseline.status
        baseline_interest = baseline.total_interest
        baseline_non_amortizing = baseline.non_amortizing_account_ids
        if (
            baseline_status == BASELINE_PAYOFFABLE
            and baseline_interest is not None
            and loop.status == STATUS_DEBT_FREE
        ):
            interest_saved: Decimal | None = max(
                Decimal("0"),
                _quantize(baseline_interest - loop.total_interest),
            )
        else:
            interest_saved = None
    else:
        interest_saved = Decimal("0")

    events = _simulation_events(
        opening_states,
        loop.timeline,
        loop.payoff_order,
        loop.debt_free_date,
        loop.months,
        utilization_target=_household_utilization_target(opening_states),
    )
    card_summaries = _build_card_summaries(
        cards,
        opening_states,
        loop.payoff_order,
        today,
        loop.debt_free_date,
        strategy=strategy,
        planned_monthly_payments=loop.first_month_planned,
        balance_by_account=balance_by_account,
        non_amortizing_account_ids=set(loop.non_amortizing_account_ids or []),
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
        baseline_status=baseline_status,
        non_amortizing_account_ids=baseline_non_amortizing or (loop.non_amortizing_account_ids or []),
        simulation_status=loop.status,
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
        "simulation_status": loop.status,
        "total_interest": _money(loop.total_interest),
        "total_paid": _money(loop.total_paid),
        "baseline_status": baseline_status,
        "total_interest_minimums_only": _money_or_none(baseline_interest),
        "interest_saved_vs_minimums": _money_or_none(interest_saved),
        "non_amortizing_account_ids": list(
            dict.fromkeys(
                (loop.non_amortizing_account_ids or []) + baseline_non_amortizing
            )
        ),
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
    *,
    utilization_target: Decimal | None = None,
) -> dict[str, int | None]:
    """Lightweight milestone months from the existing timeline (no extra snapshots)."""
    target = utilization_target if utilization_target is not None else DEFAULT_TARGET_UTILIZATION_PERCENT
    events: dict[str, int | None] = {
        "first_card_eliminated_month": None,
        "utilization_below_50_month": None,
        "utilization_below_target_month": None,
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
        if events["utilization_below_50_month"] is None and util < INDUSTRY_UTILIZATION_50_PCT:
            events["utilization_below_50_month"] = month
        if events["utilization_below_target_month"] is None and util < target:
            events["utilization_below_target_month"] = month
    if not timeline and debt_free_date is not None:
        events["debt_free_month"] = 0
        events["first_card_eliminated_month"] = 0
        events["utilization_below_50_month"] = 0
        events["utilization_below_target_month"] = 0
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


def _card_priority_reason(
    strategy: str,
    payoff_order_rank: int | None,
    opening: "CardState | None",
) -> dict[str, str] | None:
    """Canonical prioritization explanation for mobile/web clients."""
    if payoff_order_rank is None or opening is None:
        return None
    if payoff_order_rank == 1:
        if strategy == "snowball":
            return {
                "code": "lowest_balance",
                "label": "Smallest balance — snowball strategy pays this first",
            }
        if strategy == "utilization_target":
            util = _money(opening.utilization)
            return {
                "code": "highest_utilization",
                "label": (
                    f"Highest utilization ({util}%) — credit score strategy pays this first"
                ),
            }
        if strategy == "custom":
            return {
                "code": "custom_priority",
                "label": "Your top priority in custom order",
            }
        return {
            "code": "highest_apr",
            "label": f"Highest APR ({_money(opening.apr)}%) — avalanche strategy pays this first",
        }
    return {
        "code": "next_in_plan",
        "label": "Next in payoff order after higher-priority debts",
    }


def _build_card_summaries(
    all_cards: list[Account],
    opening_states: list[CardState],
    payoff_order: list[int],
    today: date,
    debt_free_date: date | None,
    *,
    strategy: str = "avalanche",
    planned_monthly_payments: dict[int, Decimal] | None = None,
    balance_by_account: dict | None = None,
    non_amortizing_account_ids: set[int] | None = None,
) -> list[dict[str, Any]]:
    opening_by_id = {s.account.pk: s for s in opening_states}
    order_rank = {aid: i + 1 for i, aid in enumerate(payoff_order)}
    non_amortizing = non_amortizing_account_ids or set()
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
        payoff_possible = bool(single.get("payoff_possible"))
        months_remaining = single.get("months_to_payoff") if payoff_possible else None
        if card.pk in non_amortizing or (
            not payoff_possible and single.get("estimated_monthly_interest")
        ):
            payoff_status = STATUS_NON_AMORTIZING
            months_remaining = None
        elif payoff_possible:
            payoff_status = "projected"
        else:
            payoff_status = STATUS_UNRESOLVED
        rank = order_rank.get(card.pk)
        priority_reason = _card_priority_reason(strategy, rank, opening)

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
                "payoff_date": single.get("payoff_date") if payoff_possible else None,
                "months_remaining": months_remaining,
                "total_projected_interest": (
                    single.get("total_interest") if payoff_possible else None
                ),
                "interest_this_month": _money(calculate_monthly_interest(card, owed)),
                "payoff_order": rank,
                "payoff_status": payoff_status,
                "priority_reason": priority_reason,
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
    target = _household_utilization_target(opening_states)
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
    if target != INDUSTRY_UTILIZATION_50_PCT:
        util_50_desc = "Household revolving utilization drops under half of limits."
        if opening_util >= INDUSTRY_UTILIZATION_50_PCT and util_50_month:
            util_50_desc = (
                f"Household revolving utilization drops under half of limits "
                f"(month {util_50_month} in this plan)."
            )
        milestones.append(
            {
                "id": "util_below_50",
                "label": "Utilization below 50%",
                "achieved": opening_util < INDUSTRY_UTILIZATION_50_PCT,
                "description": util_50_desc,
                "month": util_50_month,
            }
        )

    util_target_month = events.get("utilization_below_target_month")
    target_label = f"{target:.0f}"
    util_target_desc = f"Household revolving utilization reaches your {target_label}% target."
    if opening_util >= target and util_target_month:
        util_target_desc = (
            f"Household revolving utilization reaches your {target_label}% target "
            f"(month {util_target_month} in this plan)."
        )
    milestones.append(
        {
            "id": "util_below_target",
            "label": f"Utilization below {target_label}%",
            "achieved": opening_util < target,
            "description": util_target_desc,
            "month": util_target_month,
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
    interest_saved: Decimal | None,
    monthly_budget: Decimal,
    *,
    custom_order: list[int] | None = None,
    baseline_status: str = BASELINE_PAYOFFABLE,
    non_amortizing_account_ids: list[int] | None = None,
    simulation_status: str = STATUS_DEBT_FREE,
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
    if interest_saved is not None and interest_saved > 0:
        recs.append(
            {
                "id": "interest_saved",
                "priority": "medium",
                "message": f"This plan saves about ${_money(interest_saved)} vs minimum payments only.",
            }
        )
    elif baseline_status == BASELINE_NOT_PAYOFFABLE:
        recs.append(
            {
                "id": "baseline_not_payoffable",
                "priority": "medium",
                "message": "Minimum payments alone would not pay off all debts.",
            }
        )
    non_amort_ids = set(non_amortizing_account_ids or [])
    for st in active:
        if st.account.pk not in non_amort_ids:
            interest = calculate_monthly_interest(st.account, st.balance)
            if st.minimum > 0 and interest > 0 and st.minimum <= interest:
                non_amort_ids.add(st.account.pk)
    for st in active:
        if st.account.pk not in non_amort_ids:
            continue
        interest = calculate_monthly_interest(st.account, st.balance)
        recs.append(
            {
                "id": f"non_amortizing_{st.account.pk}",
                "priority": "high",
                "message": (
                    f"Minimum-only plan does not amortize {st.account.effective_display_name} "
                    f"(~${_money(interest)}/mo interest)."
                ),
            }
        )
        break  # one concise row is enough for the list
    high_util = [
        s for s in opening_states if s.utilization > _target_utilization_percent(s.account)
    ]
    if high_util:
        worst = max(high_util, key=lambda s: s.utilization)
        card_target = _target_utilization_percent(worst.account)
        recs.append(
            {
                "id": "utilization",
                "priority": "medium",
                "message": (
                    f"Bring {worst.account.effective_display_name} to your "
                    f"{card_target:.0f}% utilization target."
                ),
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
            f"{card.promotional_apr}:{card.promotional_end_date}:"
            f"{_target_utilization_percent(card)}"
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
        "simulation_status": STATUS_DEBT_FREE if paid_off else STATUS_UNRESOLVED,
        "total_interest": "0.00",
        "total_paid": "0.00",
        "baseline_status": BASELINE_PAYOFFABLE,
        "total_interest_minimums_only": "0.00",
        "interest_saved_vs_minimums": "0.00",
        "non_amortizing_account_ids": [],
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
    if saved is not None and str(saved).strip() != "" and Decimal(str(saved)) > 0:
        msg = f"Your plan saves ${saved} interest vs minimums only"
    elif plan.get("baseline_status") == "baseline_not_payoffable":
        msg = "Minimum payments alone would not pay off all debts."

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
