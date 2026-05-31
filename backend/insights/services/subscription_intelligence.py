"""
Subscription intelligence: recurring rules + detected repeating charges.

Surfaces monthly subscription commitments (Netflix, gym, software, etc.) for review.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from django.db.models import Q

from accounts.models import Account
from core.utils import get_households_for_user
from timeline.models import RecurringRule
from transactions.models import Transaction

SUBSCRIPTION_CATEGORY_NAMES = frozenset(
    {"Streaming", "Software / Apps", "Memberships"}
)

SUBSCRIPTION_NAME_KEYWORDS = (
    "netflix",
    "spotify",
    "hulu",
    "disney",
    "disney+",
    "hbo",
    "max",
    "apple music",
    "apple tv",
    "youtube",
    "youtube premium",
    "amazon prime",
    "prime video",
    "adobe",
    "microsoft 365",
    "office 365",
    "dropbox",
    "icloud",
    "google one",
    "gym",
    "fitness",
    "planet fitness",
    "peloton",
    "classpass",
    "subscription",
    "membership",
    "audible",
    "paramount",
    "peacock",
    "crunchyroll",
    "xbox",
    "playstation",
    "nintendo",
)


def _decimal(val) -> Decimal:
    if isinstance(val, Decimal):
        return val
    if val is None:
        return Decimal("0")
    return Decimal(str(val))


def rule_monthly_expense_amount(rule: RecurringRule) -> Decimal:
    """Normalize rule amount to approximate monthly outflow."""
    amount = abs(_decimal(rule.amount))
    interval = max(1, int(rule.interval or 1))
    freq = rule.frequency
    if freq == RecurringRule.Frequency.WEEKLY:
        per_month = (Decimal("52") / Decimal("12") / Decimal(interval)) * amount
    elif freq == RecurringRule.Frequency.BIWEEKLY:
        per_month = (Decimal("26") / Decimal("12") / Decimal(interval)) * amount
    elif freq in (
        RecurringRule.Frequency.MONTHLY_DAY,
        RecurringRule.Frequency.MONTHLY_NTH_WEEKDAY,
    ):
        per_month = amount / Decimal(interval)
    elif freq == RecurringRule.Frequency.YEARLY:
        per_month = amount / (Decimal("12") * Decimal(interval))
    else:
        per_month = amount / Decimal(interval)
    return per_month.quantize(Decimal("0.01"))


def rule_is_subscription(rule: RecurringRule, *, today: date | None = None) -> bool:
    if rule.direction != RecurringRule.Direction.EXPENSE:
        return False
    today = today or date.today()
    if rule.end_date and rule.end_date < today:
        return False
    if not rule.active:
        return False
    cat_name = (rule.category.name if rule.category_id and rule.category else "") or ""
    if cat_name in SUBSCRIPTION_CATEGORY_NAMES:
        return True
    name_lower = (rule.name or "").lower()
    return any(kw in name_lower for kw in SUBSCRIPTION_NAME_KEYWORDS)


def _normalize_merchant_label(payee: str | None, imported: str | None) -> str:
    raw = (payee or imported or "").strip()
    if not raw:
        return "Unknown"
    # Title-case short merchant names; keep acronyms readable.
    if len(raw) <= 32 and raw.upper() == raw:
        return raw.title()
    return raw[:80]


def _amounts_similar(a: Decimal, b: Decimal, tolerance: Decimal = Decimal("0.05")) -> bool:
    if a == b:
        return True
    base = max(abs(a), abs(b), Decimal("0.01"))
    return abs(a - b) / base <= tolerance


def _detect_subscriptions_from_transactions(
    user,
    *,
    today: date | None = None,
    lookback_days: int = 120,
    exclude_names: set[str],
) -> list[dict[str, Any]]:
    """
    Find merchants with 2+ similar outflows in the lookback window that are not
    already covered by a subscription rule name.
    """
    today = today or date.today()
    start = today - timedelta(days=lookback_days)
    households = get_households_for_user(user)
    account_ids = Account.objects.filter(household__in=households).values_list("id", flat=True)

    qs = (
        Transaction.objects.filter(
            account_id__in=account_ids,
            date__gte=start,
            date__lte=today,
            amount__lt=0,
        )
        .exclude(status=Transaction.Status.PLANNED)
        .filter(
            Q(source=Transaction.Source.PLAID)
            | Q(source=Transaction.Source.ONE_TIME)
            | Q(source=Transaction.Source.ACTUAL)
        )
        .order_by("-date")
    )

    by_merchant: dict[str, list[Transaction]] = defaultdict(list)
    for txn in qs.iterator(chunk_size=500):
        label = _normalize_merchant_label(txn.payee, txn.imported_description)
        key = label.strip().lower()
        if not key or key in exclude_names:
            continue
        if any(kw in key for kw in SUBSCRIPTION_NAME_KEYWORDS):
            by_merchant[key].append(txn)
            continue
        cat_name = (txn.category.name if txn.category_id and txn.category else "") or ""
        if cat_name in SUBSCRIPTION_CATEGORY_NAMES:
            by_merchant[key].append(txn)

    out: list[dict[str, Any]] = []
    for key, txns in by_merchant.items():
        if len(txns) < 2:
            continue
        amounts = [abs(_decimal(t.amount)) for t in txns]
        median = sorted(amounts)[len(amounts) // 2]
        if not all(_amounts_similar(median, a) for a in amounts):
            continue
        display = _normalize_merchant_label(txns[0].payee, txns[0].imported_description)
        out.append(
            {
                "id": f"detected-{key[:48]}",
                "source": "detected",
                "rule_id": None,
                "name": display,
                "monthly_amount": str(median.quantize(Decimal("0.01"))),
                "category": (txns[0].category.name if txns[0].category_id and txns[0].category else None),
                "account_name": (
                    txns[0].account.effective_display_name
                    if txns[0].account_id and txns[0].account
                    else None
                ),
                "active": True,
                "charge_count": len(txns),
                "last_charge_date": txns[0].date.isoformat(),
                "confidence": "high" if len(txns) >= 3 else "medium",
            }
        )

    out.sort(key=lambda x: (-float(x["monthly_amount"]), x["name"].lower()))
    return out


def build_subscription_intelligence(user, *, today: date | None = None) -> dict[str, Any]:
    today = today or date.today()
    households = get_households_for_user(user)
    rules = (
        RecurringRule.objects.filter(household__in=households, direction=RecurringRule.Direction.EXPENSE)
        .select_related("account", "category")
        .order_by("name")
    )

    subscriptions: list[dict[str, Any]] = []
    exclude_names: set[str] = set()
    total = Decimal("0")

    for rule in rules:
        if not rule_is_subscription(rule, today=today):
            continue
        monthly = rule_monthly_expense_amount(rule)
        if not rule.active or (rule.end_date and rule.end_date < today):
            continue
        exclude_names.add((rule.name or "").strip().lower())
        subscriptions.append(
            {
                "id": f"rule-{rule.id}",
                "source": "recurring_rule",
                "rule_id": rule.id,
                "name": rule.name,
                "monthly_amount": str(monthly),
                "category": rule.category.name if rule.category_id and rule.category else None,
                "account_name": rule.account.effective_display_name if rule.account_id else None,
                "active": rule.active,
                "charge_count": None,
                "last_charge_date": None,
                "confidence": "high",
            }
        )
        total += monthly

    subscriptions.sort(key=lambda x: (-float(x["monthly_amount"]), x["name"].lower()))

    suggested = _detect_subscriptions_from_transactions(user, today=today, exclude_names=exclude_names)

    suggested_total = sum(
        (_decimal(s["monthly_amount"]) for s in suggested),
        Decimal("0"),
    )

    return {
        "monthly_commitments_total": str(total.quantize(Decimal("0.01"))),
        "subscription_count": len(subscriptions),
        "subscriptions": subscriptions,
        "suggested": suggested,
        "suggested_monthly_total": str(suggested_total.quantize(Decimal("0.01"))),
    }
