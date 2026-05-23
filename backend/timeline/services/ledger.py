"""
Projection engine: rule occurrence generation and timeline build.
Recurring rule instances are evaluated in date order; debt payments may materialize as PLANNED
rows or be skipped and purged when the destination balance is already clear on that date.
"""
import logging
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal
from typing import Any, Collection, Optional

from django.db.models import Sum
from django.db.models.functions import Coalesce
from django.utils import timezone

from accounts.models import Account
from core.utils import get_households_for_user
from timeline.models import (
    InterestCycleSkip,
    RecurringRule,
    RecurringRuleSkip,
    Scenario,
    ScenarioRuleOverride,
)
from transactions.models import Transaction
from transactions.services.matching import ledger_visible_transactions, try_match_rule_to_pending_imports

logger = logging.getLogger(__name__)


def _safe_try_match_rule_to_pending_imports(txn: Transaction) -> None:
    """Link rule materializations to Plaid rows that synced earlier (never break timeline build)."""
    try:
        try_match_rule_to_pending_imports(txn)
    except Exception:
        logger.exception("try_match_rule_to_pending_imports failed for transaction pk=%s", txn.pk)


def _category_suggests_loan_payment(category_name: Optional[str]) -> bool:
    if not category_name or not str(category_name).strip():
        return False
    n = str(category_name).lower()
    return any(k in n for k in ("loan", "mortgage", "debt", "heloc"))


def _account_is_debt_payment_destination(acc: Account, category_name: Optional[str]) -> bool:
    if acc.account_type == Account.AccountType.CREDIT:
        return True
    if acc.account_type == Account.AccountType.OTHER and _category_suggests_loan_payment(category_name):
        return True
    return False


def _category_name_allows_rule_transfer_destination(category_name: Optional[str]) -> bool:
    """
    RecurringRule.transfer_to_account is only meaningful for these categories (same as Rules UI).
    Stale FK rows must not force transfer/skip logic for plain expenses (e.g. Shopping).
    """
    n = (category_name or "").strip()
    return n in ("Credit Card Payment", "Bank Transfer")


def _db_card_postings_in_exclusive_range(
    card_account_id: int,
    after_date: date,
    through_date: date,
) -> Decimal:
    """Signed sum of ledger-visible postings on the card with date in (after_date, through_date]."""
    qs = ledger_visible_transactions(
        Transaction.objects.filter(
            account_id=card_account_id,
            date__gt=after_date,
            date__lte=through_date,
        )
    )
    return sum((Decimal(str(a)) for a in qs.values_list("amount", flat=True)), start=Decimal("0"))


def _future_recurring_expense_impact_on_card(
    card_account_id: int,
    payment_date: date,
    through_date: date,
    households,
) -> Decimal:
    """
    Signed incremental debt from recurring EXPENSE rules that post on this card strictly after
    payment_date through through_date. Usually negative. Skips dates that already have any
    posting on this card (those are covered by DB sums). Omits rules with transfer_to_account set.
    """
    total = Decimal("0")
    rules = RecurringRule.objects.filter(
        household__in=households,
        active=True,
        account_id=card_account_id,
        direction=RecurringRule.Direction.EXPENSE,
        transfer_to_account__isnull=True,
    )
    occ_start = payment_date + timedelta(days=1)
    if occ_start > through_date:
        return Decimal("0")
    for rule in rules:
        raw_amt = Decimal(str(rule.amount))
        amt_delta = -abs(raw_amt)
        for d in generate_rule_occurrences(rule, occ_start, through_date):
            if d <= payment_date:
                continue
            if Transaction.objects.filter(account_id=card_account_id, date=d).exists():
                continue
            total += amt_delta
    return total


def _purge_skipped_rule_occurrence(rule_id: int, occurrence_date: date, as_of_today: date) -> None:
    """
    Remove all RULE-sourced rows for this occurrence (any status) so skipped payments do not
    respawn. Old rows were often status=CLEARED (model default) before we forced PLANNED, so
    filtering only PLANNED left ghosts in the DB.
    """
    if occurrence_date < as_of_today:
        return
    Transaction.objects.filter(
        rule_id=rule_id,
        date=occurrence_date,
        source=Transaction.Source.RULE,
    ).delete()


def _liability_balance_through_date(
    account_id: int,
    as_of_date: date,
    rows: list[dict],
    *,
    include_row_leg_without_txn: bool,
    include_db_postings_on_as_of_date: bool = False,
    exclude_transaction_ids: Optional[Collection[int]] = None,
) -> Decimal:
    """
    Signed balance for a non-credit liability account (e.g. OTHER loan): starting_balance + txns.
    Convention matches bank-style accounts: negative balance = owed principal (payments are inflows).
    """
    acc = Account.objects.filter(pk=account_id).first()
    if not acc:
        return Decimal("0")
    ex = exclude_transaction_ids
    opening_one = Decimal(str(acc.starting_balance)) if acc.starting_balance is not None else Decimal("0")
    if include_db_postings_on_as_of_date:
        before_qs = ledger_visible_transactions(
            Transaction.objects.filter(account_id=account_id, date__lt=as_of_date)
        )
        on_day_qs = ledger_visible_transactions(
            Transaction.objects.filter(account_id=account_id, date=as_of_date)
        )
        if ex:
            before_qs = before_qs.exclude(pk__in=ex)
            on_day_qs = on_day_qs.exclude(pk__in=ex)
        balance = opening_one + sum(
            (Decimal(str(a)) for a in before_qs.values_list("amount", flat=True)), start=Decimal("0")
        )
        balance += sum(
            (Decimal(str(a)) for a in on_day_qs.values_list("amount", flat=True)), start=Decimal("0")
        )
        if include_row_leg_without_txn:
            for r in rows:
                if r.get("account_id") != account_id:
                    continue
                rd = r.get("date")
                if rd is None:
                    continue
                if isinstance(rd, str):
                    rd = date.fromisoformat(rd[:10]) if rd else None
                if rd != as_of_date or r.get("transaction_id") is not None:
                    continue
                amt = r.get("amount")
                try:
                    amt_d = Decimal(str(amt)) if amt is not None else Decimal("0")
                except (TypeError, ValueError):
                    continue
                balance += amt_d
        return balance

    txns_qs = ledger_visible_transactions(
        Transaction.objects.filter(account_id=account_id, date__lte=as_of_date)
    )
    if ex:
        txns_qs = txns_qs.exclude(pk__in=ex)
    balance = opening_one + sum(
        (Decimal(str(a)) for a in txns_qs.values_list("amount", flat=True)), start=Decimal("0")
    )
    for r in rows:
        if r.get("account_id") != account_id:
            continue
        rd = r.get("date")
        if rd is None:
            continue
        if isinstance(rd, str):
            rd = date.fromisoformat(rd[:10]) if rd else None
        if rd is None or rd > as_of_date:
            continue
        amt = r.get("amount")
        try:
            amt_d = Decimal(str(amt)) if amt is not None else Decimal("0")
        except (TypeError, ValueError):
            continue
        if include_row_leg_without_txn:
            if r.get("transaction_id") is not None:
                continue
            balance += amt_d
        else:
            if r.get("source") != "rule":
                continue
            balance += amt_d
    return balance


def _skip_payment_to_debt_destination(
    dest_account: Account,
    payment_date: date,
    rows: list[dict],
    payment_amount: Optional[Decimal],
    *,
    exclude_transaction_ids: Optional[Collection[int]] = None,
    category_name: Optional[str] = None,
) -> bool:
    """
    True if we should not project/materialize a payment into dest_account on payment_date
    because there is no debt before this payment (balance >= 0 in app convention).

    We intentionally do *not* skip based on (balance + payment) > 0 (would overpay): projected
    credit-card interest is appended to ``rows`` only *after* the rule loop, so during skip
    checks the balance often ignores interest that posts earlier in the same month. That made
    debt look smaller than it is and incorrectly skipped minimum payments after a few months.
    """
    _ = payment_amount  # reserved for API; skip uses balance only (see docstring)
    if not _account_is_debt_payment_destination(dest_account, category_name):
        return False
    if dest_account.account_type == Account.AccountType.CREDIT:
        balance = _credit_card_balance_through_date(
            dest_account.id,
            payment_date,
            rows,
            include_row_leg_without_txn=True,
            include_db_postings_on_as_of_date=True,
            exclude_transaction_ids=exclude_transaction_ids,
        )
    else:
        balance = _liability_balance_through_date(
            dest_account.id,
            payment_date,
            rows,
            include_row_leg_without_txn=True,
            include_db_postings_on_as_of_date=True,
            exclude_transaction_ids=exclude_transaction_ids,
        )
    return balance >= 0


def _materialize_rule_occurrence(
    rule: RecurringRule,
    d: date,
    account_id: int,
    amount: Decimal,
    payee: str,
    category_id: Optional[int],
) -> Transaction:
    """Get or create a Transaction for this rule occurrence. If one already exists, return it as-is so user edits (e.g. "this occurrence only" amount change) are preserved."""
    txn = (
        Transaction.objects.filter(rule=rule, date=d, account_id=account_id)
        .select_related("account", "category")
        .first()
    )
    if txn is not None:
        _safe_try_match_rule_to_pending_imports(txn)
        return txn
    created = Transaction.objects.create(
        account_id=account_id,
        date=d,
        payee=payee or "—",
        memo="",
        amount=amount,
        category_id=category_id,
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.RULE,
        rule=rule,
    )
    _safe_try_match_rule_to_pending_imports(created)
    return created


def generate_rule_occurrences(
    rule: RecurringRule,
    start_date: date,
    end_date: date,
    effective_start: Optional[date] = None,
    effective_end: Optional[date] = None,
) -> list[date]:
    """
    Generate list of occurrence dates for a rule within [start_date, end_date].
    Uses rule's start_date/end_date unless effective_start/effective_end provided (e.g. from scenario).
    Respects interval and frequency. No duplicates; sorted ascending.
    """
    if not rule.active:
        return []
    start = max(start_date, effective_start or rule.start_date)
    end = end_date
    if effective_end is not None:
        end = min(end, effective_end)
    if (rule.end_date and rule.end_date < end) or (effective_end and effective_end < end):
        end = min(end, effective_end or rule.end_date or end)
    if rule.end_date:
        end = min(end, rule.end_date)
    if start > end:
        return []

    interval = max(1, rule.interval or 1)
    out: list[date] = []
    freq = rule.frequency

    if freq == RecurringRule.Frequency.WEEKLY:
        dow = rule.day_of_week if rule.day_of_week is not None else (rule.start_date.weekday() % 7)
        # First occurrence of target weekday on or after start
        d = start
        while d.weekday() != dow:
            d += timedelta(days=1)
        # If that date is before rule.start_date, advance by full weeks to keep weekday correct
        while d < rule.start_date:
            d += timedelta(weeks=interval)
        while d <= end:
            if d >= rule.start_date and (not rule.end_date or d <= rule.end_date):
                out.append(d)
            d += timedelta(weeks=interval)

    elif freq == RecurringRule.Frequency.BIWEEKLY:
        dow = rule.day_of_week if rule.day_of_week is not None else (rule.start_date.weekday() % 7)
        d = start
        while d.weekday() != dow:
            d += timedelta(days=1)
        while d < rule.start_date:
            d += timedelta(weeks=2 * interval)
        while d <= end:
            if d >= rule.start_date and (not rule.end_date or d <= rule.end_date):
                out.append(d)
            d += timedelta(weeks=2 * interval)

    elif freq == RecurringRule.Frequency.MONTHLY_DAY:
        day = rule.day_of_month if rule.day_of_month is not None else rule.start_date.day
        day = max(1, min(31, day))
        y, m = start.year, start.month
        month_count = 0
        while (y, m) <= (end.year, end.month):
            try:
                d = date(y, m, min(day, _days_in_month(y, m)))
            except ValueError:
                d = date(y, m, _days_in_month(y, m))
            if rule.start_date <= d <= end and (not rule.end_date or d <= rule.end_date):
                if month_count % interval == 0:
                    out.append(d)
            month_count += 1
            m += 1
            if m > 12:
                m, y = 1, y + 1

    elif freq == RecurringRule.Frequency.MONTHLY_NTH_WEEKDAY:
        dow = rule.day_of_week if rule.day_of_week is not None else (rule.start_date.weekday() % 7)
        nth = rule.nth_week if rule.nth_week is not None else 1
        nth = max(1, min(5, nth))
        y, m = start.year, start.month
        month_count = 0
        while (y, m) <= (end.year, end.month):
            d = _nth_weekday_in_month(y, m, dow, nth)
            if d and rule.start_date <= d <= end and (not rule.end_date or d <= rule.end_date):
                if month_count % interval == 0:
                    out.append(d)
            month_count += 1
            m += 1
            if m > 12:
                m, y = 1, y + 1

    elif freq == RecurringRule.Frequency.YEARLY:
        ref = rule.start_date
        y = start.year
        while y <= end.year:
            try:
                d = date(y, ref.month, min(ref.day, _days_in_month(y, ref.month)))
            except ValueError:
                d = date(y, ref.month, _days_in_month(y, ref.month))
            if start <= d <= end and (not rule.end_date or d <= rule.end_date):
                if (y - rule.start_date.year) % interval == 0:
                    out.append(d)
            y += 1

    return sorted(set(out))


def _days_in_month(year: int, month: int) -> int:
    if month == 12:
        return 31
    return (date(year, month + 1, 1) - date(year, month, 1)).days


def _cycle_end_dates_in_range(
    cycle_day: int,
    start_date: date,
    end_date: date,
    on_or_after: Optional[date] = None,
) -> list[date]:
    """Return cycle end dates (day-of-month = cycle_day) in [start_date, end_date].
    If on_or_after is set, only include dates >= on_or_after."""
    cycle_day = max(1, min(31, cycle_day))
    out: list[date] = []
    y, m = start_date.year, start_date.month
    while (y, m) <= (end_date.year, end_date.month):
        last = _days_in_month(y, m)
        d = date(y, m, min(cycle_day, last))
        if start_date <= d <= end_date and (on_or_after is None or d >= on_or_after):
            out.append(d)
        m += 1
        if m > 12:
            m, y = 1, y + 1
    return out


def _balance_at_date_from_rows(
    account_id: int,
    as_of_date: date,
    rows: list[dict],
    opening: dict[int, Decimal],
) -> Decimal:
    """Balance for account at end of as_of_date from opening + rows with date <= as_of_date."""
    total = opening.get(account_id, Decimal("0"))
    for r in rows:
        if r["account_id"] == account_id and r["date"] <= as_of_date:
            amt = r["amount"] if isinstance(r["amount"], Decimal) else Decimal(str(r["amount"]))
            total += amt
    return total


def _nth_weekday_in_month(year: int, month: int, weekday: int, n: int) -> Optional[date]:
    """weekday 0=Monday..6=Sunday. n=1..5. Return nth occurrence of that weekday in month."""
    first = date(year, month, 1)
    # first weekday occurrence
    delta = (weekday - first.weekday()) % 7
    if delta == 0 and first.weekday() != weekday:
        delta = 7
    first_occ = first + timedelta(days=delta)
    # n-th occurrence
    occ = first_occ + timedelta(weeks=n - 1)
    if occ.month != month:
        return None
    return occ


def apply_scenario_overrides(rule: RecurringRule, scenario: Optional[Scenario]) -> dict[str, Any]:
    """
    Return an "effective rule" as a dict with base rule fields plus any overrides from the scenario.
    Used for timeline projection when scenario_id is set.
    """
    effective = {
        "id": rule.id,
        "name": rule.name,
        "account_id": rule.account_id,
        "category_id": getattr(rule.category_id, "pk", rule.category_id),
        "direction": rule.direction,
        "amount": rule.amount,
        "currency": rule.currency,
        "frequency": rule.frequency,
        "interval": rule.interval,
        "day_of_week": rule.day_of_week,
        "day_of_month": rule.day_of_month,
        "nth_week": rule.nth_week,
        "start_date": rule.start_date,
        "end_date": rule.end_date,
        "active": rule.active,
        "notes": rule.notes,
    }
    if not scenario:
        return effective
    try:
        override = ScenarioRuleOverride.objects.get(scenario=scenario, rule=rule)
    except ScenarioRuleOverride.DoesNotExist:
        return effective
    if override.override_amount is not None:
        effective["amount"] = override.override_amount
    if override.override_active is not None:
        effective["active"] = override.override_active
    if override.override_start_date is not None:
        effective["start_date"] = override.override_start_date
    if override.override_end_date is not None:
        effective["end_date"] = override.override_end_date
    if override.override_account_id is not None:
        effective["account_id"] = override.override_account_id
    if override.override_category_id is not None:
        effective["category_id"] = override.override_category_id
    return effective


def _opening_balance(account_id: int, as_of_date: date) -> Decimal:
    """Balance for account as of end of day before as_of_date. amount is signed: positive=inflow, negative=outflow.
    For CREDIT accounts, negate so debt is negative: debits (expenses) make balance more negative, credits (payments) less negative.
    Includes all transaction sources (ACTUAL, RULE, ONE_TIME) so interest uses full balance."""
    acc = Account.objects.filter(pk=account_id).first()
    txns = ledger_visible_transactions(
        Transaction.objects.filter(
            account_id=account_id,
            date__lt=as_of_date,
        ).exclude(source=Transaction.Source.INTEREST)
    ).values_list("amount", flat=True)
    txn_sum = sum((Decimal(str(a)) for a in txns), start=Decimal("0"))
    opening = Decimal("0")
    credit_opening_pre_negated = False
    if acc and acc.starting_balance is not None:
        opening = Decimal(str(acc.starting_balance))
        # Match timeline: opening debt entered as a positive starting_balance is stored as negative signed balance.
        if acc.account_type == Account.AccountType.CREDIT and opening > 0:
            opening = -opening
            credit_opening_pre_negated = True
    total = opening + txn_sum
    # Legacy cards with unsigned (all-positive) activity and non-positive starting balance.
    if (
        acc
        and acc.account_type == Account.AccountType.CREDIT
        and total > 0
        and not credit_opening_pre_negated
    ):
        total = -total
    return total


def _balance_at_end_of_date(account_id: int, d: date) -> Decimal:
    """Balance at end of day d (only actual transactions)."""
    return _opening_balance(account_id, d + timedelta(days=1))


def payoff_projection(
    account_id: int,
    monthly_payment: Decimal,
    as_of_date: Optional[date] = None,
    max_months: int = 360,
) -> Optional[dict]:
    """
    For a CREDIT account: project how many months of fixed monthly payments until balance is zero.
    Returns dict with months_to_payoff, total_interest, payoff_date (last payment date), or None if not applicable.
    Simulates: each billing period apply payment then charge interest on remaining balance.
    """
    today = as_of_date or date.today()
    acc = Account.objects.filter(pk=account_id).first()
    if not acc or acc.account_type != Account.AccountType.CREDIT:
        return None
    cycle_day = acc.get_statement_closing_day() if hasattr(acc, "get_statement_closing_day") else getattr(acc, "billing_cycle_end_day", None)
    apr_val = getattr(acc, "apr", None)
    if cycle_day is None or apr_val is None or monthly_payment <= 0:
        return None
    balance = _balance_at_end_of_date(account_id, today)
    if balance >= 0:
        return {
            "months_to_payoff": 0,
            "total_interest": "0",
            "payoff_date": today.isoformat(),
            "current_balance": str(balance),
        }
    promo_end = getattr(acc, "promotional_end_date", None)
    promo_apr = getattr(acc, "promotional_apr", None)
    cycle_day = max(1, min(31, int(cycle_day)))
    total_interest = Decimal("0")
    months = 0
    payoff_date: Optional[date] = None
    # Next cycle end on or after today
    y, m = today.year, today.month
    try:
        d = date(y, m, min(cycle_day, _days_in_month(y, m)))
    except ValueError:
        d = date(y, m, _days_in_month(y, m))
    if d < today:
        m += 1
        if m > 12:
            m, y = 1, y + 1
        try:
            d = date(y, m, min(cycle_day, _days_in_month(y, m)))
        except ValueError:
            d = date(y, m, _days_in_month(y, m))
    prev_cycle_end = _previous_cycle_end(d) if d > today else today
    while balance < 0 and months < max_months:
        months += 1
        balance += monthly_payment
        if balance >= 0:
            payoff_date = d
            break
        period_start = prev_cycle_end + timedelta(days=1)
        period_end = d
        num_days = (period_end - period_start).days + 1
        if num_days <= 0:
            prev_cycle_end = d
            m += 1
            if m > 12:
                m, y = 1, y + 1
            try:
                d = date(y, m, min(cycle_day, _days_in_month(y, m)))
            except ValueError:
                d = date(y, m, _days_in_month(y, m))
            continue
        # Use promotional APR until promotional_end_date, then standard APR
        if promo_end is not None and d <= promo_end and promo_apr is not None:
            effective_apr = Decimal(str(promo_apr))
        else:
            effective_apr = Decimal(str(apr_val))
        interest = abs(balance) * effective_apr / Decimal("100") * Decimal(str(num_days)) / Decimal("365")
        interest = interest.quantize(Decimal("0.01"))
        total_interest += interest
        balance -= interest
        payoff_date = d
        prev_cycle_end = d
        m += 1
        if m > 12:
            m, y = 1, y + 1
        try:
            d = date(y, m, min(cycle_day, _days_in_month(y, m)))
        except ValueError:
            d = date(y, m, _days_in_month(y, m))
    return {
        "months_to_payoff": months,
        "total_interest": str(total_interest),
        "payoff_date": payoff_date.isoformat() if payoff_date else None,
        "current_balance": str(_balance_at_end_of_date(account_id, today)),
    }


def _sum_payments_to_card_from_other_accounts(
    card_account_id: int,
    card_name: str,
    through_date: date,
    households,
) -> Decimal:
    """Sum of actual outflows (payments) from any other account in the household where payee matches card name.
    Used when viewing the card only so we still count payments from Chase etc. that aren't in the timeline rows."""
    if not (households and card_name and card_name.strip()):
        return Decimal("0")
    name = card_name.strip()
    agg = ledger_visible_transactions(
        Transaction.objects.filter(
            account__household__in=households,
            date__lte=through_date,
            amount__lt=0,
            payee__iexact=name,
        )
    ).exclude(account_id=card_account_id).aggregate(s=Sum("amount"))
    s = agg.get("s")
    if s is None:
        return Decimal("0")
    return abs(s)


def _raw_balance_at_end_of_date(account_id: int, as_of_date: date) -> Decimal:
    """Balance at end of as_of_date from actual transactions only, without CREDIT sign flip.
    Used to detect 'no debt': raw <= 0 means paid off or in credit (overpayment)."""
    acc = Account.objects.filter(pk=account_id).first()
    txns = ledger_visible_transactions(
        Transaction.objects.filter(
            account_id=account_id,
            date__lte=as_of_date,
        )
    ).values_list("amount", flat=True)
    total = sum((Decimal(str(a)) for a in txns), start=Decimal("0"))
    if acc and acc.starting_balance is not None:
        total += Decimal(str(acc.starting_balance))
    return total


def _credit_card_balance_through_date(
    card_account_id: int,
    as_of_date: date,
    rows: list[dict],
    *,
    include_row_leg_without_txn: bool,
    include_db_postings_on_as_of_date: bool = False,
    exclude_transaction_ids: Optional[Collection[int]] = None,
) -> Decimal:
    """
    Signed balance for a CREDIT account (starting balance + activity).

    If include_db_postings_on_as_of_date is False: sum DB postings with date <= as_of_date
    (typically as_of_date = day before payment). Optionally add ``rows`` with date <= as_of_date
    and transaction_id None (or source rule when include_row_leg_without_txn is False).

    If True: as_of_date is the payment date; sum DB date < as_of_date, then all DB postings on
    that date (so earlier same-day rule payments are included). Add only non-DB rows on that
    date (transaction_id is None) when include_row_leg_without_txn is True.
    """
    acc = Account.objects.filter(pk=card_account_id).first()
    if not acc or acc.account_type != Account.AccountType.CREDIT:
        return Decimal("0")
    sb = Decimal(str(acc.starting_balance)) if acc.starting_balance is not None else Decimal("0")
    if acc.account_type == Account.AccountType.CREDIT and sb > 0:
        opening_one = -sb
    else:
        opening_one = sb
    ex = exclude_transaction_ids
    if include_db_postings_on_as_of_date:
        before_qs = ledger_visible_transactions(
            Transaction.objects.filter(
                account_id=card_account_id,
                date__lt=as_of_date,
            )
        )
        on_day_qs = ledger_visible_transactions(
            Transaction.objects.filter(
                account_id=card_account_id,
                date=as_of_date,
            )
        )
        if ex:
            before_qs = before_qs.exclude(pk__in=ex)
            on_day_qs = on_day_qs.exclude(pk__in=ex)
        before = before_qs.values_list("amount", flat=True)
        on_day = on_day_qs.values_list("amount", flat=True)
        balance = opening_one + sum((Decimal(str(a)) for a in before), start=Decimal("0"))
        balance += sum((Decimal(str(a)) for a in on_day), start=Decimal("0"))
        if include_row_leg_without_txn:
            for r in rows:
                if r.get("account_id") != card_account_id:
                    continue
                rd = r.get("date")
                if rd is None:
                    continue
                if isinstance(rd, str):
                    rd = date.fromisoformat(rd[:10]) if rd else None
                if rd != as_of_date or r.get("transaction_id") is not None:
                    continue
                amt = r.get("amount")
                try:
                    amt_d = Decimal(str(amt)) if amt is not None else Decimal("0")
                except (TypeError, ValueError):
                    continue
                balance += amt_d
        return balance

    txns_qs = ledger_visible_transactions(
        Transaction.objects.filter(
            account_id=card_account_id,
            date__lte=as_of_date,
        )
    )
    if ex:
        txns_qs = txns_qs.exclude(pk__in=ex)
    txns = txns_qs.values_list("amount", flat=True)
    balance = opening_one + sum((Decimal(str(a)) for a in txns), start=Decimal("0"))
    for r in rows:
        if r.get("account_id") != card_account_id:
            continue
        rd = r.get("date")
        if rd is None:
            continue
        if isinstance(rd, str):
            rd = date.fromisoformat(rd[:10]) if rd else None
        if rd is None or rd > as_of_date:
            continue
        amt = r.get("amount")
        try:
            amt_d = Decimal(str(amt)) if amt is not None else Decimal("0")
        except (TypeError, ValueError):
            continue
        if include_row_leg_without_txn:
            if r.get("transaction_id") is not None:
                continue
            balance += amt_d
        else:
            if r.get("source") != "rule":
                continue
            balance += amt_d
    return balance


def _previous_cycle_end(cycle_end: date) -> date:
    """Cycle end date for the month before cycle_end (same day of month, or last day if shorter)."""
    if cycle_end.month == 1:
        prev_year, prev_month = cycle_end.year - 1, 12
    else:
        prev_year, prev_month = cycle_end.year, cycle_end.month - 1
    last_day = _days_in_month(prev_year, prev_month)
    day = min(cycle_end.day, last_day)
    return date(prev_year, prev_month, day)


def _interest_for_cycle_from_rows(
    account_id: int,
    cycle_end: date,
    apr_pct: Decimal,
    rows: list[dict],
    opening: dict[int, Decimal],
) -> Optional[Decimal]:
    """
    Interest for the billing period ending on cycle_end using Average Daily Balance (ADB)
    computed from projected rows (so previous months' projected interest is included).
    Returns None if no debt (ADB >= 0) or zero interest.
    """
    prev = _previous_cycle_end(cycle_end)
    period_start = prev + timedelta(days=1)
    period_end = cycle_end
    num_days = (period_end - period_start).days + 1
    if num_days <= 0:
        return None
    balance_sum = Decimal("0")
    d = period_start
    while d <= period_end:
        balance_sum += _balance_at_date_from_rows(account_id, d, rows, opening)
        d += timedelta(days=1)
    adb = balance_sum / num_days
    if adb >= 0:
        return None
    interest = abs(adb) * apr_pct / Decimal("100") * Decimal(str(num_days)) / Decimal("365")
    return interest.quantize(Decimal("0.01"))


def _interest_average_daily_balance(
    account_id: int,
    cycle_end: date,
    apr_pct: Decimal,
    as_of_date: Optional[date] = None,
) -> Optional[Decimal]:
    """
    Interest for the billing period ending on cycle_end using Average Daily Balance (ADB).
    Period = day after previous cycle end through cycle_end. Interest = ADB × (APR/100) × (days/365).
    For days after as_of_date (default today), uses balance at end of as_of_date (for projected interest).
    Returns None if no debt (ADB non-negative) or zero interest.
    """
    today = as_of_date or date.today()
    raw_balance_today = _raw_balance_at_end_of_date(account_id, today)
    acc = Account.objects.filter(pk=account_id).first()
    # Don't project interest when there's no debt. For CREDIT: raw < 0 = debt when starting_balance <= 0;
    # when starting_balance > 0 (entered as "opening debt"), raw > 0 = debt.
    if acc and acc.account_type == Account.AccountType.CREDIT:
        sb = acc.starting_balance
        if sb is not None and sb > 0:
            if raw_balance_today <= 0:
                return None  # paid off or in credit
        else:
            if raw_balance_today >= 0:
                return None  # paid off or in credit
    else:
        if raw_balance_today >= 0:
            return None
    prev = _previous_cycle_end(cycle_end)
    period_start = prev + timedelta(days=1)
    period_end = cycle_end
    num_days = (period_end - period_start).days + 1
    if num_days <= 0:
        return None
    balance_sum = Decimal("0")
    d = period_start
    while d <= period_end:
        if d <= today:
            balance_sum += _balance_at_end_of_date(account_id, d)
        else:
            balance_sum += _balance_at_end_of_date(account_id, today)
        d += timedelta(days=1)
    adb = balance_sum / num_days
    if adb >= 0:
        return None
    # Interest = |ADB| × (APR/100) × (days/365)
    interest = abs(adb) * apr_pct / Decimal("100") * Decimal(str(num_days)) / Decimal("365")
    return interest.quantize(Decimal("0.01"))


def _savings_interest_earned(
    account_id: int,
    cycle_end: date,
    apy_pct: Decimal,
    as_of_date: Optional[date] = None,
) -> Optional[Decimal]:
    """
    Interest earned for a savings period ending on cycle_end using Average Daily Balance (ADB).
    Period = day after previous cycle end through cycle_end. Interest = ADB × (APY/100) × (days/365).
    For days after as_of_date, uses balance at end of as_of_date (for projected interest).
    Returns None if no positive balance (ADB <= 0) or zero interest.
    """
    prev = _previous_cycle_end(cycle_end)
    period_start = prev + timedelta(days=1)
    period_end = cycle_end
    num_days = (period_end - period_start).days + 1
    if num_days <= 0:
        return None
    today = as_of_date or date.today()
    balance_sum = Decimal("0")
    d = period_start
    while d <= period_end:
        if d <= today:
            balance_sum += _balance_at_end_of_date(account_id, d)
        else:
            balance_sum += _balance_at_end_of_date(account_id, today)
        d += timedelta(days=1)
    adb = balance_sum / num_days
    if adb <= 0:
        return None
    interest = adb * apy_pct / Decimal("100") * Decimal(str(num_days)) / Decimal("365")
    return interest.quantize(Decimal("0.01"))


def build_timeline(
    user,
    start_date: date,
    end_date: date,
    scenario_id: Optional[int] = None,
    account_id: Optional[int] = None,
    household_id: Optional[int] = None,
    as_of_date: Optional[date] = None,
) -> list[dict]:
    """
    Build merged timeline: opening balances, actual transactions, projected rule occurrences,
    and one-time planned transactions. Sorted by date asc; running balance per account.

    Projected credit/savings interest appears only for **future** billing cycle ends (strictly
    after ``as_of_date`` / today): synthetic rows with ``transaction_id`` None. Past and current
    cycles are not shown on the timeline, and ``source=INTEREST`` rows from the database are
    omitted here (use a normal transaction to record actual bank interest if needed).
    """
    households = get_households_for_user(user)
    if household_id:
        households = households.filter(pk=household_id)
    if not households.exists():
        return []

    if account_id:
        accounts = Account.all_objects.for_historical_reporting().filter(
            household__in=households, pk=account_id,
        )
    else:
        accounts = Account.objects.for_historical_reporting().filter(household__in=households)
    account_ids = list(accounts.values_list("pk", flat=True))
    forecastable_account_ids = {
        a.pk
        for a in Account.objects.filter(pk__in=account_ids)
        if a.participates_in_forecast()
    }
    if not account_ids:
        return []

    scenario = None
    if scenario_id:
        scenario = Scenario.objects.filter(household__in=households, pk=scenario_id).first()

    # 1) Actual transactions: fetch ALL with date <= end_date so nothing is ever hidden in opening balance.
    #    Exclude Plaid rows that are matched as imports (canonical row is the planned side).
    actual = list(
        ledger_visible_transactions(
            Transaction.objects.filter(
                account_id__in=account_ids,
                date__lte=end_date,
            )
        )
        .select_related(
            "account",
            "category",
            "rule",
            "rule__transfer_to_account",
            "match_as_planned__imported_transaction",
        )
        .order_by("date", "id")
    )
    # Amount is stored signed: positive = inflow (payment), negative = outflow (expense).
    # Dedupe rule-created transactions by (account_id, date, rule_id, sign) so we only show
    # one row per rule occurrence when duplicates exist (e.g. after account change + materialization).
    # Do NOT hide rule-backed transactions by "rule's current account" — if the user moved a single
    # instance to another account (e.g. Savor), it should still show on that account.
    # Build map (rule_id, date) -> destination account name for transfer "from" legs so we can show "Move to CC (Savor)" in the list.
    from_leg_keys = [(t.rule_id, t.date) for t in actual if t.rule_id is not None and t.amount is not None and t.amount < 0]
    to_leg_account_name: dict[tuple[int, date], str] = {}
    if from_leg_keys:
        rule_dates = {(r, d) for r, d in from_leg_keys}
        to_legs = Transaction.objects.filter(
            rule_id__in={r for r, _ in rule_dates},
            date__in={d for _, d in rule_dates},
        ).exclude(account_id__in=account_ids).select_related("account")
        for to_txn in to_legs:
            if to_txn.account_id and to_txn.rule_id:
                to_leg_account_name[(to_txn.rule_id, to_txn.date)] = getattr(to_txn.account, "name", "") or ""

    today = as_of_date or timezone.localdate()
    accs = {a.id: a for a in Account.objects.filter(pk__in=account_ids)}
    credit_account_ids = {
        aid for aid in account_ids
        if accs.get(aid) and getattr(accs[aid], "account_type", None) == Account.AccountType.CREDIT
    }

    # Opening balances (before actual + rule rows) — used with full row ledger when skipping min payments
    opening: dict[int, Decimal] = {}
    for aid in account_ids:
        acc = accs.get(aid)
        sb = Decimal(str(acc.starting_balance)) if acc and acc.starting_balance is not None else Decimal("0")
        if acc and acc.account_type == Account.AccountType.CREDIT and sb > 0:
            sb = -sb
        opening[aid] = sb

    rows: list[dict] = []
    ids_in_rows: set[int] = set()
    seen_rule_actual_key: set[tuple] = set()
    purged_rule_dates: set[tuple[int, date]] = set()
    for t in actual:
        amt = t.amount
        sign = 1 if (amt is not None and amt >= 0) else -1
        if t.rule_id is not None and (t.rule_id, t.date) in purged_rule_dates:
            ids_in_rows.add(t.id)
            continue
        if t.rule_id is not None:
            rule_actual_key = (t.account_id, t.date, t.rule_id, sign)
            if rule_actual_key in seen_rule_actual_key:
                ids_in_rows.add(t.id)
                continue
            seen_rule_actual_key.add(rule_actual_key)
        if t.source == Transaction.Source.INTEREST:
            ids_in_rows.add(t.id)
            continue
        # Per-occurrence: skip (and purge) debt payments when destination owes nothing that day.
        cat_nm = (t.category.name if getattr(t, "category", None) and t.category else None) or ""
        if t.rule_id is not None and t.date >= today and amt is not None:
            hide_paid_off = False
            if t.account_id in credit_account_ids and amt > 0 and t.account:
                hide_paid_off = _skip_payment_to_debt_destination(
                    t.account,
                    t.date,
                    rows,
                    amt,
                    exclude_transaction_ids=(t.id,),
                    category_name=cat_nm,
                )
            elif amt < 0:
                dest_account: Optional[Account] = None
                payment_amt: Optional[Decimal] = None
                exclude_ids: list[int] = []
                for cand in (
                    Transaction.objects.filter(
                        rule_id=t.rule_id,
                        date=t.date,
                        amount__gt=0,
                    )
                    .exclude(account_id=t.account_id)
                    .select_related("account")
                ):
                    acc_c = cand.account
                    if acc_c and _account_is_debt_payment_destination(acc_c, cat_nm):
                        dest_account = acc_c
                        payment_amt = cand.amount
                        exclude_ids.append(cand.id)
                        break
                if dest_account is None:
                    rule_obj = getattr(t, "rule", None)
                    tac = None
                    if (
                        rule_obj is not None
                        and rule_obj.transfer_to_account_id
                        and _category_name_allows_rule_transfer_destination(cat_nm)
                    ):
                        tac = getattr(rule_obj, "transfer_to_account", None) or Account.objects.filter(
                            pk=rule_obj.transfer_to_account_id
                        ).first()
                    if tac and _account_is_debt_payment_destination(tac, cat_nm):
                        dest_account = tac
                        try:
                            payment_amt = abs(Decimal(str(amt)))
                        except (TypeError, ValueError):
                            payment_amt = None
                        exclude_ids.extend(
                            Transaction.objects.filter(
                                rule_id=t.rule_id,
                                date=t.date,
                                account_id=tac.id,
                            ).values_list("pk", flat=True)
                        )
                if dest_account is not None and payment_amt is not None:
                    hide_paid_off = _skip_payment_to_debt_destination(
                        dest_account,
                        t.date,
                        rows,
                        payment_amt,
                        exclude_transaction_ids=tuple(exclude_ids) if exclude_ids else None,
                        category_name=cat_nm,
                    )
            if hide_paid_off:
                _purge_skipped_rule_occurrence(t.rule_id, t.date, today)
                purged_rule_dates.add((t.rule_id, t.date))
                ids_in_rows.add(t.id)
                continue
        desc = t.payee or ""
        try:
            mpl = t.match_as_planned
            imp = mpl.imported_transaction
            bank_hint = (imp.payee or imp.imported_description or "").strip()
            if bank_hint and bank_hint not in desc:
                desc = f"{desc} — bank: {bank_hint}" if desc else f"Bank: {bank_hint}"
        except Exception:
            pass
        if t.rule_id and amt is not None and amt < 0:
            to_name = to_leg_account_name.get((t.rule_id, t.date))
            if to_name and to_name not in desc:
                desc = f"{desc} ({to_name})" if desc else to_name
        row_source = (
            "interest" if t.source == Transaction.Source.INTEREST else "actual"
        )
        rows.append({
            "date": t.date,
            "description": desc,
            "account_id": t.account_id,
            "account_name": t.account.effective_display_name,
            "category_id": t.category_id,
            "category_name": t.category.name if t.category else None,
            "amount": amt,
            "type": "INFLOW" if amt >= 0 else "OUTFLOW",
            "status": t.status,
            "source": row_source,
            "rule_id": t.rule_id,
            "transaction_id": t.id,
            "sort_key": (t.date, 0, t.id),
        })
        ids_in_rows.add(t.id)

    # 2) One-time planned (Transaction with source=ONE_TIME or status=PLANNED, in range)
    # Already included in actual queryset above; we tagged by source. So no duplicate.

    # 3) Projected recurring occurrences (computed, not stored).
    # Only dates >= today are emitted. Rule amount/schedule changes affect only these
    # future projections; past actual transactions in the DB are never modified.
    #
    # Use every active rule in the household (not only rules touching the filtered account).
    # Otherwise a Chase-only timeline would never materialize e.g. Savings→Platinum payments,
    # and bank→card minimum rules would still project because the card balance looked wrong.
    rules_qs = RecurringRule.objects.filter(
        household__in=households,
        active=True,
    ).select_related("account", "category", "transfer_to_account")
    if scenario_id and scenario:
        rules_qs = rules_qs.prefetch_related("scenario_overrides")

    # Build rule list and sort by first occurrence date so that when we evaluate "skip 3/23?"
    # we have already added any earlier payment (e.g. 3/20) from the same or another rule.
    rules_with_occ: list[tuple] = []
    for rule in rules_qs:
        eff = apply_scenario_overrides(rule, scenario)
        if not eff.get("active", True):
            continue
        eff_start = eff.get("start_date") or rule.start_date
        eff_end = eff.get("end_date")
        occ_dates = generate_rule_occurrences(
            rule, start_date, end_date,
            effective_start=eff_start,
            effective_end=eff_end,
        )
        first_occ = min(occ_dates) if occ_dates else date.max
        rules_with_occ.append((rule, eff, eff_start, eff_end, occ_dates, first_occ))
    rules_with_occ.sort(key=lambda x: x[5])

    # User-deleted rule occurrences: do not re-materialize or show them.
    rule_ids = [r.id for r, *_ in rules_with_occ]
    skipped_occurrences = set(
        RecurringRuleSkip.objects.filter(
            rule_id__in=rule_ids, date__gte=start_date, date__lte=end_date
        ).values_list("rule_id", "date")
    )

    # Queue all occurrences, then process in global order. Same calendar day, same destination
    # card: larger transfers first (then rule_id) so a full payment materializes before a minimum.
    occurrence_events: list[tuple[date, Decimal, int, str, tuple]] = []

    def _rule_account_forecastable(rule_obj: RecurringRule, eff: dict) -> bool:
        acc_id = eff.get("account_id") or rule_obj.account_id
        if acc_id not in forecastable_account_ids:
            return False
        to_id = rule_obj.transfer_to_account_id
        if to_id and to_id not in forecastable_account_ids:
            return False
        return True

    for rule, eff, eff_start, eff_end, occ_dates, _first_occ in rules_with_occ:
        if not _rule_account_forecastable(rule, eff):
            continue
        raw_amount = eff.get("amount") or rule.amount
        amount_decimal = Decimal(str(raw_amount))
        if rule.direction == RecurringRule.Direction.EXPENSE and amount_decimal > 0:
            amount_decimal = -amount_decimal
        elif rule.direction == RecurringRule.Direction.INCOME and amount_decimal < 0:
            amount_decimal = abs(amount_decimal)
        cat_id = eff.get("category_id")
        cat_name = None
        if rule.category_id:
            from categories.models import Category
            c = Category.objects.filter(pk=cat_id or rule.category_id).first()
            cat_name = c.name if c else None

        use_transfer_branch = bool(rule.transfer_to_account_id) and _category_name_allows_rule_transfer_destination(
            cat_name
        )
        if use_transfer_branch:
            from_acc_id = eff.get("account_id") or rule.account_id
            to_acc_id = rule.transfer_to_account_id
            from_acc = next((a for a in accounts if a.pk == from_acc_id), None)
            to_acc = getattr(rule, "transfer_to_account", None) or next((a for a in accounts if a.pk == to_acc_id), None)
            if to_acc is None:
                to_acc = accs.get(to_acc_id) or Account.objects.filter(pk=to_acc_id).first()
            from_name = from_acc.name if from_acc else getattr(rule.account, "name", "")
            to_name = to_acc.name if to_acc else ""
            out_amount = -abs(amount_decimal)
            in_amount = abs(amount_decimal)
            is_debt_dest = bool(to_acc and _account_is_debt_payment_destination(to_acc, cat_name))
            for d in occ_dates:
                if d < today or (rule.id, d) in skipped_occurrences:
                    continue
                sort_amt = -in_amount if is_debt_dest else Decimal("0")
                occurrence_events.append(
                    (
                        d,
                        sort_amt,
                        rule.id,
                        "transfer",
                        (
                            rule,
                            from_acc_id,
                            to_acc_id,
                            from_name,
                            to_name,
                            out_amount,
                            in_amount,
                            is_debt_dest,
                            cat_id,
                            cat_name,
                        ),
                    )
                )
        else:
            acc_id = eff.get("account_id") or rule.account_id
            acc = next((a for a in accounts if a.pk == acc_id), None)
            acc_name = acc.name if acc else getattr(rule.account, "name", "")
            card_for_skip = None
            if acc and acc.account_type == Account.AccountType.CREDIT and rule.direction == RecurringRule.Direction.INCOME:
                card_for_skip = acc
            elif (
                rule.direction == RecurringRule.Direction.EXPENSE
                and cat_name
                and "credit" in (cat_name or "").lower()
            ):
                rule_name_lower = (getattr(rule, "name", None) or "").lower()
                for a in Account.objects.operational().filter(
                    household__in=households, account_type=Account.AccountType.CREDIT,
                ):
                    an = (a.name or "").strip()
                    if not an:
                        continue
                    if an.lower() in rule_name_lower or rule_name_lower in an.lower() or rule_name_lower.startswith(an.lower()) or an.lower().startswith(rule_name_lower[:20]):
                        card_for_skip = a
                        break
            for d in occ_dates:
                if d < today or (rule.id, d) in skipped_occurrences:
                    continue
                occurrence_events.append(
                    (
                        d,
                        Decimal("0"),
                        rule.id,
                        "single",
                        (rule, acc_id, acc_name, amount_decimal, cat_id, cat_name, card_for_skip),
                    )
                )

    occurrence_events.sort(key=lambda x: (x[0], x[1], x[2]))

    for d, _sort_amt, _rid, kind, payload in occurrence_events:
        if kind == "transfer":
            (
                rule,
                from_acc_id,
                to_acc_id,
                from_name,
                to_name,
                out_amount,
                in_amount,
                is_debt_dest,
                cat_id,
                cat_name,
            ) = payload
            to_acc_for_skip = Account.objects.filter(pk=to_acc_id).first()
            if is_debt_dest and to_acc_for_skip:
                dest_leg_ids = tuple(
                    Transaction.objects.filter(
                        rule_id=rule.id, date=d, account_id=to_acc_id
                    ).values_list("pk", flat=True)
                )
                from_acc_obj = accs.get(from_acc_id) or Account.objects.filter(pk=from_acc_id).first()
                fund_from_bank = (
                    from_acc_obj is not None
                    and from_acc_obj.account_type != Account.AccountType.CREDIT
                )
                lookahead_end = d + timedelta(days=45)
                skip_payment = False
                if fund_from_bank:
                    bal = _credit_card_balance_through_date(
                        to_acc_for_skip.id,
                        d,
                        rows,
                        include_row_leg_without_txn=True,
                        include_db_postings_on_as_of_date=True,
                        exclude_transaction_ids=dest_leg_ids if dest_leg_ids else None,
                    )
                    extra_scheduled = _future_recurring_expense_impact_on_card(
                        to_acc_for_skip.id,
                        d,
                        lookahead_end,
                        households,
                    )
                    extra_db = _db_card_postings_in_exclusive_range(
                        to_acc_for_skip.id,
                        d,
                        lookahead_end,
                    )
                    skip_payment = bal + extra_scheduled + extra_db >= 0
                else:
                    skip_payment = _skip_payment_to_debt_destination(
                        to_acc_for_skip,
                        d,
                        rows,
                        in_amount,
                        exclude_transaction_ids=dest_leg_ids if dest_leg_ids else None,
                        category_name=cat_name,
                    )
                if skip_payment:
                    _purge_skipped_rule_occurrence(rule.id, d, today)
                    continue
            txn_from = _materialize_rule_occurrence(
                rule, d, from_acc_id, out_amount, rule.name, cat_id
            )
            existing_to = Transaction.objects.filter(
                rule_id=rule.id, date=d
            ).exclude(account_id=from_acc_id).select_related("account").first()
            if existing_to is not None:
                txn_to = existing_to
                to_acc_id_actual = txn_to.account_id
                to_name_actual = getattr(txn_to.account, "name", "") if txn_to.account else to_name
            else:
                txn_to = _materialize_rule_occurrence(
                    rule, d, to_acc_id, in_amount, rule.name, None
                )
                to_acc_id_actual = to_acc_id
                to_name_actual = to_name
            if txn_from.id in ids_in_rows or txn_to.id in ids_in_rows:
                continue
            ids_in_rows.add(txn_from.id)
            ids_in_rows.add(txn_to.id)
            amt_from = txn_from.amount if txn_from.amount is not None else out_amount
            amt_to = txn_to.amount if txn_to.amount is not None else in_amount
            desc_with_card = f"{rule.name} ({to_name_actual})" if to_name_actual else rule.name
            rows.append({
                "date": d,
                "description": desc_with_card,
                "account_id": from_acc_id,
                "account_name": from_name,
                "category_id": cat_id,
                "category_name": cat_name,
                "amount": amt_from,
                "type": "OUTFLOW",
                "status": txn_from.status,
                "source": "actual",
                "rule_id": rule.id,
                "transaction_id": txn_from.id,
                "sort_key": (d, 1, rule.id * 2),
            })
            rows.append({
                "date": d,
                "description": desc_with_card,
                "account_id": to_acc_id_actual,
                "account_name": to_name_actual,
                "category_id": None,
                "category_name": None,
                "amount": amt_to,
                "type": "INFLOW",
                "status": txn_to.status,
                "source": "actual",
                "rule_id": rule.id,
                "transaction_id": txn_to.id,
                "sort_key": (d, 1, rule.id * 2 + 1),
            })
        else:
            rule, acc_id, acc_name, amount_decimal, cat_id, cat_name, card_for_skip = payload
            if card_for_skip is not None:
                if _skip_payment_to_debt_destination(
                    card_for_skip,
                    d,
                    rows,
                    None,
                    exclude_transaction_ids=None,
                    category_name=cat_name,
                ):
                    _purge_skipped_rule_occurrence(rule.id, d, today)
                    continue
            txn = _materialize_rule_occurrence(
                rule, d, acc_id, amount_decimal, rule.name, cat_id
            )
            if txn.id in ids_in_rows:
                continue
            ids_in_rows.add(txn.id)
            amt = txn.amount if txn.amount is not None else amount_decimal
            rows.append({
                "date": d,
                "description": rule.name,
                "account_id": acc_id,
                "account_name": acc_name,
                "category_id": cat_id,
                "category_name": cat_name,
                "amount": amt,
                "type": rule.direction,
                "status": txn.status,
                "source": "actual",
                "rule_id": rule.id,
                "transaction_id": txn.id,
                "sort_key": (d, 1, rule.id),
            })

    # User-deleted projected interest: do not re-show or re-materialize that billing cycle.
    skipped_interest_by_account: dict[int, set[date]] = defaultdict(set)
    for sk in InterestCycleSkip.objects.filter(account_id__in=account_ids).values(
        "account_id", "cycle_end_date"
    ):
        skipped_interest_by_account[sk["account_id"]].add(sk["cycle_end_date"])

    # 4) Projected credit card interest: one row per CREDIT account per cycle end in range.
    # Each month's interest uses projected balance (actual + recurring + prior months' interest).
    from categories.models import Category
    interest_category_cache: dict[int, tuple[Optional[int], str]] = {}  # household_id -> (category_id, name)
    credit_accounts = [a for a in accounts if getattr(a, "account_type", "").upper() == "CREDIT"]
    for acc in credit_accounts:
        cycle_day = acc.get_statement_closing_day() if hasattr(acc, "get_statement_closing_day") else getattr(acc, "billing_cycle_end_day", None)
        apr_val = getattr(acc, "apr", None)
        if cycle_day is None or apr_val is None:
            continue
        cycle_dates = _cycle_end_dates_in_range(
            int(cycle_day), start_date, end_date, on_or_after=None
        )
        if not cycle_dates:
            continue
        if acc.id not in opening:
            sb = Decimal(str(acc.starting_balance)) if acc.starting_balance is not None else Decimal("0")
            if acc.account_type == Account.AccountType.CREDIT and sb > 0:
                sb = -sb
            opening[acc.id] = sb
        if acc.household_id not in interest_category_cache:
            cat = Category.objects.filter(
                household_id=acc.household_id, name="Interest", category_type="EXPENSE"
            ).first()
            interest_category_cache[acc.household_id] = (
                (cat.id, cat.name) if cat else (None, "Interest")
            )
        cat_id, cat_name = interest_category_cache[acc.household_id]
        promo_end = getattr(acc, "promotional_end_date", None)
        promo_apr = getattr(acc, "promotional_apr", None)
        for cycle_end in cycle_dates:
            if cycle_end in skipped_interest_by_account.get(acc.id, ()):
                continue
            if cycle_end <= today:
                continue
            # Use promotional APR until promotional_end_date, then standard APR
            if promo_end is not None and cycle_end <= promo_end and promo_apr is not None:
                effective_apr = Decimal(str(promo_apr))
            else:
                effective_apr = Decimal(str(apr_val))
            if effective_apr <= 0:
                continue
            projected_balance_at_cycle_end = _balance_at_date_from_rows(
                acc.id, cycle_end, rows, opening
            )
            if projected_balance_at_cycle_end >= 0:
                continue
            interest_amount = _interest_for_cycle_from_rows(
                acc.id, cycle_end, effective_apr, rows, opening
            )
            if interest_amount is None or interest_amount <= 0:
                continue
            rows.append({
                "date": cycle_end,
                "description": "Projected Interest",
                "account_id": acc.id,
                "account_name": acc.effective_display_name,
                "category_id": cat_id,
                "category_name": cat_name,
                "amount": -interest_amount,
                "type": "OUTFLOW",
                "status": "planned",
                "source": "interest",
                "rule_id": None,
                "transaction_id": None,
                "sort_key": (cycle_end, 2, acc.id),
            })

    # 5) Savings interest: project next future cycle end only (no past/current rows).
    income_interest_category_cache: dict[int, tuple[Optional[int], str]] = {}
    savings_accounts = [a for a in accounts if getattr(a, "account_type", "").upper() == "SAVINGS"]
    for acc in savings_accounts:
        cycle_day = getattr(acc, "interest_cycle_end_day", None)
        rate_val = getattr(acc, "interest_rate", None)
        if cycle_day is None or rate_val is None:
            continue
        all_cycles = _cycle_end_dates_in_range(
            int(cycle_day), start_date, end_date, on_or_after=None
        )
        if not all_cycles:
            continue
        if acc.household_id not in income_interest_category_cache:
            cat = Category.objects.filter(
                household_id=acc.household_id, name="Interest Income", category_type="INCOME"
            ).first()
            income_interest_category_cache[acc.household_id] = (
                (cat.id, cat.name) if cat else (None, "Interest Income")
            )
        cat_id, cat_name = income_interest_category_cache[acc.household_id]
        rate_decimal = Decimal(str(rate_val))
        future_cycles = [d for d in all_cycles if d > today]
        if not future_cycles:
            continue
        cycle_end = min(future_cycles)
        if cycle_end in skipped_interest_by_account.get(acc.id, ()):
            continue
        interest_amount = _savings_interest_earned(
            acc.id, cycle_end, rate_decimal, as_of_date=today
        )
        if interest_amount is None or interest_amount <= 0:
            continue
        rows.append({
            "date": cycle_end,
            "description": "Projected Interest Income",
            "account_id": acc.id,
            "account_name": acc.effective_display_name,
            "category_id": cat_id,
            "category_name": cat_name,
            "amount": interest_amount,
            "type": "INFLOW",
            "status": "planned",
            "source": "interest",
            "rule_id": None,
            "transaction_id": None,
            "sort_key": (cycle_end, 2, acc.id),
        })

    # Sort by date, then by sort_key tiebreaker
    rows.sort(key=lambda x: (x["date"], x["sort_key"][1], x["sort_key"][2] or 0))
    for r in rows:
        r.pop("sort_key", None)

    # Opening balance for any account that appears in rows (e.g. card when we added both legs for CC rules)
    for r in rows:
        aid = r["account_id"]
        if aid not in opening:
            acc = accs.get(aid) or Account.objects.filter(pk=aid).first()
            sb = Decimal(str(acc.starting_balance)) if acc and acc.starting_balance is not None else Decimal("0")
            if acc and acc.account_type == Account.AccountType.CREDIT and sb > 0:
                sb = -sb
            opening[aid] = sb

    # Running balance: use opening (already has account_ids + any accounts we added for CC legs).
    running = dict(opening)
    for r in rows:
        aid = r["account_id"]
        amt = r["amount"] if isinstance(r["amount"], Decimal) else Decimal(str(r["amount"]))
        running[aid] = running.get(aid, opening.get(aid, Decimal("0"))) + amt
        r["running_balance"] = running[aid]

    # Return only rows for requested accounts (we added both legs for CC transfers for balance math)
    rows = [r for r in rows if r["account_id"] in account_ids]
    return rows
