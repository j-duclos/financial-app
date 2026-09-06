"""FHA Mortgage Insurance Premium planning rates.

Authoritative source: HUD Mortgagee Letter 2023-05 (February 22, 2023),
effective for case numbers assigned on or after March 20, 2023.

https://www.hud.gov/sites/dfiles/OCHCO/documents/2023-05hsgml.pdf

This module implements the Title II forward-mortgage MIP table from that letter
for a DTI planning estimate. It does not model Hawaiian Homelands (Section 247),
Indian Lands (Section 248), or streamline/simple refinances of mortgages
endorsed on or before May 31, 2009.

The letter set the high-balance MIP threshold to the national conforming loan
limit then in effect ($726,200 in the published table). Subsequent conforming
limits may differ; this planning estimate uses the published ML 2023-05 table.

First-year monthly MIP is estimated as:

    (base_loan_amount × annual_mip_rate) / 12

rounded to cents with ROUND_HALF_UP. It is not an amortization-based monthly
schedule of declining unpaid principal. Duration (11 years vs full term) is
returned for disclosure and is not used to change the first-year monthly amount.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from affordability.services.dti import HUNDRED, as_decimal, quantize_money, quantize_percent

UFMIP_RATE_PERCENT = Decimal("1.75")  # 175 bps of the base loan amount
ML_2023_05_BASE_LOAN_THRESHOLD = Decimal("726200")
ZERO = Decimal("0")
MONTHS_PER_YEAR = Decimal("12")

DURATION_ELEVEN_YEARS = "11 years"
DURATION_MORTGAGE_TERM = "mortgage term"

SOURCE_LABEL = "HUD Mortgagee Letter 2023-05"
SOURCE_URL = "https://www.hud.gov/sites/dfiles/OCHCO/documents/2023-05hsgml.pdf"


@dataclass(frozen=True)
class FhaMipEstimate:
    upfront_mip_rate_percent: Decimal
    upfront_mip_amount: Decimal
    annual_mip_rate_percent: Decimal
    estimated_monthly_mip: Decimal
    annual_mip_duration: str
    ltv_percent: Decimal
    high_balance: bool
    source_label: str = SOURCE_LABEL
    source_url: str = SOURCE_URL
    monthly_mip_method: str = "first_year_initial_base_loan"


def loan_to_value_percent(base_loan_amount: Decimal, purchase_price: Decimal) -> Decimal:
    price = as_decimal(purchase_price)
    if price <= ZERO:
        return ZERO
    return quantize_percent(as_decimal(base_loan_amount) / price * HUNDRED)


def annual_mip_rate_and_duration(
    *,
    loan_term_years: int,
    ltv_percent: Decimal,
    base_loan_amount: Decimal,
) -> tuple[Decimal, str]:
    """Return (annual MIP percent, duration label) from the ML 2023-05 table."""
    high_balance = as_decimal(base_loan_amount) > ML_2023_05_BASE_LOAN_THRESHOLD
    ltv = as_decimal(ltv_percent)
    long_term = int(loan_term_years) > 15
    if long_term:
        if not high_balance:
            if ltv <= Decimal("90"):
                return Decimal("0.50"), DURATION_ELEVEN_YEARS
            if ltv <= Decimal("95"):
                return Decimal("0.50"), DURATION_MORTGAGE_TERM
            return Decimal("0.55"), DURATION_MORTGAGE_TERM
        if ltv <= Decimal("90"):
            return Decimal("0.70"), DURATION_ELEVEN_YEARS
        if ltv <= Decimal("95"):
            return Decimal("0.70"), DURATION_MORTGAGE_TERM
        return Decimal("0.75"), DURATION_MORTGAGE_TERM
    if not high_balance:
        if ltv <= Decimal("90"):
            return Decimal("0.15"), DURATION_ELEVEN_YEARS
        return Decimal("0.40"), DURATION_MORTGAGE_TERM
    if ltv <= Decimal("78"):
        return Decimal("0.15"), DURATION_ELEVEN_YEARS
    if ltv <= Decimal("90"):
        return Decimal("0.40"), DURATION_ELEVEN_YEARS
    return Decimal("0.65"), DURATION_MORTGAGE_TERM


def estimate_fha_mip(
    *,
    purchase_price: Decimal,
    base_loan_amount: Decimal,
    loan_term_years: int,
) -> FhaMipEstimate:
    base = quantize_money(base_loan_amount)
    ltv = loan_to_value_percent(base, purchase_price)
    annual_rate, duration = annual_mip_rate_and_duration(
        loan_term_years=loan_term_years,
        ltv_percent=ltv,
        base_loan_amount=base,
    )
    upfront_amount = quantize_money(base * UFMIP_RATE_PERCENT / HUNDRED)
    monthly_mip = quantize_money(base * annual_rate / HUNDRED / MONTHS_PER_YEAR)
    return FhaMipEstimate(
        upfront_mip_rate_percent=UFMIP_RATE_PERCENT,
        upfront_mip_amount=upfront_amount,
        annual_mip_rate_percent=annual_rate,
        estimated_monthly_mip=monthly_mip,
        annual_mip_duration=duration,
        ltv_percent=ltv,
        high_balance=base > ML_2023_05_BASE_LOAN_THRESHOLD,
    )
