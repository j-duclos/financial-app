"""Credit card interest reporting from ledger transactions."""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any

from django.db.models import Sum
from django.db.models.functions import Coalesce

from accounts.models import Account
from accounts.services.balances import bulk_signed_ledger_balances, credit_owed_from_signed_balance
from credit_cards.services.payoff import project_credit_card_payoff, resolve_strategy_payment_amount
from insights.services.report_context import ReportContext, build_report_context
from transactions.models import Transaction


def _decimal(value) -> Decimal:
    if value is None:
        return Decimal("0")
    return Decimal(str(value))


def _money(value: Decimal) -> str:
    return str(value.quantize(Decimal("0.01")))


def _cards_from_context(ctx: ReportContext) -> list[Account]:
    return [
        acc
        for acc in ctx.accounts
        if acc.account_type == Account.AccountType.CREDIT and not acc.is_hidden
    ]


def _interest_paid_by_account(
    card_ids: list[int],
    *,
    start: date,
    end: date,
) -> dict[int, Decimal]:
    paid, _trend = _interest_aggregates(card_ids, start=start, end=end, month=None)
    return paid


def _interest_aggregates(
    card_ids: list[int],
    *,
    start: date,
    end: date,
    month: str | None,
) -> tuple[dict[int, Decimal], list[dict[str, Any]]]:
    """One grouped query: interest by card (selected month) and monthly trend."""
    if not card_ids:
        return {}, []
    from collections import defaultdict

    from django.db.models.functions import TruncMonth

    from insights.services.report_dates import month_key

    rows = (
        Transaction.objects.filter(
            account_id__in=card_ids,
            transaction_type=Transaction.TransactionType.INTEREST_CHARGE,
            date__gte=start,
            date__lte=end,
        )
        .annotate(month=TruncMonth("date"))
        .values("account_id", "month")
        .annotate(interest_paid=Coalesce(Sum("amount"), Decimal("0")))
    )
    paid_by_account: dict[int, Decimal] = defaultdict(lambda: Decimal("0"))
    trend_by_month: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
    for row in rows:
        amount = abs(_decimal(row["interest_paid"]))
        key = month_key(row["month"])
        trend_by_month[key] += amount
        if month is None or key == month:
            paid_by_account[int(row["account_id"])] += amount
    trend = [
        {"month": key, "interest_paid": _money(trend_by_month[key])}
        for key in sorted(trend_by_month)
    ]
    return dict(paid_by_account), trend


def _payoff_metrics_for_cards(
    cards: list[Account],
    *,
    owed_by_account: dict[int, Decimal],
    as_of: date,
) -> dict[int, Decimal]:
    """Pure Python payoff interest remaining. No SQL after balances are loaded."""
    projected: dict[int, Decimal] = {}
    for card in cards:
        owed = owed_by_account.get(card.pk, Decimal("0"))
        projected[card.pk] = Decimal("0")
        try:
            payment = resolve_strategy_payment_amount(
                card, "minimum_payment", as_of=as_of, starting_balance=owed
            )
            if payment <= 0:
                continue
            proj = project_credit_card_payoff(
                card,
                "minimum_payment",
                start_date=as_of,
                starting_balance=owed,
            )
            if proj.get("payoff_possible"):
                projected[card.pk] = _decimal(proj.get("total_interest"))
        except ValueError:
            continue
    return projected


def build_credit_card_interest_report(
    user,
    *,
    month: str | None = None,
    context: ReportContext | None = None,
    as_of: date | None = None,
) -> dict[str, Any]:
    """
    Interest paid (interest_charge txns) by card, totals, and projected remaining
    at minimum payment strategy.
    """
    today = date.today()
    if context is not None:
        period = context.period
        cards = _cards_from_context(context)
    else:
        if not month:
            month = today.strftime("%Y-%m")
        context = build_report_context(user, month)
        period = context.period
        cards = _cards_from_context(context)

    as_of_date = as_of or min(today, period.end)
    signed = bulk_signed_ledger_balances(cards, as_of_date)
    owed_by_account = {
        card.pk: credit_owed_from_signed_balance(signed.get(card.pk, Decimal("0")))
        for card in cards
    }
    interest_paid_by_account, interest_trend = _interest_aggregates(
        [card.pk for card in cards],
        start=period.history_start,
        end=period.end,
        month=period.month,
    )
    projected_by_account = _payoff_metrics_for_cards(
        cards, owed_by_account=owed_by_account, as_of=as_of_date
    )

    by_card: list[dict[str, Any]] = []
    total_paid_period = Decimal("0")
    total_projected_remaining = Decimal("0")
    highest_apr: Account | None = None
    highest_util: tuple[Account, Decimal] | None = None

    for card in cards:
        interest_paid = interest_paid_by_account.get(card.pk, Decimal("0"))
        projected_remaining = projected_by_account.get(card.pk, Decimal("0"))
        owed = owed_by_account.get(card.pk, Decimal("0"))
        limit = _decimal(card.credit_limit or 0)
        util = None
        if limit > 0:
            util = (owed / limit * Decimal("100")).quantize(Decimal("0.1"))
            if highest_util is None or util > highest_util[1]:
                highest_util = (card, util)
        apr = _decimal(card.apr or 0)
        if highest_apr is None or apr > _decimal(highest_apr.apr or 0):
            highest_apr = card
        by_card.append(
            {
                "account_id": card.pk,
                "account_name": card.effective_display_name,
                "interest_paid": _money(interest_paid),
                "projected_interest_remaining": _money(projected_remaining),
                "apr": str(apr.quantize(Decimal("0.01"))) if apr else None,
                "utilization_percent": str(util) if util is not None else None,
                "balance_owed": _money(owed),
            }
        )
        total_paid_period += interest_paid
        total_projected_remaining += projected_remaining

    return {
        "month": period.month,
        "by_card": by_card,
        "total_interest_paid": _money(total_paid_period),
        "total_projected_interest_remaining": _money(total_projected_remaining),
        "highest_apr_card": (
            {
                "account_id": highest_apr.pk,
                "account_name": highest_apr.effective_display_name,
                "apr": str(_decimal(highest_apr.apr or 0).quantize(Decimal("0.01"))),
            }
            if highest_apr is not None
            else None
        ),
        "highest_utilization_card": (
            {
                "account_id": highest_util[0].pk,
                "account_name": highest_util[0].effective_display_name,
                "utilization_percent": str(highest_util[1]),
            }
            if highest_util is not None
            else None
        ),
        "interest_trend": interest_trend,
    }


__all__ = [
    "build_credit_card_interest_report",
    "_payoff_metrics_for_cards",
    "_interest_paid_by_account",
]
