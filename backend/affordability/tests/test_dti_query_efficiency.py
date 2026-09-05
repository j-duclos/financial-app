"""Calculation query count stays bounded as debt items grow."""
from decimal import Decimal

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from accounts.models import Account
from affordability.models import DtiDebtItem, DtiIncomeSource, DtiProfile

WRITE_SQL = ("INSERT", "UPDATE", "DELETE")


@pytest.fixture
def auth_client(api_client, user):
    api_client.force_authenticate(user=user)
    return api_client


def _sql_verb(sql: str) -> str:
    return sql.strip().split(None, 1)[0].upper() if sql.strip() else ""


def _seed(household, n_debts: int) -> None:
    DtiProfile.objects.create(
        household=household,
        current_housing_payment=Decimal("1200.00"),
        target_back_end_dti_percent=Decimal("36.00"),
    )
    DtiIncomeSource.objects.create(
        household=household,
        name="Salary",
        gross_monthly_amount=Decimal("8000.00"),
        income_type="employment",
        included=True,
        position=1,
    )
    for i in range(n_debts):
        card = Account.objects.create(
            household=household,
            account_type=Account.AccountType.CREDIT,
            name=f"Card {i}",
            minimum_payment_amount=Decimal(str(25 + i)),
        )
        DtiDebtItem.objects.create(
            household=household,
            name=f"Card {i}",
            debt_type="credit_card",
            monthly_payment=Decimal("0.00"),
            outstanding_balance=Decimal(str(500 + i)),
            linked_account=card,
            payment_source="linked_account_minimum",
            included=True,
            position=i,
        )


def test_calculate_query_count_does_not_grow_linearly_with_debts(auth_client, household):
    _seed(household, 5)
    connection.queries_log.clear()
    with CaptureQueriesContext(connection) as small:
        res = auth_client.post(
            "/api/affordability/dti/calculate/",
            {"household_id": household.id},
            format="json",
        )
    assert res.status_code == 200, res.content[:400]
    small_count = len(small.captured_queries)
    small_writes = sum(
        1 for q in small.captured_queries if _sql_verb(q["sql"]) in WRITE_SQL
    )
    assert small_writes == 0
    assert small_count <= 20

    household.dti_income_sources.all().delete()
    household.dti_debt_items.all().delete()
    household.dti_profile.delete()
    household.accounts.all().delete()
    _seed(household, 25)

    connection.queries_log.clear()
    with CaptureQueriesContext(connection) as large:
        res = auth_client.post(
            "/api/affordability/dti/calculate/",
            {"household_id": household.id},
            format="json",
        )
    assert res.status_code == 200, res.content[:400]
    large_count = len(large.captured_queries)
    large_writes = sum(
        1 for q in large.captured_queries if _sql_verb(q["sql"]) in WRITE_SQL
    )
    assert large_writes == 0
    assert large_count <= small_count + 2
    assert "timeline_" not in " ".join(q["sql"] for q in large.captured_queries).lower()
    assert "transactions_transaction" not in " ".join(
        q["sql"] for q in large.captured_queries
    ).lower()
