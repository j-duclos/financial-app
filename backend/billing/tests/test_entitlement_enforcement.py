"""Launch entitlement enforcement: Plaid is Premium-only; Free resource caps."""
from datetime import date
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.test import override_settings

from accounts.models import Account
from categories.models import Category
from billing.entitlements import PLAID_PREMIUM_DETAIL, PLAID_SYNC_PAUSED_DETAIL
from billing.models import BillingSubscription
from billing.services import downgrade_to_free
from billing.tests.helpers import grant_premium
from core.models import UserProfile
from goals.models import FinancialGoal
from plaid_link.models import PlaidItem, PlaidLinkedAccount
from timeline.models import RecurringRule
from transactions.models import Transaction

pytestmark = pytest.mark.django_db


def _assert_premium_required(response, feature="plaid_bank_sync"):
    assert response.status_code == 403
    body = response.json()
    assert body["code"] == "premium_required"
    assert body["feature"] == feature
    assert body["upgrade_required"] is True
    assert body["detail"]
    return body


def test_free_user_cannot_create_plaid_link_token(authenticated_client, household):
    with patch("plaid_link.views.plaid_configured", return_value=True):
        r = authenticated_client.post(
            "/api/plaid/link-token/",
            {"household_id": household.id},
            format="json",
        )
    body = _assert_premium_required(r)
    assert body["detail"] == PLAID_PREMIUM_DETAIL


def test_free_user_cannot_exchange_public_token(authenticated_client, household):
    with patch("plaid_link.views.plaid_configured", return_value=True):
        r = authenticated_client.post(
            "/api/plaid/exchange/",
            {"household_id": household.id, "public_token": "public-sandbox-x"},
            format="json",
        )
    _assert_premium_required(r)


def test_free_user_sync_all_is_blocked(authenticated_client, household):
    with patch("plaid_link.views.plaid_configured", return_value=True):
        r = authenticated_client.post(f"/api/plaid/sync-all/?household={household.id}&force=true")
    body = _assert_premium_required(r)
    assert body["detail"] == PLAID_SYNC_PAUSED_DETAIL


def test_downgrade_keeps_plaid_item_and_transactions(user, household, account):
    item = PlaidItem.objects.create(
        household=household,
        item_id="item-keep",
        access_token_cipher="cipher",
        institution_name="Kept Bank",
    )
    PlaidLinkedAccount.objects.create(
        item=item,
        plaid_account_id="pa-keep",
        account=account,
    )
    txn = Transaction.objects.create(
        account=account,
        date=date(2026, 9, 1),
        amount=Decimal("-12.00"),
        payee="Imported coffee",
        plaid_transaction_id="pl-keep",
    )
    billing = grant_premium(user)
    downgrade_to_free(billing, status="canceled")
    billing.refresh_from_db()
    assert billing.plan == BillingSubscription.Plan.FREE
    assert PlaidItem.objects.filter(pk=item.pk).exists()
    assert PlaidLinkedAccount.objects.filter(account=account).exists()
    assert Transaction.objects.filter(pk=txn.pk, plaid_transaction_id="pl-keep").exists()
    account.refresh_from_db()
    assert account.status == Account.Status.ACTIVE


def test_free_user_manual_account_limit(authenticated_client, household):
    for i in range(3):
        r = authenticated_client.post(
            "/api/accounts/",
            {
                "household": household.id,
                "name": f"Manual {i}",
                "account_type": "CHECKING",
                "currency": "USD",
            },
            format="json",
        )
        assert r.status_code == 201, r.data
    r = authenticated_client.post(
        "/api/accounts/",
        {
            "household": household.id,
            "name": "Manual 4",
            "account_type": "CHECKING",
            "currency": "USD",
        },
        format="json",
    )
    assert r.status_code == 403
    body = r.json()
    assert body["code"] == "plan_limit_reached"
    assert body["feature"] == "manual_accounts"
    assert body["limit"] == 3
    assert body["upgrade_required"] is True


def test_plaid_linked_accounts_do_not_consume_manual_slots(
    authenticated_client, user, household, account
):
    item = PlaidItem.objects.create(
        household=household,
        item_id="item-manual-slot",
        access_token_cipher="cipher",
        institution_name="Bank",
    )
    PlaidLinkedAccount.objects.create(item=item, plaid_account_id="pa-1", account=account)
    for i in range(3):
        r = authenticated_client.post(
            "/api/accounts/",
            {
                "household": household.id,
                "name": f"Extra {i}",
                "account_type": "SAVINGS",
                "currency": "USD",
            },
            format="json",
        )
        assert r.status_code == 201, r.data


def test_free_user_recurring_rule_limit(authenticated_client, household, account):
    cat = Category.objects.create(
        household=household,
        name="Entitlement Bills",
        category_type=Category.CategoryType.EXPENSE,
        sort_order=90,
    )
    payload = {
        "household": household.id,
        "name": "Bill",
        "account_id": account.id,
        "category_id": cat.id,
        "direction": "EXPENSE",
        "amount": "10.00",
        "currency": "USD",
        "frequency": "MONTHLY_DAY",
        "interval": 1,
        "day_of_month": 1,
        "start_date": "2026-01-01",
        "active": True,
    }
    for i in range(10):
        r = authenticated_client.post(
            "/api/rules/",
            {**payload, "name": f"Bill {i}"},
            format="json",
        )
        assert r.status_code == 201, r.data
    r = authenticated_client.post("/api/rules/", {**payload, "name": "Bill 11"}, format="json")
    assert r.status_code == 403
    assert r.json()["feature"] == "recurring_rules"
    assert r.json()["code"] == "plan_limit_reached"


def _make_rule(household, account, name, *, active=True):
    return RecurringRule.objects.create(
        household=household,
        name=name,
        account=account,
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("10.00"),
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=1,
        start_date=date(2026, 1, 1),
        active=active,
    )


def test_inactive_recurring_rules_do_not_consume_quota(authenticated_client, household, account):
    for i in range(10):
        _make_rule(household, account, f"Active {i}", active=True)
    for i in range(5):
        _make_rule(household, account, f"Idle {i}", active=False)
    cat = Category.objects.create(
        household=household,
        name="Entitlement Extra Bills",
        category_type=Category.CategoryType.EXPENSE,
        sort_order=91,
    )
    r = authenticated_client.post(
        "/api/rules/",
        {
            "household": household.id,
            "name": "Inactive extra",
            "account_id": account.id,
            "category_id": cat.id,
            "direction": "EXPENSE",
            "amount": "10.00",
            "currency": "USD",
            "frequency": "MONTHLY_DAY",
            "interval": 1,
            "day_of_month": 1,
            "start_date": "2026-01-01",
            "active": False,
        },
        format="json",
    )
    assert r.status_code == 201, r.data


def test_nine_active_and_inactive_can_create_one_active(
    authenticated_client, household, account
):
    for i in range(9):
        _make_rule(household, account, f"Active {i}", active=True)
    for i in range(5):
        _make_rule(household, account, f"Idle {i}", active=False)
    cat = Category.objects.create(
        household=household,
        name="Entitlement Extra Bills",
        category_type=Category.CategoryType.EXPENSE,
        sort_order=91,
    )
    r = authenticated_client.post(
        "/api/rules/",
        {
            "household": household.id,
            "name": "Tenth active",
            "account_id": account.id,
            "category_id": cat.id,
            "direction": "EXPENSE",
            "amount": "10.00",
            "currency": "USD",
            "frequency": "MONTHLY_DAY",
            "interval": 1,
            "day_of_month": 1,
            "start_date": "2026-01-01",
            "active": True,
        },
        format="json",
    )
    assert r.status_code == 201, r.data


def test_disabling_active_rule_frees_quota_slot(authenticated_client, household, account):
    rules = [_make_rule(household, account, f"Active {i}", active=True) for i in range(10)]
    extra = _make_rule(household, account, "Waiting", active=False)
    r = authenticated_client.patch(
        f"/api/rules/{rules[0].id}/",
        {"active": False},
        format="json",
    )
    assert r.status_code == 200, r.data
    r = authenticated_client.patch(
        f"/api/rules/{extra.id}/",
        {"active": True},
        format="json",
    )
    assert r.status_code == 200, r.data


def test_rule_activation_denied_at_quota(authenticated_client, household, account):
    for i in range(10):
        _make_rule(household, account, f"Active {i}", active=True)
    idle = _make_rule(household, account, "Idle", active=False)
    r = authenticated_client.patch(
        f"/api/rules/{idle.id}/",
        {"active": True},
        format="json",
    )
    assert r.status_code == 403
    body = r.json()
    assert body["code"] == "plan_limit_reached"
    assert body["feature"] == "recurring_rules"
    idle.refresh_from_db()
    assert idle.active is False


def test_active_to_active_edit_does_not_consume_extra_slot(
    authenticated_client, household, account
):
    rules = [_make_rule(household, account, f"Active {i}", active=True) for i in range(10)]
    r = authenticated_client.patch(
        f"/api/rules/{rules[0].id}/",
        {"name": "Still active", "active": True},
        format="json",
    )
    assert r.status_code == 200, r.data
    rules[0].refresh_from_db()
    assert rules[0].active is True
    assert rules[0].name == "Still active"


def test_inactive_to_inactive_edit_remains_allowed(authenticated_client, household, account):
    for i in range(10):
        _make_rule(household, account, f"Active {i}", active=True)
    idle = _make_rule(household, account, "Idle", active=False)
    r = authenticated_client.patch(
        f"/api/rules/{idle.id}/",
        {"name": "Still idle", "active": False},
        format="json",
    )
    assert r.status_code == 200, r.data
    idle.refresh_from_db()
    assert idle.active is False
    assert idle.name == "Still idle"


def test_active_to_inactive_edit_is_allowed(authenticated_client, household, account):
    rules = [_make_rule(household, account, f"Active {i}", active=True) for i in range(10)]
    r = authenticated_client.patch(
        f"/api/rules/{rules[0].id}/",
        {"active": False},
        format="json",
    )
    assert r.status_code == 200, r.data
    rules[0].refresh_from_db()
    assert rules[0].active is False


def test_resume_endpoint_enforces_active_quota(authenticated_client, household, account):
    for i in range(10):
        _make_rule(household, account, f"Active {i}", active=True)
    idle = _make_rule(household, account, "Idle", active=False)
    r = authenticated_client.post(f"/api/rules/{idle.id}/resume/")
    assert r.status_code == 403
    body = r.json()
    assert body["code"] == "plan_limit_reached"
    assert body["feature"] == "recurring_rules"
    idle.refresh_from_db()
    assert idle.active is False
    payload = {
        "household": household.id,
        "name": "Goal",
        "goal_type": "emergency_fund",
        "target_amount": "1000.00",
        "priority": 1,
    }
    for i in range(2):
        r = authenticated_client.post("/api/goals/", {**payload, "name": f"Goal {i}"}, format="json")
        assert r.status_code == 201, r.data
    r = authenticated_client.post("/api/goals/", {**payload, "name": "Goal 3"}, format="json")
    assert r.status_code == 403
    assert r.json()["feature"] == "goals"
    assert r.json()["code"] == "plan_limit_reached"
    assert FinancialGoal.objects.filter(household=household).count() == 2


@pytest.mark.django_db
@override_settings(PLAID_WEBHOOK_URL="https://example.test/api/plaid/webhooks/liabilities/")
def test_plaid_liabilities_webhook_is_ignored_for_free_household(household):
    from rest_framework.test import APIClient

    item = PlaidItem.objects.create(
        household=household,
        item_id="item-free-webhook",
        access_token_cipher="cipher",
        institution_name="Bank",
    )
    api = APIClient()
    r = api.post(
        "/api/plaid/webhooks/liabilities/",
        {
            "webhook_type": "LIABILITIES",
            "webhook_code": "DEFAULT_UPDATE",
            "item_id": item.item_id,
        },
        format="json",
    )
    assert r.status_code == 200
    assert r.json()["status"] == "ignored"
    assert r.json()["reason"] == "premium_required"


def test_premium_user_can_create_plaid_link_token(authenticated_client, user, household):
    grant_premium(user)
    with (
        patch("plaid_link.views.plaid_configured", return_value=True),
        patch("plaid_link.views.create_link_token", return_value="link-sandbox-token"),
    ):
        r = authenticated_client.post(
            "/api/plaid/link-token/",
            {"household_id": household.id},
            format="json",
        )
    assert r.status_code == 200
    assert r.json()["link_token"] == "link-sandbox-token"


def _assert_forecast_premium_required(response):
    assert response.status_code == 403
    body = response.json()
    assert body["code"] == "premium_required"
    assert body["feature"] == "operational_forecast_days"
    assert body["upgrade_required"] is True
    assert body["limit"] == 90
    return body


@patch("insights.views.build_dashboard_summary", return_value={"ok": True})
def test_free_explicit_180_forecast_is_forbidden(mock_summary, authenticated_client):
    r = authenticated_client.get("/api/insights/dashboard/summary/?forecast_days=180")
    _assert_forecast_premium_required(r)
    mock_summary.assert_not_called()


@patch("insights.views.build_dashboard_summary", return_value={"ok": True})
def test_free_explicit_365_forecast_is_forbidden(mock_summary, authenticated_client):
    r = authenticated_client.get("/api/insights/dashboard/summary/?days=365")
    _assert_forecast_premium_required(r)
    mock_summary.assert_not_called()


@patch("insights.views.build_dashboard_summary", return_value={"ok": True})
def test_free_explicit_90_forecast_is_allowed(mock_summary, authenticated_client):
    r = authenticated_client.get("/api/insights/dashboard/summary/?forecast_days=90")
    assert r.status_code == 200
    mock_summary.assert_called_once()


@patch("insights.views.build_dashboard_summary", return_value={"ok": True})
def test_premium_explicit_180_and_365_forecast_are_allowed(mock_summary, authenticated_client, user):
    grant_premium(user)
    r = authenticated_client.get("/api/insights/dashboard/summary/?forecast_days=180")
    assert r.status_code == 200
    r = authenticated_client.get("/api/insights/dashboard/summary/?forecast_days=365")
    assert r.status_code == 200
    assert mock_summary.call_count == 2


@patch("insights.views.build_dashboard_summary", return_value={"ok": True})
def test_invalid_forecast_window_is_validation_error(mock_summary, authenticated_client):
    r = authenticated_client.get("/api/insights/dashboard/summary/?forecast_days=45")
    assert r.status_code == 400
    assert "Forecast Window" in r.json()["detail"]
    mock_summary.assert_not_called()


@patch("insights.views.build_dashboard_summary", return_value={"ok": True})
def test_downgrade_passive_dashboard_does_not_error(
    mock_summary, authenticated_client, user
):
    billing = grant_premium(user)
    profile, _ = UserProfile.objects.get_or_create(user=user)
    UserProfile.objects.filter(pk=profile.pk).update(default_forecast_days=180)
    downgrade_to_free(billing, status="canceled")
    r = authenticated_client.get("/api/insights/dashboard/summary/")
    assert r.status_code == 200
    mock_summary.assert_called_once()
    assert mock_summary.call_args.kwargs["days"] == 30
