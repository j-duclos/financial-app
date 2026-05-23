from decimal import Decimal
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from core.models import Household, HouseholdMembership
from accounts.models import Account
from transactions.models import Transaction

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


def test_account_balances(authenticated_client, account):
    Transaction.objects.create(
        account=account, date="2025-01-10", payee="X", amount=Decimal("100.00")
    )
    response = authenticated_client.get("/api/insights/account-balances/")
    assert response.status_code == 200
    data = response.json()
    assert len(data["balances"]) == 1
    assert Decimal(str(data["balances"][0]["balance"])) == Decimal("100.00")
