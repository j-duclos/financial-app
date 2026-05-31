from decimal import Decimal
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from core.models import Household, HouseholdMembership
from accounts.models import Account
from categories.models import Category
from transactions.models import Transaction, TransferGroup

User = get_user_model()


def test_monthly_summary(authenticated_client, account):
    Transaction.objects.create(
        account=account, date="2025-01-10", payee="Job", amount=Decimal("2000.00")
    )
    Transaction.objects.create(
        account=account, date="2025-01-12", payee="Shop", amount=Decimal("-80.00")
    )
    response = authenticated_client.get("/api/insights/monthly-summary/?month=2025-01")
    assert response.status_code == 200
    data = response.json()
    assert Decimal(str(data["total_income"])) == Decimal("2000.00")
    assert Decimal(str(data["total_expenses"])) == Decimal("-80.00")
    assert Decimal(str(data["net"])) == Decimal("1920.00")


def test_category_breakdown_excludes_bank_transfers(authenticated_client, account, household):
    transfer_cat = Category.objects.create(
        household=household,
        name="Bank Transfer",
        category_type=Category.CategoryType.EXPENSE,
        sort_order=99,
    )
    groceries = Category.objects.create(
        household=household,
        name="Groceries",
        category_type=Category.CategoryType.EXPENSE,
        sort_order=1,
    )
    tg = TransferGroup.objects.create(
        household=household,
        from_account=account,
        to_account=account,
        amount=Decimal("500.00"),
        scheduled_date="2025-01-05",
    )
    Transaction.objects.create(
        account=account,
        date="2025-01-05",
        payee="Xfer out",
        amount=Decimal("-500.00"),
        category=transfer_cat,
        transfer_group=tg,
    )
    Transaction.objects.create(
        account=account,
        date="2025-01-05",
        payee="Xfer in",
        amount=Decimal("500.00"),
        category=transfer_cat,
        transfer_group=tg,
    )
    Transaction.objects.create(
        account=account,
        date="2025-01-08",
        payee="Store",
        amount=Decimal("-25.00"),
        category=groceries,
    )
    response = authenticated_client.get("/api/insights/category-breakdown/?month=2025-01")
    assert response.status_code == 200
    names = {row["category_name"] for row in response.json()["breakdown"]}
    assert "Bank Transfer" not in names
    assert "Groceries" in names
    groceries_row = next(r for r in response.json()["breakdown"] if r["category_name"] == "Groceries")
    assert Decimal(str(groceries_row["total"])) == Decimal("-25.00")


def test_monthly_summary_excludes_bank_transfers(authenticated_client, account, household):
    transfer_cat = Category.objects.create(
        household=household,
        name="Bank Transfer",
        category_type=Category.CategoryType.EXPENSE,
        sort_order=99,
    )
    tg = TransferGroup.objects.create(
        household=household,
        from_account=account,
        to_account=account,
        amount=Decimal("500.00"),
        scheduled_date="2025-01-05",
    )
    Transaction.objects.create(
        account=account,
        date="2025-01-05",
        payee="Xfer out",
        amount=Decimal("-500.00"),
        category=transfer_cat,
        transfer_group=tg,
    )
    Transaction.objects.create(
        account=account,
        date="2025-01-05",
        payee="Xfer in",
        amount=Decimal("500.00"),
        category=transfer_cat,
        transfer_group=tg,
    )
    Transaction.objects.create(
        account=account, date="2025-01-10", payee="Job", amount=Decimal("2000.00")
    )
    response = authenticated_client.get("/api/insights/monthly-summary/?month=2025-01")
    assert response.status_code == 200
    data = response.json()
    assert Decimal(str(data["total_income"])) == Decimal("2000.00")
    assert Decimal(str(data["total_expenses"])) == Decimal("0")
    assert Decimal(str(data["net"])) == Decimal("2000.00")


def test_account_balances(authenticated_client, account):
    Transaction.objects.create(
        account=account, date="2025-01-10", payee="X", amount=Decimal("100.00")
    )
    response = authenticated_client.get("/api/insights/account-balances/")
    assert response.status_code == 200
    data = response.json()
    assert len(data["balances"]) == 1
    assert Decimal(str(data["balances"][0]["balance"])) == Decimal("100.00")
