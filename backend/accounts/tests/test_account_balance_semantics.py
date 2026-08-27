"""Account balance semantics: Current vs pending, matched twins, safe-to-spend."""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.core.cache import cache
from django.utils import timezone

from accounts.models import Account
from transactions.models import Reconciliation, Transaction, TransactionMatch
from transactions.services.reconciliation import (
    app_current_balance,
    ledger_today_balance_before_pending,
)


@pytest.fixture
def auth_client(api_client, user):
    api_client.force_authenticate(user=user)
    return api_client


@pytest.fixture
def checking(household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        name="Main",
        starting_balance=Decimal("1000.00"),
        minimum_buffer=Decimal("100"),
        currency="USD",
        include_in_forecast=True,
    )


@pytest.mark.django_db
def test_list_balance_includes_unresolved_same_day_pending(auth_client, checking):
    today = date.today()
    Transaction.objects.create(
        account=checking,
        date=today,
        payee="Pending bill",
        amount=Decimal("-50.00"),
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.ONE_TIME,
    )
    r = auth_client.get(f"/api/accounts/{checking.id}/?balance=true")
    assert r.status_code == 200
    # Ledger end-of-day (app_current_balance) includes unresolved pending.
    assert Decimal(r.json()["available_balance"]) == Decimal("950.00")
    assert app_current_balance(checking, today) == Decimal("950.00")


@pytest.mark.django_db
def test_forecast_current_balance_excludes_pending_when_reconciled(
    auth_client, checking, user
):
    """Forecast summary current_balance is before pending; list balance may differ."""
    today = date.today()
    Reconciliation.objects.create(
        user=user,
        account=checking,
        bank_current_balance=Decimal("1000.00"),
        app_current_balance=Decimal("1000.00"),
        last_reconciled_balance=Decimal("1000.00"),
        final_reconciled_balance=Decimal("1000.00"),
        difference=Decimal("0"),
        period_start_date=today - timedelta(days=30),
        period_end_date=today - timedelta(days=1),
        status=Reconciliation.Status.COMPLETED,
        is_active=True,
        completed_at=timezone.now(),
    )
    Transaction.objects.create(
        account=checking,
        date=today,
        payee="Pending bill",
        amount=Decimal("-75.00"),
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.ONE_TIME,
    )
    cache.clear()
    before = ledger_today_balance_before_pending(checking, today)
    assert before == Decimal("1000.00")

    r = auth_client.get(
        f"/api/accounts/{checking.id}/?balance=true&forecast_summary=true&days=30"
    )
    assert r.status_code == 200
    data = r.json()
    assert Decimal(data["available_balance"]) == Decimal("925.00")
    summary = data.get("forecast_summary") or {}
    assert Decimal(summary["current_balance"]) == Decimal("1000.00")
    assert Decimal(data["available_to_spend"]) == Decimal(summary["available_to_spend"])


@pytest.mark.django_db
def test_matched_pending_twin_is_not_double_counted_in_balance(auth_client, checking):
    today = date.today()
    planned = Transaction.objects.create(
        account=checking,
        date=today,
        payee="Rent",
        amount=Decimal("-500.00"),
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.ONE_TIME,
    )
    imported = Transaction.objects.create(
        account=checking,
        date=today,
        payee="Rent",
        amount=Decimal("-500.00"),
        status=Transaction.Status.CLEARED,
        source=Transaction.Source.PLAID,
        plaid_transaction_id="plaid-rent-1",
    )
    TransactionMatch.objects.create(
        planned_transaction=planned,
        imported_transaction=imported,
    )
    r = auth_client.get(f"/api/accounts/{checking.id}/?balance=true")
    assert r.status_code == 200
    # Only the imported twin affects the ledger (planned is hidden).
    assert Decimal(r.json()["available_balance"]) == Decimal("500.00")
    assert app_current_balance(checking, today) == Decimal("500.00")
