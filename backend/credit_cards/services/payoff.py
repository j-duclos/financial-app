"""Credit card payoff projection (MVP monthly interest model)."""
from __future__ import annotations

from datetime import date
from decimal import ROUND_HALF_UP, ROUND_UP, Decimal
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

# Used only when APR / interest cannot be computed reliably.
IMPOSSIBLE_MESSAGE = "Planned payment may not be enough to reduce the balance."


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
    """MVP: balance * (apr / 100 / 12). Canonical monthly-interest formula."""
    if balance <= 0:
        return Decimal("0")
    apr_val = _effective_apr(card)
    if apr_val <= 0:
        return Decimal("0")
    return _quantize_money(balance * apr_val / Decimal("100") / Decimal("12"))


def min_payment_to_reduce_principal(monthly_interest: Decimal) -> Decimal:
    """Smallest whole-dollar payment that begins reducing principal."""
    if monthly_interest <= 0:
        return Decimal("0.01")
    next_dollar = monthly_interest.to_integral_value(rounding=ROUND_UP)
    if next_dollar <= monthly_interest:
        next_dollar += Decimal("1")
    return next_dollar


def format_payment_below_interest_message(
    payment: Decimal,
    monthly_interest: Decimal,
) -> str:
    """Compact actionable copy when a planned payment cannot cover monthly interest."""
    if monthly_interest <= 0:
        return IMPOSSIBLE_MESSAGE
    min_pay = min_payment_to_reduce_principal(monthly_interest)
    interest_approx = monthly_interest.quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    pay_approx = payment.quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    return (
        f"Planned ${pay_approx:.0f} payment may not cover ~${interest_approx:.0f}/mo interest. "
        f"Increase to at least ~${min_pay:.0f}/mo to begin reducing principal."
    )


def payment_below_interest_details(
    card: Account,
    payment_amount: Decimal,
    balance: Decimal,
) -> dict[str, Any] | None:
    """
    If APR is known and payment cannot reduce principal, return warning details.
    Returns None when the calculation is not reliable or the payment is sufficient.
    """
    if payment_amount <= 0 or balance <= 0:
        return None
    if _effective_apr(card) <= 0:
        return None
    interest = calculate_monthly_interest(card, balance)
    if interest <= 0 or payment_amount > interest:
        return None
    min_reduce = min_payment_to_reduce_principal(interest)
    return {
        "payment_amount": _quantize_money(payment_amount),
        "estimated_monthly_interest": interest,
        "min_payment_to_reduce_principal": min_reduce,
        "message": format_payment_below_interest_message(payment_amount, interest),
    }


def _starting_balance(card: Account, as_of: date) -> Decimal:
    return ledger_owed_balance(card, as_of)


def resolve_strategy_payment_amount(
    card: Account,
    strategy: str,
    *,
    custom_amount: Optional[Decimal] = None,
    as_of: Optional[date] = None,
    starting_balance: Optional[Decimal] = None,
) -> Decimal:
    """Map strategy name to a monthly (or one-shot) payment amount."""
    as_of = as_of or date.today()
    owed = starting_balance if starting_balance is not None else _starting_balance(card, as_of)

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
    starting_balance: Optional[Decimal] = None,
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
    if starting_balance is None:
        starting_balance = _starting_balance(card, today)

    try:
        payment_amount = resolve_strategy_payment_amount(
            card,
            strategy,
            custom_amount=custom_amount,
            as_of=today,
            starting_balance=starting_balance,
        )
    except ValueError as exc:
        return _error_projection(
            card, str(exc), apr_val, monthly_rate, starting_balance=starting_balance
        )
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
    starting_balance: Optional[Decimal] = None,
) -> dict[str, Any]:
    """Run all standard strategies and return projections keyed by strategy."""
    today = start_date or date.today()
    owed = starting_balance if starting_balance is not None else _starting_balance(card, today)
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
            card,
            name,
            custom_amount=amount,
            start_date=today,
            starting_balance=owed,
        )
    return {
        "account_id": card.pk,
        "starting_balance": _money_str(owed),
        "strategies": comparisons,
    }


def payoff_estimates_for_accounts(
    accounts: list[Account],
    *,
    strategy: str = "minimum_payment",
    signed_balances: dict[int, Decimal] | None = None,
) -> dict[int, dict[str, Any]]:
    """Batch payoff estimate summaries keyed by account id."""
    from accounts.services.balances import credit_owed_from_signed_balance

    result: dict[int, dict[str, Any]] = {}
    for card in accounts:
        if not card.is_credit_card():
            continue
        owed = None
        if signed_balances is not None and card.pk in signed_balances:
            owed = credit_owed_from_signed_balance(signed_balances[card.pk])
        summary = payoff_estimate_summary(
            card, strategy=strategy, starting_balance=owed
        )
        if summary:
            result[card.pk] = summary
    return result


def payoff_estimate_summary(
    card: Account,
    *,
    strategy: str = "minimum_payment",
    custom_amount: Optional[Decimal] = None,
    starting_balance: Optional[Decimal] = None,
) -> dict[str, Any] | None:
    """Compact summary for account list / dashboard."""
    if not card.is_credit_card():
        return None
    owed = (
        starting_balance
        if starting_balance is not None
        else _starting_balance(card, date.today())
    )
    if owed <= 0:
        return {"label": "Paid off", "months_to_payoff": 0, "payment_amount": "0"}

    try:
        payment = resolve_strategy_payment_amount(
            card, strategy, custom_amount=custom_amount, starting_balance=owed
        )
    except ValueError:
        return None

    proj = project_credit_card_payoff(
        card, strategy, custom_amount=custom_amount, starting_balance=owed
    )
    if not proj.get("payoff_possible"):
        if payment <= 0:
            return None
        return {
            "label": proj.get("message", IMPOSSIBLE_MESSAGE),
            "payoff_possible": False,
            "months_to_payoff": None,
            "payment_amount": _money_str(payment),
            "estimated_monthly_interest": proj.get("estimated_monthly_interest"),
            "min_payment_to_reduce_principal": proj.get("min_payment_to_reduce_principal"),
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
    details = payment_below_interest_details(card, payment_amount, starting_balance)
    if details:
        message = details["message"]
        interest_str = _money_str(details["estimated_monthly_interest"])
        min_reduce_str = _money_str(details["min_payment_to_reduce_principal"])
    else:
        message = IMPOSSIBLE_MESSAGE
        interest_str = None
        min_reduce_str = None
    return {
        "payoff_possible": False,
        "message": message,
        "starting_balance": _money_str(starting_balance),
        "apr": _money_str(apr_val),
        "monthly_interest_rate": _money_str(monthly_rate * Decimal("100")),
        "payment_amount": _money_str(payment_amount),
        "payoff_date": None,
        "months_to_payoff": months_so_far,
        "total_interest": "0.00",
        "total_paid": "0.00",
        "schedule": partial_schedule or [],
        "estimated_monthly_interest": interest_str,
        "min_payment_to_reduce_principal": min_reduce_str,
    }


def _error_projection(
    card: Account,
    message: str,
    apr_val: Decimal,
    monthly_rate: Decimal,
    *,
    starting_balance: Optional[Decimal] = None,
) -> dict[str, Any]:
    owed = starting_balance if starting_balance is not None else _starting_balance(card, date.today())
    return {
        "payoff_possible": False,
        "message": message,
        "starting_balance": _money_str(owed),
        "apr": _money_str(apr_val),
        "monthly_interest_rate": _money_str(monthly_rate * Decimal("100")),
        "payment_amount": "0.00",
        "payoff_date": None,
        "months_to_payoff": 0,
        "total_interest": "0.00",
        "total_paid": "0.00",
        "schedule": [],
    }
