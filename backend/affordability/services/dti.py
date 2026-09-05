"""Household DTI planning calculations.

Math lives here — not in serializers or views. Intermediate totals keep full Decimal
precision; only returned percentages (and money presentation strings) are rounded.

Rounding policy:
- Arithmetic uses decimal.Decimal only (no binary floats).
- Intermediate sums and DTI ratios are not rounded.
- Returned money strings are quantized to 0.01 with ROUND_HALF_UP.
- Returned percentage strings are quantized to 0.01 with ROUND_HALF_UP.
- Remaining capacity is clamped to 0 for presentation; signed overage is returned separately.

Formulas:
    gross_monthly_income = sum(included income)
    non_housing_monthly_debt = sum(included effective debt payments in the calculation)
    current_housing_payment = profile.current_housing_payment if include flag else 0
    current_front_end_dti = current_housing_payment / income * 100
    current_back_end_dti = (current_housing_payment + non_housing_monthly_debt) / income * 100
    proposed_total_housing = sum(proposed housing components)
    proposed_front_end_dti = proposed_total_housing / income * 100
    proposed_back_end_dti = (proposed_total_housing + non_housing_monthly_debt) / income * 100

Proposed housing REPLACES current housing; it is never added on top of it.

Capacity at the selected target back-end DTI is a planning estimate, not an approved payment.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from typing import Iterable, Sequence

from django.core.exceptions import ObjectDoesNotExist

MONEY_QUANT = Decimal("0.01")
PERCENT_QUANT = Decimal("0.01")
ZERO = Decimal("0")
HUNDRED = Decimal("100")

STATUS_CALCULATED = "calculated"
STATUS_GROSS_INCOME_REQUIRED = "gross_income_required"

PLANNING_DISCLAIMER = (
    "Planning estimate only. Lender calculations and qualifying rules vary."
)

PAYMENT_SOURCE_LINKED_ACCOUNT_MINIMUM = "linked_account_minimum"

ACCOUNT_TYPE_CREDIT = "CREDIT"
ACCOUNT_STATUS_ACTIVE = "active"

HOUSING_DEBT_TYPES = frozenset({"mortgage", "home_equity"})

WARNING_GROSS_INCOME_REQUIRED = "gross_income_required"
WARNING_NO_INCLUDED_DEBTS = "no_included_debts"
WARNING_CURRENT_HOUSING_EXCLUDED = "current_housing_excluded"
WARNING_PROPOSED_HOUSING_EMPTY = "proposed_housing_empty"
WARNING_LINKED_ACCOUNT_INACTIVE = "linked_account_inactive"
WARNING_LINKED_ACCOUNT_INELIGIBLE = "linked_account_ineligible"
WARNING_LINKED_ACCOUNT_MINIMUM_UNAVAILABLE = "linked_account_minimum_unavailable"
WARNING_LINKED_ACCOUNT_MISSING = "linked_account_missing"
WARNING_LINKED_ACCOUNT_MINIMUM_STALE = "linked_account_minimum_stale"
WARNING_LINKED_ACCOUNT_REAUTHORIZATION_REQUIRED = "linked_account_reauthorization_required"
WARNING_PROVIDER_MINIMUM_ZERO_WITH_BALANCE = "provider_minimum_zero_with_balance"
WARNING_DEBT_PAYMENT_WITHOUT_BALANCE = "debt_payment_without_balance"
WARNING_DEBT_BALANCE_WITHOUT_PAYMENT = "debt_balance_without_payment"
WARNING_POSSIBLE_HOUSING_DOUBLE_COUNT = "possible_housing_double_count"
WARNING_UNKNOWN_EXCLUDED_DEBT_ITEM = "unknown_excluded_debt_item"
WARNING_STUDENT_LOAN_BALANCE_REQUIRED = "student_loan_balance_required"
WARNING_STUDENT_LOAN_STATUS_REQUIRED = "student_loan_status_required"
WARNING_STUDENT_LOAN_ZERO_MANUAL_PAYMENT = "student_loan_zero_manual_payment"
WARNING_STUDENT_LOAN_PAYMENT_UNAVAILABLE = "student_loan_payment_unavailable"
WARNING_STUDENT_LOAN_FHA_ESTIMATE_USED = "student_loan_fha_estimate_used"
WARNING_STUDENT_LOAN_REPORTED_PAYMENT_MAY_BE_MORE_APPROPRIATE = (
    "student_loan_reported_payment_may_be_more_appropriate"
)

DEBT_TYPE_STUDENT_LOAN = "student_loan"
STUDENT_LOAN_METHOD_MANUAL = "manual"
STUDENT_LOAN_METHOD_FHA_DEFERRED = "fha_deferred_balance_percent"
STUDENT_LOAN_STATUS_DEFERRED = "deferred"
STUDENT_LOAN_STATUS_FORBEARANCE = "forbearance"
FHA_DEFERRED_STUDENT_LOAN_PERCENT = Decimal("0.50")
FHA_DEFERRED_STUDENT_LOAN_MULTIPLIER = Decimal("0.005")
FHA_DEFERRED_STUDENT_LOAN_STATUSES = frozenset(
    {STUDENT_LOAN_STATUS_DEFERRED, STUDENT_LOAN_STATUS_FORBEARANCE}
)
PAYMENT_CALC_LABEL_MANUAL = "Manual or reported monthly payment"
PAYMENT_CALC_LABEL_LINKED = "Linked account minimum"
PAYMENT_CALC_LABEL_FHA = "FHA deferred/zero-payment estimate"


def as_decimal(value: Decimal | int | str | None, default: Decimal = ZERO) -> Decimal:
    if value is None or value == "":
        return default
    if isinstance(value, Decimal):
        result = value
    else:
        result = Decimal(str(value))
    if result.is_nan() or result.is_infinite():
        raise ValueError("non-finite decimal in DTI calculation")
    return result


def quantize_money(value: Decimal) -> Decimal:
    return as_decimal(value).quantize(MONEY_QUANT, rounding=ROUND_HALF_UP)


def fha_deferred_student_loan_payment(outstanding_balance: Decimal) -> Decimal:
    """FHA planning estimate: outstanding balance × 0.5% (multiplier 0.005)."""
    return quantize_money(as_decimal(outstanding_balance) * FHA_DEFERRED_STUDENT_LOAN_MULTIPLIER)


def quantize_percent(value: Decimal) -> Decimal:
    return as_decimal(value).quantize(PERCENT_QUANT, rounding=ROUND_HALF_UP)


def money_str(value: Decimal) -> str:
    return str(quantize_money(value))


def percent_str(value: Decimal | None) -> str | None:
    if value is None:
        return None
    return str(quantize_percent(value))


def dti_ratio_percent(numerator: Decimal, income: Decimal) -> Decimal | None:
    """Unrounded DTI percentage. None when income is not positive."""
    if income <= ZERO:
        return None
    return (numerator / income) * HUNDRED


@dataclass(frozen=True)
class DtiWarning:
    code: str
    message: str
    debt_item_id: int | None = None
    linked_account_id: int | None = None

    def to_dict(self) -> dict:
        payload: dict = {"code": self.code, "message": self.message}
        if self.debt_item_id is not None:
            payload["debt_item_id"] = self.debt_item_id
        if self.linked_account_id is not None:
            payload["linked_account_id"] = self.linked_account_id
        return payload


@dataclass(frozen=True)
class LinkedAccountSnapshot:
    id: int
    name: str
    effective_display_name: str
    account_type: str
    status: str
    is_active: bool
    is_hidden: bool
    minimum_payment_amount: Decimal | None
    current_balance: Decimal | None = None
    minimum_payment_source: str | None = None
    minimum_payment_freshness: str | None = None
    minimum_payment_warning: str | None = None
    minimum_payment_warning_code: str | None = None
    provider_minimum_payment_observed_at: str | None = None

    def is_eligible_credit_card(self) -> bool:
        return (
            self.account_type == ACCOUNT_TYPE_CREDIT
            and self.status == ACCOUNT_STATUS_ACTIVE
            and self.is_active
            and not self.is_hidden
        )

    def is_operationally_active(self) -> bool:
        return self.status == ACCOUNT_STATUS_ACTIVE and self.is_active and not self.is_hidden


@dataclass(frozen=True)
class PaymentCalculation:
    method: str
    label: str
    balance: Decimal | None = None
    percentage: Decimal | None = None
    multiplier: Decimal | None = None
    calculated_monthly_payment: Decimal | None = None
    configured_monthly_payment: Decimal | None = None

    def to_dict(self) -> dict:
        payload: dict = {
            "method": self.method,
            "label": self.label,
        }
        if self.balance is not None:
            payload["balance"] = money_str(self.balance)
        if self.percentage is not None:
            payload["percentage"] = str(self.percentage.quantize(PERCENT_QUANT))
        if self.multiplier is not None:
            payload["multiplier"] = str(self.multiplier)
        if self.calculated_monthly_payment is not None:
            payload["calculated_monthly_payment"] = money_str(self.calculated_monthly_payment)
        if self.configured_monthly_payment is not None:
            payload["configured_monthly_payment"] = money_str(self.configured_monthly_payment)
        return payload


@dataclass(frozen=True)
class IncomeInput:
    id: int | None
    name: str
    gross_monthly_amount: Decimal
    income_type: str
    included: bool
    notes: str = ""
    position: int = 0


@dataclass(frozen=True)
class DebtInput:
    id: int | None
    name: str
    debt_type: str
    monthly_payment: Decimal
    payment_source: str
    included: bool
    outstanding_balance: Decimal | None = None
    linked_account: LinkedAccountSnapshot | None = None
    months_remaining: int | None = None
    notes: str = ""
    position: int = 0
    warnings: tuple[DtiWarning, ...] = ()
    effective_monthly_payment: Decimal = ZERO
    student_loan_status: str | None = None
    student_loan_payment_method: str | None = None
    payment_calculation: PaymentCalculation | None = None


@dataclass(frozen=True)
class ProfileInput:
    target_back_end_dti_percent: Decimal
    target_front_end_dti_percent: Decimal | None
    current_housing_payment: Decimal
    current_housing_label: str = ""
    include_current_housing_in_current_dti: bool = True


@dataclass(frozen=True)
class ProposedHousingInput:
    principal_and_interest: Decimal = ZERO
    property_taxes: Decimal = ZERO
    homeowners_insurance: Decimal = ZERO
    mortgage_insurance: Decimal = ZERO
    hoa_dues: Decimal = ZERO
    other_required_housing_costs: Decimal = ZERO

    @property
    def total(self) -> Decimal:
        return (
            self.principal_and_interest
            + self.property_taxes
            + self.homeowners_insurance
            + self.mortgage_insurance
            + self.hoa_dues
            + self.other_required_housing_costs
        )

    def to_dict(self) -> dict:
        return {
            "principal_and_interest": money_str(self.principal_and_interest),
            "property_taxes": money_str(self.property_taxes),
            "homeowners_insurance": money_str(self.homeowners_insurance),
            "mortgage_insurance": money_str(self.mortgage_insurance),
            "hoa_dues": money_str(self.hoa_dues),
            "other_required_housing_costs": money_str(self.other_required_housing_costs),
            "total": money_str(self.total),
        }


@dataclass(frozen=True)
class CreditCardSuggestion:
    account_id: int
    name: str
    effective_display_name: str
    current_balance: Decimal
    minimum_payment_amount: Decimal | None
    minimum_payment_usable: bool
    suggested_debt_type: str = "credit_card"

    def to_dict(self) -> dict:
        return {
            "account_id": self.account_id,
            "name": self.name,
            "effective_display_name": self.effective_display_name,
            "current_balance": money_str(self.current_balance),
            "minimum_payment_amount": (
                money_str(self.minimum_payment_amount)
                if self.minimum_payment_amount is not None
                else None
            ),
            "minimum_payment_usable": self.minimum_payment_usable,
            "suggested_debt_type": self.suggested_debt_type,
        }


@dataclass(frozen=True)
class DtiBucketResult:
    front_end_dti_percent: Decimal | None
    back_end_dti_percent: Decimal | None
    total_monthly_obligations: Decimal
    remaining_capacity_at_target: Decimal
    amount_over_target: Decimal
    housing_payment: Decimal

    def to_dict(self, *, include_housing_breakdown: dict | None = None) -> dict:
        payload = {
            "front_end_dti_percent": percent_str(self.front_end_dti_percent),
            "back_end_dti_percent": percent_str(self.back_end_dti_percent),
            "total_monthly_obligations": money_str(self.total_monthly_obligations),
            "remaining_capacity_at_target": money_str(self.remaining_capacity_at_target),
            "amount_over_target": money_str(self.amount_over_target),
        }
        if include_housing_breakdown is not None:
            payload["housing"] = include_housing_breakdown
        return payload


@dataclass(frozen=True)
class PayoffImpact:
    debt_item_id: int | None
    name: str
    effective_monthly_payment: Decimal
    current_back_end_dti: Decimal | None
    back_end_dti_after_payoff: Decimal | None
    dti_reduction_percentage_points: Decimal | None
    additional_housing_capacity_at_target: Decimal
    linked_account_id: int | None
    warnings: tuple[DtiWarning, ...] = ()

    def to_dict(self) -> dict:
        return {
            "debt_item_id": self.debt_item_id,
            "name": self.name,
            "effective_monthly_payment": money_str(self.effective_monthly_payment),
            "current_back_end_dti": percent_str(self.current_back_end_dti),
            "back_end_dti_after_payoff": percent_str(self.back_end_dti_after_payoff),
            "dti_reduction_percentage_points": percent_str(self.dti_reduction_percentage_points),
            "additional_housing_capacity_at_target": money_str(
                self.additional_housing_capacity_at_target
            ),
            "linked_account_id": self.linked_account_id,
            "warnings": [w.to_dict() for w in self.warnings],
        }


@dataclass
class DtiCalculationResult:
    household_id: int
    status: str
    gross_monthly_income: Decimal
    current_housing_payment: Decimal
    non_housing_monthly_debt: Decimal
    target_back_end_dti_percent: Decimal
    target_front_end_dti_percent: Decimal | None
    current: DtiBucketResult
    proposed: DtiBucketResult | None
    proposed_housing: ProposedHousingInput | None
    target_total_obligation_capacity: Decimal
    max_proposed_housing_payment_at_target: Decimal
    income_sources: tuple[IncomeInput, ...]
    debt_items: tuple[DebtInput, ...]
    debts_in_calculation: tuple[DebtInput, ...]
    payoff_impacts: tuple[PayoffImpact, ...]
    warnings: tuple[DtiWarning, ...]
    credit_card_suggestions: tuple[CreditCardSuggestion, ...] = ()
    disclaimer: str = PLANNING_DISCLAIMER


def is_minimum_usable(amount: Decimal | None) -> bool:
    return amount is not None and amount > ZERO


def linked_account_warnings(
    *,
    debt_item_id: int | None,
    payment_source: str,
    account: LinkedAccountSnapshot | None,
    linked_account_id: int | None = None,
) -> list[DtiWarning]:
    warnings: list[DtiWarning] = []
    account_id = account.id if account is not None else linked_account_id
    if payment_source == PAYMENT_SOURCE_LINKED_ACCOUNT_MINIMUM and account is None:
        warnings.append(
            DtiWarning(
                code=WARNING_LINKED_ACCOUNT_MISSING,
                message="This debt uses a linked-account minimum, but no linked account is available.",
                debt_item_id=debt_item_id,
                linked_account_id=account_id,
            )
        )
        return warnings
    if account is None:
        return warnings
    if not account.is_operationally_active():
        warnings.append(
            DtiWarning(
                code=WARNING_LINKED_ACCOUNT_INACTIVE,
                message="The linked account is inactive, archived, closed, hidden, or deleted.",
                debt_item_id=debt_item_id,
                linked_account_id=account.id,
            )
        )
    if payment_source == PAYMENT_SOURCE_LINKED_ACCOUNT_MINIMUM:
        if not account.is_eligible_credit_card():
            warnings.append(
                DtiWarning(
                    code=WARNING_LINKED_ACCOUNT_INELIGIBLE,
                    message="Linked-account minimums can only be used with an eligible active credit-card account.",
                    debt_item_id=debt_item_id,
                    linked_account_id=account.id,
                )
            )
        if not is_minimum_usable(account.minimum_payment_amount):
            warnings.append(
                DtiWarning(
                    code=WARNING_LINKED_ACCOUNT_MINIMUM_UNAVAILABLE,
                    message="The linked account minimum payment is unavailable or zero.",
                    debt_item_id=debt_item_id,
                    linked_account_id=account.id,
                )
            )
        elif account.minimum_payment_warning_code == "provider_minimum_stale":
            warnings.append(
                DtiWarning(
                    code=WARNING_LINKED_ACCOUNT_MINIMUM_STALE,
                    message=account.minimum_payment_warning
                    or "Last institution minimum is older than the freshness window; refresh recommended.",
                    debt_item_id=debt_item_id,
                    linked_account_id=account.id,
                )
            )
        elif account.minimum_payment_warning_code == "reauthorization_required":
            warnings.append(
                DtiWarning(
                    code=WARNING_LINKED_ACCOUNT_REAUTHORIZATION_REQUIRED,
                    message=account.minimum_payment_warning
                    or "Reconnect this bank login to refresh the institution minimum.",
                    debt_item_id=debt_item_id,
                    linked_account_id=account.id,
                )
            )
        elif account.minimum_payment_warning_code == "provider_minimum_zero_with_balance":
            warnings.append(
                DtiWarning(
                    code=WARNING_PROVIDER_MINIMUM_ZERO_WITH_BALANCE,
                    message=account.minimum_payment_warning
                    or "Plaid reported no required minimum while this account still has a balance.",
                    debt_item_id=debt_item_id,
                    linked_account_id=account.id,
                )
            )
    return warnings


def student_loan_method(debt: DebtInput) -> str:
    method = (debt.student_loan_payment_method or "").strip()
    if debt.debt_type != DEBT_TYPE_STUDENT_LOAN:
        return STUDENT_LOAN_METHOD_MANUAL
    if method == STUDENT_LOAN_METHOD_FHA_DEFERRED:
        return STUDENT_LOAN_METHOD_FHA_DEFERRED
    return STUDENT_LOAN_METHOD_MANUAL


def fha_method_is_applicable(debt: DebtInput) -> bool:
    if debt.debt_type != DEBT_TYPE_STUDENT_LOAN:
        return False
    if student_loan_method(debt) != STUDENT_LOAN_METHOD_FHA_DEFERRED:
        return False
    status = (debt.student_loan_status or "").strip()
    if status not in FHA_DEFERRED_STUDENT_LOAN_STATUSES:
        return False
    if debt.outstanding_balance is None or debt.outstanding_balance <= ZERO:
        return False
    if debt.linked_account is not None:
        return False
    if debt.payment_source == PAYMENT_SOURCE_LINKED_ACCOUNT_MINIMUM:
        return False
    return True


def resolve_effective_monthly_payment(
    *,
    monthly_payment: Decimal,
    payment_source: str,
    account: LinkedAccountSnapshot | None,
    debt: DebtInput | None = None,
) -> Decimal:
    """Effective obligation for DTI.

    linked_account_minimum always reads the account minimum and never falls back
    to the saved monthly_payment (those two values must not drift together).
    FHA deferred student-loan estimates use outstanding_balance × 0.005.
    """
    if debt is not None and fha_method_is_applicable(debt):
        return fha_deferred_student_loan_payment(debt.outstanding_balance or ZERO)
    if payment_source == PAYMENT_SOURCE_LINKED_ACCOUNT_MINIMUM:
        if account is None or account.minimum_payment_amount is None:
            return ZERO
        return as_decimal(account.minimum_payment_amount)
    return as_decimal(monthly_payment)


def _payment_calculation_for(debt: DebtInput, effective: Decimal) -> PaymentCalculation:
    if fha_method_is_applicable(debt):
        balance = as_decimal(debt.outstanding_balance)
        return PaymentCalculation(
            method=STUDENT_LOAN_METHOD_FHA_DEFERRED,
            label=PAYMENT_CALC_LABEL_FHA,
            balance=balance,
            percentage=FHA_DEFERRED_STUDENT_LOAN_PERCENT,
            multiplier=FHA_DEFERRED_STUDENT_LOAN_MULTIPLIER,
            calculated_monthly_payment=effective,
        )
    if debt.payment_source == PAYMENT_SOURCE_LINKED_ACCOUNT_MINIMUM:
        return PaymentCalculation(
            method=PAYMENT_SOURCE_LINKED_ACCOUNT_MINIMUM,
            label=PAYMENT_CALC_LABEL_LINKED,
            configured_monthly_payment=effective,
        )
    return PaymentCalculation(
        method=STUDENT_LOAN_METHOD_MANUAL,
        label=PAYMENT_CALC_LABEL_MANUAL,
        configured_monthly_payment=as_decimal(debt.monthly_payment),
    )


def _student_loan_warnings(debt: DebtInput, effective: Decimal) -> list[DtiWarning]:
    if debt.debt_type != DEBT_TYPE_STUDENT_LOAN:
        return []
    warnings: list[DtiWarning] = []
    method = student_loan_method(debt)
    status = (debt.student_loan_status or "").strip()
    balance = debt.outstanding_balance
    has_balance = balance is not None and balance > ZERO
    if method == STUDENT_LOAN_METHOD_FHA_DEFERRED:
        if not has_balance:
            warnings.append(
                DtiWarning(
                    code=WARNING_STUDENT_LOAN_BALANCE_REQUIRED,
                    message="FHA deferred student-loan estimates require a positive outstanding balance.",
                    debt_item_id=debt.id,
                )
            )
        if status not in FHA_DEFERRED_STUDENT_LOAN_STATUSES:
            warnings.append(
                DtiWarning(
                    code=WARNING_STUDENT_LOAN_STATUS_REQUIRED,
                    message=(
                        "The FHA 0.5% estimate can be used only when the student loan is deferred or in forbearance."
                    ),
                    debt_item_id=debt.id,
                )
            )
        if fha_method_is_applicable(debt):
            warnings.append(
                DtiWarning(
                    code=WARNING_STUDENT_LOAN_FHA_ESTIMATE_USED,
                    message=(
                        "FHA planning estimate: 0.5% of the outstanding balance is used when the "
                        "reported monthly student-loan payment is $0. Actual lender treatment may vary."
                    ),
                    debt_item_id=debt.id,
                )
            )
            if as_decimal(debt.monthly_payment) > ZERO:
                warnings.append(
                    DtiWarning(
                        code=WARNING_STUDENT_LOAN_REPORTED_PAYMENT_MAY_BE_MORE_APPROPRIATE,
                        message=(
                            "This loan has a documented monthly payment. A reported payment may be "
                            "more appropriate than the FHA balance estimate."
                        ),
                        debt_item_id=debt.id,
                    )
                )
    elif status in FHA_DEFERRED_STUDENT_LOAN_STATUSES and has_balance and effective <= ZERO:
        warnings.append(
            DtiWarning(
                code=WARNING_STUDENT_LOAN_ZERO_MANUAL_PAYMENT,
                message=(
                    "This deferred or forbearance student loan uses a $0 monthly payment. "
                    "Select the FHA 0.5% estimate if you want a planning obligation from the balance."
                ),
                debt_item_id=debt.id,
            )
        )
    if has_balance and effective <= ZERO:
        warnings.append(
            DtiWarning(
                code=WARNING_STUDENT_LOAN_PAYMENT_UNAVAILABLE,
                message="This student loan has a positive balance but no usable DTI monthly payment.",
                debt_item_id=debt.id,
            )
        )
    if method == STUDENT_LOAN_METHOD_FHA_DEFERRED and not has_balance:
        # already added balance_required; still flag unavailable payment
        pass
    return warnings


def enrich_debt(debt: DebtInput) -> DebtInput:
    warnings = list(debt.warnings)
    warnings.extend(
        linked_account_warnings(
            debt_item_id=debt.id,
            payment_source=debt.payment_source,
            account=debt.linked_account,
            linked_account_id=debt.linked_account.id if debt.linked_account else None,
        )
    )
    effective = resolve_effective_monthly_payment(
        monthly_payment=debt.monthly_payment,
        payment_source=debt.payment_source,
        account=debt.linked_account,
        debt=debt,
    )
    student_warnings = _student_loan_warnings(debt, effective)
    warnings.extend(student_warnings)
    student_codes = {w.code for w in student_warnings}
    if effective > ZERO and (debt.outstanding_balance is None):
        warnings.append(
            DtiWarning(
                code=WARNING_DEBT_PAYMENT_WITHOUT_BALANCE,
                message="This debt has a monthly payment but no outstanding balance.",
                debt_item_id=debt.id,
                linked_account_id=debt.linked_account.id if debt.linked_account else None,
            )
        )
    if (
        debt.outstanding_balance is not None
        and debt.outstanding_balance > ZERO
        and effective <= ZERO
        and WARNING_STUDENT_LOAN_ZERO_MANUAL_PAYMENT not in student_codes
        and WARNING_STUDENT_LOAN_PAYMENT_UNAVAILABLE not in student_codes
    ):
        warnings.append(
            DtiWarning(
                code=WARNING_DEBT_BALANCE_WITHOUT_PAYMENT,
                message="This debt has an outstanding balance but a zero monthly payment.",
                debt_item_id=debt.id,
                linked_account_id=debt.linked_account.id if debt.linked_account else None,
            )
        )
    return DebtInput(
        id=debt.id,
        name=debt.name,
        debt_type=debt.debt_type,
        monthly_payment=as_decimal(debt.monthly_payment),
        payment_source=debt.payment_source,
        included=debt.included,
        outstanding_balance=(
            as_decimal(debt.outstanding_balance) if debt.outstanding_balance is not None else None
        ),
        linked_account=debt.linked_account,
        months_remaining=debt.months_remaining,
        notes=debt.notes,
        position=debt.position,
        warnings=tuple(warnings),
        effective_monthly_payment=effective,
        student_loan_status=debt.student_loan_status,
        student_loan_payment_method=debt.student_loan_payment_method,
        payment_calculation=_payment_calculation_for(debt, effective),
    )


def _capacity_pair(signed_remaining: Decimal) -> tuple[Decimal, Decimal]:
    if signed_remaining >= ZERO:
        return signed_remaining, ZERO
    return ZERO, -signed_remaining


def _bucket(
    *,
    housing: Decimal,
    non_housing: Decimal,
    income: Decimal,
    target_capacity: Decimal,
) -> DtiBucketResult:
    total = housing + non_housing
    signed = target_capacity - total
    remaining, over = _capacity_pair(signed)
    return DtiBucketResult(
        front_end_dti_percent=dti_ratio_percent(housing, income),
        back_end_dti_percent=dti_ratio_percent(total, income),
        total_monthly_obligations=total,
        remaining_capacity_at_target=remaining,
        amount_over_target=over,
        housing_payment=housing,
    )


def calculate_dti(
    *,
    household_id: int,
    profile: ProfileInput,
    income_sources: Sequence[IncomeInput],
    debt_items: Sequence[DebtInput],
    proposed_housing: ProposedHousingInput | None = None,
    excluded_debt_item_ids: Iterable[int] = (),
    credit_card_suggestions: Sequence[CreditCardSuggestion] = (),
    known_debt_item_ids: Iterable[int] | None = None,
) -> DtiCalculationResult:
    excluded = {int(pk) for pk in excluded_debt_item_ids}
    enriched_debts = tuple(enrich_debt(item) for item in debt_items)
    included_income = [
        item for item in income_sources if item.included
    ]
    gross_monthly_income = sum(
        (as_decimal(item.gross_monthly_amount) for item in included_income),
        ZERO,
    )
    debts_in_calculation = tuple(
        item
        for item in enriched_debts
        if item.included and (item.id is None or item.id not in excluded)
    )
    non_housing = sum(
        (item.effective_monthly_payment for item in debts_in_calculation),
        ZERO,
    )
    saved_housing = as_decimal(profile.current_housing_payment)
    current_housing = (
        saved_housing if profile.include_current_housing_in_current_dti else ZERO
    )
    target_back = as_decimal(profile.target_back_end_dti_percent)
    target_front = (
        as_decimal(profile.target_front_end_dti_percent)
        if profile.target_front_end_dti_percent is not None
        else None
    )
    target_capacity = gross_monthly_income * target_back / HUNDRED
    signed_max_housing = target_capacity - non_housing
    max_housing = signed_max_housing if signed_max_housing > ZERO else ZERO

    current = _bucket(
        housing=current_housing,
        non_housing=non_housing,
        income=gross_monthly_income,
        target_capacity=target_capacity,
    )

    proposed_result: DtiBucketResult | None = None
    if proposed_housing is not None:
        proposed_result = _bucket(
            housing=proposed_housing.total,
            non_housing=non_housing,
            income=gross_monthly_income,
            target_capacity=target_capacity,
        )

    warnings: list[DtiWarning] = []
    if gross_monthly_income <= ZERO:
        warnings.append(
            DtiWarning(
                code=WARNING_GROSS_INCOME_REQUIRED,
                message="Included gross monthly income is required before DTI percentages can be calculated.",
            )
        )
    if not debts_in_calculation:
        warnings.append(
            DtiWarning(
                code=WARNING_NO_INCLUDED_DEBTS,
                message="No included monthly debt obligations are in this calculation.",
            )
        )
    if not profile.include_current_housing_in_current_dti:
        warnings.append(
            DtiWarning(
                code=WARNING_CURRENT_HOUSING_EXCLUDED,
                message="Current housing payment is excluded from current DTI.",
            )
        )
    if proposed_housing is not None and proposed_housing.total <= ZERO:
        warnings.append(
            DtiWarning(
                code=WARNING_PROPOSED_HOUSING_EMPTY,
                message="Proposed housing contains no payment.",
            )
        )
    if (
        profile.include_current_housing_in_current_dti
        and saved_housing > ZERO
        and any(item.debt_type in HOUSING_DEBT_TYPES for item in debts_in_calculation)
    ):
        warnings.append(
            DtiWarning(
                code=WARNING_POSSIBLE_HOUSING_DOUBLE_COUNT,
                message=(
                    "Current housing is included alongside a mortgage or home-equity obligation. "
                    "Confirm the housing payment is not counted twice."
                ),
            )
        )

    known_ids = set(known_debt_item_ids) if known_debt_item_ids is not None else {
        item.id for item in enriched_debts if item.id is not None
    }
    for excluded_id in excluded:
        if excluded_id not in known_ids:
            warnings.append(
                DtiWarning(
                    code=WARNING_UNKNOWN_EXCLUDED_DEBT_ITEM,
                    message="An excluded debt item id was not found on this household.",
                    debt_item_id=excluded_id,
                )
            )

    for item in enriched_debts:
        warnings.extend(item.warnings)

    payoff_impacts: list[PayoffImpact] = []
    for item in debts_in_calculation:
        non_housing_after = non_housing - item.effective_monthly_payment
        total_after = current_housing + non_housing_after
        after_pct = dti_ratio_percent(total_after, gross_monthly_income)
        current_pct = current.back_end_dti_percent
        reduction = None
        if current_pct is not None and after_pct is not None:
            reduction = current_pct - after_pct
        payoff_impacts.append(
            PayoffImpact(
                debt_item_id=item.id,
                name=item.name,
                effective_monthly_payment=item.effective_monthly_payment,
                current_back_end_dti=current_pct,
                back_end_dti_after_payoff=after_pct,
                dti_reduction_percentage_points=reduction,
                additional_housing_capacity_at_target=item.effective_monthly_payment,
                linked_account_id=item.linked_account.id if item.linked_account else None,
                warnings=item.warnings,
            )
        )

    status = (
        STATUS_GROSS_INCOME_REQUIRED
        if gross_monthly_income <= ZERO
        else STATUS_CALCULATED
    )
    return DtiCalculationResult(
        household_id=household_id,
        status=status,
        gross_monthly_income=gross_monthly_income,
        current_housing_payment=current_housing,
        non_housing_monthly_debt=non_housing,
        target_back_end_dti_percent=target_back,
        target_front_end_dti_percent=target_front,
        current=current,
        proposed=proposed_result,
        proposed_housing=proposed_housing,
        target_total_obligation_capacity=target_capacity,
        max_proposed_housing_payment_at_target=max_housing,
        income_sources=tuple(income_sources),
        debt_items=enriched_debts,
        debts_in_calculation=debts_in_calculation,
        payoff_impacts=tuple(payoff_impacts),
        warnings=tuple(warnings),
        credit_card_suggestions=tuple(credit_card_suggestions),
    )


def _serialize_income(item: IncomeInput) -> dict:
    return {
        "id": item.id,
        "name": item.name,
        "gross_monthly_amount": money_str(item.gross_monthly_amount),
        "income_type": item.income_type,
        "included": item.included,
        "notes": item.notes,
        "position": item.position,
    }


def _serialize_linked_account(account: LinkedAccountSnapshot) -> dict:
    return {
        "id": account.id,
        "name": account.name,
        "effective_display_name": account.effective_display_name,
        "account_type": account.account_type,
        "status": account.status,
        "minimum_payment_amount": (
            money_str(account.minimum_payment_amount)
            if account.minimum_payment_amount is not None
            else None
        ),
        "minimum_payment_source": account.minimum_payment_source,
        "minimum_payment_freshness": account.minimum_payment_freshness,
        "minimum_payment_warning": account.minimum_payment_warning,
        "minimum_payment_warning_code": account.minimum_payment_warning_code,
        "provider_minimum_payment_observed_at": account.provider_minimum_payment_observed_at,
    }


def serialize_debt_item(item: DebtInput) -> dict:
    linked = item.linked_account
    return {
        "id": item.id,
        "name": item.name,
        "debt_type": item.debt_type,
        "monthly_payment": money_str(item.monthly_payment),
        "payment_source": item.payment_source,
        "effective_monthly_payment": money_str(item.effective_monthly_payment),
        "outstanding_balance": (
            money_str(item.outstanding_balance) if item.outstanding_balance is not None else None
        ),
        "linked_account_id": linked.id if linked else None,
        "linked_account": _serialize_linked_account(linked) if linked else None,
        "included": item.included,
        "months_remaining": item.months_remaining,
        "notes": item.notes,
        "position": item.position,
        "student_loan_status": item.student_loan_status,
        "student_loan_payment_method": item.student_loan_payment_method,
        "payment_calculation": (
            item.payment_calculation.to_dict() if item.payment_calculation is not None else None
        ),
        "warnings": [w.to_dict() for w in item.warnings],
    }


def serialize_dti_result(result: DtiCalculationResult) -> dict:
    proposed_payload = None
    if result.proposed is not None and result.proposed_housing is not None:
        proposed_payload = result.proposed.to_dict(
            include_housing_breakdown=result.proposed_housing.to_dict()
        )
    return {
        "household_id": result.household_id,
        "status": result.status,
        "inputs": {
            "gross_monthly_income": money_str(result.gross_monthly_income),
            "current_housing_payment": money_str(result.current_housing_payment),
            "non_housing_monthly_debt": money_str(result.non_housing_monthly_debt),
            "target_back_end_dti_percent": money_str(result.target_back_end_dti_percent),
            "target_front_end_dti_percent": (
                money_str(result.target_front_end_dti_percent)
                if result.target_front_end_dti_percent is not None
                else None
            ),
        },
        "current": result.current.to_dict(),
        "proposed": proposed_payload,
        "capacity": {
            "target_total_obligation_capacity": money_str(
                result.target_total_obligation_capacity
            ),
            "max_proposed_housing_payment_at_target": money_str(
                result.max_proposed_housing_payment_at_target
            ),
        },
        "income_sources": [_serialize_income(item) for item in result.income_sources],
        "debt_items": [serialize_debt_item(item) for item in result.debt_items],
        "payoff_impacts": [item.to_dict() for item in result.payoff_impacts],
        "credit_card_suggestions": [item.to_dict() for item in result.credit_card_suggestions],
        "warnings": [w.to_dict() for w in result.warnings],
        "disclaimer": result.disclaimer,
    }


def snapshot_from_account(account) -> LinkedAccountSnapshot:
    from accounts.services.minimum_payment import resolve_effective_minimum_payment

    resolved = resolve_effective_minimum_payment(account)
    current_balance = getattr(account, "current_balance", None)
    observed = None
    if resolved.observed_at is not None:
        observed = resolved.observed_at.isoformat()
    return LinkedAccountSnapshot(
        id=account.id,
        name=account.name,
        effective_display_name=account.effective_display_name,
        account_type=account.account_type,
        status=account.status,
        is_active=bool(account.is_active),
        is_hidden=bool(account.is_hidden),
        minimum_payment_amount=resolved.amount,
        current_balance=as_decimal(current_balance) if current_balance is not None else ZERO,
        minimum_payment_source=resolved.source,
        minimum_payment_freshness=resolved.freshness,
        minimum_payment_warning=resolved.warning_message,
        minimum_payment_warning_code=resolved.warning_code,
        provider_minimum_payment_observed_at=observed,
    )


def income_input_from_model(obj) -> IncomeInput:
    return IncomeInput(
        id=obj.id,
        name=obj.name,
        gross_monthly_amount=as_decimal(obj.gross_monthly_amount),
        income_type=obj.income_type,
        included=bool(obj.included),
        notes=obj.notes or "",
        position=obj.position,
    )


def debt_input_from_model(obj) -> DebtInput:
    account = None
    if obj.linked_account_id:
        try:
            related = obj.linked_account
        except ObjectDoesNotExist:
            related = None
        if related is not None:
            account = snapshot_from_account(related)
    return DebtInput(
        id=obj.id,
        name=obj.name,
        debt_type=obj.debt_type,
        monthly_payment=as_decimal(obj.monthly_payment),
        payment_source=obj.payment_source,
        included=bool(obj.included),
        outstanding_balance=(
            as_decimal(obj.outstanding_balance) if obj.outstanding_balance is not None else None
        ),
        linked_account=account,
        months_remaining=obj.months_remaining,
        notes=obj.notes or "",
        position=obj.position,
        student_loan_status=obj.student_loan_status or None,
        student_loan_payment_method=obj.student_loan_payment_method or None,
    )


def profile_input_from_model(obj) -> ProfileInput:
    return ProfileInput(
        target_back_end_dti_percent=as_decimal(obj.target_back_end_dti_percent),
        target_front_end_dti_percent=(
            as_decimal(obj.target_front_end_dti_percent)
            if obj.target_front_end_dti_percent is not None
            else None
        ),
        current_housing_payment=as_decimal(obj.current_housing_payment),
        current_housing_label=obj.current_housing_label or "",
        include_current_housing_in_current_dti=bool(obj.include_current_housing_in_current_dti),
    )


def default_profile_input() -> ProfileInput:
    from affordability.models import (
        DEFAULT_PLANNING_TARGET_BACK_END_DTI_PERCENT,
        DEFAULT_PLANNING_TARGET_FRONT_END_DTI_PERCENT,
    )

    return ProfileInput(
        target_back_end_dti_percent=DEFAULT_PLANNING_TARGET_BACK_END_DTI_PERCENT,
        target_front_end_dti_percent=DEFAULT_PLANNING_TARGET_FRONT_END_DTI_PERCENT,
        current_housing_payment=ZERO,
        current_housing_label="",
        include_current_housing_in_current_dti=True,
    )


def suggestion_from_account(
    account, *, current_balance: Decimal | None = None
) -> CreditCardSuggestion:
    from accounts.services.minimum_payment import resolve_effective_minimum_payment

    resolved = resolve_effective_minimum_payment(account)
    owed = (
        current_balance
        if current_balance is not None
        else as_decimal(account.current_balance)
    )
    return CreditCardSuggestion(
        account_id=account.id,
        name=account.name,
        effective_display_name=account.effective_display_name,
        current_balance=owed,
        minimum_payment_amount=resolved.amount,
        minimum_payment_usable=is_minimum_usable(resolved.amount),
        suggested_debt_type="credit_card",
    )


def suggestions_from_accounts(accounts) -> list[CreditCardSuggestion]:
    """Suggestion balances match the Accounts page: ledger owed, not the stored snapshot.

    Does not change DTI formulas. The calculate path still avoids the ledger.
    """
    from accounts.services.balances import (
        bulk_signed_ledger_balances,
        credit_owed_from_signed_balance,
    )

    account_list = list(accounts)
    signed = bulk_signed_ledger_balances(account_list) if account_list else {}
    return [
        suggestion_from_account(
            account,
            current_balance=credit_owed_from_signed_balance(signed.get(account.pk, ZERO)),
        )
        for account in account_list
    ]


def load_dti_records(household) -> tuple[ProfileInput, list[IncomeInput], list[DebtInput], list[CreditCardSuggestion]]:
    """Bounded-query load for one household calculation.

    Queries: profile, income sources, debt items (select_related account),
    unlinked active credit cards. Does not read the ledger or forecast.
    """
    from accounts.models import Account
    from affordability.models import DtiDebtItem, DtiIncomeSource, DtiProfile

    profile_obj = DtiProfile.objects.filter(household=household).first()
    profile = profile_input_from_model(profile_obj) if profile_obj else default_profile_input()
    income_sources = [
        income_input_from_model(obj)
        for obj in DtiIncomeSource.objects.filter(household=household).order_by("position", "id")
    ]
    debt_qs = (
        DtiDebtItem.objects.filter(household=household)
        .select_related("linked_account")
        .order_by("position", "id")
    )
    debt_items = [debt_input_from_model(obj) for obj in debt_qs]
    linked_ids = [item.linked_account.id for item in debt_items if item.linked_account is not None]
    suggestion_qs = (
        Account.objects.filter(
            household=household,
            account_type=Account.AccountType.CREDIT,
            status=Account.Status.ACTIVE,
            is_active=True,
            is_hidden=False,
        )
        .exclude(id__in=linked_ids)
        .order_by("position", "name", "id")
    )
    suggestions = [suggestion_from_account(account) for account in suggestion_qs]
    return profile, income_sources, debt_items, suggestions
