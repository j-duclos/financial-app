"""FHA MIP planning rates from HUD Mortgagee Letter 2023-05."""
from decimal import Decimal
from pathlib import Path

from affordability.services.fha_mip import (
    ML_2023_05_BASE_LOAN_THRESHOLD,
    SOURCE_URL,
    UFMIP_RATE_PERCENT,
    annual_mip_rate_and_duration,
    estimate_fha_mip,
    loan_to_value_percent,
)

SERVICE_PATH = Path(__file__).resolve().parents[1] / "services" / "fha_mip.py"


def test_upfront_mip_is_175_bps_of_base_loan():
    mip = estimate_fha_mip(
        purchase_price=Decimal("400000.00"),
        base_loan_amount=Decimal("386000.00"),
        loan_term_years=30,
    )
    assert UFMIP_RATE_PERCENT == Decimal("1.75")
    assert mip.upfront_mip_rate_percent == Decimal("1.75")
    assert mip.upfront_mip_amount == Decimal("6755.00")
    assert mip.ltv_percent == Decimal("96.50")
    assert mip.annual_mip_rate_percent == Decimal("0.55")
    assert mip.annual_mip_duration == "mortgage term"
    assert mip.estimated_monthly_mip == Decimal("176.92")
    assert mip.monthly_mip_method == "first_year_initial_base_loan"
    assert mip.source_url == SOURCE_URL


def test_gt_15_year_above_95_ltv_uses_55_bps():
    rate, duration = annual_mip_rate_and_duration(
        loan_term_years=30,
        ltv_percent=Decimal("96.50"),
        base_loan_amount=Decimal("386000.00"),
    )
    assert rate == Decimal("0.55")
    assert duration == "mortgage term"


def test_gt_15_year_at_or_below_90_ltv_uses_50_bps_for_11_years():
    rate, duration = annual_mip_rate_and_duration(
        loan_term_years=30,
        ltv_percent=Decimal("90.00"),
        base_loan_amount=Decimal("300000.00"),
    )
    assert rate == Decimal("0.50")
    assert duration == "11 years"


def test_high_balance_gt_15_year_above_95_uses_75_bps():
    rate, duration = annual_mip_rate_and_duration(
        loan_term_years=30,
        ltv_percent=Decimal("96.50"),
        base_loan_amount=ML_2023_05_BASE_LOAN_THRESHOLD + Decimal("1"),
    )
    assert rate == Decimal("0.75")
    assert duration == "mortgage term"


def test_le_15_year_above_90_uses_40_bps():
    rate, duration = annual_mip_rate_and_duration(
        loan_term_years=15,
        ltv_percent=Decimal("96.50"),
        base_loan_amount=Decimal("200000.00"),
    )
    assert rate == Decimal("0.40")
    assert duration == "mortgage term"


def test_monthly_mip_uses_initial_base_loan_not_financed_balance():
    mip = estimate_fha_mip(
        purchase_price=Decimal("400000.00"),
        base_loan_amount=Decimal("386000.00"),
        loan_term_years=30,
    )
    financed = Decimal("386000.00") + mip.upfront_mip_amount
    from_financed = (financed * Decimal("0.55") / Decimal("100") / Decimal("12")).quantize(
        Decimal("0.01")
    )
    assert mip.estimated_monthly_mip != from_financed
    assert mip.estimated_monthly_mip == Decimal("176.92")


def test_ltv_and_source_are_isolated_from_mortgage_formula():
    assert loan_to_value_percent(Decimal("386000.00"), Decimal("400000.00")) == Decimal("96.50")
    src = SERVICE_PATH.read_text(encoding="utf-8")
    assert "2023-05hsgml.pdf" in src
    assert "first_year_initial_base_loan" in src
    assert "float(" not in src
