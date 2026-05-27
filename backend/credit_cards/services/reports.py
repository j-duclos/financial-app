"""Credit card interest reporting from ledger transactions."""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any

from django.db.models import Sum
from django.db.models.functions import Coalesce

from accounts.models import Account
from core.utils import get_households_for_user
from credit_cards.services.payoff import project_credit_card_payoff, resolve_strategy_payment_amount
from transactions.models import Transaction


def _decimal(value) -> Decimal:
    if value is None:
        return Decimal("0")
    return Decimal(str(value))


def build_credit_card_interest_report(user, *, month: str | None = None) -> dict[str, Any]:
    """
    Interest paid (interest_charge txns) by card, totals, and projected remaining
    at minimum payment strategy.
    """
    households = get_households_for_user(user)
    cards = list(
        Account.objects.filter(
            household__in=households,
            account_type=Account.AccountType.CREDIT,
            is_hidden=False,
        ).exclude(status=Account.AccountStatus.DELETED)
    )
    today = date.today()
    year = today.year
    month_int = today.month
    if month:
        year, month_int = map(int, month.split("-"))

    by_card: list[dict[str, Any]] = []
    total_paid_period = Decimal("0")
    total_projected_remaining = Decimal("0")

    for card in cards:
        qs = Transaction.objects.filter(
            account_id=card.pk,
            transaction_type=Transaction.TransactionType.INTEREST_CHARGE,
        )
        if month:
            qs = qs.filter(date__year=year, date__month=month_int)
        interest_paid = _decimal(
            qs.aggregate(s=Coalesce(Sum("amount"), Decimal("0")))["s"]
        )
        interest_paid = abs(interest_paid)

        projected_remaining = Decimal("0")
        try:
            payment = resolve_strategy_payment_amount(card, "minimum_payment", as_of=today)
            if payment > 0:
                proj = project_credit_card_payoff(card, "minimum_payment", start_date=today)
                if proj.get("payoff_possible"):
                    projected_remaining = _decimal(proj.get("total_interest"))
        except ValueError:
            pass

        by_card.append({
            "account_id": card.pk,
            "account_name": card.effective_display_name,
            "interest_paid": str(interest_paid.quantize(Decimal("0.01"))),
            "projected_interest_remaining": str(projected_remaining.quantize(Decimal("0.01"))),
        })
        total_paid_period += interest_paid
        total_projected_remaining += projected_remaining

    return {
        "month": month or f"{year:04d}-{month_int:02d}",
        "by_card": by_card,
        "total_interest_paid": str(total_paid_period.quantize(Decimal("0.01"))),
        "total_projected_interest_remaining": str(
            total_projected_remaining.quantize(Decimal("0.01"))
        ),
    }
