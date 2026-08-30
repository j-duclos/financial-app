"""API contract: Payment Planner numeric fields are finite or explicitly null."""
from datetime import date
from decimal import Decimal
from math import isfinite

import pytest
from rest_framework.test import APIClient

from accounts.models import Account
from transactions.services.posting import post_transaction


def _debt(card, user, amount):
    post_transaction(user, card.id, date.today(), "Charge", -amount)


def _assert_finite_money(raw):
    if raw is None:
        return
    val = Decimal(str(raw))
    assert val.is_finite()
    assert isfinite(float(val))


@pytest.mark.django_db
def test_plan_endpoint_numeric_contract_no_nan_infinity(user, household):
    client = APIClient()
    client.force_authenticate(user=user)
    cards = []
    for name, apr, minimum, bal in [
        ("A", "32.99", "63", "1070.96"),
        ("B", "28.24", "26", "2877.18"),
        ("C", "28.24", "25", "1920.92"),
        ("D", "31.99", "8.28", "8.28"),
    ]:
        card = Account.objects.create(
            household=household,
            account_type=Account.AccountType.CREDIT,
            name=name,
            credit_limit=Decimal("5000"),
            apr=Decimal(apr),
            minimum_payment_amount=Decimal(minimum),
        )
        _debt(card, user, Decimal(bal))
        cards.append(card)

    response = client.get(
        "/api/credit-cards/plan/",
        {"strategy": "avalanche", "mode": "aggressive", "extra_monthly": "150"},
    )
    assert response.status_code == 200
    plan = response.json()

    for field in (
        "total_debt",
        "weighted_apr",
        "monthly_interest_burn",
        "monthly_payment_budget",
        "extra_monthly",
        "total_interest",
        "total_paid",
    ):
        _assert_finite_money(plan[field])

    for field in ("interest_saved_vs_minimums", "total_interest_minimums_only"):
        _assert_finite_money(plan.get(field))

    assert plan["baseline_status"] in ("payoffable", "baseline_not_payoffable")
    assert plan["simulation_status"] in ("debt_free", "non_amortizing", "unresolved")
    assert "NaN" not in str(plan)
    assert "Infinity" not in str(plan)

    for card in plan["cards"]:
        for field in ("balance", "apr", "minimum_payment", "suggested_payment", "interest_this_month"):
            _assert_finite_money(card[field])
        assert card.get("payoff_status") in (
            None,
            "projected",
            "non_amortizing",
            "unresolved",
            "paid_off",
        )


@pytest.mark.django_db
def test_plan_endpoint_defaults_extra_monthly_to_zero(user, household):
    """Omitting extra_monthly must not invent a client-style $150 default."""
    client = APIClient()
    client.force_authenticate(user=user)
    card = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        name="Default Extra",
        credit_limit=Decimal("2000"),
        apr=Decimal("19.99"),
        minimum_payment_amount=Decimal("35"),
    )
    _debt(card, user, Decimal("500"))

    response = client.get("/api/credit-cards/plan/", {"strategy": "avalanche", "mode": "aggressive"})
    assert response.status_code == 200
    plan = response.json()
    assert Decimal(str(plan["extra_monthly"])) == Decimal("0")


@pytest.mark.django_db
def test_plan_endpoint_rejects_invalid_extra_and_lump_account(user, household):
    client = APIClient()
    client.force_authenticate(user=user)
    card = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        name="Validate",
        credit_limit=Decimal("2000"),
        apr=Decimal("19.99"),
        minimum_payment_amount=Decimal("35"),
    )
    _debt(card, user, Decimal("400"))

    bad_extra = client.get(
        "/api/credit-cards/plan/",
        {"strategy": "avalanche", "mode": "aggressive", "extra_monthly": "not-a-number"},
    )
    assert bad_extra.status_code == 400

    bad_lump = client.get(
        "/api/credit-cards/plan/",
        {
            "strategy": "avalanche",
            "mode": "aggressive",
            "lump_sum": "100",
            "lump_sum_account": "99999999",
        },
    )
    assert bad_lump.status_code == 400
