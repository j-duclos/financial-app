"""Export and account deletion. Household financial data is not user-owned."""
from datetime import date
from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from billing.models import BillingSubscription
from billing.services import get_or_create_billing_subscription
from billing.tests.helpers import stripe_configured
from core.account_lifecycle import DELETE_CONFIRMATION_PHRASE, sanitize_csv_cell
from core.email_identity import mark_email_verified
from core.models import Household, HouseholdMembership
from categories.models import Category
from goals.models import FinancialGoal, GoalBucket
from plaid_link.crypto import encrypt_secret
from plaid_link.models import PlaidItem
from timeline.models import ReconciliationMatch, StatementTransaction
from transactions.models import Reconciliation, ReconciliationEntry, Transaction

pytestmark = pytest.mark.django_db

User = get_user_model()

SENSITIVE_MARKERS = (
    "password",
    "hashed",
    "access_token",
    "access_token_cipher",
    "STRIPE_SECRET",
    "sk_test",
    "sk_live",
    "whsec_",
    "plaid_secret",
    "DJANGO_SECRET",
)


def _verify(user, email="owner@example.com"):
    user.email = email
    user.save(update_fields=["email"])
    mark_email_verified(user)
    return user


def _delete_payload(password="testpass123", confirmation=DELETE_CONFIRMATION_PHRASE):
    return {"current_password": password, "confirmation": confirmation}


def test_sanitize_csv_cells_against_formula_injection():
    assert sanitize_csv_cell("=CMD") == "'=CMD"
    assert sanitize_csv_cell("+1+1") == "'+1+1"
    assert sanitize_csv_cell("-1") == "'-1"
    assert sanitize_csv_cell("@sum") == "'@sum"
    assert sanitize_csv_cell("Groceries") == "Groceries"


def test_export_requires_authentication(api_client):
    assert api_client.get("/api/profile/export-data/").status_code in (401, 403)


def test_export_contains_accessible_data_and_omits_secrets(authenticated_client, user, household, account):
    _verify(user)
    coffee_category = Category.objects.create(
        household=household,
        name="Export Cafe",
        category_type=Category.CategoryType.EXPENSE,
        sort_order=99,
    )
    Transaction.objects.create(
        account=account,
        date=date(2026, 1, 15),
        payee="Coffee",
        amount=Decimal("-4.50"),
        category=coffee_category,
        status=Transaction.Status.CLEARED,
        source=Transaction.Source.ACTUAL,
        memo="latte",
    )
    other = User.objects.create_user(username="other_export", password="testpass123")
    other_hh = Household.objects.create(name="Secret HH")
    HouseholdMembership.objects.create(
        household=other_hh, user=other, role=HouseholdMembership.Role.OWNER
    )
    from accounts.models import Account

    other_acct = Account.objects.create(
        household=other_hh,
        account_type=Account.AccountType.CHECKING,
        name="Hidden checking",
        currency="USD",
        starting_balance=Decimal("1.00"),
    )
    Transaction.objects.create(
        account=other_acct,
        date=date(2026, 1, 1),
        payee="Secret payee",
        amount=Decimal("-9.00"),
        status=Transaction.Status.CLEARED,
        source=Transaction.Source.ACTUAL,
    )

    r = authenticated_client.get("/api/profile/export-data/")
    assert r.status_code == 200
    assert r["Content-Type"].startswith("application/json")
    assert "attachment" in r["Content-Disposition"]
    assert "filename=" in r["Content-Disposition"]
    assert ".json" in r["Content-Disposition"]
    body = r.json()
    text = r.content.decode()
    for marker in SENSITIVE_MARKERS:
        assert marker not in text
    assert "hashed" not in body.get("user", {})
    assert body["export_version"] == 2
    assert body["user"]["username"] == user.username
    assert household.name in [h["name"] for h in body["households"]]
    assert "Secret HH" not in [h["name"] for h in body["households"]]
    assert any(a["name"] == account.name for a in body["accounts"])
    assert not any(a["name"] == "Hidden checking" for a in body["accounts"])
    payees = [t["payee"] for t in body["transactions"]]
    assert "Coffee" in payees
    assert "Secret payee" not in payees
    coffee = next(t for t in body["transactions"] if t["payee"] == "Coffee")
    assert coffee["amount"] == "-4.50"
    assert coffee["date"] == "2026-01-15"
    assert "stripe_customer_id" not in body["billing"]
    assert "stripe_subscription_id" not in body["billing"]
    assert "access_token_cipher" not in text


def test_export_includes_all_transactions_not_one_page(authenticated_client, user, account):
    for i in range(25):
        Transaction.objects.create(
            account=account,
            date=date(2026, 2, 1),
            payee=f"Txn {i}",
            amount=Decimal("-1.00"),
            status=Transaction.Status.CLEARED,
            source=Transaction.Source.ACTUAL,
        )
    r = authenticated_client.get("/api/profile/export-data/")
    assert r.status_code == 200
    assert len(r.json()["transactions"]) == 25
    csv_r = authenticated_client.get("/api/profile/export-transactions.csv")
    assert csv_r.status_code == 200
    assert csv_r["Content-Type"].startswith("text/csv")
    assert "attachment" in csv_r["Content-Disposition"]
    lines = csv_r.content.decode().strip().splitlines()
    assert lines[0].startswith("date,account,payee")
    assert len(lines) == 26
    assert "=HACK" not in csv_r.content.decode()


def test_csv_sanitizes_formula_payee(authenticated_client, account):
    Transaction.objects.create(
        account=account,
        date=date(2026, 3, 1),
        payee="=1+1",
        amount=Decimal("-1.00"),
        status=Transaction.Status.CLEARED,
        source=Transaction.Source.ACTUAL,
    )
    r = authenticated_client.get("/api/profile/export-transactions.csv")
    assert r.status_code == 200
    assert "'=1+1" in r.content.decode()


PLAID_PLAINTEXT_TOKEN = "access-sandbox-SECRETTOKEN99"


def test_export_includes_goals_plaid_metadata_and_reconciliation(
    authenticated_client, user, household, account
):
    _verify(user)
    FinancialGoal.objects.create(
        household=household,
        name="Vacation fund",
        goal_type=FinancialGoal.GoalType.VACATION,
        target_amount=Decimal("2000"),
        current_amount=Decimal("150.00"),
        monthly_contribution=Decimal("50"),
        priority=2,
        notes="beach",
    )
    GoalBucket.objects.create(
        household=household,
        name="Emergency bucket",
        type=GoalBucket.BucketType.EMERGENCY,
        target_amount=Decimal("10000"),
        allocated_amount=Decimal("400"),
        linked_account=account,
    )
    rec = Reconciliation.objects.create(
        user=user,
        account=account,
        bank_current_balance=Decimal("100.00"),
        app_current_balance=Decimal("100.00"),
        last_reconciled_balance=Decimal("90.00"),
        final_reconciled_balance=Decimal("100.00"),
        difference=Decimal("0"),
        period_start_date=date(2026, 1, 1),
        period_end_date=date(2026, 1, 31),
        transaction_count=1,
        status=Reconciliation.Status.COMPLETED,
        is_active=True,
    )
    txn = Transaction.objects.create(
        account=account,
        date=date(2026, 1, 10),
        payee="Reconciled coffee",
        amount=Decimal("-4.00"),
        status=Transaction.Status.CLEARED,
        source=Transaction.Source.ACTUAL,
        reconciled=True,
    )
    ReconciliationEntry.objects.create(session=rec, transaction=txn, reconciled_balance=Decimal("96.00"))
    stmt = StatementTransaction.objects.create(
        household=household,
        account=account,
        posted_date=date(2026, 1, 10),
        description="STMT COFFEE",
        amount=Decimal("-4.00"),
        raw={"internal": "do-not-export-raw"},
    )
    ReconciliationMatch.objects.create(
        statement_txn=stmt,
        matched_transaction=txn,
        status=ReconciliationMatch.Status.MATCHED,
    )
    PlaidItem.objects.create(
        household=household,
        item_id="item-export-meta",
        access_token_cipher=encrypt_secret(PLAID_PLAINTEXT_TOKEN),
        institution_name="Export Bank",
        institution_id="ins_secret",
        transactions_cursor="cursor-secret",
    )

    other = User.objects.create_user(username="other_goals", password="testpass123")
    other_hh = Household.objects.create(name="Hidden Goals HH")
    HouseholdMembership.objects.create(
        household=other_hh, user=other, role=HouseholdMembership.Role.OWNER
    )
    from accounts.models import Account

    other_acct = Account.objects.create(
        household=other_hh,
        account_type=Account.AccountType.CHECKING,
        name="Hidden recon account",
        currency="USD",
        starting_balance=Decimal("1.00"),
    )
    FinancialGoal.objects.create(
        household=other_hh,
        name="Secret goal",
        goal_type=FinancialGoal.GoalType.CUSTOM,
        target_amount=Decimal("9"),
    )
    GoalBucket.objects.create(
        household=other_hh,
        name="Secret bucket",
        type=GoalBucket.BucketType.CUSTOM,
        target_amount=Decimal("9"),
    )
    Reconciliation.objects.create(
        user=other,
        account=other_acct,
        bank_current_balance=Decimal("1.00"),
        app_current_balance=Decimal("1.00"),
        last_reconciled_balance=Decimal("1.00"),
        final_reconciled_balance=Decimal("1.00"),
        difference=Decimal("0"),
        status=Reconciliation.Status.COMPLETED,
    )
    PlaidItem.objects.create(
        household=other_hh,
        item_id="item-hidden-bank",
        access_token_cipher=encrypt_secret("access-sandbox-HIDDEN"),
        institution_name="Hidden Bank",
    )

    r = authenticated_client.get("/api/profile/export-data/")
    assert r.status_code == 200
    body = r.json()
    text = r.content.decode()
    for marker in SENSITIVE_MARKERS:
        assert marker not in text
    assert PLAID_PLAINTEXT_TOKEN not in text
    assert "access-sandbox-HIDDEN" not in text
    assert "access_token_cipher" not in text
    assert "cursor-secret" not in text
    assert "ins_secret" not in text
    assert "do-not-export-raw" not in text
    assert "item-export-meta" not in text

    goal_names = [g["name"] for g in body["financial_goals"]]
    assert "Vacation fund" in goal_names
    assert "Secret goal" not in goal_names
    vacation = next(g for g in body["financial_goals"] if g["name"] == "Vacation fund")
    assert vacation["goal_type"] == FinancialGoal.GoalType.VACATION
    assert vacation["current_amount"] == "150.00"

    bucket_names = [g["name"] for g in body["goal_buckets"]]
    assert "Emergency bucket" in bucket_names
    assert "Secret bucket" not in bucket_names

    banks = [b["institution_name"] for b in body["bank_connections"]]
    assert "Export Bank" in banks
    assert "Hidden Bank" not in banks
    bank = next(b for b in body["bank_connections"] if b["institution_name"] == "Export Bank")
    assert set(bank.keys()) <= {
        "household_id",
        "institution_name",
        "created_at",
        "last_sync_at",
        "linked_accounts",
    }

    rec_ids = [row["id"] for row in body["reconciliations"]]
    assert rec.pk in rec_ids
    exported_rec = next(row for row in body["reconciliations"] if row["id"] == rec.pk)
    assert txn.pk in exported_rec["transaction_ids"]
    assert exported_rec["final_reconciled_balance"] == "100.00"
    assert not any(row["account_id"] == other_acct.pk for row in body["reconciliations"])

    stmt_descs = [row["description"] for row in body["statement_transactions"]]
    assert "STMT COFFEE" in stmt_descs
    exported_stmt = next(row for row in body["statement_transactions"] if row["description"] == "STMT COFFEE")
    assert "raw" not in exported_stmt
    assert exported_stmt["match_status"] == ReconciliationMatch.Status.MATCHED
    assert exported_stmt["matched_transaction_id"] == txn.pk


def test_delete_requires_authentication(api_client):
    r = api_client.post("/api/profile/delete-account/", _delete_payload(), format="json")
    assert r.status_code in (401, 403)


def test_delete_rejects_wrong_password(authenticated_client, user):
    r = authenticated_client.post(
        "/api/profile/delete-account/",
        _delete_payload(password="nope"),
        format="json",
    )
    assert r.status_code == 400
    assert User.objects.filter(pk=user.pk).exists()


def test_delete_rejects_wrong_confirmation(authenticated_client, user):
    r = authenticated_client.post(
        "/api/profile/delete-account/",
        _delete_payload(confirmation="delete"),
        format="json",
    )
    assert r.status_code == 400
    assert User.objects.filter(pk=user.pk).exists()


def test_unverified_email_cannot_delete(authenticated_client, user):
    user.email = "pending@example.com"
    user.save(update_fields=["email"])
    r = authenticated_client.post("/api/profile/delete-account/", _delete_payload(), format="json")
    assert r.status_code == 403
    assert r.json()["code"] == "email_verification_required"
    assert User.objects.filter(pk=user.pk).exists()


def test_legacy_blank_email_user_can_delete(authenticated_client, user, household):
    assert user.email == ""
    r = authenticated_client.post("/api/profile/delete-account/", _delete_payload(), format="json")
    assert r.status_code == 200
    assert r.json()["detail"] == "Your account has been deleted."
    assert not User.objects.filter(pk=user.pk).exists()
    assert not Household.objects.filter(pk=household.pk).exists()


def test_verified_user_deletes_only_member_household(authenticated_client, user, household, account):
    _verify(user)
    Transaction.objects.create(
        account=account,
        date=date(2026, 1, 1),
        payee="Keep-me-not",
        amount=Decimal("-1.00"),
        status=Transaction.Status.CLEARED,
        source=Transaction.Source.ACTUAL,
    )
    r = authenticated_client.post("/api/profile/delete-account/", _delete_payload(), format="json")
    assert r.status_code == 200
    assert not User.objects.filter(pk=user.pk).exists()
    assert not Household.objects.filter(pk=household.pk).exists()
    assert not Transaction.objects.filter(payee="Keep-me-not").exists()


def test_shared_non_owner_membership_removed_household_kept(authenticated_client, user, household):
    _verify(user)
    membership = HouseholdMembership.objects.get(user=user, household=household)
    membership.role = HouseholdMembership.Role.MEMBER
    membership.save(update_fields=["role"])
    co_owner = User.objects.create_user(username="co_owner", password="testpass123")
    HouseholdMembership.objects.create(
        household=household, user=co_owner, role=HouseholdMembership.Role.OWNER
    )
    r = authenticated_client.post("/api/profile/delete-account/", _delete_payload(), format="json")
    assert r.status_code == 200
    assert not User.objects.filter(pk=user.pk).exists()
    household.refresh_from_db()
    assert household.name
    assert HouseholdMembership.objects.filter(household=household, user=co_owner).exists()
    assert not HouseholdMembership.objects.filter(user_id=user.pk).exists()


def test_sole_owner_with_other_members_blocked(authenticated_client, user, household):
    _verify(user)
    member = User.objects.create_user(username="member_stay", password="testpass123")
    HouseholdMembership.objects.create(
        household=household, user=member, role=HouseholdMembership.Role.MEMBER
    )
    pre = authenticated_client.get("/api/profile/delete-account/preflight/")
    assert pre.status_code == 200
    assert pre.json()["can_delete"] is False
    assert pre.json()["blocking_reasons"][0]["code"] == "household_owner_transfer_required"
    assert household.name in pre.json()["blocking_reasons"][0]["household_name"]
    r = authenticated_client.post("/api/profile/delete-account/", _delete_payload(), format="json")
    assert r.status_code == 409
    assert User.objects.filter(pk=user.pk).exists()
    assert Household.objects.filter(pk=household.pk).exists()


def test_multiple_owners_can_delete(authenticated_client, user, household):
    _verify(user)
    other = User.objects.create_user(username="also_owner", password="testpass123")
    HouseholdMembership.objects.create(
        household=household, user=other, role=HouseholdMembership.Role.OWNER
    )
    r = authenticated_client.post("/api/profile/delete-account/", _delete_payload(), format="json")
    assert r.status_code == 200
    assert Household.objects.filter(pk=household.pk).exists()
    assert HouseholdMembership.objects.filter(household=household, user=other).exists()


@stripe_configured
def test_active_subscription_canceled_before_delete(authenticated_client, user, household):
    _verify(user)
    billing = get_or_create_billing_subscription(user)
    billing.status = "active"
    billing.plan = BillingSubscription.Plan.PREMIUM
    billing.stripe_customer_id = "cus_keep"
    billing.stripe_subscription_id = "sub_live"
    billing.save()
    with patch("billing.stripe_api.cancel_subscription") as mock_cancel:
        mock_cancel.return_value = MagicMock(id="sub_live", status="canceled")
        r = authenticated_client.post("/api/profile/delete-account/", _delete_payload(), format="json")
    assert r.status_code == 200
    mock_cancel.assert_called_once_with("sub_live")
    assert not User.objects.filter(pk=user.pk).exists()


@stripe_configured
def test_stripe_cancel_failure_preserves_account(authenticated_client, user):
    _verify(user)
    billing = get_or_create_billing_subscription(user)
    billing.status = "active"
    billing.plan = BillingSubscription.Plan.PREMIUM
    billing.stripe_subscription_id = "sub_live"
    billing.save()
    with patch("billing.stripe_api.cancel_subscription", side_effect=RuntimeError("stripe down")):
        r = authenticated_client.post("/api/profile/delete-account/", _delete_payload(), format="json")
    assert r.status_code == 503
    assert r.json()["code"] == "stripe_cancellation_failed"
    assert User.objects.filter(pk=user.pk).exists()
    billing.refresh_from_db()
    assert billing.stripe_subscription_id == "sub_live"


@stripe_configured
def test_stale_free_subscription_id_does_not_call_stripe(authenticated_client, user, household):
    _verify(user)
    billing = get_or_create_billing_subscription(user)
    billing.status = "canceled"
    billing.plan = BillingSubscription.Plan.FREE
    billing.stripe_subscription_id = "sub_old"
    billing.save()
    with patch("billing.stripe_api.cancel_subscription") as mock_cancel:
        r = authenticated_client.post("/api/profile/delete-account/", _delete_payload(), format="json")
    assert r.status_code == 200
    mock_cancel.assert_not_called()
    assert not User.objects.filter(pk=user.pk).exists()


@stripe_configured
def test_already_canceled_remote_subscription_allows_delete(authenticated_client, user, household):
    import stripe

    _verify(user)
    billing = get_or_create_billing_subscription(user)
    billing.status = "active"
    billing.plan = BillingSubscription.Plan.PREMIUM
    billing.stripe_subscription_id = "sub_gone"
    billing.save()
    already_gone = stripe.InvalidRequestError(
        "No such subscription",
        "id",
        code="resource_missing",
        http_status=404,
    )
    with patch("billing.stripe_api.cancel_subscription", side_effect=already_gone):
        r = authenticated_client.post("/api/profile/delete-account/", _delete_payload(), format="json")
    assert r.status_code == 200
    assert not User.objects.filter(pk=user.pk).exists()


@stripe_configured
def test_ambiguous_stripe_invalid_request_preserves_account(authenticated_client, user):
    import stripe

    _verify(user)
    billing = get_or_create_billing_subscription(user)
    billing.status = "active"
    billing.plan = BillingSubscription.Plan.PREMIUM
    billing.stripe_subscription_id = "sub_live"
    billing.save()
    ambiguous = stripe.InvalidRequestError(
        "Request failed",
        "id",
        code="parameter_invalid",
        http_status=400,
    )
    with patch("billing.stripe_api.cancel_subscription", side_effect=ambiguous):
        r = authenticated_client.post("/api/profile/delete-account/", _delete_payload(), format="json")
    assert r.status_code == 503
    assert r.json()["code"] == "stripe_cancellation_failed"
    assert User.objects.filter(pk=user.pk).exists()
    billing.refresh_from_db()
    assert billing.stripe_subscription_id == "sub_live"


def test_exclusive_plaid_item_revoked_before_delete(authenticated_client, user, household):
    _verify(user)
    item = PlaidItem.objects.create(
        household=household,
        item_id="item-exclusive",
        access_token_cipher=encrypt_secret("access-sandbox-test"),
        institution_name="Test Bank",
    )
    with patch("plaid_link.plaid_api_client.get_plaid_client") as mock_client:
        api = MagicMock()
        mock_client.return_value = api
        r = authenticated_client.post("/api/profile/delete-account/", _delete_payload(), format="json")
    assert r.status_code == 200, r.data
    api.item_remove.assert_called_once()
    assert not PlaidItem.objects.filter(pk=item.pk).exists()
    assert not User.objects.filter(pk=user.pk).exists()


def test_plaid_revoke_failure_preserves_retryable_state(authenticated_client, user, household):
    _verify(user)
    item = PlaidItem.objects.create(
        household=household,
        item_id="item-fail",
        access_token_cipher=encrypt_secret("access-sandbox-test"),
        institution_name="Test Bank",
    )
    with patch("plaid_link.plaid_api_client.get_plaid_client") as mock_client:
        api = MagicMock()
        api.item_remove.side_effect = RuntimeError("plaid down")
        mock_client.return_value = api
        r = authenticated_client.post("/api/profile/delete-account/", _delete_payload(), format="json")
    assert r.status_code == 503
    assert r.json()["code"] == "plaid_revocation_failed"
    assert User.objects.filter(pk=user.pk).exists()
    assert PlaidItem.objects.filter(pk=item.pk).exists()


def test_shared_plaid_item_not_revoked(authenticated_client, user, household):
    _verify(user)
    membership = HouseholdMembership.objects.get(user=user, household=household)
    membership.role = HouseholdMembership.Role.MEMBER
    membership.save(update_fields=["role"])
    co_owner = User.objects.create_user(username="plaid_owner", password="testpass123")
    HouseholdMembership.objects.create(
        household=household, user=co_owner, role=HouseholdMembership.Role.OWNER
    )
    item = PlaidItem.objects.create(
        household=household,
        item_id="item-shared",
        access_token_cipher=encrypt_secret("access-sandbox-test"),
        institution_name="Shared Bank",
    )
    with patch("plaid_link.plaid_api_client.get_plaid_client") as mock_client:
        r = authenticated_client.post("/api/profile/delete-account/", _delete_payload(), format="json")
    assert r.status_code == 200
    mock_client.assert_not_called()
    assert PlaidItem.objects.filter(pk=item.pk).exists()
    assert Household.objects.filter(pk=household.pk).exists()


def test_deleted_user_jwt_cannot_access_api(user, household):
    _verify(user)
    token = str(RefreshToken.for_user(user).access_token)
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
    assert client.get("/api/profile/").status_code == 200
    authed = APIClient()
    authed.force_authenticate(user=user)
    r = authed.post("/api/profile/delete-account/", _delete_payload(), format="json")
    assert r.status_code == 200
    stale = APIClient()
    stale.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
    denied = stale.get("/api/profile/")
    assert denied.status_code in (401, 403)
