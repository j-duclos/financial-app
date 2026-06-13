from datetime import date
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from accounts.models import Account
from core.models import Household, HouseholdMembership
from transactions.models import Reconciliation, ReconciliationEntry, Transaction
from transactions.services.reconciliation import (
    BALANCE_TOLERANCE,
    app_current_balance,
    balances_within_tolerance,
    calculated_balance_for_checked,
    calculating_balance,
    complete_reconciliation,
    difference_remaining,
    filter_superseded_planned_transactions,
    get_setup_data,
    last_completed_reconciliation,
    last_reconcile_period_end,
    last_reconciled_balance,
    min_reconcile_start_date,
    sum_checked_amounts,
    undo_reconciliation,
    validate_no_overlapping_active_session,
)
from transactions.services.posting import post_transaction

User = get_user_model()


@pytest.fixture
def user(db):
    return User.objects.create_user(username="reconcile_user", password="pass1234")


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="Reconcile HH")
    HouseholdMembership.objects.create(household=h, user=user, role=HouseholdMembership.Role.OWNER)
    return h


@pytest.fixture
def account(db, household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Checking",
        currency="USD",
        starting_balance=Decimal("1000.00"),
    )


@pytest.fixture
def auth_client(api_client, user):
    api_client.force_authenticate(user=user)
    return api_client


@pytest.fixture
def api_client():
    return APIClient()


class TestReconciliationCalculations:
    def test_last_reconciled_balance_defaults_to_starting_balance(self, account):
        assert last_reconciled_balance(account) == Decimal("1000.00")

    def test_app_current_balance_includes_posted_transactions(self, account, user):
        post_transaction(
            user=user,
            account_id=account.pk,
            date=date.today(),
            payee="Coffee",
            amount=Decimal("-5.00"),
        )
        assert app_current_balance(account) == Decimal("995.00")

    def test_calculating_balance_and_tolerance(self, account, user):
        t1 = post_transaction(
            user=user,
            account_id=account.pk,
            date=date.today(),
            payee="Deposit",
            amount=Decimal("50.00"),
        )
        t2 = post_transaction(
            user=user,
            account_id=account.pk,
            date=date.today(),
            payee="Gas",
            amount=Decimal("-20.00"),
        )
        last = last_reconciled_balance(account)
        checked = Transaction.objects.filter(pk__in=[t1.pk, t2.pk])
        assert sum_checked_amounts(checked) == Decimal("30.00")
        calc = calculating_balance(last, checked)
        assert calc == Decimal("1030.00")
        bank = Decimal("1030.00")
        diff = difference_remaining(bank, calc)
        assert balances_within_tolerance(diff, BALANCE_TOLERANCE)

    def test_complete_reconciliation_marks_transactions(self, account, user):
        t1 = post_transaction(
            user=user,
            account_id=account.pk,
            date=date.today(),
            payee="Paycheck",
            amount=Decimal("500.00"),
        )
        last = last_reconciled_balance(account)
        bank = last + t1.amount
        rec = complete_reconciliation(
            account=account,
            user=user,
            bank_current_balance=bank,
            checked_transaction_ids=[t1.pk],
            period_start=date.today(),
            period_end=date.today(),
        )
        t1.refresh_from_db()
        assert rec.status == Reconciliation.Status.COMPLETED
        assert rec.final_reconciled_balance == bank
        assert rec.difference == Decimal("0")
        assert rec.transaction_count == 1
        assert rec.is_active is True
        assert t1.reconciled is True
        assert t1.reconciliation_id == rec.pk
        assert t1.reconciled_at is not None
        assert ReconciliationEntry.objects.filter(session=rec, transaction=t1).exists()

    def test_transaction_running_balances_are_cumulative_per_row(self, account, user):
        post_transaction(
            user=user,
            account_id=account.pk,
            date=date(2026, 1, 29),
            payee="A",
            amount=Decimal("100.00"),
        )
        t2 = post_transaction(
            user=user,
            account_id=account.pk,
            date=date(2026, 1, 29),
            payee="B",
            amount=Decimal("50.00"),
        )
        from transactions.services.reconciliation import transaction_running_balances

        txns = list(
            __import__("transactions.services.reconciliation", fromlist=["unreconciled_transactions_qs"])
            .unreconciled_transactions_qs(account)
        )
        balances = transaction_running_balances(account, txns)
        assert balances[txns[0].pk] == Decimal("1100.00")
        assert balances[t2.pk] == Decimal("1150.00")

    def test_running_balances_follow_last_bank_reconcile_not_raw_ledger(self, account, user):
        """After a prior reconcile, running balances must start from the saved bank balance."""
        from transactions.services.reconciliation import transaction_running_balances

        post_transaction(
            user=user,
            account_id=account.pk,
            date=date(2026, 5, 10),
            payee="Old",
            amount=Decimal("-5000.00"),
        )
        adj = post_transaction(
            user=user,
            account_id=account.pk,
            date=date(2026, 5, 13),
            payee="Adjust",
            amount=Decimal("236.52"),
        )
        complete_reconciliation(
            account=account,
            user=user,
            bank_current_balance=Decimal("1236.52"),
            checked_transaction_ids=[adj.pk],
            period_start=date(2026, 5, 10),
            period_end=date(2026, 5, 13),
        )
        payroll = post_transaction(
            user=user,
            account_id=account.pk,
            date=date(2026, 5, 14),
            payee="Payroll",
            amount=Decimal("1835.52"),
        )
        txns = list(
            __import__("transactions.services.reconciliation", fromlist=["unreconciled_transactions_qs"])
            .unreconciled_transactions_qs(account, start=date(2026, 5, 14), end=date(2026, 5, 14))
        )
        balances = transaction_running_balances(account, txns)
        assert balances[payroll.pk] == Decimal("3072.04")

    def test_calculated_balance_for_checked_uses_running_balance(self, account, user):
        """After a prior reconcile, opening + raw sum can disagree with running balances."""
        from transactions.services.reconciliation import (
            calculated_balance_for_checked,
            transaction_running_balances,
            unreconciled_transactions_qs,
        )

        post_transaction(
            user=user,
            account_id=account.pk,
            date=date(2026, 5, 10),
            payee="Old",
            amount=Decimal("-5000.00"),
        )
        adj = post_transaction(
            user=user,
            account_id=account.pk,
            date=date(2026, 5, 13),
            payee="Adjust",
            amount=Decimal("236.52"),
        )
        complete_reconciliation(
            account=account,
            user=user,
            bank_current_balance=Decimal("1236.52"),
            checked_transaction_ids=[adj.pk],
            period_start=date(2026, 5, 10),
            period_end=date(2026, 5, 13),
        )
        payroll = post_transaction(
            user=user,
            account_id=account.pk,
            date=date(2026, 5, 14),
            payee="Payroll",
            amount=Decimal("1835.52"),
        )
        fee = post_transaction(
            user=user,
            account_id=account.pk,
            date=date(2026, 5, 14),
            payee="Fee",
            amount=Decimal("-21.21"),
        )
        txns = list(
            unreconciled_transactions_qs(
                account, start=date(2026, 5, 14), end=date(2026, 5, 14)
            )
        )
        opening = Decimal("1236.52")
        checked = Transaction.objects.filter(pk__in=[payroll.pk, fee.pk])
        raw_sum = calculating_balance(opening, checked)
        assert raw_sum == Decimal("3050.83")
        assert calculated_balance_for_checked(account, opening, checked) == Decimal("3050.83")
        running = transaction_running_balances(account, txns)
        assert running[fee.pk] == Decimal("3050.83")

    def test_complete_reconciliation_after_prior_session_uses_running_balance(self, account, user):
        post_transaction(
            user=user,
            account_id=account.pk,
            date=date(2026, 5, 10),
            payee="Old",
            amount=Decimal("-5000.00"),
        )
        adj = post_transaction(
            user=user,
            account_id=account.pk,
            date=date(2026, 5, 13),
            payee="Adjust",
            amount=Decimal("236.52"),
        )
        complete_reconciliation(
            account=account,
            user=user,
            bank_current_balance=Decimal("1236.52"),
            checked_transaction_ids=[adj.pk],
            period_start=date(2026, 5, 10),
            period_end=date(2026, 5, 13),
        )
        payroll = post_transaction(
            user=user,
            account_id=account.pk,
            date=date(2026, 5, 14),
            payee="Payroll",
            amount=Decimal("1835.52"),
        )
        fee = post_transaction(
            user=user,
            account_id=account.pk,
            date=date(2026, 5, 14),
            payee="Fee",
            amount=Decimal("-21.21"),
        )
        bank = Decimal("3050.83")
        rec = complete_reconciliation(
            account=account,
            user=user,
            bank_current_balance=bank,
            checked_transaction_ids=[payroll.pk, fee.pk],
            period_start=date(2026, 5, 14),
            period_end=date(2026, 5, 14),
        )
        assert rec.final_reconciled_balance == bank

    def test_complete_reconciliation_with_unchecked_siblings_in_period(self, account, user):
        """Partial selection: unchecked rows in the period must not block completion."""
        checked_a = post_transaction(
            user=user,
            account_id=account.pk,
            date=date(2026, 6, 1),
            payee="Deposit",
            amount=Decimal("100.00"),
        )
        post_transaction(
            user=user,
            account_id=account.pk,
            date=date(2026, 6, 1),
            payee="Pending fee",
            amount=Decimal("-50.00"),
        )
        checked_c = post_transaction(
            user=user,
            account_id=account.pk,
            date=date(2026, 6, 1),
            payee="Refund",
            amount=Decimal("25.00"),
        )
        opening = last_reconciled_balance(account)
        bank = opening + Decimal("125.00")
        rec = complete_reconciliation(
            account=account,
            user=user,
            bank_current_balance=bank,
            checked_transaction_ids=[checked_a.pk, checked_c.pk],
            period_start=date(2026, 6, 1),
            period_end=date(2026, 6, 1),
        )
        assert rec.final_reconciled_balance == bank
        pending = Transaction.objects.get(payee="Pending fee")
        assert pending.reconciled is False

    def test_complete_reconciliation_rejects_imbalance(self, account, user):
        t1 = post_transaction(
            user=user,
            account_id=account.pk,
            date=date.today(),
            payee="Snack",
            amount=Decimal("-3.00"),
        )
        with pytest.raises(ValueError, match="does not balance"):
            complete_reconciliation(
                account=account,
                user=user,
                bank_current_balance=Decimal("999.00"),
                checked_transaction_ids=[t1.pk],
                period_start=date.today(),
                period_end=date.today(),
            )


def test_reconcile_setup_all_reconciled_through_today(auth_client, account, user):
    today = date.today()
    txn = post_transaction(
        user=user,
        account_id=account.pk,
        date=today,
        payee="Coffee",
        amount=Decimal("-4.50"),
    )
    complete_reconciliation(
        account=account,
        user=user,
        bank_current_balance=Decimal("995.50"),
        checked_transaction_ids=[txn.pk],
        period_start=today,
        period_end=today,
    )
    r = auth_client.get("/api/reconcile/setup/", {"account_id": account.pk})
    assert r.status_code == 200, r.data
    data = r.json()
    assert data["all_reconciled_through_today"] is True
    assert data["unreconciled_transactions"] == []
    assert data["last_reconcile_period_end"] == today.isoformat()


def test_reconcile_setup_after_same_day_imports_post_reconcile(auth_client, account, user):
    """New unreconciled rows on the last reconciled day must not 400 the setup endpoint."""
    today = date.today()
    txn = post_transaction(
        user=user,
        account_id=account.pk,
        date=today,
        payee="Coffee",
        amount=Decimal("-4.50"),
    )
    complete_reconciliation(
        account=account,
        user=user,
        bank_current_balance=Decimal("995.50"),
        checked_transaction_ids=[txn.pk],
        period_start=today,
        period_end=today,
    )
    post_transaction(
        user=user,
        account_id=account.pk,
        date=today,
        payee="Snack",
        amount=Decimal("-2.00"),
    )
    r = auth_client.get("/api/reconcile/setup/", {"account_id": account.pk})
    assert r.status_code == 200, r.data
    data = r.json()
    assert data["all_reconciled_through_today"] is False
    assert data["min_start_date"] == today.isoformat()
    assert data["period_start_date"] == today.isoformat()
    assert len(data["unreconciled_transactions"]) >= 1


def test_reconcile_setup_api_returns_date_range_fields(auth_client, account):
    r = auth_client.get("/api/reconcile/setup/", {"account_id": account.pk})
    assert r.status_code == 200, r.data
    data = r.json()
    assert data["last_reconciled_balance"] == "1000.00"
    assert data["period_opening_balance"] == "1000.00"
    assert data["app_current_balance"] == "1000.00"
    assert "min_start_date" in data
    assert "period_start_date" in data
    assert "period_end_date" in data
    assert data["unreconciled_transactions"] == []


def test_unreconciled_excludes_dates_on_or_before_last_period_end(account, user):
    """Rows on/before a completed period end never reappear, even if reconciled=False."""
    jan = post_transaction(
        user=user,
        account_id=account.pk,
        date=date(2026, 1, 15),
        payee="Old",
        amount=Decimal("5.00"),
    )
    feb = post_transaction(
        user=user,
        account_id=account.pk,
        date=date(2026, 2, 10),
        payee="Mid",
        amount=Decimal("10.00"),
    )
    mar = post_transaction(
        user=user,
        account_id=account.pk,
        date=date(2026, 3, 5),
        payee="New",
        amount=Decimal("3.00"),
    )
    complete_reconciliation(
        account=account,
        user=user,
        bank_current_balance=Decimal("1015.00"),
        checked_transaction_ids=[feb.pk],
        period_start=date(2026, 2, 1),
        period_end=date(2026, 2, 27),
    )
    jan.refresh_from_db()
    assert jan.reconciled is False
    from transactions.services.reconciliation import get_setup_data

    data = get_setup_data(
        account,
        start=date(2026, 1, 1),
        end=date(2026, 3, 5),
    )
    ids = [t.pk for t in data["unreconciled_transactions"]]
    assert jan.pk not in ids
    assert feb.pk not in ids
    assert mar.pk in ids
    assert data["min_start_date"] == date(2026, 2, 28)
    assert data["period_start_date"] == date(2026, 2, 28)


def test_reconcile_date_range_limits_start_after_prior_period(auth_client, account, user):
    t1 = post_transaction(
        user=user,
        account_id=account.pk,
        date=date(2026, 1, 10),
        payee="A",
        amount=Decimal("10.00"),
    )
    t2 = post_transaction(
        user=user,
        account_id=account.pk,
        date=date(2026, 1, 20),
        payee="B",
        amount=Decimal("5.00"),
    )
    complete_reconciliation(
        account=account,
        user=user,
        bank_current_balance=Decimal("1010.00"),
        checked_transaction_ids=[t1.pk],
        period_start=date(2026, 1, 10),
        period_end=date(2026, 1, 10),
    )
    r = auth_client.get(
        "/api/reconcile/setup/",
        {"account_id": account.pk, "start": "2026-01-10", "end": "2026-01-31"},
    )
    assert r.status_code == 200, r.data
    body = r.json()
    assert body["min_start_date"] == "2026-01-11"
    assert body["period_start_date"] == "2026-01-11"
    assert len(body["unreconciled_transactions"]) == 1
    assert body["unreconciled_transactions"][0]["id"] == t2.pk


def test_reconcile_complete_api(auth_client, account, user):
    t1 = post_transaction(
        user=user,
        account_id=account.pk,
        date=date.today(),
        payee="Interest",
        amount=Decimal("10.00"),
    )
    bank = "1010.00"
    r = auth_client.post(
        "/api/reconcile/complete/",
        {
            "account_id": account.pk,
            "bank_current_balance": bank,
            "checked_transaction_ids": [t1.pk],
            "period_start_date": date.today().isoformat(),
            "period_end_date": date.today().isoformat(),
        },
        format="json",
    )
    assert r.status_code == 201, r.data
    body = r.json()
    assert body["final_reconciled_balance"] == bank
    t1.refresh_from_db()
    assert t1.reconciled is True


def test_reconcile_complete_api_rejects_bad_balance(auth_client, account, user):
    t1 = post_transaction(
        user=user,
        account_id=account.pk,
        date=date.today(),
        payee="Fee",
        amount=Decimal("-2.00"),
    )
    r = auth_client.post(
        "/api/reconcile/complete/",
        {
            "account_id": account.pk,
            "bank_current_balance": "500.00",
            "checked_transaction_ids": [t1.pk],
            "period_start_date": date.today().isoformat(),
            "period_end_date": date.today().isoformat(),
        },
        format="json",
    )
    assert r.status_code == 400


def test_overlapping_active_sessions_rejected(account, user):
    t1 = post_transaction(
        user=user,
        account_id=account.pk,
        date=date(2026, 5, 10),
        payee="A",
        amount=Decimal("10.00"),
    )
    complete_reconciliation(
        account=account,
        user=user,
        bank_current_balance=Decimal("1010.00"),
        checked_transaction_ids=[t1.pk],
        period_start=date(2026, 5, 10),
        period_end=date(2026, 5, 13),
    )
    with pytest.raises(ValueError, match="overlapping"):
        validate_no_overlapping_active_session(
            account,
            date(2026, 5, 12),
            date(2026, 5, 20),
        )


def test_latest_session_and_next_period_start(account, user):
    t1 = post_transaction(
        user=user,
        account_id=account.pk,
        date=date(2026, 5, 10),
        payee="Seed",
        amount=Decimal("1.00"),
    )
    complete_reconciliation(
        account=account,
        user=user,
        bank_current_balance=Decimal("1001.00"),
        checked_transaction_ids=[t1.pk],
        period_start=date(2026, 5, 10),
        period_end=date(2026, 5, 13),
    )
    latest = last_completed_reconciliation(account)
    assert latest is not None
    assert latest.period_end_date == date(2026, 5, 13)
    assert last_reconcile_period_end(account) == date(2026, 5, 13)
    assert min_reconcile_start_date(account) == date(2026, 5, 14)


def test_undo_latest_session_clears_transaction_flags(account, user):
    t1 = post_transaction(
        user=user,
        account_id=account.pk,
        date=date(2026, 5, 10),
        payee="Deposit",
        amount=Decimal("25.00"),
    )
    rec = complete_reconciliation(
        account=account,
        user=user,
        bank_current_balance=Decimal("1025.00"),
        checked_transaction_ids=[t1.pk],
        period_start=date(2026, 5, 10),
        period_end=date(2026, 5, 13),
    )
    result = undo_reconciliation(session=rec, user=user)
    t1.refresh_from_db()
    rec.refresh_from_db()
    assert result["success"] is True
    assert result["transactions_unreconciled_count"] == 1
    assert t1.reconciled is False
    assert t1.reconciled_at is None
    assert t1.reconciliation_id is None
    assert rec.is_active is False
    assert rec.undone_at is not None
    assert ReconciliationEntry.objects.filter(session=rec).exists()
    assert Transaction.objects.filter(pk=t1.pk).exists()


def test_cannot_undo_non_latest_session(account, user):
    t1 = post_transaction(
        user=user,
        account_id=account.pk,
        date=date(2026, 5, 10),
        payee="First",
        amount=Decimal("1.00"),
    )
    complete_reconciliation(
        account=account,
        user=user,
        bank_current_balance=Decimal("1001.00"),
        checked_transaction_ids=[t1.pk],
        period_start=date(2026, 5, 10),
        period_end=date(2026, 5, 13),
    )
    t2 = post_transaction(
        user=user,
        account_id=account.pk,
        date=date(2026, 5, 20),
        payee="Later",
        amount=Decimal("10.00"),
    )
    rec2 = complete_reconciliation(
        account=account,
        user=user,
        bank_current_balance=Decimal("1011.00"),
        checked_transaction_ids=[t2.pk],
        period_start=date(2026, 5, 14),
        period_end=date(2026, 5, 26),
    )
    older = Reconciliation.objects.filter(account=account).order_by("completed_at").first()
    with pytest.raises(ValueError, match="latest"):
        undo_reconciliation(session=older, user=user)
    assert rec2.is_active is True


def test_reconcile_sessions_list_api(auth_client, account, user):
    t1 = post_transaction(
        user=user,
        account_id=account.pk,
        date=date(2026, 5, 10),
        payee="List",
        amount=Decimal("1.00"),
    )
    complete_reconciliation(
        account=account,
        user=user,
        bank_current_balance=Decimal("1001.00"),
        checked_transaction_ids=[t1.pk],
        period_start=date(2026, 5, 10),
        period_end=date(2026, 5, 13),
    )
    r = auth_client.get("/api/reconcile/sessions/", {"account_id": account.pk})
    assert r.status_code == 200, r.data
    body = r.json()
    assert len(body["results"]) == 1
    assert body["results"][0]["can_undo"] is True
    assert body["results"][0]["bank_balance"] == "1001.00"


def test_reconcile_session_detail_api(auth_client, account, user):
    t1 = post_transaction(
        user=user,
        account_id=account.pk,
        date=date(2026, 5, 10),
        payee="Coffee",
        amount=Decimal("-4.00"),
    )
    rec = complete_reconciliation(
        account=account,
        user=user,
        bank_current_balance=Decimal("996.00"),
        checked_transaction_ids=[t1.pk],
        period_start=date(2026, 5, 10),
        period_end=date(2026, 5, 13),
    )
    r = auth_client.get(f"/api/reconcile/sessions/{rec.pk}/")
    assert r.status_code == 200, r.data
    body = r.json()
    assert body["transaction_count"] == 1
    assert len(body["transactions"]) == 1
    assert body["transactions"][0]["payee"] == "Coffee"


def test_reconcile_session_undo_api(auth_client, account, user):
    t1 = post_transaction(
        user=user,
        account_id=account.pk,
        date=date.today(),
        payee="Refund",
        amount=Decimal("12.00"),
    )
    rec = complete_reconciliation(
        account=account,
        user=user,
        bank_current_balance=Decimal("1012.00"),
        checked_transaction_ids=[t1.pk],
        period_start=date.today(),
        period_end=date.today(),
    )
    r = auth_client.post(f"/api/reconcile/sessions/{rec.pk}/undo/", {}, format="json")
    assert r.status_code == 200, r.data
    body = r.json()
    assert body["success"] is True
    assert body["transactions_unreconciled_count"] == 1
    t1.refresh_from_db()
    assert t1.reconciled is False


def test_reconcile_setup_hides_superseded_planned_when_bank_row_exists(account, user):
    """Recurring forecast + same-day Plaid deposit should not both appear in reconcile."""
    d = date(2026, 6, 3)
    amt = Decimal("1800.00")
    planned = Transaction.objects.create(
        account=account,
        date=d,
        payee="Gen's Rent",
        amount=amt,
        source=Transaction.Source.RULE,
        status=Transaction.Status.PLANNED,
    )
    bank = Transaction.objects.create(
        account=account,
        date=d,
        payee="Zelle payment from GENEVIEVE DUCLOS WFCT128CLCFF",
        amount=amt,
        source=Transaction.Source.PLAID,
        plaid_transaction_id="pl-gens-rent-jun3",
        imported_description="Zelle payment from GENEVIEVE DUCLOS WFCT128CLCFF",
        import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        cleared=True,
        status=Transaction.Status.CLEARED,
    )
    data = get_setup_data(account, start=d, end=d)
    ids = [t.pk for t in data["unreconciled_transactions"]]
    assert planned.pk not in ids
    assert bank.pk in ids


def test_reconcile_running_balance_excludes_superseded_planned_duplicate(account, user):
    """Gen's Rent forecast must not inflate running balances when the Zelle deposit cleared same day."""
    from transactions.services.reconciliation import transaction_running_balances

    d = date(2026, 6, 3)
    amt = Decimal("1800.00")
    opening = Decimal("1499.82")
    account.starting_balance = opening
    account.save(update_fields=["starting_balance", "updated_at"])
    planned = Transaction.objects.create(
        account=account,
        date=d,
        payee="Gen's Rent",
        amount=amt,
        source=Transaction.Source.RULE,
        status=Transaction.Status.PLANNED,
    )
    bank = Transaction.objects.create(
        account=account,
        date=d,
        payee="Zelle payment from GENEVIEVE DUCLOS WFCT128CLCFF",
        amount=amt,
        source=Transaction.Source.ACTUAL,
        cleared=True,
        status=Transaction.Status.CLEARED,
    )
    data = get_setup_data(account, start=d, end=d)
    assert planned.pk not in {t.pk for t in data["unreconciled_transactions"]}
    assert bank.pk in data["running_balances"]
    assert data["running_balances"][bank.pk] == opening + amt
    rb = transaction_running_balances(account, data["unreconciled_transactions"], d)
    assert rb[bank.pk] == opening + amt


def test_filter_superseded_planned_transactions(account):
    d = date(2026, 6, 3)
    amt = Decimal("1800.00")
    planned = Transaction.objects.create(
        account=account,
        date=d,
        payee="Gen's Rent",
        amount=amt,
        source=Transaction.Source.RULE,
        status=Transaction.Status.PLANNED,
    )
    bank = Transaction.objects.create(
        account=account,
        date=d,
        payee="Zelle payment from GENEVIEVE DUCLOS",
        amount=amt,
        source=Transaction.Source.PLAID,
        plaid_transaction_id="pl-dup-test",
        import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        cleared=True,
        status=Transaction.Status.CLEARED,
    )
    filtered = filter_superseded_planned_transactions([planned, bank])
    assert [t.pk for t in filtered] == [bank.pk]
