"""
Regression: Dashboard cash-risk must match canonical timeline balance_after.

Reproduces the Aug 28 false-negative case: end-of-day balance stays positive while
below minimum buffer — must not be labeled projected negative.
"""
from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.core.cache import cache

from accounts.models import Account
from accounts.services.account_health import (
    HEALTH_STATUS_CRITICAL,
    HEALTH_STATUS_RISK,
    _cash_health,
    calculate_account_health_for_accounts,
)
from accounts.services.available_to_spend import (
    build_cash_risk_context,
    calculate_forecast_summaries_for_accounts,
    cash_account_risk_shortfall,
)
from timeline.services.ledger import forecast_account_balance_metrics
from core.models import Household, HouseholdMembership
from insights.services.dashboard_summary import (
    _attention_amount,
    _dashboard_recommended_action,
    _short_attention_reason,
    build_attention_items,
)
from timeline.services.canonical_timeline_cache import get_or_build_canonical_forecast_timeline
from timeline.services.ledger import build_forecast_projection_timeline
from transactions.models import Transaction

User = get_user_model()

AS_OF = date(2026, 8, 27)
AUG_28 = date(2026, 8, 28)
SEP_4 = date(2026, 9, 4)
FORECAST_DAYS = 30
MINIMUM_BUFFER = Decimal("503.43")
OPENING = Decimal("1784.18")
AUG_28_FINAL = Decimal("99.18")
SEP_4_NEGATIVE = Decimal("-1005.43")
BUFFER_SHORTFALL = Decimal("404.25")
ACTUAL_SHORTFALL = abs(SEP_4_NEGATIVE)


@pytest.fixture
def user(db):
    return User.objects.create_user(username="cash_risk_canonical", password="testpass123")


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="Cash Risk Canonical HH")
    HouseholdMembership.objects.create(
        household=h, user=user, role=HouseholdMembership.Role.OWNER
    )
    return h


@pytest.fixture
def main(db, household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        name="Main",
        starting_balance=OPENING,
        minimum_buffer=MINIMUM_BUFFER,
        currency="USD",
        include_in_forecast=True,
    )


def _planned(account, day, payee, amount):
    return Transaction.objects.create(
        account=account,
        date=day,
        payee=payee,
        amount=amount,
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.ONE_TIME,
    )


def _aug_28_stack(main):
    """Canonical same-day order: inflows before large rent, then smaller bills."""
    _planned(main, AUG_28, "Gen's Rent", Decimal("1500.00"))
    _planned(main, AUG_28, "Rent", Decimal("-3100.00"))
    _planned(main, AUG_28, "Lou", Decimal("500.00"))
    _planned(main, AUG_28, "Electric bill", Decimal("-405.00"))
    _planned(main, AUG_28, "Water Bill", Decimal("-180.00"))


def _canonical_rows(user, main):
    cache.clear()
    end = AS_OF + timedelta(days=FORECAST_DAYS)
    return build_forecast_projection_timeline(
        user,
        today=AS_OF,
        end_date=end,
        caller="test_cash_risk_canonical",
        account_id=main.pk,
    )


def _aug_28_row_balances(rows, account_id):
    day_rows = [
        r
        for r in rows
        if r.get("account_id") == account_id
        and str(r.get("date"))[:10] == AUG_28.isoformat()
    ]
    day_rows.sort(key=lambda r: (r.get("transaction_id") or -1, str(r.get("description") or "")))
    return [Decimal(str(r["running_balance"])) for r in day_rows if r.get("running_balance") is not None]


@pytest.mark.django_db
def test_aug_28_canonical_balances_never_negative(user, main):
    _aug_28_stack(main)
    rows = _canonical_rows(user, main)
    balances = _aug_28_row_balances(rows, main.id)

    assert balances
    assert all(b >= 0 for b in balances)
    assert balances[-1] == AUG_28_FINAL

    metrics = forecast_account_balance_metrics(
        rows,
        account_id=main.id,
        today=AS_OF,
        end_date=AS_OF + timedelta(days=FORECAST_DAYS),
        minimum_buffer=MINIMUM_BUFFER,
    )
    assert metrics["first_negative_date"] is None
    assert metrics["end_of_day"][AUG_28] == AUG_28_FINAL
    assert metrics["first_below_buffer_date"] == AUG_28
    assert metrics["first_below_buffer_balance"] < MINIMUM_BUFFER


@pytest.mark.django_db
def test_aug_28_buffer_risk_not_projected_negative(user, main):
    _aug_28_stack(main)
    rows = _canonical_rows(user, main)
    summaries = calculate_forecast_summaries_for_accounts(
        user, [main], as_of_date=AS_OF, days=FORECAST_DAYS, timeline_rows=rows
    )
    forecast = summaries[main.id]
    status, reason, risk_date, details = _cash_health(main, forecast, AS_OF, rows)

    assert status == HEALTH_STATUS_RISK
    assert details["actual_balance_negative"] is False
    assert details["shortfall_type"] == "buffer"
    assert risk_date == AUG_28
    assert cash_account_risk_shortfall(forecast, shortfall_type="buffer") == BUFFER_SHORTFALL
    assert cash_account_risk_shortfall(forecast, shortfall_type="actual_balance") is None

    short = _short_attention_reason(
        reason, risk_date.isoformat(), status, details=details
    )
    assert short == "Below buffer Aug 28"
    assert "Projected negative" not in short

    amount = _attention_amount(
        {"status": status, "reason": reason, "details": details},
        forecast,
        main,
        today=AS_OF,
    )
    assert amount == BUFFER_SHORTFALL

    action = _dashboard_recommended_action(
        main,
        {"status": status, "reason": reason, "details": details},
        forecast,
        amount,
        risk_date.isoformat(),
    )
    assert "restore buffer" in action.lower()
    assert "Projected negative" not in action


@pytest.mark.django_db
def test_sep_4_actual_negative_wins_over_buffer_date(user, main):
    _aug_28_stack(main)
    _planned(main, SEP_4, "Large bill", Decimal("-1104.61"))
    rows = _canonical_rows(user, main)
    summaries = calculate_forecast_summaries_for_accounts(
        user, [main], as_of_date=AS_OF, days=FORECAST_DAYS, timeline_rows=rows
    )
    forecast = summaries[main.id]

    assert forecast["first_negative_date"] == SEP_4.isoformat()
    assert Decimal(forecast["first_negative_balance"]) == SEP_4_NEGATIVE
    assert Decimal(forecast["lowest_projected_balance"]) == SEP_4_NEGATIVE
    assert forecast["lowest_projected_balance_date"] == SEP_4.isoformat()
    assert forecast["first_below_buffer_date"] == AUG_28.isoformat()

    status, reason, risk_date, details = _cash_health(main, forecast, AS_OF, rows)
    assert status == HEALTH_STATUS_CRITICAL
    assert details["shortfall_type"] == "actual_balance"
    assert details["actual_balance_negative"] is True
    assert risk_date == SEP_4
    assert cash_account_risk_shortfall(forecast, shortfall_type="actual_balance") == ACTUAL_SHORTFALL

    short = _short_attention_reason(
        reason, risk_date.isoformat(), status, details=details
    )
    assert short == "Projected negative Sep 4"
    assert "Aug 28" not in short

    cash_risk = build_cash_risk_context(forecast)
    assert cash_risk["risk_type"] == "actual_balance"
    assert cash_risk["date"] == SEP_4.isoformat()
    assert Decimal(cash_risk["amount_to_resolve"]) == ACTUAL_SHORTFALL


@pytest.mark.django_db
def test_dashboard_attention_matches_canonical_metrics(user, main):
    _aug_28_stack(main)
    _planned(main, SEP_4, "Large bill", Decimal("-1104.61"))
    cache.clear()
    rows, _ = get_or_build_canonical_forecast_timeline(
        user,
        today=AS_OF,
        forecast_days=FORECAST_DAYS,
        caller="test_dashboard",
    )
    forecasts = calculate_forecast_summaries_for_accounts(
        user, [main], as_of_date=AS_OF, days=FORECAST_DAYS, timeline_rows=rows
    )
    health_by_id = calculate_account_health_for_accounts(
        user,
        [main],
        as_of_date=AS_OF,
        days=FORECAST_DAYS,
        timeline_rows=rows,
        forecast_summaries=forecasts,
    )
    items = build_attention_items(
        health_by_id,
        {main.id: main},
        forecasts,
        limit=10,
        today=AS_OF,
    )
    assert len(items) == 1
    item = items[0]
    assert item["reason"] == "Projected negative Sep 4"
    assert Decimal(item["amount"]) == ACTUAL_SHORTFALL
    assert forecasts[main.id]["lowest_projected_balance"] == str(SEP_4_NEGATIVE)
    assert forecasts[main.id]["lowest_projected_balance_date"] == SEP_4.isoformat()
