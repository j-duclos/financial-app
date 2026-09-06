"""Purchase-mode DTI calculate API tests."""
from decimal import Decimal

import pytest
from rest_framework.test import APIClient

from accounts.models import Account
from affordability.services.dti import percent_str
from timeline.models import RecurringRule, Scenario
from transactions.models import Transaction

from .test_dti_api import CALC_URL, _add_debt, _add_income, _save_profile

PURCHASE = {
    "purchase_price": "400000.00",
    "down_payment_type": "percent",
    "down_payment_value": "3.50",
    "annual_interest_rate": "6.50",
    "loan_term_years": 30,
    "annual_property_taxes": "2500.00",
    "annual_homeowners_insurance": "1440.00",
    "monthly_mortgage_insurance": "180.00",
    "monthly_hoa_dues": "67.00",
    "other_required_monthly_housing_costs": "0.00",
}


@pytest.fixture
def auth_client(api_client, user):
    api_client.force_authenticate(user=user)
    return api_client


@pytest.fixture
def credit_card(db, household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        role=Account.AccountRole.CREDIT_CARD,
        name="Visa",
        display_name="Everyday Visa",
        credit_limit=Decimal("5000"),
        current_balance=Decimal("2993.00"),
        minimum_payment_amount=Decimal("125.00"),
        currency="USD",
    )


def test_legacy_monthly_proposed_housing_remains_backward_compatible(auth_client, household):
    _save_profile(auth_client, household)
    _add_income(auth_client, household, "10400.00")
    _add_debt(auth_client, household)
    calc = auth_client.post(
        CALC_URL,
        {
            "household_id": household.id,
            "proposed_housing": {
                "principal_and_interest": "2100.00",
                "property_taxes": "250.00",
                "homeowners_insurance": "150.00",
                "mortgage_insurance": "175.00",
                "hoa_dues": "90.00",
                "other_required_housing_costs": "0.00",
            },
        },
        format="json",
    )
    assert calc.status_code == 200, calc.content[:400]
    data = calc.json()
    assert data["proposed_housing_mode"] == "monthly_payment"
    assert data["purchase_estimate"] is None
    assert data["proposed"]["housing"]["total"] == "2765.00"
    assert data["proposed"]["housing"]["principal_and_interest"] in ("2100.00", "2100.0")
    assert data["proposed"]["front_end_dti_percent"] == "26.59"
    assert data["current"]["back_end_dti_percent"] == "46.03"


def test_explicit_monthly_mode_does_not_convert_components(auth_client, household):
    _save_profile(auth_client, household)
    _add_income(auth_client, household, "10400.00")
    _add_debt(auth_client, household)
    calc = auth_client.post(
        CALC_URL,
        {
            "household_id": household.id,
            "proposed_housing_mode": "monthly_payment",
            "proposed_housing": {
                "principal_and_interest": "2130.00",
                "property_taxes": "208.33",
                "homeowners_insurance": "120.00",
                "mortgage_insurance": "180.00",
                "hoa_dues": "67.00",
                "other_required_housing_costs": "0.00",
            },
        },
        format="json",
    )
    assert calc.status_code == 200
    housing = calc.json()["proposed"]["housing"]
    assert Decimal(housing["principal_and_interest"]) == Decimal("2130.00")
    assert Decimal(housing["property_taxes"]) == Decimal("208.33")
    assert Decimal(housing["homeowners_insurance"]) == Decimal("120.00")
    assert Decimal(housing["hoa_dues"]) == Decimal("67.00")


def test_purchase_estimate_feeds_existing_proposed_dti(auth_client, household):
    _save_profile(auth_client, household)
    _add_income(auth_client, household, "10400.00")
    _add_debt(auth_client, household)
    calc = auth_client.post(
        CALC_URL,
        {
            "household_id": household.id,
            "proposed_housing_mode": "purchase",
            "proposed_purchase": PURCHASE,
        },
        format="json",
    )
    assert calc.status_code == 200, calc.content[:500]
    data = calc.json()
    estimate = data["purchase_estimate"]
    assert data["proposed_housing_mode"] == "purchase"
    assert estimate["purchase_price"] == "400000.00"
    assert estimate["down_payment_amount"] == "14000.00"
    assert estimate["down_payment_percent"] == "3.50"
    assert estimate["loan_amount"] == "386000.00"
    assert estimate["loan_term_years"] == 30
    assert estimate["number_of_payments"] == 360
    assert estimate["monthly"]["principal_and_interest"] == "2439.78"
    assert estimate["monthly"]["property_taxes"] == "208.33"
    assert estimate["monthly"]["homeowners_insurance"] == "120.00"
    assert estimate["monthly"]["mortgage_insurance"] == "180.00"
    assert estimate["monthly"]["hoa_dues"] == "67.00"
    housing = data["proposed"]["housing"]
    assert housing == estimate["monthly"]
    assert Decimal(housing["principal_and_interest"]) != Decimal("400000.00")
    assert Decimal(data["inputs"]["non_housing_monthly_debt"]) == Decimal("1687.00")
    total = Decimal(housing["total"])
    assert data["proposed"]["front_end_dti_percent"] == percent_str(
        total / Decimal("10400.00") * Decimal("100")
    )
    assert data["proposed"]["back_end_dti_percent"] == percent_str(
        (total + Decimal("1687.00")) / Decimal("10400.00") * Decimal("100")
    )
    none = auth_client.post(CALC_URL, {"household_id": household.id}, format="json").json()
    assert none["proposed"] is None
    assert none["current"]["back_end_dti_percent"] == data["current"]["back_end_dti_percent"]


def test_purchase_payoff_exclusions_and_no_record_mutation(auth_client, household, credit_card):
    txn_count = Transaction.objects.count()
    rule_count = RecurringRule.objects.count()
    scenario_count = Scenario.objects.count()
    account_count = Account.objects.count()
    min_pay = credit_card.minimum_payment_amount
    _save_profile(auth_client, household)
    _add_income(auth_client, household, "10400.00")
    auto = _add_debt(auth_client, household).json()
    calc = auth_client.post(
        CALC_URL,
        {
            "household_id": household.id,
            "proposed_housing_mode": "purchase",
            "proposed_purchase": PURCHASE,
            "excluded_debt_item_ids": [auto["id"], auto["id"]],
        },
        format="json",
    )
    assert calc.status_code == 200, calc.content[:400]
    data = calc.json()
    assert Decimal(data["inputs"]["non_housing_monthly_debt"]) == Decimal("0.00")
    assert Decimal(data["proposed"]["housing"]["total"]) == Decimal(
        data["purchase_estimate"]["monthly"]["total"]
    )
    credit_card.refresh_from_db()
    assert Transaction.objects.count() == txn_count
    assert RecurringRule.objects.count() == rule_count
    assert Scenario.objects.count() == scenario_count
    assert Account.objects.count() == account_count
    assert credit_card.minimum_payment_amount == min_pay


def test_purchase_validation_rejects_invalid_and_conflicting_payloads(auth_client, household):
    _save_profile(auth_client, household)
    over = auth_client.post(
        CALC_URL,
        {
            "household_id": household.id,
            "proposed_housing_mode": "purchase",
            "proposed_purchase": {**PURCHASE, "down_payment_value": "101.00"},
        },
        format="json",
    )
    assert over.status_code == 400
    assert "down_payment_value" in str(over.json())

    dollars_over = auth_client.post(
        CALC_URL,
        {
            "household_id": household.id,
            "proposed_housing_mode": "purchase",
            "proposed_purchase": {
                **PURCHASE,
                "down_payment_type": "dollars",
                "down_payment_value": "400000.01",
            },
        },
        format="json",
    )
    assert dollars_over.status_code == 400

    negative = auth_client.post(
        CALC_URL,
        {
            "household_id": household.id,
            "proposed_housing_mode": "purchase",
            "proposed_purchase": {**PURCHASE, "annual_property_taxes": "-1.00"},
        },
        format="json",
    )
    assert negative.status_code == 400

    conflict = auth_client.post(
        CALC_URL,
        {
            "household_id": household.id,
            "proposed_housing_mode": "purchase",
            "proposed_purchase": PURCHASE,
            "proposed_housing": {"principal_and_interest": "2100.00"},
        },
        format="json",
    )
    assert conflict.status_code == 400

    monthly_conflict = auth_client.post(
        CALC_URL,
        {
            "household_id": household.id,
            "proposed_housing_mode": "monthly_payment",
            "proposed_housing": {"principal_and_interest": "2100.00"},
            "proposed_purchase": PURCHASE,
        },
        format="json",
    )
    assert monthly_conflict.status_code == 400

    zero_price = auth_client.post(
        CALC_URL,
        {
            "household_id": household.id,
            "proposed_housing_mode": "purchase",
            "proposed_purchase": {**PURCHASE, "purchase_price": "0.00"},
        },
        format="json",
    )
    assert zero_price.status_code == 400

    nan_price = auth_client.post(
        CALC_URL,
        {
            "household_id": household.id,
            "proposed_housing_mode": "purchase",
            "proposed_purchase": {**PURCHASE, "purchase_price": "NaN"},
        },
        format="json",
    )
    assert nan_price.status_code == 400

    infinite = auth_client.post(
        CALC_URL,
        {
            "household_id": household.id,
            "proposed_housing_mode": "purchase",
            "proposed_purchase": {**PURCHASE, "annual_interest_rate": "Infinity"},
        },
        format="json",
    )
    assert infinite.status_code == 400

    bad_term = auth_client.post(
        CALC_URL,
        {
            "household_id": household.id,
            "proposed_housing_mode": "purchase",
            "proposed_purchase": {**PURCHASE, "loan_term_years": 0},
        },
        format="json",
    )
    assert bad_term.status_code == 400

    other = APIClient()
    assert other.post(CALC_URL, {"household_id": household.id}, format="json").status_code in (
        401,
        403,
    )


def test_omitted_mode_with_purchase_payload_and_full_down_payment(auth_client, household):
    _save_profile(auth_client, household)
    _add_income(auth_client, household, "10400.00")
    inferred = auth_client.post(
        CALC_URL,
        {"household_id": household.id, "proposed_purchase": PURCHASE},
        format="json",
    )
    assert inferred.status_code == 200, inferred.content[:400]
    assert inferred.json()["proposed_housing_mode"] == "purchase"
    assert inferred.json()["purchase_estimate"]["loan_amount"] == "386000.00"

    full_down = auth_client.post(
        CALC_URL,
        {
            "household_id": household.id,
            "proposed_housing_mode": "purchase",
            "proposed_purchase": {**PURCHASE, "down_payment_value": "100.00"},
        },
        format="json",
    )
    assert full_down.status_code == 200
    estimate = full_down.json()["purchase_estimate"]
    assert estimate["loan_amount"] == "0.00"
    assert estimate["monthly"]["principal_and_interest"] == "0.00"

    zero_rate = auth_client.post(
        CALC_URL,
        {
            "household_id": household.id,
            "proposed_housing_mode": "purchase",
            "proposed_purchase": {**PURCHASE, "annual_interest_rate": "0.00"},
        },
        format="json",
    )
    assert zero_rate.status_code == 200
    assert zero_rate.json()["purchase_estimate"]["monthly"]["principal_and_interest"] == "1072.22"
    assert zero_rate.json()["purchase_estimate"]["annual_interest_rate"] == "0.00"


def test_blank_interest_rate_cannot_produce_zero_interest_estimate(auth_client, household):
    _save_profile(auth_client, household)
    missing_rate = {key: value for key, value in PURCHASE.items() if key != "annual_interest_rate"}
    missing = auth_client.post(
        CALC_URL,
        {
            "household_id": household.id,
            "proposed_housing_mode": "purchase",
            "proposed_purchase": missing_rate,
        },
        format="json",
    )
    assert missing.status_code == 400
    assert "Enter the estimated annual interest rate." in str(missing.json())

    blank = auth_client.post(
        CALC_URL,
        {
            "household_id": household.id,
            "proposed_housing_mode": "purchase",
            "proposed_purchase": {**PURCHASE, "annual_interest_rate": ""},
        },
        format="json",
    )
    assert blank.status_code == 400
    assert "Enter the estimated annual interest rate." in str(blank.json())


def test_omitted_loan_estimate_type_defaults_to_fixed_rate_manual(auth_client, household):
    _save_profile(auth_client, household)
    _add_income(auth_client, household, "10400.00")
    calc = auth_client.post(
        CALC_URL,
        {
            "household_id": household.id,
            "proposed_housing_mode": "purchase",
            "proposed_purchase": PURCHASE,
        },
        format="json",
    )
    assert calc.status_code == 200
    estimate = calc.json()["purchase_estimate"]
    assert estimate["loan_estimate_type"] == "fixed_rate_manual"
    assert estimate["loan_amount"] == "386000.00"
    assert estimate["monthly"]["mortgage_insurance"] == "180.00"
    assert estimate["estimated_monthly_mip"] is None


def test_generic_example_proposed_dti_and_equation(auth_client, household):
    _save_profile(auth_client, household, current_housing_payment="1800.00")
    _add_income(auth_client, household, "10500.00")
    _add_debt(auth_client, household, monthly_payment="1646.42")
    payload = {
        "purchase_price": "400000.00",
        "down_payment_type": "percent",
        "down_payment_value": "3.50",
        "annual_interest_rate": "6.50",
        "loan_term_years": 30,
        "annual_property_taxes": "2500.00",
        "annual_homeowners_insurance": "1500.00",
        "monthly_hoa_dues": "67.00",
        "loan_estimate_type": "fixed_rate_manual",
    }
    calc = auth_client.post(
        CALC_URL,
        {
            "household_id": household.id,
            "proposed_housing_mode": "purchase",
            "proposed_purchase": payload,
        },
        format="json",
    )
    assert calc.status_code == 200, calc.content[:500]
    data = calc.json()
    estimate = data["purchase_estimate"]
    assert estimate["annual_interest_rate"] == "6.50"
    assert estimate["base_loan_amount"] == "386000.00"
    assert estimate["monthly"]["principal_and_interest"] == "2439.78"
    assert estimate["monthly"]["property_taxes"] == "208.33"
    assert estimate["monthly"]["homeowners_insurance"] == "125.00"
    assert estimate["monthly"]["hoa_dues"] == "67.00"
    assert estimate["monthly"]["mortgage_insurance"] == "0.00"
    assert estimate["monthly"]["total"] == "2840.11"
    assert data["proposed"]["front_end_dti_percent"] == "27.05"
    assert data["proposed"]["back_end_dti_percent"] == "42.73"
    equation = data["proposed_equation"]
    assert equation["estimated_housing_payment"] == "2840.11"
    assert equation["other_included_monthly_debt"] == "1646.42"
    assert equation["total_proposed_obligations"] == "4486.53"
    assert equation["gross_monthly_income"] == "10500.00"
    assert equation["proposed_front_end_dti_percent"] == "27.05"
    assert equation["proposed_back_end_dti_percent"] == "42.73"
    assert Decimal(equation["total_proposed_obligations"]) == Decimal(
        equation["estimated_housing_payment"]
    ) + Decimal(equation["other_included_monthly_debt"])
    none = auth_client.post(CALC_URL, {"household_id": household.id}, format="json").json()
    assert none["current"]["back_end_dti_percent"] == data["current"]["back_end_dti_percent"]
    assert Decimal(data["proposed"]["housing"]["total"]) != Decimal("1800.00") + Decimal("2840.11")


def test_fha_purchase_finances_upfront_mip_and_includes_monthly_mip_once(auth_client, household):
    from affordability.services.mortgage import monthly_principal_and_interest

    _save_profile(auth_client, household)
    _add_income(auth_client, household, "10500.00")
    _add_debt(auth_client, household, monthly_payment="1646.42")
    payload = {
        "purchase_price": "400000.00",
        "down_payment_type": "percent",
        "down_payment_value": "3.50",
        "annual_interest_rate": "6.50",
        "loan_term_years": 30,
        "annual_property_taxes": "2500.00",
        "annual_homeowners_insurance": "1500.00",
        "monthly_hoa_dues": "67.00",
        "loan_estimate_type": "fha",
        "finance_upfront_mip": True,
    }
    calc = auth_client.post(
        CALC_URL,
        {
            "household_id": household.id,
            "proposed_housing_mode": "purchase",
            "proposed_purchase": payload,
        },
        format="json",
    )
    assert calc.status_code == 200, calc.content[:500]
    estimate = calc.json()["purchase_estimate"]
    expected_pi = monthly_principal_and_interest(Decimal("392755.00"), Decimal("6.50"), 360)
    assert estimate["upfront_mip_amount"] == "6755.00"
    assert estimate["total_financed_loan_amount"] == "392755.00"
    assert estimate["estimated_monthly_mip"] == "176.92"
    assert estimate["monthly"]["mortgage_insurance"] == "176.92"
    assert estimate["monthly"]["principal_and_interest"] == str(expected_pi)
    housing_total = Decimal(estimate["monthly"]["total"])
    mi_count = Decimal(estimate["monthly"]["mortgage_insurance"])
    without_mi = housing_total - mi_count
    assert without_mi == (
        Decimal(estimate["monthly"]["principal_and_interest"])
        + Decimal(estimate["monthly"]["property_taxes"])
        + Decimal(estimate["monthly"]["homeowners_insurance"])
        + Decimal(estimate["monthly"]["hoa_dues"])
        + Decimal(estimate["monthly"]["other_required_housing_costs"])
    )
    mixed = auth_client.post(
        CALC_URL,
        {
            "household_id": household.id,
            "proposed_housing_mode": "purchase",
            "proposed_purchase": {**payload, "monthly_mortgage_insurance": "180.00"},
        },
        format="json",
    )
    assert mixed.status_code == 400
    assert "monthly_mortgage_insurance" in str(mixed.json())
