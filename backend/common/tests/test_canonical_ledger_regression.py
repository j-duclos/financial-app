"""
Canonical financial-engine regression.

Protects the beta-critical ledger path with one household and real services.
No live Plaid, Stripe, SMTP, or Sentry.

Run from backend/:

    pytest common/tests/test_canonical_ledger_regression.py
    pytest -m ledger_regression

Anchor date (frozen as_of): 2026-01-20

Expected posted ledger (signed; credit debt is negative)
========================================================
Date        Event                         Checking   Savings   Credit     Net
2026-01-01  Starting balances             1000.00    500.00    -300.00    1200.00
2026-01-05  Paycheck                      3000.00    500.00    -300.00    3200.00
2026-01-06  Coffee purchase                2954.33    500.00    -300.00    3154.33
2026-01-08  Grocery (manual, then Plaid)   2922.23    500.00    -300.00    3122.23
2026-01-10  Transfer checking→savings      2722.23    700.00    -300.00    3122.23
2026-01-12  Credit-card payment            2622.23    700.00    -200.00    3122.23
2026-01-13  Three Cash App imports         2592.23    700.00    -200.00    3092.23

90-day projection from 2026-01-20 also includes:
  2026-01-25 / 02-25 / 03-25  Recurring income +500 (×3)
  2026-01-28                  Future dentist -150 (once)
  2026-02-01 / 03-01 / 04-01  Recurring rent -200 (×3)
Checking 90-day ending: 3342.23
Checking 365-day ending: 6042.23 (12 income + 12 rent + dentist)
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Account
from accounts.services.balances import signed_ledger_balance
from billing.entitlements import EntitlementDenied
from billing.tests.helpers import grant_premium
from categories.models import Category
from common.services.forecast_horizon import parse_forecast_days_param
from core.models import Household, HouseholdMembership
from insights.services.dashboard_summary import _build_dashboard_summary
from plaid_link.services import _create_plaid_sync_transaction, _plaid_txn_to_defaults
from timeline.models import RecurringRule
from timeline.services.ledger import (
    build_forecast_projection_timeline,
    forecast_account_balance_metrics,
)
from transactions.models import Transaction
from transactions.services.matching import ledger_visible_transactions
from transactions.services.posting import create_transfer, post_transaction
from transactions.services.reconciliation import app_current_balance

User = get_user_model()

TODAY = date(2026, 1, 20)
CENTS = Decimal("0.01")

CHECKING_START = Decimal("1000.00")
SAVINGS_START = Decimal("500.00")
CREDIT_OWED_START = Decimal("300.00")

PAYCHECK = Decimal("2000.00")
COFFEE = Decimal("-45.67")
GROCERY = Decimal("-32.10")
TRANSFER_AMT = Decimal("200.00")
CARD_PAYMENT = Decimal("100.00")
CASH_APP = Decimal("-10.00")
DENTIST = Decimal("-150.00")
RENT = Decimal("200.00")
INCOME = Decimal("500.00")

POSTED_CHECKING = Decimal("2592.23")
POSTED_SAVINGS = Decimal("700.00")
POSTED_CREDIT = Decimal("-200.00")
POSTED_NET = Decimal("3092.23")

CHECKING_90D = Decimal("3342.23")
CHECKING_365D = Decimal("6042.23")


def D(value) -> Decimal:
    return Decimal(str(value)).quantize(CENTS)


def assert_money(actual, expected, label: str) -> None:
    got = D(actual)
    want = D(expected)
    assert got == want, f"{label} expected {want}, got {got}"


def _row_date(row: dict) -> date:
    raw = row.get("date")
    if isinstance(raw, date):
        return raw
    return date.fromisoformat(str(raw)[:10])


def _row_account_id(row: dict) -> int:
    return int(row.get("account_id") or 0)


def _rows_named(rows: list[dict], needle: str, account_id: int) -> list[dict]:
    key = needle.lower()
    return [
        row
        for row in rows
        if key in (row.get("description") or "").lower() and _row_account_id(row) == account_id
    ]


def _projected_end(rows: list[dict], account_id: int):
    last = None
    for row in rows:
        if _row_account_id(row) != account_id:
            continue
        raw = row.get("balance_after")
        if raw is None:
            raw = row.get("running_balance")
        if raw is not None:
            last = D(raw)
    return last


def _max_row_date(rows: list[dict], account_id: int | None = None) -> date | None:
    latest = None
    for row in rows:
        if account_id is not None and _row_account_id(row) != account_id:
            continue
        d = _row_date(row)
        if latest is None or d > latest:
            latest = d
    return latest


def _import_plaid(*, account: Account, plaid_id: str, txn_date: date, our_amount: Decimal, payee: str, name: str | None = None):
    """Production Plaid insert/merge path. Plaid amounts are opposite our signed amounts."""
    defaults = _plaid_txn_to_defaults(
        {
            "transaction_id": plaid_id,
            "amount": -Decimal(str(our_amount)),
            "date": txn_date.isoformat(),
            "merchant_name": payee,
            "name": name or payee,
            "pending": False,
        },
        account.id,
    )
    assert defaults is not None, f"Plaid defaults missing for {plaid_id}"
    pid = defaults.pop("plaid_transaction_id", plaid_id)
    return _create_plaid_sync_transaction(account_pk=account.id, pid=str(pid), defaults=defaults)


@pytest.fixture
def freeze_today():
    with patch("django.utils.timezone.localdate", return_value=TODAY):
        yield TODAY


@pytest.fixture
def canonical(db, freeze_today):
    cache.clear()
    user = User.objects.create_user(username="ledger_regression", password="testpass123")
    household = Household.objects.create(name="Canonical HH")
    HouseholdMembership.objects.create(
        household=household, user=user, role=HouseholdMembership.Role.OWNER
    )
    checking = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        name="Checking",
        starting_balance=CHECKING_START,
        currency="USD",
        include_in_forecast=True,
    )
    savings = Account.objects.create(
        household=household,
        account_type=Account.AccountType.SAVINGS,
        role=Account.AccountRole.SAVINGS,
        name="Savings",
        starting_balance=SAVINGS_START,
        currency="USD",
        include_in_forecast=True,
    )
    credit = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        role=Account.AccountRole.CREDIT_CARD,
        name="Credit Card",
        starting_balance=CREDIT_OWED_START,
        currency="USD",
        include_in_forecast=True,
        credit_limit=Decimal("2000.00"),
    )
    income_cat = Category.objects.create(
        household=household, name="Paycheck", category_type=Category.CategoryType.INCOME
    )
    expense_cat = Category.objects.create(
        household=household, name="Living", category_type=Category.CategoryType.EXPENSE
    )

    snapshots = {}

    def snap(label: str):
        snapshots[label] = {
            "checking": signed_ledger_balance(checking, TODAY),
            "savings": signed_ledger_balance(savings, TODAY),
            "credit": signed_ledger_balance(credit, TODAY),
        }

    snap("start")

    paycheck = post_transaction(
        user, checking.id, date(2026, 1, 5), "Acme Payroll", PAYCHECK, category_id=income_cat.id
    )
    snap("paycheck")

    coffee = post_transaction(
        user, checking.id, date(2026, 1, 6), "Coffee Shop", COFFEE, category_id=expense_cat.id
    )
    snap("coffee")

    grocery = post_transaction(
        user,
        checking.id,
        date(2026, 1, 8),
        "POS DEBIT WAL-MART #4430 MARICOPA AZ (...2404)",
        GROCERY,
        category_id=expense_cat.id,
        memo="weekly groceries",
    )
    snap("grocery_manual")

    imported_grocery = _import_plaid(
        account=checking,
        plaid_id="pl-walmart-canonical",
        txn_date=date(2026, 1, 8),
        our_amount=GROCERY,
        payee="Walmart",
        name="Walmart",
    )
    snap("grocery_imported")

    xfer = create_transfer(
        user, checking.id, savings.id, TRANSFER_AMT, date(2026, 1, 10), payee="Transfer to savings"
    )
    snap("transfer")

    card_pay = create_transfer(
        user, checking.id, credit.id, CARD_PAYMENT, date(2026, 1, 12), payee="Credit card payment"
    )
    snap("card_payment")

    cash_app_imports = []
    for i in range(3):
        cash_app_imports.append(
            _import_plaid(
                account=checking,
                plaid_id=f"pl-cash-app-{i}",
                txn_date=date(2026, 1, 13),
                our_amount=CASH_APP,
                payee="Cash App Payment",
                name="Cash App Payment",
            )
        )
    snap("cash_app")

    dentist = post_transaction(
        user, checking.id, date(2026, 1, 28), "Dentist", DENTIST, category_id=expense_cat.id
    )

    rent_rule = RecurringRule.objects.create(
        household=household,
        account=checking,
        category=expense_cat,
        name="Rent",
        direction=RecurringRule.Direction.EXPENSE,
        amount=RENT,
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=1,
        start_date=date(2026, 2, 1),
        active=True,
        is_bill=True,
    )
    income_rule = RecurringRule.objects.create(
        household=household,
        account=checking,
        category=income_cat,
        name="Monthly paycheck",
        direction=RecurringRule.Direction.INCOME,
        amount=INCOME,
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=25,
        start_date=date(2026, 1, 25),
        active=True,
    )

    return SimpleNamespace(
        user=user,
        household=household,
        checking=checking,
        savings=savings,
        credit=credit,
        paycheck=paycheck,
        coffee=coffee,
        grocery=grocery,
        imported_grocery=imported_grocery,
        xfer=xfer,
        card_pay=card_pay,
        cash_app_imports=cash_app_imports,
        dentist=dentist,
        rent_rule=rent_rule,
        income_rule=income_rule,
        snapshots=snapshots,
    )


@pytest.mark.ledger_regression
@pytest.mark.django_db
def test_starting_balances_use_ledger_sign_conventions(canonical):
    snap = canonical.snapshots["start"]
    assert_money(snap["checking"], CHECKING_START, "Checking starting balance")
    assert_money(snap["savings"], SAVINGS_START, "Savings starting balance")
    assert_money(
        snap["credit"],
        -CREDIT_OWED_START,
        "Credit Card starting signed balance (positive owed stored as negative debt)",
    )


@pytest.mark.ledger_regression
@pytest.mark.django_db
def test_posted_event_balances_match_expected_table(canonical):
    snaps = canonical.snapshots
    assert_money(snaps["paycheck"]["checking"], Decimal("3000.00"), "Checking balance after paycheck")
    assert_money(snaps["coffee"]["checking"], Decimal("2954.33"), "Checking balance after coffee purchase")
    assert_money(snaps["grocery_manual"]["checking"], Decimal("2922.23"), "Checking balance after grocery")
    assert_money(snaps["transfer"]["checking"], Decimal("2722.23"), "Checking balance after transfer")
    assert_money(snaps["transfer"]["savings"], Decimal("700.00"), "Savings balance after transfer")
    assert_money(snaps["card_payment"]["checking"], Decimal("2622.23"), "Checking balance after card payment")
    assert_money(snaps["card_payment"]["credit"], Decimal("-200.00"), "Credit Card signed balance after payment")
    assert_money(snaps["cash_app"]["checking"], POSTED_CHECKING, "Checking balance after Cash App imports")
    assert_money(snaps["cash_app"]["savings"], POSTED_SAVINGS, "Savings posted balance")
    assert_money(snaps["cash_app"]["credit"], POSTED_CREDIT, "Credit Card posted signed balance")
    net = snaps["cash_app"]["checking"] + snaps["cash_app"]["savings"] + snaps["cash_app"]["credit"]
    assert_money(net, POSTED_NET, "Household net position after posted activity")


@pytest.mark.ledger_regression
@pytest.mark.django_db
def test_plaid_import_merges_matching_manual_without_double_count(canonical):
    grocery = canonical.grocery
    grocery.refresh_from_db()
    assert grocery.plaid_transaction_id == "pl-walmart-canonical", (
        "Imported Walmart transaction should merge onto the matching manual grocery row"
    )
    visible = ledger_visible_transactions(
        Transaction.objects.filter(account=canonical.checking, amount=GROCERY)
    )
    assert visible.count() == 1, (
        f"Grocery should appear once after Plaid merge, got {visible.count()} visible rows"
    )
    assert_money(
        canonical.snapshots["grocery_imported"]["checking"],
        canonical.snapshots["grocery_manual"]["checking"],
        "Checking balance after Plaid grocery import (must not double-count)",
    )


@pytest.mark.ledger_regression
@pytest.mark.django_db
def test_three_identical_looking_plaid_imports_all_remain(canonical):
    visible = ledger_visible_transactions(
        Transaction.objects.filter(
            account=canonical.checking,
            date=date(2026, 1, 13),
            amount=CASH_APP,
        )
    )
    assert visible.count() == 3, (
        "Imported bank transactions must NEVER be deleted solely because description, "
        f"date, and amount match another imported transaction; got {visible.count()} visible Cash App rows"
    )
    ids = {txn.plaid_transaction_id for txn in visible}
    assert ids == {"pl-cash-app-0", "pl-cash-app-1", "pl-cash-app-2"}
    for txn in canonical.cash_app_imports:
        assert txn is not None
        txn.refresh_from_db()
        assert txn.import_match_status != Transaction.ImportMatchStatus.DUPLICATE, (
            f"{txn.plaid_transaction_id} was marked duplicate despite a distinct Plaid id"
        )


@pytest.mark.ledger_regression
@pytest.mark.django_db
def test_transfer_moves_assets_once_without_changing_household_total(canonical):
    before = canonical.snapshots["grocery_imported"]
    after = canonical.snapshots["transfer"]
    assets_before = before["checking"] + before["savings"]
    assets_after = after["checking"] + after["savings"]
    assert_money(assets_before, assets_after, "Household cash assets after internal transfer")
    assert_money(after["checking"] - before["checking"], -TRANSFER_AMT, "Checking decrease after transfer")
    assert_money(after["savings"] - before["savings"], TRANSFER_AMT, "Savings increase after transfer")
    out_leg = canonical.xfer.from_transaction
    in_leg = canonical.xfer.to_transaction
    assert_money(out_leg.amount, -TRANSFER_AMT, "Transfer out-leg amount")
    assert_money(in_leg.amount, TRANSFER_AMT, "Transfer in-leg amount")
    transfer_legs = Transaction.objects.filter(transfer_group=out_leg.transfer_group)
    assert transfer_legs.count() == 2, (
        f"Transfer should create exactly two legs, got {transfer_legs.count()}"
    )


@pytest.mark.ledger_regression
@pytest.mark.django_db
def test_credit_card_payment_reduces_checking_and_liability_once(canonical):
    before = canonical.snapshots["transfer"]
    after = canonical.snapshots["card_payment"]
    assert_money(
        after["checking"] - before["checking"],
        -CARD_PAYMENT,
        "Checking decrease after credit-card payment",
    )
    assert_money(
        after["credit"] - before["credit"],
        CARD_PAYMENT,
        "Credit Card signed balance increase (debt down) after payment",
    )
    out_leg = canonical.card_pay.from_transaction
    in_leg = canonical.card_pay.to_transaction
    assert out_leg.account_id == canonical.checking.id
    assert in_leg.account_id == canonical.credit.id
    assert in_leg.transaction_type == Transaction.TransactionType.CREDIT_CARD_PAYMENT
    legs = Transaction.objects.filter(transfer_group=out_leg.transfer_group)
    assert legs.count() == 2, f"Card payment should have exactly two legs, got {legs.count()}"


@pytest.mark.ledger_regression
@pytest.mark.django_db
def test_reconciled_row_keeps_amount_and_is_not_deleted(canonical):
    """Companion: reconciling a row is metadata, not a delete or amount rewrite."""
    coffee = Transaction.objects.get(pk=canonical.coffee.pk)
    coffee.reconciled = True
    coffee.reconciled_at = timezone.now()
    coffee.save(update_fields=["reconciled", "reconciled_at", "updated_at"])
    coffee.refresh_from_db()
    assert coffee.reconciled is True
    assert_money(
        coffee.amount,
        COFFEE,
        "Reconciliation metadata must not alter the coffee purchase amount",
    )
    assert Transaction.objects.filter(pk=coffee.pk).exists(), (
        "Hiding a reconciled row in UI must not delete it from financial history"
    )
    assert_money(
        app_current_balance(canonical.checking, TODAY),
        POSTED_CHECKING,
        "Ledger still includes the reconciled coffee purchase in posted checking balance",
    )
    assert_money(
        signed_ledger_balance(canonical.checking, TODAY),
        POSTED_CHECKING,
        "Signed ledger still includes the reconciled coffee purchase",
    )


@pytest.mark.ledger_regression
@pytest.mark.django_db
def test_manual_future_transaction_stays_in_forecast_and_not_in_current_balance(canonical):
    current = signed_ledger_balance(canonical.checking, TODAY)
    assert_money(
        current,
        POSTED_CHECKING,
        "Current Checking balance must exclude the future dentist until its date",
    )
    end = TODAY + timedelta(days=90)
    rows = build_forecast_projection_timeline(
        canonical.user,
        today=TODAY,
        end_date=end,
        caller="canonical_future_dentist",
        account_id=canonical.checking.id,
    )
    dentist_rows = _rows_named(rows, "Dentist", canonical.checking.id)
    assert len(dentist_rows) == 1, (
        f"Future manual dentist must appear once in the 90-day forecast, got {len(dentist_rows)}"
    )
    assert _row_date(dentist_rows[0]) == date(2026, 1, 28)
    assert dentist_rows[0].get("transaction_id") == canonical.dentist.id, (
        f"Future dentist must remain the original manual row "
        f"(transaction_id expected {canonical.dentist.id}, got {dentist_rows[0].get('transaction_id')})"
    )
    assert Transaction.objects.filter(pk=canonical.dentist.pk).exists(), (
        "Future manual transaction must not be removed merely because no import exists yet"
    )


@pytest.mark.ledger_regression
@pytest.mark.django_db
def test_recurring_occurrences_count_once_and_do_not_persist_on_projection(canonical):
    before = Transaction.objects.count()
    end = TODAY + timedelta(days=90)
    rows = build_forecast_projection_timeline(
        canonical.user,
        today=TODAY,
        end_date=end,
        caller="canonical_recurring_90",
        account_id=canonical.checking.id,
    )
    after = Transaction.objects.count()
    assert after == before, (
        f"Projection-only forecast must not persist Transaction rows; before={before} after={after}"
    )
    rent_rows = _rows_named(rows, "Rent", canonical.checking.id)
    income_rows = _rows_named(rows, "Monthly paycheck", canonical.checking.id)
    rent_dates = sorted(_row_date(r) for r in rent_rows)
    income_dates = sorted(_row_date(r) for r in income_rows)
    assert rent_dates == [date(2026, 2, 1), date(2026, 3, 1), date(2026, 4, 1)], (
        f"Rent occurrence dates in the 90-day window expected Feb/Mar/Apr 1, got {rent_dates}"
    )
    assert income_dates == [date(2026, 1, 25), date(2026, 2, 25), date(2026, 3, 25)], (
        f"Paycheck occurrence dates in the 90-day window expected Jan/Feb/Mar 25, got {income_dates}"
    )
    assert len(rent_rows) == 3, f"Each rent occurrence must appear once, got {len(rent_rows)}"
    assert len(income_rows) == 3, f"Each paycheck occurrence must appear once, got {len(income_rows)}"


@pytest.mark.ledger_regression
@pytest.mark.django_db
def test_ninety_day_forecast_honors_window_and_projected_checking_balance(canonical):
    end = TODAY + timedelta(days=90)
    before = Transaction.objects.count()
    rows = build_forecast_projection_timeline(
        canonical.user,
        today=TODAY,
        end_date=end,
        caller="canonical_forecast_90",
        household_id=canonical.household.id,
    )
    dashboard = _build_dashboard_summary(canonical.user, days=90, as_of_date=TODAY)
    after = Transaction.objects.count()
    assert after == before, (
        f"Dashboard projection-only path created Transaction rows; before={before} after={after}"
    )
    assert dashboard["safe_to_spend"]["window_days"] == 90, (
        f"90-day dashboard window expected 90, got {dashboard['safe_to_spend']['window_days']}"
    )
    latest = _max_row_date(rows, canonical.checking.id)
    assert latest is not None and latest <= end, (
        f"90-day forecast truncated or overran: latest checking row {latest} vs window end {end}"
    )
    assert_money(
        _projected_end(rows, canonical.checking.id),
        CHECKING_90D,
        "Checking projected balance after 90-day forecast",
    )
    xfer_gid = canonical.xfer.from_transaction.transfer_group_id
    card_gid = canonical.card_pay.from_transaction.transfer_group_id
    future_xfer = [
        r
        for r in rows
        if r.get("transfer_group_id") == xfer_gid and _row_date(r) > TODAY
    ]
    future_card = [
        r
        for r in rows
        if r.get("transfer_group_id") == card_gid and _row_date(r) > TODAY
    ]
    assert future_xfer == [], (
        f"Posted transfer must not add extra synthetic forecast legs after {TODAY}; got {future_xfer}"
    )
    assert future_card == [], (
        f"Posted credit-card payment must not add extra synthetic forecast legs after {TODAY}; got {future_card}"
    )
    metrics = forecast_account_balance_metrics(
        [r for r in rows if _row_account_id(r) == canonical.checking.id],
        account_id=canonical.checking.id,
        today=TODAY,
        end_date=end,
        minimum_buffer=Decimal("0"),
    )
    dentist = next(r for r in rows if "Dentist" in (r.get("description") or ""))
    dentist_bal = D(dentist["balance_after"])
    assert metrics["lowest"] <= dentist_bal, (
        "90-day lowest projected checking balance should consider the dentist outflow"
    )


@pytest.mark.ledger_regression
@pytest.mark.django_db
def test_free_user_cannot_request_365_day_window_premium_can(canonical):
    free_req = SimpleNamespace(query_params={"forecast_days": "90"}, user=canonical.user)
    assert parse_forecast_days_param(free_req) == 90
    with pytest.raises(EntitlementDenied) as exc_info:
        parse_forecast_days_param(
            SimpleNamespace(query_params={"forecast_days": "365"}, user=canonical.user)
        )
    assert exc_info.value.limit == 90
    with pytest.raises(ValueError, match="Invalid Forecast Window"):
        parse_forecast_days_param(
            SimpleNamespace(query_params={"forecast_days": "184"}, user=canonical.user)
        )

    grant_premium(canonical.user)
    premium_req = SimpleNamespace(query_params={"forecast_days": "365"}, user=canonical.user)
    assert parse_forecast_days_param(premium_req) == 365

    client = APIClient()
    client.force_authenticate(user=canonical.user)
    r = client.get("/api/insights/dashboard/summary-fast/?forecast_days=365")
    assert r.status_code == 200, r.content


@pytest.mark.ledger_regression
@pytest.mark.django_db
def test_premium_365_day_forecast_is_not_truncated_and_does_not_persist_rows(canonical):
    grant_premium(canonical.user)
    end = TODAY + timedelta(days=365)
    before = Transaction.objects.count()
    rows = build_forecast_projection_timeline(
        canonical.user,
        today=TODAY,
        end_date=end,
        caller="canonical_forecast_365",
        household_id=canonical.household.id,
    )
    dashboard = _build_dashboard_summary(canonical.user, days=365, as_of_date=TODAY)
    after = Transaction.objects.count()
    assert after == before, (
        f"365-day projection-only dashboard created Transaction rows; before={before} after={after}"
    )
    assert dashboard["safe_to_spend"]["window_days"] == 365, (
        f"365-day dashboard window expected 365, got {dashboard['safe_to_spend']['window_days']}"
    )
    rent_rows = _rows_named(rows, "Rent", canonical.checking.id)
    income_rows = _rows_named(rows, "Monthly paycheck", canonical.checking.id)
    assert len(rent_rows) == 12, (
        f"365-day rent occurrences expected 12 (Feb 2026–Jan 2027), got {len(rent_rows)}"
    )
    assert len(income_rows) == 12, (
        f"365-day paycheck occurrences expected 12 (Jan–Dec 2026), got {len(income_rows)}"
    )
    latest = _max_row_date(rows, canonical.checking.id)
    assert latest is not None and latest <= end, (
        f"365-day forecast overran window: latest {latest} vs end {end}"
    )
    jan_rent = [r for r in rent_rows if _row_date(r) == date(2027, 1, 1)]
    assert jan_rent, "365-day window should include 2027-01-01 rent (not truncate prematurely)"
    assert_money(
        _projected_end(rows, canonical.checking.id),
        CHECKING_365D,
        "Checking projected balance after 365-day forecast",
    )
