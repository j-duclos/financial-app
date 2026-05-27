"""Credit card payoff projection (MVP monthly interest model)."""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any, Optional

from accounts.models import Account
from accounts.services.credit_card import ledger_owed_balance

PAYOFF_STRATEGIES = frozenset({
    "minimum_payment",
    "statement_balance",
    "fixed_amount",
    "current_balance",
    "custom_amount",
})

IMPOSSIBLE_MESSAGE = "Payment is too low to reduce balance."


def _quantize_money(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"))


def _money_str(value: Decimal) -> str:
    return str(_quantize_money(value))


def _effective_apr(card: Account) -> Decimal:
    today = date.today()
    promo_end = getattr(card, "promotional_end_date", None)
    promo_apr = getattr(card, "promotional_apr", None)
    if promo_end is not None and today <= promo_end and promo_apr is not None:
        return Decimal(str(promo_apr))
    return Decimal(str(card.apr or 0))


def calculate_monthly_interest(card: Account, balance: Decimal) -> Decimal:
    """MVP: balance * (apr / 100 / 12)."""
    if balance <= 0:
        return Decimal("0")
    apr_val = _effective_apr(card)
    if apr_val <= 0:
        return Decimal("0")
    return _quantize_money(balance * apr_val / Decimal("100") / Decimal("12"))


def _starting_balance(card: Account, as_of: date) -> Decimal:
    return ledger_owed_balance(card, as_of)


def resolve_strategy_payment_amount(
    card: Account,
    strategy: str,
    *,
    custom_amount: Optional[Decimal] = None,
    as_of: Optional[date] = None,
) -> Decimal:
    """Map strategy name to a monthly (or one-shot) payment amount."""
    as_of = as_of or date.today()
    owed = _starting_balance(card, as_of)

    if strategy == "minimum_payment":
        return _quantize_money(Decimal(str(card.minimum_payment_amount or 0)))
    if strategy == "statement_balance":
        stmt = Decimal(str(card.statement_balance or 0))
        if stmt > 0:
            return _quantize_money(stmt)
        return _quantize_money(card.payoff_to_avoid_interest)
    if strategy == "current_balance":
        return _quantize_money(owed)
    if strategy in ("fixed_amount", "custom_amount"):
        if custom_amount is None or custom_amount <= 0:
            raise ValueError(f"strategy '{strategy}' requires a positive payment amount.")
        return _quantize_money(custom_amount)
    raise ValueError(f"Unknown strategy: {strategy}")


def _add_month(d: date) -> date:
    y, m = d.year, d.month + 1
    if m > 12:
        m, y = 1, y + 1
    day = min(d.day, _days_in_month(y, m))
    return date(y, m, day)


def _days_in_month(year: int, month: int) -> int:
    if month == 12:
        next_m = date(year + 1, 1, 1)
    else:
        next_m = date(year, month + 1, 1)
    return (next_m - date(year, month, 1)).days


def project_credit_card_payoff(
    card: Account,
    strategy: str,
    *,
    custom_amount: Optional[Decimal] = None,
    start_date: Optional[date] = None,
    max_months: int = 360,
) -> dict[str, Any]:
    """
    Project payoff using MVP monthly compounding:
    each month add interest, subtract payment, stop when balance <= 0.
    """
    if not card.is_credit_card():
        raise ValueError("Account is not a credit card.")

    if strategy not in PAYOFF_STRATEGIES:
        raise ValueError(f"Invalid strategy. Choose one of: {', '.join(sorted(PAYOFF_STRATEGIES))}")

    today = start_date or date.today()
    apr_val = _effective_apr(card)
    monthly_rate = apr_val / Decimal("100") / Decimal("12") if apr_val > 0 else Decimal("0")

    try:
        payment_amount = resolve_strategy_payment_amount(
            card, strategy, custom_amount=custom_amount, as_of=today,
        )
    except ValueError as exc:
        return _error_projection(card, str(exc), apr_val, monthly_rate)

    starting_balance = _starting_balance(card, today)
    if starting_balance <= 0:
        return _paid_off_projection(card, starting_balance, apr_val, monthly_rate, payment_amount, today)

    if apr_val > 0 and payment_amount > 0:
        first_interest = calculate_monthly_interest(card, starting_balance)
        if payment_amount <= first_interest:
            return _impossible_projection(
                card, starting_balance, apr_val, monthly_rate, payment_amount,
            )

    balance = starting_balance
    total_interest = Decimal("0")
    total_paid = Decimal("0")
    schedule: list[dict[str, Any]] = []
    cursor = today
    months = 0
    payoff_date: date | None = None

    while balance > 0 and months < max_months:
        months += 1
        interest = calculate_monthly_interest(card, balance) if apr_val > 0 else Decimal("0")
        month_start = balance
        balance = _quantize_money(balance + interest)
        payment = min(payment_amount, balance)
        principal = max(Decimal("0"), _quantize_money(payment - interest))
        balance = _quantize_money(balance - payment)
        total_interest += interest
        total_paid += payment
        schedule.append({
            "month": months,
            "starting_balance": _money_str(month_start),
            "interest_charged": _money_str(interest),
            "payment": _money_str(payment),
            "principal_paid": _money_str(principal),
            "ending_balance": _money_str(max(Decimal("0"), balance)),
        })
        cursor = _add_month(cursor)
        if balance <= 0:
            payoff_date = cursor
            break
        if apr_val > 0 and payment_amount <= calculate_monthly_interest(card, balance):
            return _impossible_projection(
                card, starting_balance, apr_val, monthly_rate, payment_amount,
                partial_schedule=schedule,
                months_so_far=months,
            )

    if balance > 0:
        return {
            "payoff_possible": False,
            "message": f"Balance not paid off within {max_months} months at this payment level.",
            "starting_balance": _money_str(starting_balance),
            "apr": _money_str(apr_val),
            "monthly_interest_rate": _money_str(monthly_rate * Decimal("100")),
            "payment_amount": _money_str(payment_amount),
            "strategy": strategy,
            "payoff_date": None,
            "months_to_payoff": months,
            "total_interest": _money_str(total_interest),
            "total_paid": _money_str(total_paid),
            "schedule": schedule,
        }

    return _build_success_result(
        starting_balance=starting_balance,
        apr_val=apr_val,
        monthly_rate=monthly_rate,
        payment_amount=payment_amount,
        strategy=strategy,
        payoff_date=payoff_date,
        months=months,
        total_interest=total_interest,
        total_paid=total_paid,
        schedule=schedule,
    )


def _build_success_result(
    *,
    starting_balance: Decimal,
    apr_val: Decimal,
    monthly_rate: Decimal,
    payment_amount: Decimal,
    strategy: str,
    payoff_date: date | None,
    months: int,
    total_interest: Decimal,
    total_paid: Decimal,
    schedule: list,
) -> dict[str, Any]:
    return {
        "payoff_possible": True,
        "starting_balance": _money_str(starting_balance),
        "apr": _money_str(apr_val),
        "monthly_interest_rate": _money_str(monthly_rate * Decimal("100")),
        "payment_amount": _money_str(payment_amount),
        "strategy": strategy,
        "payoff_date": payoff_date.isoformat() if payoff_date else None,
        "months_to_payoff": months,
        "total_interest": _money_str(total_interest),
        "total_paid": _money_str(total_paid),
        "schedule": schedule,
    }


def compare_payment_strategies(
    card: Account,
    *,
    fixed_amount: Optional[Decimal] = None,
    custom_amount: Optional[Decimal] = None,
    start_date: Optional[date] = None,
) -> dict[str, Any]:
    """Run all standard strategies and return projections keyed by strategy."""
    strategies: list[tuple[str, Optional[Decimal]]] = [
        ("minimum_payment", None),
        ("statement_balance", None),
        ("current_balance", None),
    ]
    if fixed_amount and fixed_amount > 0:
        strategies.append(("fixed_amount", fixed_amount))
    if custom_amount and custom_amount > 0:
        strategies.append(("custom_amount", custom_amount))
    elif card.autopay_enabled and card.autopay_type == Account.AutopayType.FIXED_AMOUNT:
        amt = Decimal(str(card.autopay_fixed_amount or 0))
        if amt > 0:
            strategies.append(("fixed_amount", amt))

    comparisons: dict[str, Any] = {}
    for name, amount in strategies:
        comparisons[name] = project_credit_card_payoff(
            card, name, custom_amount=amount, start_date=start_date,
        )
    return {
        "account_id": card.pk,
        "starting_balance": _money_str(_starting_balance(card, start_date or date.today())),
        "strategies": comparisons,
    }


def payoff_estimates_for_accounts(
    accounts: list[Account],
    *,
    strategy: str = "minimum_payment",
) -> dict[int, dict[str, Any]]:
    """Batch payoff estimate summaries keyed by account id."""
    result: dict[int, dict[str, Any]] = {}
    for card in accounts:
        if not card.is_credit_card():
            continue
        summary = payoff_estimate_summary(card, strategy=strategy)
        if summary:
            result[card.pk] = summary
    return result


def payoff_estimate_summary(
    card: Account,
    *,
    strategy: str = "minimum_payment",
    custom_amount: Optional[Decimal] = None,
) -> dict[str, Any] | None:
    """Compact summary for account list / dashboard."""
    if not card.is_credit_card():
        return None
    owed = _starting_balance(card, date.today())
    if owed <= 0:
        return {"label": "Paid off", "months_to_payoff": 0, "payment_amount": "0"}

    try:
        payment = resolve_strategy_payment_amount(card, strategy, custom_amount=custom_amount)
    except ValueError:
        return None

    proj = project_credit_card_payoff(card, strategy, custom_amount=custom_amount)
    if not proj.get("payoff_possible"):
        return {
            "label": proj.get("message", IMPOSSIBLE_MESSAGE),
            "payoff_possible": False,
            "months_to_payoff": None,
            "payment_amount": _money_str(payment),
        }
    months = proj.get("months_to_payoff", 0)
    if months <= 0:
        return {"label": "Paid off", "months_to_payoff": 0, "payment_amount": _money_str(payment)}
    return {
        "label": f"Paid off in {months} month{'s' if months != 1 else ''} at ${_money_str(payment)}/mo",
        "payoff_possible": True,
        "months_to_payoff": months,
        "payment_amount": _money_str(payment),
        "payoff_date": proj.get("payoff_date"),
        "total_interest": proj.get("total_interest"),
    }


def _paid_off_projection(
    card: Account,
    starting_balance: Decimal,
    apr_val: Decimal,
    monthly_rate: Decimal,
    payment_amount: Decimal,
    today: date,
) -> dict[str, Any]:
    return {
        "payoff_possible": True,
        "starting_balance": _money_str(starting_balance),
        "apr": _money_str(apr_val),
        "monthly_interest_rate": _money_str(monthly_rate * Decimal("100")),
        "payment_amount": _money_str(payment_amount),
        "payoff_date": today.isoformat(),
        "months_to_payoff": 0,
        "total_interest": "0.00",
        "total_paid": "0.00",
        "schedule": [],
    }


def _impossible_projection(
    card: Account,
    starting_balance: Decimal,
    apr_val: Decimal,
    monthly_rate: Decimal,
    payment_amount: Decimal,
    *,
    partial_schedule: list | None = None,
    months_so_far: int = 0,
) -> dict[str, Any]:
    return {
        "payoff_possible": False,
        "message": IMPOSSIBLE_MESSAGE,
        "starting_balance": _money_str(starting_balance),
        "apr": _money_str(apr_val),
        "monthly_interest_rate": _money_str(monthly_rate * Decimal("100")),
        "payment_amount": _money_str(payment_amount),
        "payoff_date": None,
        "months_to_payoff": months_so_far,
        "total_interest": "0.00",
        "total_paid": "0.00",
        "schedule": partial_schedule or [],
    }


def _error_projection(
    card: Account,
    message: str,
    apr_val: Decimal,
    monthly_rate: Decimal,
) -> dict[str, Any]:
    return {
        "payoff_possible": False,
        "message": message,
        "starting_balance": _money_str(_starting_balance(card, date.today())),
        "apr": _money_str(apr_val),
        "monthly_interest_rate": _money_str(monthly_rate * Decimal("100")),
        "payment_amount": "0.00",
        "payoff_date": None,
        "months_to_payoff": 0,
        "total_interest": "0.00",
        "total_paid": "0.00",
        "schedule": [],
    }
