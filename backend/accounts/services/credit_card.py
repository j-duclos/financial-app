"""Credit card balance, statement dates, and transaction classification."""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from typing import Optional

from django.db import transaction
from django.utils import timezone

from accounts.credit_card_models import CreditCardStatement
from accounts.models import Account
from transactions.models import Transaction
from transactions.services.matching import ledger_visible_transactions


def _days_in_month(year: int, month: int) -> int:
    if month == 12:
        return 31
    return (date(year, month + 1, 1) - date(year, month, 1)).days


def _day_in_month(year: int, month: int, day: int) -> date:
    """Map day-of-month to a calendar date; day 31 in February → last day of month."""
    day = max(1, min(31, int(day)))
    last = _days_in_month(year, month)
    return date(year, month, min(day, last))


def calculate_next_statement_date(statement_closing_day: int, today: Optional[date] = None) -> date:
    """Next statement close on or after today."""
    today = today or date.today()
    closing_day = max(1, min(31, int(statement_closing_day)))
    y, m = today.year, today.month
    candidate = _day_in_month(y, m, closing_day)
    if candidate < today:
        m += 1
        if m > 12:
            m, y = 1, y + 1
        candidate = _day_in_month(y, m, closing_day)
    return candidate


def calculate_next_payment_due_date(payment_due_day: int, today: Optional[date] = None) -> date:
    """Next payment due date on or after today."""
    today = today or date.today()
    due_day = max(1, min(31, int(payment_due_day)))
    y, m = today.year, today.month
    candidate = _day_in_month(y, m, due_day)
    if candidate < today:
        m += 1
        if m > 12:
            m, y = 1, y + 1
        candidate = _day_in_month(y, m, due_day)
    return candidate


def _previous_statement_close(closing_day: int, before: date) -> date:
    """Last statement close strictly before ``before``."""
    closing_day = max(1, min(31, int(closing_day)))
    y, m = before.year, before.month
    candidate = _day_in_month(y, m, closing_day)
    if candidate >= before:
        m -= 1
        if m < 1:
            m, y = 12, y - 1
        candidate = _day_in_month(y, m, closing_day)
    return candidate


def refresh_statement_schedule(account: Account, today: Optional[date] = None) -> None:
    """Update next_statement_date and next_payment_due_date from day-of-month fields."""
    if not account.is_credit_card():
        return
    today = today or date.today()
    closing = account.get_statement_closing_day()
    due_day = account.get_payment_due_day()
    updates: list[str] = []
    if closing is not None:
        account.next_statement_date = calculate_next_statement_date(closing, today)
        updates.append("next_statement_date")
    if due_day is not None:
        account.next_payment_due_date = calculate_next_payment_due_date(due_day, today)
        updates.append("next_payment_due_date")
    if updates:
        Account.objects.filter(pk=account.pk).update(**{f: getattr(account, f) for f in updates})


@transaction.atomic
def close_statement_for_account(
    account: Account,
    period_start: date,
    period_end: date,
) -> CreditCardStatement:
    """Close a billing period: snapshot statement balance and open a new statement row."""
    if not account.is_credit_card():
        raise ValueError("Account must be a credit card")
    stmt_balance = Decimal(str(account.current_balance or 0))
    min_pay = Decimal(str(account.minimum_payment_amount or 0))
    due_day = account.get_payment_due_day()
    if due_day is not None:
        payment_due = calculate_next_payment_due_date(due_day, period_end + timedelta(days=1))
    else:
        payment_due = period_end + timedelta(days=21)

    stmt, _ = CreditCardStatement.objects.update_or_create(
        account=account,
        period_start=period_start,
        period_end=period_end,
        defaults={
            "statement_balance": stmt_balance,
            "minimum_payment": min_pay,
            "payment_due_date": payment_due,
            "status": CreditCardStatement.Status.CLOSED,
        },
    )
    account.statement_balance = stmt_balance
    account.last_statement_date = period_end
    account.save(
        update_fields=["statement_balance", "last_statement_date", "updated_at"]
    )
    refresh_statement_schedule(account)
    return stmt


def ledger_owed_balance(account: Account, as_of: Optional[date] = None) -> Decimal:
    """Positive amount owed from ledger (does not flip sign convention)."""
    from timeline.services.ledger import _balance_at_end_of_date

    as_of = as_of or timezone.localdate()
    bal = _balance_at_end_of_date(account.pk, as_of)
    if bal >= 0:
        return Decimal("0")
    return abs(bal)


def sync_current_balance_from_ledger(account: Account, as_of: Optional[date] = None) -> Decimal:
    """Recompute current_balance from ledger; returns positive owed."""
    if not account.is_credit_card():
        return Decimal("0")
    owed = ledger_owed_balance(account, as_of)
    if account.current_balance != owed:
        Account.objects.filter(pk=account.pk).update(
            current_balance=owed,
            updated_at=timezone.now(),
        )
        account.current_balance = owed
    return owed


def classify_plaid_credit_card_type(amount: Decimal, payee: str, memo: str) -> str:
    """Infer transaction_type from Plaid-signed amount and text."""
    text = f"{payee} {memo}".lower()
    if "interest" in text:
        return Transaction.TransactionType.INTEREST_CHARGE
    if "fee" in text or "annual fee" in text or "late fee" in text:
        return Transaction.TransactionType.FEE
    if amount > 0:
        if "refund" in text or "return" in text or "credit" in text:
            return Transaction.TransactionType.CREDIT_CARD_REFUND
        return Transaction.TransactionType.CREDIT_CARD_PAYMENT
    return Transaction.TransactionType.CREDIT_CARD_PURCHASE


def balance_delta_for_transaction_type(txn_type: str, amount: Decimal) -> Decimal:
    """
    Change to current_balance (positive owed) for a credit card transaction.
    Ledger amount: negative = purchase/fee/interest, positive = payment/refund.
    """
    amount = Decimal(str(amount))
    if txn_type == Transaction.TransactionType.BALANCE_ADJUSTMENT:
        return Decimal("0")
    if txn_type in (
        Transaction.TransactionType.CREDIT_CARD_PURCHASE,
        Transaction.TransactionType.FEE,
        Transaction.TransactionType.INTEREST_CHARGE,
    ):
        return -amount if amount < 0 else amount
    if txn_type in (
        Transaction.TransactionType.CREDIT_CARD_PAYMENT,
        Transaction.TransactionType.CREDIT_CARD_REFUND,
    ):
        return -amount if amount > 0 else amount
    # Default: mirror ledger sign
    return -amount


def apply_credit_card_balance_change(
    account: Account,
    delta_owed: Decimal,
    *,
    set_absolute: Optional[Decimal] = None,
) -> None:
    if not account.is_credit_card():
        return
    if set_absolute is not None:
        account.current_balance = max(Decimal("0"), Decimal(str(set_absolute)))
    else:
        account.current_balance = max(
            Decimal("0"),
            Decimal(str(account.current_balance or 0)) + Decimal(str(delta_owed)),
        )
    Account.objects.filter(pk=account.pk).update(
        current_balance=account.current_balance,
        updated_at=timezone.now(),
    )


def apply_transaction_to_credit_card_balance(txn: Transaction, *, reverse: bool = False) -> None:
    """Update account.current_balance when a credit card transaction is posted."""
    account = txn.account
    if not account.is_credit_card():
        return
    if txn.status == Transaction.Status.PLANNED and not reverse:
        return
    txn_type = txn.transaction_type or Transaction.TransactionType.OTHER
    if txn_type == Transaction.TransactionType.BALANCE_ADJUSTMENT:
        if reverse:
            sync_current_balance_from_ledger(account, txn.date)
        else:
            owed = abs(Decimal(str(txn.amount)))
            apply_credit_card_balance_change(account, Decimal("0"), set_absolute=owed)
        return
    mult = Decimal("-1") if reverse else Decimal("1")
    delta = balance_delta_for_transaction_type(txn_type, txn.amount) * mult
    apply_credit_card_balance_change(account, delta)


def initialize_credit_card_from_starting_balance(account: Account) -> None:
    """Set current_balance from starting_balance when creating a card."""
    if not account.is_credit_card():
        return
    sb = account.starting_balance
    if sb is not None and Decimal(str(sb)) > 0:
        account.current_balance = Decimal(str(sb))
    else:
        account.current_balance = ledger_owed_balance(account)
    refresh_statement_schedule(account)
    Account.objects.filter(pk=account.pk).update(
        current_balance=account.current_balance,
        next_statement_date=account.next_statement_date,
        next_payment_due_date=account.next_payment_due_date,
    )
