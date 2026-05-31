"""
Household debt payoff engine: multi-card simulation, strategies, what-if, milestones.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from typing import Any, Optional

from accounts.models import Account
from accounts.services.credit_card import ledger_owed_balance
from credit_cards.services.payoff import (
    _effective_apr,
    calculate_monthly_interest,
    project_credit_card_payoff,
)

DEBT_STRATEGIES = frozenset({"avalanche", "snowball", "utilization_target", "custom"})
PAYOFF_MODES = frozenset({"survival", "aggressive", "credit_score", "balanced"})
UTILIZATION_TARGET_PCT = Decimal("30")


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


def _minimum_payment(card: Account, balance: Decimal) -> Decimal:
    configured = Decimal(str(card.minimum_payment_amount or 0))
    if configured > 0:
        return _quantize(min(configured, balance))
    if balance <= 0:
        return Decimal("0")
    return _quantize(max(Decimal("25"), balance * Decimal("0.02")))


def _load_card_states(cards: list[Account], *, as_of: date) -> list[CardState]:
    states: list[CardState] = []
    for card in cards:
        if not card.is_credit_card():
            continue
        owed = ledger_owed_balance(card, as_of)
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


def _simulate_interest_only(
    cards: list[Account],
    *,
    strategy: str,
    mode: str,
    extra_monthly: Decimal,
    as_of: date,
    max_months: int,
) -> Decimal:
    result = simulate_household_debt(
        cards,
        strategy=strategy,
        mode=mode,
        extra_monthly=extra_monthly,
        as_of=as_of,
        max_months=max_months,
        _skip_baseline=True,
    )
    return Decimal(result.get("total_interest") or 0)


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
) -> dict[str, Any]:
    today = as_of or date.today()
    if strategy not in DEBT_STRATEGIES:
        strategy = "avalanche"
    if mode not in PAYOFF_MODES:
        mode = "aggressive"

    states = _load_card_states(cards, as_of=today)
    if not states:
        return _empty_plan(today, paid_off=True)

    if lump_sum_by_account:
        for st in states:
            lump = lump_sum_by_account.get(st.account.pk, Decimal("0"))
            if lump > 0:
                st.balance = _quantize(max(Decimal("0"), st.balance - lump))

    states = [s for s in states if s.balance > 0]
    if not states:
        return _empty_plan(today, paid_off=True)

    monthly_budget = _monthly_budget(states, mode, extra_monthly=extra_monthly)
    monthly_burn = sum(
        (
            calculate_monthly_interest(s.account, s.balance)
            for s in states
        ),
        Decimal("0"),
    )

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
            extra = min(remaining, payments[st.account.pk] + st.balance)
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

    baseline_interest = Decimal("0")
    if not _skip_baseline:
        baseline_interest = _simulate_interest_only(
            cards,
            strategy="avalanche",
            mode="survival",
            extra_monthly=Decimal("0"),
            as_of=today,
            max_months=max_months,
        )
        interest_saved = max(Decimal("0"), _quantize(baseline_interest - total_interest))
    else:
        interest_saved = Decimal("0")

    card_summaries = _build_card_summaries(
        cards,
        states,
        payoff_order,
        timeline,
        today,
        months,
        debt_free_date,
        total_interest,
        planned_monthly_payments=first_month_planned,
    )
    milestones = _build_milestones(states, cards, timeline, payoff_order, today)
    recommendations = _build_recommendations(
        states, strategy, interest_saved, monthly_budget, cards=cards
    )
    utilization_forecast = _utilization_forecast(states, timeline)

    total_debt = sum(_quantize(ledger_owed_balance(c, today)) for c in cards if c.is_credit_card())
    weighted_apr = _weighted_apr(states)
    return {
        "as_of": today.isoformat(),
        "strategy": strategy,
        "mode": mode,
        "extra_monthly": _money(extra_monthly),
        "monthly_payment_budget": _money(monthly_budget),
        "total_debt": _money(total_debt),
        "weighted_apr": _money(weighted_apr),
        "monthly_interest_burn": _money(monthly_burn),
        "debt_free_date": debt_free_date.isoformat() if debt_free_date else None,
        "months_to_debt_free": months if debt_free_date else None,
        "debt_free_possible": debt_free_date is not None,
        "total_interest": _money(total_interest),
        "total_paid": _money(total_paid),
        "total_interest_minimums_only": _money(baseline_interest),
        "interest_saved_vs_minimums": _money(interest_saved),
        "payoff_order": payoff_order,
        "cards": card_summaries,
        "timeline": timeline[:60],
        "milestones": milestones,
        "recommendations": recommendations,
        "utilization_forecast": utilization_forecast,
    }


def _weighted_apr(states: list[CardState]) -> Decimal:
    total = sum(s.balance for s in states)
    if total <= 0:
        return Decimal("0")
    weighted = sum(s.balance * s.apr for s in states) / total
    return _quantize(weighted)


def _build_card_summaries(
    all_cards: list[Account],
    final_states: list[CardState],
    payoff_order: list[int],
    timeline: list,
    today: date,
    total_months: int,
    debt_free_date: date | None,
    total_interest: Decimal,
    *,
    planned_monthly_payments: dict[int, Decimal] | None = None,
) -> list[dict[str, Any]]:
    state_by_id = {s.account.pk: s for s in final_states}
    order_rank = {aid: i + 1 for i, aid in enumerate(payoff_order)}
    summaries: list[dict[str, Any]] = []

    for card in all_cards:
        if not card.is_credit_card():
            continue
        owed = ledger_owed_balance(card, today)
        if owed <= 0 and card.pk not in payoff_order:
            continue
        st = state_by_id.get(card.pk)
        balance = st.balance if st else _quantize(owed)
        apr = _effective_apr(card)
        limit = Decimal(str(card.credit_limit or 0))
        util = _quantize(owed / limit * Decimal("100")) if limit > 0 else None
        min_pay = _minimum_payment(card, owed)
        planned = (planned_monthly_payments or {}).get(card.pk)
        pay_amt = _quantize(planned) if planned is not None and planned > 0 else min_pay
        suggested = pay_amt
        single = project_credit_card_payoff(
            card,
            "custom_amount",
            custom_amount=pay_amt,
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
    states: list[CardState],
    cards: list[Account],
    timeline: list,
    payoff_order: list[int],
    today: date,
) -> list[dict[str, Any]]:
    milestones: list[dict[str, Any]] = []
    if payoff_order:
        milestones.append(
            {
                "id": "first_card_paid",
                "label": "First card eliminated",
                "achieved": True,
                "description": "Your first account reaches zero balance in this plan.",
            }
        )

    high_util = any(s.utilization > Decimal("50") for s in states)
    if high_util:
        milestones.append(
            {
                "id": "util_below_50",
                "label": "Utilization below 50%",
                "achieved": False,
                "description": "Household revolving utilization drops under half of limits.",
            }
        )
    milestones.append(
        {
            "id": "util_below_30",
            "label": "Utilization below 30%",
            "achieved": False,
            "description": "Strong credit profile territory for most scoring models.",
        }
    )
    milestones.append(
        {
            "id": "debt_free",
            "label": "Debt-free month",
            "achieved": False,
            "description": "All credit card balances paid off.",
        }
    )
    return milestones


def _build_recommendations(
    states: list[CardState],
    strategy: str,
    interest_saved: Decimal,
    monthly_budget: Decimal,
    *,
    cards: list[Account] | None = None,
) -> list[dict[str, Any]]:
    recs: list[dict[str, Any]] = []
    active = [s for s in states if s.balance > 0]
    if not active and cards:
        active = _load_card_states(cards, as_of=date.today())
    if not active:
        return recs
    focus = _focus_order(active, strategy, None)[0]
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
    high_util = [s for s in states if s.utilization > UTILIZATION_TARGET_PCT]
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


def _empty_plan(today: date, *, paid_off: bool = False) -> dict[str, Any]:
    return {
        "as_of": today.isoformat(),
        "strategy": "avalanche",
        "mode": "aggressive",
        "total_debt": "0.00",
        "weighted_apr": "0.00",
        "monthly_interest_burn": "0.00",
        "debt_free_date": today.isoformat() if paid_off else None,
        "months_to_debt_free": 0 if paid_off else None,
        "debt_free_possible": paid_off,
        "total_interest": "0.00",
        "interest_saved_vs_minimums": "0.00",
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


def build_dashboard_debt_summary(cards: list[Account], *, as_of: date | None = None) -> dict[str, Any]:
    plan = simulate_household_debt(
        cards,
        strategy="avalanche",
        mode="aggressive",
        extra_monthly=Decimal("100"),
        as_of=as_of,
    )
    label = "No credit card debt"
    if Decimal(plan.get("total_debt") or 0) > 0:
        if plan.get("debt_free_date"):
            d = date.fromisoformat(plan["debt_free_date"])
            label = f"Debt-free projected: {d.strftime('%b %Y')}"
        else:
            label = "Payoff needs higher payments"
    msg = None
    saved = plan.get("interest_saved_vs_minimums")
    if saved and Decimal(saved) > 0:
        msg = f"Your plan saves ${saved} interest vs minimums only"
    return {
        "label": label,
        "debt_free_date": plan.get("debt_free_date"),
        "total_debt": plan.get("total_debt"),
        "monthly_interest_burn": plan.get("monthly_interest_burn"),
        "interest_saved_vs_minimums": saved,
        "message": msg,
        "planner_url": "/credit-cards",
        "plan": plan,
    }
