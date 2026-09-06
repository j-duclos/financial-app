"""Decimal mortgage payment estimates for DTI purchase mode."""
from decimal import Decimal
from pathlib import Path

from affordability.services.dti import ProposedHousingInput, money_str
from affordability.services.mortgage import (
    estimate_purchase_housing,
    monthly_from_annual,
    monthly_principal_and_interest,
)

SERVICE_PATH = Path(__file__).resolve().parents[1] / "services" / "mortgage.py"


def _purchase(**overrides):
    data = dict(
        purchase_price=Decimal("400000.00"),
        down_payment_type="percent",
        down_payment_value=Decimal("3.50"),
        annual_interest_rate=Decimal("6.50"),
        loan_term_years=30,
        annual_property_taxes=Decimal("2500.00"),
        annual_homeowners_insurance=Decimal("1440.00"),
        monthly_mortgage_insurance=Decimal("180.00"),
        monthly_hoa_dues=Decimal("67.00"),
        other_required_monthly_housing_costs=Decimal("0.00"),
    )
    data.update(overrides)
    return estimate_purchase_housing(**data)


def test_percent_down_payment_and_annual_costs_are_converted_not_used_as_monthly():
    estimate = _purchase()
    assert estimate.down_payment_amount == Decimal("14000.00")
    assert estimate.down_payment_percent == Decimal("3.50")
    assert estimate.loan_amount == Decimal("386000.00")
    assert estimate.monthly.property_taxes == Decimal("208.33")
    assert estimate.monthly.homeowners_insurance == Decimal("120.00")
    assert estimate.monthly.mortgage_insurance == Decimal("180.00")
    assert estimate.monthly.hoa_dues == Decimal("67.00")
    assert estimate.monthly.principal_and_interest == Decimal("2439.78")
    assert estimate.monthly.principal_and_interest != Decimal("400000.00")
    assert estimate.monthly.property_taxes != Decimal("2500.00")
    payload = estimate.to_dict()
    assert payload["loan_amount"] == "386000.00"
    assert payload["monthly"]["property_taxes"] == "208.33"
    assert isinstance(payload["monthly"]["principal_and_interest"], str)


def test_dollar_down_payment_produces_percent_and_loan_amount():
    estimate = _purchase(down_payment_type="dollars", down_payment_value=Decimal("14000.00"))
    assert estimate.loan_amount == Decimal("386000.00")
    assert estimate.down_payment_percent == Decimal("3.50")
    assert estimate.down_payment_amount == Decimal("14000.00")


def test_zero_interest_divides_loan_by_payment_count():
    estimate = _purchase(annual_interest_rate=Decimal("0.00"))
    assert estimate.number_of_payments == 360
    assert estimate.monthly.principal_and_interest == Decimal("1072.22")


def test_generic_example_principal_and_interest_before_insurance():
    estimate = _purchase(
        annual_homeowners_insurance=Decimal("1500.00"),
        monthly_mortgage_insurance=Decimal("0.00"),
    )
    assert estimate.base_loan_amount == Decimal("386000.00")
    assert estimate.loan_amount == Decimal("386000.00")
    assert estimate.monthly.principal_and_interest == Decimal("2439.78")
    assert estimate.monthly.property_taxes == Decimal("208.33")
    assert estimate.monthly.homeowners_insurance == Decimal("125.00")
    assert estimate.monthly.hoa_dues == Decimal("67.00")
    assert estimate.monthly.mortgage_insurance == Decimal("0.00")
    assert estimate.monthly.total == Decimal("2840.11")


def test_fha_financed_upfront_mip_increases_amortized_loan():
    estimate = _purchase(
        annual_homeowners_insurance=Decimal("1500.00"),
        monthly_mortgage_insurance=Decimal("999.00"),
        loan_estimate_type="fha",
        finance_upfront_mip=True,
    )
    assert estimate.loan_estimate_type == "fha"
    assert estimate.base_loan_amount == Decimal("386000.00")
    assert estimate.upfront_mip_amount == Decimal("6755.00")
    assert estimate.total_financed_loan_amount == Decimal("392755.00")
    assert estimate.loan_amount == Decimal("392755.00")
    assert estimate.monthly.principal_and_interest == monthly_principal_and_interest(
        Decimal("392755.00"), Decimal("6.50"), 360
    )
    assert estimate.monthly.principal_and_interest != Decimal("2439.78")
    assert estimate.estimated_monthly_mip == Decimal("176.92")
    assert estimate.monthly.mortgage_insurance == Decimal("176.92")
    assert estimate.monthly.mortgage_insurance != Decimal("999.00")
    payload = estimate.to_dict()
    assert payload["annual_interest_rate"] == "6.50"
    assert payload["mortgage_insurance_source"] == "fha_mip"


def test_fha_upfront_mip_paid_at_closing_does_not_increase_amortized_balance():
    financed = _purchase(loan_estimate_type="fha", finance_upfront_mip=True)
    closing = _purchase(loan_estimate_type="fha", finance_upfront_mip=False)
    assert closing.base_loan_amount == Decimal("386000.00")
    assert closing.upfront_mip_amount == Decimal("6755.00")
    assert closing.total_financed_loan_amount == Decimal("386000.00")
    assert closing.loan_amount == Decimal("386000.00")
    assert closing.monthly.principal_and_interest == Decimal("2439.78")
    assert closing.monthly.mortgage_insurance == Decimal("176.92")
    assert financed.loan_amount > closing.loan_amount
    assert financed.monthly.principal_and_interest > closing.monthly.principal_and_interest


def test_manual_mode_does_not_apply_fha_mip():
    estimate = _purchase(
        monthly_mortgage_insurance=Decimal("180.00"),
        loan_estimate_type="fixed_rate_manual",
    )
    assert estimate.loan_amount == Decimal("386000.00")
    assert estimate.monthly.mortgage_insurance == Decimal("180.00")
    assert estimate.estimated_monthly_mip is None
    assert estimate.upfront_mip_amount is None
    assert estimate.mortgage_insurance_source == "manual"


def test_fifteen_year_term_differs_from_thirty_year_term():
    thirty = _purchase(loan_term_years=30)
    fifteen = _purchase(loan_term_years=15)
    assert fifteen.number_of_payments == 180
    assert fifteen.monthly.principal_and_interest == Decimal("3362.47")
    assert fifteen.monthly.principal_and_interest != thirty.monthly.principal_and_interest
    assert fifteen.monthly.principal_and_interest > thirty.monthly.principal_and_interest


def test_full_down_payment_has_zero_principal_and_interest():
    estimate = _purchase(down_payment_type="percent", down_payment_value=Decimal("100.00"))
    assert estimate.loan_amount == Decimal("0.00")
    assert estimate.monthly.principal_and_interest == Decimal("0.00")


def test_annual_helpers_do_not_divide_monthly_costs():
    assert monthly_from_annual(Decimal("2500.00")) == Decimal("208.33")
    assert monthly_from_annual(Decimal("1440.00")) == Decimal("120.00")
    assert monthly_principal_and_interest(Decimal("0.00"), Decimal("6.50"), 360) == Decimal("0.00")


def test_source_uses_decimal_not_binary_float_or_hard_coded_down_payment():
    src = SERVICE_PATH.read_text(encoding="utf-8")
    assert "float(" not in src
    assert "MORTGAGE_INTERMEDIATE_PRECISION = 28" in src
    assert "ROUND_HALF_UP" in Path(__file__).resolve().parents[1].joinpath(
        "services", "dti.py"
    ).read_text(encoding="utf-8")
    monthly = ProposedHousingInput(principal_and_interest=Decimal("2439.78"))
    assert money_str(monthly.principal_and_interest) == "2439.78"
