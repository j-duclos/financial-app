"""Account lifecycle: archive, close, soft delete, restore, forecast integration."""
from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from accounts.models import Account
from accounts.relationship_models import AccountRelationship
from core.models import Household, HouseholdMembership
from timeline.models import RecurringRule
from transactions.models import Transaction, TransferGroup

User = get_user_model()


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def user(db):
    return User.objects.create_user(username="lifecycleuser", password="testpass123")


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="Lifecycle HH")
    HouseholdMembership.objects.create(household=h, user=user, role=HouseholdMembership.Role.OWNER)
    return h


@pytest.fixture
def auth_client(api_client, user):
    api_client.force_authenticate(user=user)
    return api_client


def _checking(household, name="Checking", **kwargs):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name=name,
        currency="USD",
        **kwargs,
    )


@pytest.mark.django_db
def test_default_manager_excludes_deleted(household):
    active = _checking(household)
    deleted = _checking(household, name="Gone")
    from django.utils import timezone as tz

    deleted.status = Account.Status.DELETED
    deleted.deleted_at = tz.now()
    deleted.save()

    assert Account.objects.filter(pk=active.pk).exists()
    assert not Account.objects.filter(pk=deleted.pk).exists()
    assert Account.all_objects.filter(pk=deleted.pk).exists()


@pytest.mark.django_db
def test_archive_hides_from_active_only_query(auth_client, household):
    acct = _checking(household)
    r = auth_client.post(f"/api/accounts/{acct.id}/archive/", {"reason": "unused"}, format="json")
    assert r.status_code == 200
    acct.refresh_from_db()
    assert acct.status == Account.Status.ARCHIVED
    assert acct.archived is True
    assert acct.plaid_sync_enabled is False
    assert acct.include_in_forecast is False

    r_list = auth_client.get("/api/accounts/", {"active_only": "true"})
    ids = [a["id"] for a in r_list.data["results"]]
    assert acct.id not in ids

    r_arch = auth_client.get("/api/accounts/", {"status": "archived"})
    assert acct.id in [a["id"] for a in r_arch.data["results"]]


@pytest.mark.django_db
def test_soft_delete_preserves_transactions(auth_client, household):
    acct = _checking(household)
    Transaction.objects.create(
        account=acct,
        date=date(2024, 5, 1),
        payee="Coffee",
        amount=Decimal("-5.00"),
    )
    r = auth_client.delete(f"/api/accounts/{acct.id}/")
    assert r.status_code == 204
    assert Transaction.objects.filter(account_id=acct.id).count() == 1
    acct = Account.all_objects.get(pk=acct.id)
    assert acct.status == Account.Status.DELETED
    assert acct.is_hidden is True


@pytest.mark.django_db
def test_closed_stops_recurring_projection(user, household):
    from timeline.services.ledger import build_timeline

    acct = _checking(household)
    RecurringRule.objects.create(
        household=household,
        account=acct,
        name="Rent",
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("1000.00"),
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        day_of_month=1,
        start_date=date.today() - timedelta(days=30),
        active=True,
    )
    acct.status = Account.Status.CLOSED
    acct.closed_at = date.today()
    acct.include_in_forecast = False
    acct.is_active = False
    acct.save()

    today = date.today()
    rows = build_timeline(
        user,
        start_date=today,
        end_date=today + timedelta(days=60),
        account_id=acct.id,
    )
    future = [r for r in rows if r.get("date") and r["date"] > today and r.get("transaction_id") is None]
    assert len(future) == 0


@pytest.mark.django_db
def test_restore_reactivates_account(auth_client, household):
    acct = _checking(household)
    auth_client.post(f"/api/accounts/{acct.id}/archive/", {}, format="json")
    r = auth_client.post(
        f"/api/accounts/{acct.id}/restore/",
        {"reenable_forecast": True},
        format="json",
    )
    assert r.status_code == 200
    acct.refresh_from_db()
    assert acct.status == Account.Status.ACTIVE
    assert acct.include_in_forecast is True


@pytest.mark.django_db
def test_archive_deactivates_relationships(auth_client, household):
    src = _checking(household, name="Src")
    dst = _checking(household, name="Dst")
    rel = AccountRelationship.objects.create(
        household=household,
        source_account=src,
        destination_account=dst,
        relationship_type=AccountRelationship.RelationshipType.TRANSFER,
        default_amount=Decimal("50"),
        default_day=15,
        is_active=True,
    )
    auth_client.post(f"/api/accounts/{src.id}/archive/", {}, format="json")
    rel.refresh_from_db()
    assert rel.is_active is False


@pytest.mark.django_db
def test_close_requires_force_on_nonzero_balance(auth_client, household):
    acct = _checking(household, starting_balance=Decimal("100"))
    r = auth_client.post(f"/api/accounts/{acct.id}/close/", {}, format="json")
    assert r.status_code == 400
    r2 = auth_client.post(f"/api/accounts/{acct.id}/close/", {"force": True}, format="json")
    assert r2.status_code == 200
    acct.refresh_from_db()
    assert acct.status == Account.Status.CLOSED


@pytest.mark.django_db
def test_lifecycle_preflight_returns_warnings(auth_client, household, user):
    acct = _checking(household)
    RecurringRule.objects.create(
        household=household,
        account=acct,
        name="Sub",
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("10.00"),
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        day_of_month=10,
        start_date=date.today(),
        active=True,
    )
    r = auth_client.get(f"/api/accounts/{acct.id}/lifecycle-preflight/", {"action": "archive"})
    assert r.status_code == 200
    assert r.data["future_recurring_count"] >= 1
    assert len(r.data["warnings"]) >= 1


@pytest.mark.django_db
def test_historical_reporting_includes_archived_transactions(household):
    acct = _checking(household)
    Transaction.objects.create(
        account=acct,
        date=date(2023, 1, 1),
        payee="Old",
        amount=Decimal("-1.00"),
    )
    acct.status = Account.Status.ARCHIVED
    acct.archived = True
    acct.is_active = False
    acct.include_in_forecast = False
    acct.save()
    assert Transaction.objects.filter(account=acct).count() == 1
