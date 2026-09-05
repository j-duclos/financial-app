"""
Computed account health indicators from forecast, safe-to-spend, and credit card data.
"""
from __future__ import annotations

from collections import defaultdict
from collections.abc import Collection, Iterable
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal
from typing import Any, Optional

from django.db.models import Count, Q, Sum

from accounts.models import Account
from accounts.relationship_models import AccountRelationship
from accounts.services.account_health_constants import (
    CREDIT_MEANINGFUL_OWED,
    CREDIT_UTILIZATION_NEAR_LIMIT,
    CREDIT_UTILIZATION_RISK,
    CREDIT_UTILIZATION_WATCH,
    DEFAULT_TARGET_UTILIZATION_PERCENT,
    HEALTH_STATUS_CRITICAL,
    HEALTH_STATUS_HEALTHY,
    HEALTH_STATUS_RISK,
    HEALTH_STATUS_WATCH,
    HIGH_APR_THRESHOLD,
    LARGE_OUTFLOW_BALANCE_FRACTION,
    LARGE_OUTFLOW_WINDOW_DAYS,
    PAYMENT_DUE_RISK_DAYS,
    PAYMENT_DUE_WATCH_DAYS,
    REASON_BALANCE_TRENDING_DOWN,
    REASON_DUE_DATE_STALE,
    REASON_FORECAST_BELOW_BUFFER,
    REASON_FORECAST_NEGATIVE,
    REASON_HIGH_APR,
    REASON_HIGH_UTILIZATION,
    REASON_LARGE_OUTFLOW,
    REASON_NEAR_LIMIT,
    REASON_NO_PAYMENT_LINK,
    REASON_MINIMUM_PAYMENT_UNAVAILABLE,
    REASON_OVER_LIMIT,
    REASON_PAYMENT_BELOW_INTEREST,
    REASON_PAYMENT_DUE_SOON,
    REASON_PAYMENT_PAST_DUE,
    REASON_PROJECTED_INTEREST,
    REASON_SAFE_TO_SPEND_LOW,
    REASON_SPENDING_CUSHION_SHORT,
    REASON_UTILIZATION_ABOVE_TARGET,
    SAFE_TO_SPEND_LOW_PERCENT,
    STATUS_SEVERITY,
)
from accounts.services.available_to_spend import (
    DEFAULT_FORECAST_DAYS,
    _decimal,
    account_supports_available_to_spend,
    calculate_forecast_summaries_for_accounts_with_timeline,
    cash_account_risk_shortfall,
    normalize_forecast_days,
)
from accounts.services.balances import (
    bulk_signed_ledger_balances,
    credit_owed_from_signed_balance,
)
from accounts.services.credit_card import credit_payment_due_state, ledger_owed_balance
from timeline.services.ledger import _balance_at_end_of_date
from transactions.models import Transaction
from transactions.services.matching import ledger_visible_transactions

CASH_ROLES = frozenset(
    {
        Account.AccountRole.SPENDING,
        Account.AccountRole.BILLS,
        Account.AccountRole.CASH_RESERVE,
        Account.AccountRole.OTHER,
    }
)
SAVINGS_ROLES = frozenset(
    {
        Account.AccountRole.SAVINGS,
        Account.AccountRole.EMERGENCY_FUND,
    }
)

PAYMENT_LINK_RELATIONSHIP_TYPES = (
    AccountRelationship.RelationshipType.CREDIT_CARD_PAYMENT,
    AccountRelationship.RelationshipType.AUTOPAY,
    AccountRelationship.RelationshipType.DEBT_PAYMENT,
)


@dataclass(frozen=True)
class AccountHealthSupportData:
    """Bulk-loaded inputs so per-account health calculation can stay SQL-free."""

    signed_balances: dict[int, Decimal] = field(default_factory=dict)
    unmatched_import_counts: dict[int, int] = field(default_factory=dict)
    payment_link_account_ids: set[int] = field(default_factory=set)
    planned_loan_payment_account_ids: set[int] = field(default_factory=set)
    payments_since_statement: dict[int, Decimal] = field(default_factory=dict)


def bulk_unmatched_import_counts(account_ids: Collection[int]) -> dict[int, int]:
    ids = [int(pk) for pk in account_ids]
    if not ids:
        return {}
    rows = (
        Transaction.objects.filter(
            account_id__in=ids,
            source=Transaction.Source.PLAID,
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        )
        .values("account_id")
        .annotate(count=Count("id"))
    )
    return {row["account_id"]: int(row["count"]) for row in rows}


def bulk_payment_link_account_ids(credit_card_ids: Collection[int]) -> set[int]:
    ids = [int(pk) for pk in credit_card_ids]
    if not ids:
        return set()
    return set(
        AccountRelationship.objects.filter(
            destination_account_id__in=ids,
            is_active=True,
            relationship_type__in=PAYMENT_LINK_RELATIONSHIP_TYPES,
        ).values_list("destination_account_id", flat=True)
    )


def bulk_planned_loan_payment_account_ids(
    accounts: Iterable[Account],
    today: date,
) -> set[int]:
    loans = [
        acc
        for acc in accounts
        if acc.role == Account.AccountRole.LOAN and acc.next_payment_due_date
    ]
    if not loans:
        return set()
    max_due = max(acc.next_payment_due_date for acc in loans)
    due_by_id = {acc.pk: acc.next_payment_due_date for acc in loans}
    rows = Transaction.objects.filter(
        account_id__in=due_by_id,
        date__gte=today,
        date__lte=max_due,
        status=Transaction.Status.PLANNED,
        amount__lt=0,
    ).values_list("account_id", "date")
    matched: set[int] = set()
    for account_id, txn_date in rows:
        due = due_by_id.get(account_id)
        if due is not None and txn_date <= due:
            matched.add(account_id)
    return matched


def bulk_payments_since_statement(accounts: Iterable[Account]) -> dict[int, Decimal]:
    cards = [
        acc
        for acc in accounts
        if acc.is_credit_card() and acc.last_statement_date is not None
    ]
    if not cards:
        return {}
    q_filter = Q()
    for acc in cards:
        q_filter |= Q(account_id=acc.pk, date__gt=acc.last_statement_date)
    rows = (
        ledger_visible_transactions(
            Transaction.objects.filter(q_filter, amount__gt=0)
        )
        .values("account_id")
        .annotate(total=Sum("amount"))
    )
    return {row["account_id"]: Decimal(str(row["total"] or 0)) for row in rows}


def build_account_health_context(
    accounts: list[Account],
    *,
    today: date,
    signed_balances: dict[int, Decimal] | None = None,
) -> AccountHealthSupportData:
    """Load shared account-health support data in a handful of grouped queries."""
    account_ids = [acc.pk for acc in accounts]
    credit_card_ids = [acc.pk for acc in accounts if acc.is_credit_card()]
    balances = (
        signed_balances
        if signed_balances is not None
        else bulk_signed_ledger_balances(accounts, today)
    )
    return AccountHealthSupportData(
        signed_balances=balances,
        unmatched_import_counts=bulk_unmatched_import_counts(account_ids),
        payment_link_account_ids=bulk_payment_link_account_ids(credit_card_ids),
        planned_loan_payment_account_ids=bulk_planned_loan_payment_account_ids(
            accounts, today
        ),
        payments_since_statement=bulk_payments_since_statement(accounts),
    )


def _payoff_to_avoid_interest(
    account: Account,
    *,
    payments_since_statement: Decimal | None = None,
) -> Decimal:
    if payments_since_statement is None:
        return account.payoff_to_avoid_interest
    stmt = Decimal(str(account.statement_balance or 0))
    return max(Decimal("0"), stmt - payments_since_statement)


def _projected_interest_from_payoff(account: Account, payoff: Decimal) -> Decimal:
    from credit_cards.services.payoff import calculate_monthly_interest

    unpaid = payoff
    if unpaid <= 0:
        unpaid = _decimal(account.statement_balance or 0)
    return calculate_monthly_interest(account, unpaid)


def _worst_status(*statuses: str) -> str:
    return max(statuses, key=lambda s: STATUS_SEVERITY.get(s, 0))


def _status_score(status: str, *, headroom_ratio: Decimal | None = None) -> int:
    if status == HEALTH_STATUS_CRITICAL:
        return max(0, min(34, int(20 + (headroom_ratio or 0) * 14)))
    if status == HEALTH_STATUS_RISK:
        return max(35, min(64, 50 + int((headroom_ratio or 0) * 14)))
    if status == HEALTH_STATUS_WATCH:
        return max(65, min(84, 72 + int((headroom_ratio or 0) * 12)))
    return max(85, min(100, 90 + int((headroom_ratio or 0) * 10)))


def _serialize_decimal(val: Decimal | None) -> str | None:
    if val is None:
        return None
    return str(val)


def _target_utilization_percent(account: Account) -> Decimal:
    """Canonical utilization target for this account (user-configured preference)."""
    raw = account.target_utilization_percent
    if raw is None:
        return DEFAULT_TARGET_UTILIZATION_PERCENT
    target = _decimal(raw)
    if target < Decimal("0"):
        return DEFAULT_TARGET_UTILIZATION_PERCENT
    return min(target, Decimal("100"))


def account_target_utilization_percent(account: Account) -> Decimal:
    """Public alias for the canonical per-account utilization target."""
    return _target_utilization_percent(account)


def _credit_utilization_thresholds(target: Decimal) -> tuple[Decimal, Decimal, Decimal]:
    """
    Watch / risk / over-limit floors for utilization *severity*.

    Independent of the user's optimization target. Missing a 10% (or 30%) target
    is not Critical. Over-limit (100%+) is the utilization-related Critical case;
    past-due and cash overdraft are handled separately.

    ``target`` is accepted for call-site compatibility and is not used for floors.
    """
    del target
    return CREDIT_UTILIZATION_WATCH, CREDIT_UTILIZATION_RISK, Decimal("100")


def _utilization_reason_code(util_dec: Decimal) -> str:
    if util_dec >= CREDIT_UTILIZATION_NEAR_LIMIT:
        return REASON_NEAR_LIMIT
    if util_dec >= CREDIT_UTILIZATION_WATCH:
        return REASON_HIGH_UTILIZATION
    return REASON_UTILIZATION_ABOVE_TARGET


def _utilization_reason(util_dec: Decimal, target: Decimal) -> str:
    target_label = f"{target:.0f}%"
    if util_dec >= CREDIT_UTILIZATION_NEAR_LIMIT:
        return f"Near limit · Above {target_label} target"
    if util_dec >= CREDIT_UTILIZATION_RISK:
        return f"High utilization · Above {target_label} target"
    if util_dec >= CREDIT_UTILIZATION_WATCH:
        return f"High utilization · Above {target_label} target"
    if util_dec > target:
        return f"Above {target_label} target"
    return f"Utilization is {util_dec:.0f}% (target {target:.0f}%)"


def _credit_owed_is_meaningful(
    owed: Decimal,
    *,
    limit: Decimal,
    min_payment: Decimal,
) -> bool:
    """Soft credit watches need real debt — ignore pocket-change balances."""
    if owed <= 0:
        return False
    if owed >= CREDIT_MEANINGFUL_OWED:
        return True
    if min_payment > 0 and owed >= min_payment:
        return True
    if limit > 0:
        util = owed / limit * Decimal("100")
        if util >= CREDIT_UTILIZATION_WATCH:
            return True
    return False


def _credit_utilization_percent(owed: Decimal, limit: Decimal) -> Decimal | None:
    if limit <= 0:
        return None
    return (owed / limit * Decimal("100")).quantize(Decimal("0.01"))


def _count_unmatched_imports(
    account: Account,
    *,
    unmatched_import_count: int | None = None,
) -> int:
    if unmatched_import_count is not None:
        return unmatched_import_count
    return Transaction.objects.filter(
        account_id=account.pk,
        source=Transaction.Source.PLAID,
        import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
    ).count()


def _has_large_outflow_soon(
    timeline_rows: list[dict] | None,
    account_id: int,
    today: date,
    current_balance: Decimal,
) -> bool:
    if not timeline_rows or current_balance <= 0:
        return False
    window_end = today + timedelta(days=LARGE_OUTFLOW_WINDOW_DAYS)
    by_date: dict[date, Decimal] = defaultdict(lambda: Decimal("0"))
    for r in timeline_rows:
        if r.get("account_id") != account_id:
            continue
        row_date = r["date"]
        if hasattr(row_date, "isoformat") and not isinstance(row_date, date):
            row_date = date.fromisoformat(str(row_date)[:10])
        if row_date <= today or row_date > window_end:
            continue
        amt = _decimal(r["amount"])
        if amt < 0:
            by_date[row_date] += abs(amt)
    threshold = max(Decimal("500"), current_balance * LARGE_OUTFLOW_BALANCE_FRACTION)
    return any(outflow >= threshold for outflow in by_date.values())


def _forecast_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def _cash_health(
    account: Account,
    forecast: dict[str, Any] | None,
    today: date,
    timeline_rows: list[dict] | None,
    *,
    unmatched_import_count: int | None = None,
) -> tuple[str, str | None, str | None, date | None, dict[str, Any]]:
    details: dict[str, Any] = {
        "lowest_projected_balance": None,
        "available_to_spend": None,
        "minimum_buffer": str(account.minimum_buffer or 0),
        "utilization_percent": None,
        "days_until_due": None,
        "past_due_amount": None,
        "unmatched_import_count": _count_unmatched_imports(
            account, unmatched_import_count=unmatched_import_count
        ),
        "actual_balance_negative": False,
        "spending_cushion_negative": False,
    }
    if not forecast or not forecast.get("supports_available_to_spend"):
        return HEALTH_STATUS_HEALTHY, None, None, None, details

    lowest = _decimal(forecast["lowest_projected_balance"])
    available = _decimal(forecast["available_to_spend"])
    minimum_buffer = _decimal(forecast.get("minimum_buffer") or account.minimum_buffer or 0)
    current_balance = _decimal(forecast.get("current_balance") or 0)
    bucket_allocation = _decimal(forecast.get("bucket_allocation") or 0)
    first_negative_date = _forecast_date(forecast.get("first_negative_date"))
    first_below_buffer_date = _forecast_date(forecast.get("first_below_buffer_date"))
    lowest_date = _forecast_date(forecast.get("lowest_projected_balance_date"))

    actual_balance_negative = first_negative_date is not None and _decimal(
        forecast.get("first_negative_balance") or 0
    ) < Decimal("0")
    spending_cushion_negative = (
        available < Decimal("0")
        and lowest >= Decimal("0")
        and lowest >= minimum_buffer
    )

    details["lowest_projected_balance"] = forecast.get("lowest_projected_balance")
    details["lowest_projected_balance_date"] = forecast.get("lowest_projected_balance_date")
    details["available_to_spend"] = forecast.get("available_to_spend")
    details["first_negative_balance"] = forecast.get("first_negative_balance")
    details["first_negative_date"] = forecast.get("first_negative_date")
    details["first_below_buffer_balance"] = forecast.get("first_below_buffer_balance")
    details["balance_on_risk_date"] = forecast.get("balance_on_risk_date")
    details["bucket_allocation"] = forecast.get("bucket_allocation")
    details["actual_balance_negative"] = actual_balance_negative
    details["spending_cushion_negative"] = spending_cushion_negative
    cash_risk = forecast.get("cash_risk")
    if cash_risk:
        details["cash_risk"] = cash_risk

    if actual_balance_negative:
        shortfall_type = "actual_balance"
    elif lowest < minimum_buffer:
        shortfall_type = "buffer"
    elif spending_cushion_negative:
        shortfall_type = (
            "reserved_savings" if bucket_allocation > 0 else "spending_cushion"
        )
    else:
        shortfall_type = None
    if shortfall_type:
        details["shortfall_type"] = shortfall_type

    # (status, reason, reason_code)
    issues: list[tuple[str, str, str]] = []
    risk_date: date | None = None

    if actual_balance_negative:
        risk_date = first_negative_date or lowest_date
        date_label = risk_date.isoformat() if risk_date else "the forecast window"
        issues.append(
            (
                HEALTH_STATUS_CRITICAL,
                f"Projected negative {date_label}",
                REASON_FORECAST_NEGATIVE,
            )
        )
    elif lowest < minimum_buffer:
        risk_date = first_below_buffer_date or lowest_date
        date_label = risk_date.isoformat() if risk_date else "the forecast window"
        issues.append(
            (
                HEALTH_STATUS_RISK,
                f"Projected below buffer on {date_label}",
                REASON_FORECAST_BELOW_BUFFER,
            )
        )
    elif (
        spending_cushion_negative
        and account.role in (Account.AccountRole.SPENDING, Account.AccountRole.BILLS)
    ):
        risk_date = first_below_buffer_date or lowest_date
        if shortfall_type == "reserved_savings":
            issues.append(
                (
                    HEALTH_STATUS_CRITICAL,
                    "Reserved savings/buffer exceeds projected cushion",
                    REASON_SPENDING_CUSHION_SHORT,
                )
            )
        else:
            issues.append(
                (
                    HEALTH_STATUS_CRITICAL,
                    "Spending cushion is short",
                    REASON_SPENDING_CUSHION_SHORT,
                )
            )

    # Relative ATS pressure only — do NOT watch solely because nominal cash is small.
    has_forecast_pressure = any(
        s in (HEALTH_STATUS_CRITICAL, HEALTH_STATUS_RISK) for s, _, _ in issues
    )
    if (
        not has_forecast_pressure
        and not spending_cushion_negative
        and current_balance > 0
        and available <= current_balance * SAFE_TO_SPEND_LOW_PERCENT
        and available < current_balance
    ):
        issues.append(
            (
                HEALTH_STATUS_WATCH,
                "Safe-to-spend is low relative to balance",
                REASON_SAFE_TO_SPEND_LOW,
            )
        )

    if _has_large_outflow_soon(timeline_rows, account.pk, today, current_balance):
        issues.append(
            (
                HEALTH_STATUS_WATCH,
                "Large upcoming outflow within 7 days",
                REASON_LARGE_OUTFLOW,
            )
        )

    if not issues:
        return HEALTH_STATUS_HEALTHY, None, None, None, details

    status = _worst_status(*(s for s, _, _ in issues))
    reason = issues[0][1]
    reason_code = issues[0][2]
    if status == HEALTH_STATUS_CRITICAL:
        for _s, r, code in issues:
            if code in (REASON_FORECAST_NEGATIVE, REASON_SPENDING_CUSHION_SHORT):
                reason, reason_code = r, code
                break
    elif status == HEALTH_STATUS_RISK:
        for _s, r, code in issues:
            if code == REASON_FORECAST_BELOW_BUFFER:
                reason, reason_code = r, code
                break

    return status, reason, reason_code, risk_date, details


def _credit_card_health(
    account: Account,
    today: date,
    *,
    owed_balance: Decimal | None = None,
    unmatched_import_count: int | None = None,
    has_payment_link: bool | None = None,
    payments_since_statement: Decimal | None = None,
) -> tuple[str, str | None, str | None, date | None, dict[str, Any]]:
    owed = ledger_owed_balance(account, today) if owed_balance is None else owed_balance
    limit = _decimal(account.credit_limit or 0)
    util_dec = _credit_utilization_percent(owed, limit)
    due_state = credit_payment_due_state(account, today)
    due = due_state["stored_due"]
    days_until = due_state["days_until"]
    due_is_stale = bool(due_state["is_stale"])
    payoff = _payoff_to_avoid_interest(
        account, payments_since_statement=payments_since_statement
    )
    from accounts.services.minimum_payment import resolve_effective_minimum_payment

    resolved_min = resolve_effective_minimum_payment(account, current_owed=owed)
    min_pay = _decimal(resolved_min.amount or 0)
    meaningful_owed = _credit_owed_is_meaningful(owed, limit=limit, min_payment=min_pay)

    past_due_amount = Decimal("0")
    if (
        not due_is_stale
        and days_until is not None
        and days_until < 0
        and (payoff > 0 or owed > 0)
    ):
        past_due_amount = payoff if payoff > 0 else owed

    target_util = _target_utilization_percent(account)
    watch_at, risk_at, _over_limit_at = _credit_utilization_thresholds(target_util)

    details: dict[str, Any] = {
        "lowest_projected_balance": None,
        "available_to_spend": None,
        "minimum_buffer": str(account.minimum_buffer or 0),
        "utilization_percent": _serialize_decimal(util_dec),
        "target_utilization_percent": _serialize_decimal(target_util),
        "days_until_due": days_until,
        "payment_due_is_stale": due_is_stale,
        "past_due_amount": _serialize_decimal(past_due_amount) if past_due_amount > 0 else None,
        "unmatched_import_count": _count_unmatched_imports(
            account, unmatched_import_count=unmatched_import_count
        ),
    }

    issues: list[tuple[str, str, str]] = []
    risk_date: date | None = due if due and due >= today else None

    if past_due_amount > 0:
        issues.append(
            (HEALTH_STATUS_CRITICAL, "Payment is past due", REASON_PAYMENT_PAST_DUE)
        )
    elif due_is_stale and meaningful_owed:
        issues.append(
            (
                HEALTH_STATUS_WATCH,
                "Last known due date is outdated",
                REASON_DUE_DATE_STALE,
            )
        )

    if limit > 0 and owed > limit:
        issues.append(
            (HEALTH_STATUS_CRITICAL, "Balance exceeds credit limit", REASON_OVER_LIMIT)
        )

    if util_dec is not None and util_dec >= risk_at:
        issues.append(
            (
                HEALTH_STATUS_RISK,
                _utilization_reason(util_dec, target_util),
                _utilization_reason_code(util_dec),
            )
        )
    elif util_dec is not None and util_dec >= watch_at:
        issues.append(
            (
                HEALTH_STATUS_WATCH,
                _utilization_reason(util_dec, target_util),
                _utilization_reason_code(util_dec),
            )
        )
    elif util_dec is not None and util_dec > target_util:
        details["utilization_state"] = "above_target"
        details["utilization_label"] = _utilization_reason(util_dec, target_util)

    if (
        days_until is not None
        and 0 <= days_until <= PAYMENT_DUE_RISK_DAYS
        and payoff > 0
        and not account.autopay_enabled
    ):
        issues.append(
            (
                HEALTH_STATUS_RISK,
                f"Payment due in {days_until} day{'s' if days_until != 1 else ''}",
                REASON_PAYMENT_DUE_SOON,
            )
        )

    if (
        days_until is not None
        and 0 <= days_until <= PAYMENT_DUE_WATCH_DAYS
        and payoff > 0
    ):
        if not any(code == REASON_PAYMENT_DUE_SOON for _, _, code in issues):
            issues.append(
                (
                    HEALTH_STATUS_WATCH,
                    f"Payment due in {days_until} day{'s' if days_until != 1 else ''}",
                    REASON_PAYMENT_DUE_SOON,
                )
            )

    projected_interest = _projected_interest_from_payoff(account, payoff)
    if (
        payoff > 0
        and projected_interest > 0
        and not account.autopay_enabled
        and (days_until is None or days_until > PAYMENT_DUE_WATCH_DAYS)
    ):
        issues.append(
            (
                HEALTH_STATUS_RISK,
                "Projected interest if statement balance remains unpaid",
                REASON_PROJECTED_INTEREST,
            )
        )

    if owed > 0 and min_pay > 0:
        from credit_cards.services.payoff import payment_below_interest_details

        below = payment_below_interest_details(account, min_pay, owed)
        if below:
            issues.append(
                (HEALTH_STATUS_RISK, below["message"], REASON_PAYMENT_BELOW_INTEREST)
            )
            details["payoff_impossible"] = True
            details["estimated_monthly_interest"] = str(below["estimated_monthly_interest"])
            details["min_payment_to_reduce_principal"] = str(
                below["min_payment_to_reduce_principal"]
            )
            details["planned_payment_amount"] = str(below["payment_amount"])

    apr = _decimal(account.apr or 0)
    if apr >= HIGH_APR_THRESHOLD and meaningful_owed and payoff > 0:
        if not any(
            code in (REASON_PROJECTED_INTEREST, REASON_PAYMENT_BELOW_INTEREST)
            for _, _, code in issues
        ):
            issues.append(
                (HEALTH_STATUS_WATCH, "High APR with carried balance", REASON_HIGH_APR)
            )

    if has_payment_link is None:
        has_payment_link = account.autopay_enabled or AccountRelationship.objects.filter(
            destination_account_id=account.pk,
            is_active=True,
            relationship_type__in=PAYMENT_LINK_RELATIONSHIP_TYPES,
        ).exists()
    if meaningful_owed and not has_payment_link:
        issues.append(
            (HEALTH_STATUS_WATCH, "No payment account linked.", REASON_NO_PAYMENT_LINK)
        )
    if meaningful_owed and resolved_min.amount is None:
        details["minimum_payment_configuration_needed"] = True
        if payoff > 0 or past_due_amount > 0:
            issues.append(
                (
                    HEALTH_STATUS_WATCH,
                    "Minimum payment needs to be configured.",
                    REASON_MINIMUM_PAYMENT_UNAVAILABLE,
                )
            )

    due_needs_attention = past_due_amount > 0 or (due_is_stale and meaningful_owed)
    if account.autopay_enabled and payoff <= 0 and not due_needs_attention:
        return HEALTH_STATUS_HEALTHY, None, None, None, details

    if (
        util_dec is not None
        and util_dec <= target_util
        and payoff <= 0
        and not due_needs_attention
        and not details.get("payoff_impossible")
    ):
        return HEALTH_STATUS_HEALTHY, None, None, None, details

    if not issues:
        soft_label = details.get("utilization_label")
        soft_code = REASON_UTILIZATION_ABOVE_TARGET if soft_label else None
        return HEALTH_STATUS_HEALTHY, soft_label, soft_code, None, details

    status = _worst_status(*(s for s, _, _ in issues))
    reason = issues[0][1]
    reason_code = issues[0][2]
    priority_codes = (
        REASON_PAYMENT_PAST_DUE,
        REASON_OVER_LIMIT,
        REASON_PAYMENT_DUE_SOON,
        REASON_NEAR_LIMIT,
        REASON_HIGH_UTILIZATION,
        REASON_UTILIZATION_ABOVE_TARGET,
        REASON_PROJECTED_INTEREST,
    )
    for code in priority_codes:
        for _s, r, c in issues:
            if c == code:
                reason, reason_code = r, c
                break
        else:
            continue
        break
    return status, reason, reason_code, risk_date, details



def _savings_health(
    account: Account,
    forecast: dict[str, Any] | None,
    today: date,
    *,
    unmatched_import_count: int | None = None,
    signed_balance: Decimal | None = None,
) -> tuple[str, str | None, str | None, date | None, dict[str, Any]]:
    details: dict[str, Any] = {
        "lowest_projected_balance": None,
        "available_to_spend": None,
        "minimum_buffer": str(account.minimum_buffer or 0),
        "utilization_percent": None,
        "days_until_due": None,
        "past_due_amount": None,
        "unmatched_import_count": _count_unmatched_imports(
            account, unmatched_import_count=unmatched_import_count
        ),
    }

    if forecast and forecast.get("supports_available_to_spend"):
        lowest = _decimal(forecast["lowest_projected_balance"])
        minimum_buffer = _decimal(forecast.get("minimum_buffer") or account.minimum_buffer or 0)
        details["lowest_projected_balance"] = forecast.get("lowest_projected_balance")
        details["available_to_spend"] = forecast.get("available_to_spend")
        risk_date_str = forecast.get("risk_date")
        risk_date = date.fromisoformat(risk_date_str) if risk_date_str else None

        if lowest < Decimal("0"):
            return (
                HEALTH_STATUS_CRITICAL,
                "Projected negative",
                REASON_FORECAST_NEGATIVE,
                risk_date,
                details,
            )
        if lowest < minimum_buffer:
            date_label = risk_date.isoformat() if risk_date else "the forecast window"
            return (
                HEALTH_STATUS_RISK,
                f"Projected below buffer on {date_label}",
                REASON_FORECAST_BELOW_BUFFER,
                risk_date,
                details,
            )
        current = _decimal(forecast.get("current_balance") or 0)
        if current > 0 and lowest < current * Decimal("0.90"):
            return (
                HEALTH_STATUS_WATCH,
                "Balance trending down in forecast window",
                REASON_BALANCE_TRENDING_DOWN,
                risk_date,
                details,
            )
        return HEALTH_STATUS_HEALTHY, None, None, None, details

    balance = (
        signed_balance
        if signed_balance is not None
        else _balance_at_end_of_date(account.pk, today)
    )
    minimum_buffer = _decimal(account.minimum_buffer or 0)
    details["lowest_projected_balance"] = str(balance)
    if balance < minimum_buffer:
        return HEALTH_STATUS_RISK, "Balance below minimum buffer", REASON_FORECAST_BELOW_BUFFER, None, details
    return HEALTH_STATUS_HEALTHY, None, None, None, details


def _loan_health(
    account: Account,
    today: date,
    *,
    unmatched_import_count: int | None = None,
    has_planned_payment: bool | None = None,
) -> tuple[str, str | None, str | None, date | None, dict[str, Any]]:
    due = account.next_payment_due_date
    days_until = (due - today).days if due else None
    details: dict[str, Any] = {
        "lowest_projected_balance": None,
        "available_to_spend": None,
        "minimum_buffer": str(account.minimum_buffer or 0),
        "utilization_percent": None,
        "days_until_due": days_until,
        "past_due_amount": None,
        "unmatched_import_count": _count_unmatched_imports(
            account, unmatched_import_count=unmatched_import_count
        ),
    }
    if not due:
        return HEALTH_STATUS_HEALTHY, None, None, None, details

    if days_until is not None and days_until < 0:
        return HEALTH_STATUS_CRITICAL, "Payment is past due", REASON_PAYMENT_PAST_DUE, due, details

    if has_planned_payment is None:
        has_planned = Transaction.objects.filter(
            account_id=account.pk,
            date__gte=today,
            date__lte=due,
            status=Transaction.Status.PLANNED,
            amount__lt=0,
        ).exists()
    else:
        has_planned = has_planned_payment

    if 0 <= days_until <= PAYMENT_DUE_RISK_DAYS and not has_planned and not account.autopay_enabled:
        return (
            HEALTH_STATUS_RISK,
            f"Payment due in {days_until} day{'s' if days_until != 1 else ''}",
            REASON_PAYMENT_DUE_SOON,
            due,
            details,
        )

    if 0 <= days_until <= PAYMENT_DUE_WATCH_DAYS:
        return (
            HEALTH_STATUS_WATCH,
            f"Payment due in {days_until} day{'s' if days_until != 1 else ''}",
            REASON_PAYMENT_DUE_SOON,
            due,
            details,
        )

    return HEALTH_STATUS_HEALTHY, None, None, None, details


def _recommended_action(
    account: Account,
    status: str,
    reason: str | None,
    details: dict[str, Any],
    forecast: dict[str, Any] | None,
) -> str | None:
    if status == HEALTH_STATUS_HEALTHY:
        return None

    if account.is_credit_card():
        util = details.get("utilization_percent")
        if status == HEALTH_STATUS_CRITICAL and details.get("past_due_amount"):
            return None
        if details.get("payment_due_is_stale"):
            return "Confirm the current payment due date."
        target = _target_utilization_percent(account)
        util_dec = _decimal(util) if util is not None else None
        if details.get("payoff_impossible") and (
            util_dec is None or util_dec < CREDIT_UTILIZATION_RISK
        ):
            min_reduce = details.get("min_payment_to_reduce_principal")
            if min_reduce:
                return (
                    f"Increase the planned payment to at least "
                    f"${_decimal(min_reduce):.0f}/mo to begin reducing principal."
                )
            return "Increase the planned payment so it covers monthly interest."
        if util_dec is not None and util_dec > target:
            return f"Reduce card utilization toward your {target:.0f}% target."
        days = details.get("days_until_due")
        if days is not None and days >= 0:
            return "Schedule a payment before the due date."
        if reason and "interest" in reason.lower():
            return "Pay statement balance before the due date to avoid interest."
        return "Review payment and utilization on this card."

    if account.role == Account.AccountRole.LOAN:
        if status in (HEALTH_STATUS_CRITICAL, HEALTH_STATUS_RISK):
            return "Schedule a payment before the due date."
        return "Confirm an upcoming payment is planned."

    shortfall_type = details.get("shortfall_type")
    risk_date = forecast.get("risk_date") if forecast else None
    if shortfall_type == "actual_balance" and forecast:
        shortfall = cash_account_risk_shortfall(forecast, shortfall_type="actual_balance")
        if shortfall and shortfall > 0:
            date_part = f" before {risk_date}" if risk_date else ""
            return (
                f"Add ${shortfall.quantize(Decimal('0.01'))} before negative balance{date_part}."
            )
    elif shortfall_type == "buffer" and forecast:
        shortfall = cash_account_risk_shortfall(forecast, shortfall_type="buffer")
        if shortfall and shortfall > 0:
            date_part = f" before {risk_date}" if risk_date else ""
            return f"Add ${shortfall} to restore buffer{date_part}."
    elif details.get("spending_cushion_negative") and forecast:
        available = _decimal(forecast.get("available_to_spend") or 0)
        if available < 0:
            gap = abs(available).quantize(Decimal("0.01"))
            date_part = f" before {risk_date}" if risk_date else ""
            return (
                f"Short by ${gap} after buffers/reserved savings{date_part}."
            )

    if reason and "buffer" in reason.lower():
        return "Increase minimum buffer or adjust upcoming bills."
    if reason and "outflow" in reason.lower():
        return "Review large upcoming bills in the next week."
    return "Review upcoming activity on this account."


def calculate_account_health(
    user,
    account: Account,
    *,
    as_of_date: Optional[date] = None,
    days: int = DEFAULT_FORECAST_DAYS,
    forecast_summary: Optional[dict[str, Any]] = None,
    timeline_rows: Optional[list[dict]] = None,
    signed_balance: Decimal | None = None,
    unmatched_import_count: int | None = None,
    has_payment_link: bool | None = None,
    has_planned_loan_payment: bool | None = None,
    payments_since_statement: Decimal | None = None,
) -> dict[str, Any]:
    """Compute health for a single account."""
    days = normalize_forecast_days(days)
    today = as_of_date or date.today()

    if account.status != Account.Status.ACTIVE:
        return {
            "status": None,
            "score": None,
            "reason": None,
            "reason_code": None,
            "risk_date": None,
            "details": {"lifecycle_inactive": True, "status": account.status},
            "recommended_action": None,
        }

    if forecast_summary is None and account_supports_available_to_spend(account):
        if timeline_rows is None:
            from timeline.services.canonical_timeline_cache import (
                get_or_build_canonical_forecast_timeline,
            )

            timeline_rows, _ = get_or_build_canonical_forecast_timeline(
                user,
                today=today,
                forecast_days=days,
                household_id=account.household_id,
                caller="account_health",
            )
        from accounts.services.available_to_spend import calculate_account_forecast_summary

        forecast_summary = calculate_account_forecast_summary(
            user,
            account,
            as_of_date=today,
            days=days,
            timeline_rows=timeline_rows,
        )

    if account.is_credit_card() or account.role == Account.AccountRole.CREDIT_CARD:
        owed = (
            credit_owed_from_signed_balance(signed_balance)
            if signed_balance is not None
            else None
        )
        status, reason, reason_code, risk_date, details = _credit_card_health(
            account,
            today,
            owed_balance=owed,
            unmatched_import_count=unmatched_import_count,
            has_payment_link=has_payment_link,
            payments_since_statement=payments_since_statement,
        )
        forecast = None
    elif account.role == Account.AccountRole.LOAN:
        status, reason, reason_code, risk_date, details = _loan_health(
            account,
            today,
            unmatched_import_count=unmatched_import_count,
            has_planned_payment=has_planned_loan_payment,
        )
        forecast = forecast_summary
    elif account.role in SAVINGS_ROLES or account.account_type == Account.AccountType.SAVINGS:
        status, reason, reason_code, risk_date, details = _savings_health(
            account,
            forecast_summary,
            today,
            unmatched_import_count=unmatched_import_count,
            signed_balance=signed_balance,
        )
        forecast = forecast_summary
    elif account_supports_available_to_spend(account):
        status, reason, reason_code, risk_date, details = _cash_health(
            account,
            forecast_summary,
            today,
            timeline_rows,
            unmatched_import_count=unmatched_import_count,
        )
        forecast = forecast_summary
    else:
        status, reason, reason_code, risk_date, details = (
            HEALTH_STATUS_HEALTHY,
            None,
            None,
            None,
            {
                "lowest_projected_balance": None,
                "available_to_spend": None,
                "minimum_buffer": str(account.minimum_buffer or 0),
                "utilization_percent": None,
                "days_until_due": None,
                "past_due_amount": None,
                "unmatched_import_count": _count_unmatched_imports(
                    account, unmatched_import_count=unmatched_import_count
                ),
            },
        )
        forecast = forecast_summary

    headroom = None
    if forecast and forecast.get("supports_available_to_spend"):
        lowest = _decimal(forecast.get("lowest_projected_balance") or 0)
        buffer = _decimal(forecast.get("minimum_buffer") or 0)
        if buffer > 0:
            headroom = max(Decimal("0"), (lowest - buffer) / buffer)

    score = _status_score(status, headroom_ratio=headroom)
    action = _recommended_action(account, status, reason, details, forecast)

    return {
        "status": status,
        "score": score,
        "reason": reason,
        "reason_code": reason_code,
        "risk_date": risk_date.isoformat() if risk_date else None,
        "recommended_action": action,
        "details": details,
    }


def calculate_account_health_for_accounts(
    user,
    accounts: list[Account],
    *,
    as_of_date: Optional[date] = None,
    days: int = DEFAULT_FORECAST_DAYS,
    timeline_rows: list[dict] | None = None,
    forecast_summaries: dict[int, dict[str, Any]] | None = None,
    context: AccountHealthSupportData | None = None,
) -> dict[int, dict[str, Any]]:
    """Batch health calculation with shared forecast timeline where possible."""
    days = normalize_forecast_days(days)
    today = as_of_date or date.today()

    if forecast_summaries is None:
        forecasts, shared_timeline = calculate_forecast_summaries_for_accounts_with_timeline(
            user,
            accounts,
            as_of_date=today,
            days=days,
            timeline_rows=timeline_rows,
        )
        effective_timeline = timeline_rows if timeline_rows is not None else shared_timeline
    else:
        forecasts = forecast_summaries
        effective_timeline = timeline_rows

    if context is None:
        context = build_account_health_context(accounts, today=today)

    result: dict[int, dict[str, Any]] = {}
    for account in accounts:
        result[account.id] = calculate_account_health(
            user,
            account,
            as_of_date=today,
            days=days,
            forecast_summary=forecasts.get(account.id),
            timeline_rows=effective_timeline,
            signed_balance=context.signed_balances.get(account.id),
            unmatched_import_count=context.unmatched_import_counts.get(account.id, 0),
            has_payment_link=(
                account.autopay_enabled or account.id in context.payment_link_account_ids
            ),
            has_planned_loan_payment=account.id in context.planned_loan_payment_account_ids,
            payments_since_statement=context.payments_since_statement.get(account.id, Decimal("0"))
            if account.last_statement_date is not None
            else Decimal("0"),
        )
    return result


def serialize_account_health(health: dict[str, Any]) -> dict[str, Any]:
    """API field names for account serializers."""
    return {
        "health_status": health.get("status"),
        "health_score": health.get("score"),
        "health_reason": health.get("reason"),
        "health_reason_code": health.get("reason_code"),
        "health_risk_date": health.get("risk_date"),
        "health_details": health.get("details"),
        "health_recommended_action": health.get("recommended_action"),
    }


def dashboard_account_health_aggregate(
    health_by_id: dict[int, dict[str, Any]],
    accounts_by_id: dict[int, Account],
    *,
    safe_to_spend_total: str | None = None,
) -> dict[str, Any]:
    """Household-level health summary for dashboard."""
    needing_attention: list[dict[str, Any]] = []
    critical_count = 0
    next_risk_date: date | None = None
    worst: dict[str, Any] | None = None

    for aid, health in health_by_id.items():
        account = accounts_by_id.get(aid)
        if not account:
            continue
        status = health.get("status", HEALTH_STATUS_HEALTHY)
        if status == HEALTH_STATUS_HEALTHY:
            continue
        if status == HEALTH_STATUS_CRITICAL:
            critical_count += 1

        entry = {
            "account_id": aid,
            "account_name": account.effective_display_name,
            "health_status": status,
            "health_score": health.get("score"),
            "health_reason": health.get("reason"),
            "health_risk_date": health.get("risk_date"),
        }
        needing_attention.append(entry)

        rd = health.get("risk_date")
        if rd:
            try:
                rd_date = date.fromisoformat(rd)
                if next_risk_date is None or rd_date < next_risk_date:
                    next_risk_date = rd_date
            except ValueError:
                pass

        score = health.get("score", 100)
        if worst is None or score < worst.get("health_score", 100):
            worst = {
                "account_id": aid,
                "account_name": account.effective_display_name,
                "health_status": status,
                "health_score": score,
                "health_reason": health.get("reason"),
                "health_risk_date": health.get("risk_date"),
            }

    needing_attention.sort(
        key=lambda e: (
            -STATUS_SEVERITY.get(e["health_status"], 0),
            e.get("health_risk_date") or "9999-12-31",
        )
    )

    next_issue_account = needing_attention[0] if needing_attention else None
    next_issue_text = None
    if next_issue_account and next_issue_account.get("health_reason"):
        name = next_issue_account["account_name"]
        reason = next_issue_account["health_reason"]
        rd = next_issue_account.get("health_risk_date")
        if rd and "on " not in reason.lower():
            next_issue_text = f"Next issue: {name} — {reason} on {rd}"
        else:
            next_issue_text = f"Next issue: {name} — {reason}"

    return {
        "accounts_needing_attention_count": len(needing_attention),
        "critical_accounts_count": critical_count,
        "accounts_needing_attention": needing_attention,
        "next_health_risk_date": next_risk_date.isoformat() if next_risk_date else None,
        "worst_health_account": worst,
        "next_health_issue_text": next_issue_text,
        "total_safe_to_spend": safe_to_spend_total,
    }
