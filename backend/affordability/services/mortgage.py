"""Fixed-rate purchase-payment estimates for DTI proposed housing.

Authoritative mortgage math lives here — not in React. The resulting monthly
components are passed into ``calculate_dti`` unchanged.

Precision policy:
- All arithmetic uses ``decimal.Decimal`` (no binary floats).
- Intermediate rates and ``(1 + monthly_rate) ** n`` keep Decimal precision 28.
- Annual taxes and insurance are divided by 12, then quantized to cents.
- The final monthly principal-and-interest payment is quantized to 0.01 with
  ``ROUND_HALF_UP``.
- Other monthly components are quantized to cents on the way in.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, localcontext

from affordability.services.dti import (
    HUNDRED,
    ProposedHousingInput,
    as_decimal,
    money_str,
    percent_str,
    quantize_money,
    quantize_percent,
)

MORTGAGE_INTERMEDIATE_PRECISION = 28
MONTHS_PER_YEAR = 12
MONTHS_PER_YEAR_DECIMAL = Decimal(MONTHS_PER_YEAR)
ZERO = Decimal("0")
MAX_ANNUAL_INTEREST_RATE = Decimal("50")
MIN_LOAN_TERM_YEARS = 1
MAX_LOAN_TERM_YEARS = 50
STANDARD_LOAN_TERM_YEARS = (10, 15, 20, 25, 30)

DOWN_PAYMENT_DOLLARS = "dollars"
DOWN_PAYMENT_PERCENT = "percent"
PROPOSED_HOUSING_MODE_MONTHLY = "monthly_payment"
PROPOSED_HOUSING_MODE_PURCHASE = "purchase"


@dataclass(frozen=True)
class PurchaseEstimate:
    purchase_price: Decimal
    down_payment_type: str
    down_payment_value: Decimal
    down_payment_amount: Decimal
    down_payment_percent: Decimal
    loan_amount: Decimal
    annual_interest_rate: Decimal
    loan_term_years: int
    number_of_payments: int
    monthly: ProposedHousingInput

    def to_dict(self) -> dict:
        return {
            "purchase_price": money_str(self.purchase_price),
            "down_payment_type": self.down_payment_type,
            "down_payment_value": (
                percent_str(self.down_payment_value)
                if self.down_payment_type == DOWN_PAYMENT_PERCENT
                else money_str(self.down_payment_value)
            ),
            "down_payment_amount": money_str(self.down_payment_amount),
            "down_payment_percent": percent_str(self.down_payment_percent) or "0.00",
            "loan_amount": money_str(self.loan_amount),
            "annual_interest_rate": percent_str(self.annual_interest_rate) or "0.00",
            "loan_term_years": self.loan_term_years,
            "number_of_payments": self.number_of_payments,
            "monthly": self.monthly.to_dict(),
        }


def monthly_from_annual(annual_amount: Decimal) -> Decimal:
    """Divide an annual amount by 12 and round to cents with ROUND_HALF_UP."""
    return quantize_money(as_decimal(annual_amount) / MONTHS_PER_YEAR_DECIMAL)


def monthly_principal_and_interest(
    loan_amount: Decimal,
    annual_interest_rate: Decimal,
    number_of_payments: int,
) -> Decimal:
    """Fixed-rate monthly principal and interest.

    ``monthly_rate = annual_interest_rate / 100 / 12``

    When the annual rate is exactly 0:
        ``loan_amount / number_of_payments``

    Otherwise:
        ``loan_amount * r * (1+r)**n / ((1+r)**n - 1)``
    """
    principal = as_decimal(loan_amount)
    if principal <= ZERO or number_of_payments <= 0:
        return ZERO
    rate = as_decimal(annual_interest_rate)
    with localcontext() as ctx:
        ctx.prec = MORTGAGE_INTERMEDIATE_PRECISION
        monthly_rate = rate / HUNDRED / MONTHS_PER_YEAR_DECIMAL
        if monthly_rate == ZERO:
            raw = principal / Decimal(number_of_payments)
        else:
            growth = (Decimal("1") + monthly_rate) ** number_of_payments
            raw = principal * monthly_rate * growth / (growth - Decimal("1"))
        return quantize_money(raw)


def estimate_purchase_housing(
    *,
    purchase_price: Decimal,
    down_payment_type: str,
    down_payment_value: Decimal,
    annual_interest_rate: Decimal,
    loan_term_years: int,
    annual_property_taxes: Decimal = ZERO,
    annual_homeowners_insurance: Decimal = ZERO,
    monthly_mortgage_insurance: Decimal = ZERO,
    monthly_hoa_dues: Decimal = ZERO,
    other_required_monthly_housing_costs: Decimal = ZERO,
) -> PurchaseEstimate:
    price = quantize_money(purchase_price)
    value = as_decimal(down_payment_value)
    payment_type = (down_payment_type or "").strip()
    if payment_type == DOWN_PAYMENT_PERCENT:
        percent = quantize_percent(value)
        amount = quantize_money(price * percent / HUNDRED)
    else:
        amount = quantize_money(value)
        percent = quantize_percent((amount / price) * HUNDRED) if price > ZERO else ZERO
    loan_amount = quantize_money(price - amount)
    if loan_amount < ZERO:
        loan_amount = ZERO
    n = int(loan_term_years) * MONTHS_PER_YEAR
    principal_and_interest = monthly_principal_and_interest(
        loan_amount, annual_interest_rate, n
    )
    monthly = ProposedHousingInput(
        principal_and_interest=principal_and_interest,
        property_taxes=monthly_from_annual(annual_property_taxes),
        homeowners_insurance=monthly_from_annual(annual_homeowners_insurance),
        mortgage_insurance=quantize_money(monthly_mortgage_insurance),
        hoa_dues=quantize_money(monthly_hoa_dues),
        other_required_housing_costs=quantize_money(other_required_monthly_housing_costs),
    )
    return PurchaseEstimate(
        purchase_price=price,
        down_payment_type=payment_type,
        down_payment_value=(
            quantize_percent(value) if payment_type == DOWN_PAYMENT_PERCENT else amount
        ),
        down_payment_amount=amount,
        down_payment_percent=percent,
        loan_amount=loan_amount,
        annual_interest_rate=quantize_percent(annual_interest_rate),
        loan_term_years=int(loan_term_years),
        number_of_payments=n,
        monthly=monthly,
    )
