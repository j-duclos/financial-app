"""Future transaction edits must shift every later projected balance."""
from datetime import date
from decimal import Decimal

import pytest
from django.core.cache import cache
from rest_framework.test import APIClient

from accounts.models import Account
from accounts.services.available_to_spend import calculate_forecast_summaries_for_accounts
from common.services.cache import get_forecast_summary_cache_key
from core.models import Household
from timeline.services.ledger import build_timeline
from transactions.models import Transaction
from transactions.services.posting import post_transaction

AS_OF = date(2026, 8, 16)
END = date(2026, 9, 15)


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def checking(db, household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Main",
        currency="USD",
        starting_balance=Decimal("1000.00"),
        include_in_forecast=True,
    )


def _planned(account, d, payee, amount):
    return Transaction.objects.create(
        account=account,
        date=d,
        payee=payee,
        amount=amount,
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.ONE_TIME,
    )


def _running_by_payee(user, checking):
    rows = build_timeline(
        user,
        start_date=AS_OF,
        end_date=END,
        account_id=checking.id,
        household_id=checking.household_id,
        as_of_date=AS_OF,
        projection_only=True,
    )
    out = {}
    for row in rows:
        if row.get("account_id") != checking.id:
            continue
        desc = row.get("description") or ""
        if desc in {"Bill A", "Bill B", "Paycheck"}:
            out[desc] = Decimal(str(row["running_balance"]))
    return out


@pytest.mark.django_db
def test_future_amount_edit_shifts_all_later_projected_balances(api_client, user, checking, household):
    from accounts.services.balances import signed_ledger_balance

    signed_current = Decimal("1000.00")
    assert signed_ledger_balance(checking, AS_OF) == signed_current

    bill_a = _planned(checking, date(2026, 8, 20), "Bill A", Decimal("-200.00"))
    _planned(checking, date(2026, 8, 21), "Bill B", Decimal("-100.00"))
    _planned(checking, date(2026, 8, 22), "Paycheck", Decimal("500.00"))

    before = _running_by_payee(user, checking)
    assert before["Bill A"] == Decimal("800.00")
    assert before["Bill B"] == Decimal("700.00")
    assert before["Paycheck"] == Decimal("1200.00")

    first_summary = calculate_forecast_summaries_for_accounts(
        user, [checking], as_of_date=AS_OF, days=30
    )
    first_key = get_forecast_summary_cache_key(
        user_id=user.pk,
        household_ids=[household.id],
        account_ids=[checking.id],
        forecast_days=30,
        as_of_date=AS_OF,
    )
    cached_before = cache.get(first_key)
    assert cached_before is not None

    rev_before = Household.objects.get(pk=household.pk).financial_revision

    api_client.force_authenticate(user=user)
    resp = api_client.patch(
        f"/api/transactions/{bill_a.pk}/",
        {"amount": "-350.00"},
        format="json",
    )
    assert resp.status_code == 200, resp.data

    after = _running_by_payee(user, checking)
    assert after["Bill A"] == Decimal("650.00")
    assert after["Bill B"] == Decimal("550.00")
    assert after["Paycheck"] == Decimal("1050.00")
    assert after["Bill A"] - before["Bill A"] == Decimal("-150.00")
    assert after["Bill B"] - before["Bill B"] == Decimal("-150.00")
    assert after["Paycheck"] - before["Paycheck"] == Decimal("-150.00")
    assert signed_ledger_balance(checking, AS_OF) == signed_current

    household.refresh_from_db()
    assert household.financial_revision > rev_before

    second_key = get_forecast_summary_cache_key(
        user_id=user.pk,
        household_ids=[household.id],
        account_ids=[checking.id],
        forecast_days=30,
        as_of_date=AS_OF,
    )
    assert second_key != first_key
    assert cache.get(first_key) == cached_before  # old payload unreachable via new key

    second_summary = calculate_forecast_summaries_for_accounts(
        user, [checking], as_of_date=AS_OF, days=30
    )
    assert second_summary != first_summary


@pytest.mark.django_db
def test_future_date_change_reorders_projected_balances(user, checking):
    bill_a = _planned(checking, date(2026, 8, 20), "Bill A", Decimal("-200.00"))
    _planned(checking, date(2026, 8, 21), "Bill B", Decimal("-100.00"))
    _planned(checking, date(2026, 8, 22), "Paycheck", Decimal("500.00"))

    bill_a.date = date(2026, 8, 23)
    bill_a.save(update_fields=["date", "updated_at"])

    after = _running_by_payee(user, checking)
    assert after["Bill B"] == Decimal("900.00")
    assert after["Paycheck"] == Decimal("1400.00")
    assert after["Bill A"] == Decimal("1200.00")


@pytest.mark.django_db
def test_delete_future_transaction_recalculates_later_balances(api_client, user, checking):
    bill_a = _planned(checking, date(2026, 8, 20), "Bill A", Decimal("-200.00"))
    _planned(checking, date(2026, 8, 21), "Bill B", Decimal("-100.00"))
    _planned(checking, date(2026, 8, 22), "Paycheck", Decimal("500.00"))

    api_client.force_authenticate(user=user)
    resp = api_client.delete(f"/api/transactions/{bill_a.pk}/")
    assert resp.status_code in (200, 204)

    after = _running_by_payee(user, checking)
    assert "Bill A" not in after
    assert after["Bill B"] == Decimal("900.00")
    assert after["Paycheck"] == Decimal("1400.00")


@pytest.mark.django_db
def test_memo_only_patch_does_not_bump_financial_revision(api_client, user, checking, household):
    txn = post_transaction(
        user=user,
        account_id=checking.pk,
        date=date(2026, 8, 10),
        payee="Note me",
        amount=Decimal("-1.00"),
        memo="",
    )
    rev_before = Household.objects.get(pk=household.pk).financial_revision
    api_client.force_authenticate(user=user)
    resp = api_client.patch(
        f"/api/transactions/{txn.pk}/",
        {"memo": "cosmetic"},
        format="json",
    )
    assert resp.status_code == 200, resp.data
    household.refresh_from_db()
    assert household.financial_revision == rev_before
