"""Pure DTI calculation tests. Uses Decimal inputs; asserts rounded percentage strings."""
from decimal import Decimal

from affordability.services.dti import (
    DebtInput,
    IncomeInput,
    LinkedAccountSnapshot,
    ProfileInput,
    ProposedHousingInput,
    WARNING_CURRENT_HOUSING_EXCLUDED,
    WARNING_GROSS_INCOME_REQUIRED,
    WARNING_LINKED_ACCOUNT_INACTIVE,
    WARNING_NO_INCLUDED_DEBTS,
    WARNING_PROPOSED_HOUSING_EMPTY,
    calculate_dti,
    percent_str,
    serialize_dti_result,
)


def _profile(**kwargs) -> ProfileInput:
    data = dict(
        target_back_end_dti_percent=Decimal("47.00"),
        target_front_end_dti_percent=Decimal("31.00"),
        current_housing_payment=Decimal("3100.00"),
        current_housing_label="Rent",
        include_current_housing_in_current_dti=True,
    )
    data.update(kwargs)
    return ProfileInput(**data)


def _income(amount, *, included=True, name="Job", pk=1) -> IncomeInput:
    return IncomeInput(
        id=pk,
        name=name,
        gross_monthly_amount=Decimal(str(amount)),
        income_type="employment",
        included=included,
    )


def _debt(
    payment,
    *,
    pk=1,
    name="Auto",
    included=True,
    debt_type="auto_loan",
    payment_source="manual",
    balance=None,
    account=None,
) -> DebtInput:
    return DebtInput(
        id=pk,
        name=name,
        debt_type=debt_type,
        monthly_payment=Decimal(str(payment)),
        payment_source=payment_source,
        included=included,
        outstanding_balance=Decimal(str(balance)) if balance is not None else None,
        linked_account=account,
    )


def test_current_front_and_back_end_dti_and_capacity():
    result = calculate_dti(
        household_id=1,
        profile=_profile(),
        income_sources=[_income("10400.00")],
        debt_items=[_debt("1687.00", balance="12000.00")],
    )
    payload = serialize_dti_result(result)
    assert payload["status"] == "calculated"
    assert payload["inputs"]["gross_monthly_income"] == "10400.00"
    assert payload["inputs"]["current_housing_payment"] == "3100.00"
    assert payload["inputs"]["non_housing_monthly_debt"] == "1687.00"
    assert payload["current"]["front_end_dti_percent"] == "29.81"
    assert payload["current"]["back_end_dti_percent"] == "46.03"
    assert payload["current"]["total_monthly_obligations"] == "4787.00"
    assert payload["capacity"]["target_total_obligation_capacity"] == "4888.00"
    assert payload["capacity"]["max_proposed_housing_payment_at_target"] == "3201.00"
    assert payload["current"]["remaining_capacity_at_target"] == "101.00"
    assert payload["current"]["amount_over_target"] == "0.00"
    assert payload["proposed"] is None


def test_proposed_housing_sums_and_replaces_current_housing():
    result = calculate_dti(
        household_id=1,
        profile=_profile(),
        income_sources=[_income("10400.00")],
        debt_items=[_debt("1687.00", balance="12000.00")],
        proposed_housing=ProposedHousingInput(
            principal_and_interest=Decimal("2100.00"),
            property_taxes=Decimal("250.00"),
            homeowners_insurance=Decimal("150.00"),
            mortgage_insurance=Decimal("175.00"),
            hoa_dues=Decimal("90.00"),
            other_required_housing_costs=Decimal("0.00"),
        ),
    )
    payload = serialize_dti_result(result)
    assert payload["proposed"]["housing"]["total"] == "2765.00"
    assert payload["proposed"]["front_end_dti_percent"] == "26.59"
    assert payload["proposed"]["back_end_dti_percent"] == "42.81"
    assert payload["proposed"]["total_monthly_obligations"] == "4452.00"
    assert payload["proposed"]["remaining_capacity_at_target"] == "436.00"
    # Replaces current housing (3100) rather than adding 2765 + 3100.
    assert Decimal(payload["proposed"]["total_monthly_obligations"]) == Decimal("4452.00")
    assert Decimal(payload["current"]["total_monthly_obligations"]) == Decimal("4787.00")


def test_zero_income_returns_null_percentages_and_warning():
    result = calculate_dti(
        household_id=1,
        profile=_profile(current_housing_payment=Decimal("1200.00")),
        income_sources=[_income("5000.00", included=False)],
        debt_items=[_debt("400.00", balance="8000.00")],
    )
    payload = serialize_dti_result(result)
    assert payload["status"] == "gross_income_required"
    assert payload["current"]["front_end_dti_percent"] is None
    assert payload["current"]["back_end_dti_percent"] is None
    assert payload["current"]["total_monthly_obligations"] == "1600.00"
    codes = [w["code"] for w in payload["warnings"]]
    assert WARNING_GROSS_INCOME_REQUIRED in codes
    assert payload["current"]["front_end_dti_percent"] != "0.00"


def test_current_housing_exclusion():
    result = calculate_dti(
        household_id=1,
        profile=_profile(include_current_housing_in_current_dti=False),
        income_sources=[_income("10400.00")],
        debt_items=[_debt("1687.00", balance="1")],
    )
    payload = serialize_dti_result(result)
    assert payload["inputs"]["current_housing_payment"] == "0.00"
    assert payload["current"]["front_end_dti_percent"] == "0.00"
    assert payload["current"]["back_end_dti_percent"] == "16.22"
    assert any(w["code"] == WARNING_CURRENT_HOUSING_EXCLUDED for w in payload["warnings"])


def test_negative_remaining_capacity_reports_over_target():
    result = calculate_dti(
        household_id=1,
        profile=_profile(
            target_back_end_dti_percent=Decimal("20.00"),
            current_housing_payment=Decimal("2000.00"),
        ),
        income_sources=[_income("5000.00")],
        debt_items=[_debt("1500.00", balance="9000.00")],
    )
    payload = serialize_dti_result(result)
    # capacity = 1000; obligations = 3500; remaining clamped 0; overage 2500
    assert payload["capacity"]["target_total_obligation_capacity"] == "1000.00"
    assert payload["current"]["remaining_capacity_at_target"] == "0.00"
    assert payload["current"]["amount_over_target"] == "2500.00"
    assert payload["capacity"]["max_proposed_housing_payment_at_target"] == "0.00"


def test_payoff_of_one_debt_reduces_back_end_dti():
    result = calculate_dti(
        household_id=1,
        profile=_profile(),
        income_sources=[_income("10400.00")],
        debt_items=[
            _debt("1000.00", pk=1, name="Auto", balance="8000"),
            _debt("687.00", pk=2, name="Student", balance="14000"),
        ],
    )
    payload = serialize_dti_result(result)
    auto = next(row for row in payload["payoff_impacts"] if row["debt_item_id"] == 1)
    assert auto["effective_monthly_payment"] == "1000.00"
    assert auto["current_back_end_dti"] == payload["current"]["back_end_dti_percent"]
    assert Decimal(auto["back_end_dti_after_payoff"]) < Decimal(auto["current_back_end_dti"])
    auto_impact = next(row for row in result.payoff_impacts if row.debt_item_id == 1)
    assert auto["dti_reduction_percentage_points"] == percent_str(
        auto_impact.dti_reduction_percentage_points
    )
    assert auto["additional_housing_capacity_at_target"] == "1000.00"
    # Paying off removes the full obligation, not a partial balance.
    assert "partial" not in auto["name"].lower()


def test_excluding_several_debts_does_not_change_inputs_objects():
    auto = _debt("400.00", pk=10, name="Auto", balance="1")
    card = _debt("200.00", pk=11, name="Card", balance="1")
    student = _debt("300.00", pk=12, name="Student", balance="1")
    result = calculate_dti(
        household_id=1,
        profile=_profile(current_housing_payment=Decimal("0")),
        income_sources=[_income("10000.00")],
        debt_items=[auto, card, student],
        excluded_debt_item_ids=[10, 12],
    )
    payload = serialize_dti_result(result)
    assert payload["inputs"]["non_housing_monthly_debt"] == "200.00"
    assert [row["id"] for row in payload["debt_items"]] == [10, 11, 12]
    assert all(row["included"] is True for row in payload["debt_items"])
    assert [row["debt_item_id"] for row in payload["payoff_impacts"]] == [11]


def test_linked_account_minimum_uses_account_not_saved_payment():
    account = LinkedAccountSnapshot(
        id=7,
        name="Visa",
        effective_display_name="Everyday Visa",
        account_type="CREDIT",
        status="active",
        is_active=True,
        is_hidden=False,
        minimum_payment_amount=Decimal("125.00"),
        current_balance=Decimal("2993.00"),
    )
    result = calculate_dti(
        household_id=1,
        profile=_profile(current_housing_payment=Decimal("0")),
        income_sources=[_income("5000.00")],
        debt_items=[
            _debt(
                "100.00",
                pk=12,
                name="Credit Card",
                debt_type="credit_card",
                payment_source="linked_account_minimum",
                balance="2993.00",
                account=account,
            )
        ],
    )
    payload = serialize_dti_result(result)
    item = payload["debt_items"][0]
    assert item["monthly_payment"] == "100.00"
    assert item["effective_monthly_payment"] == "125.00"
    assert payload["inputs"]["non_housing_monthly_debt"] == "125.00"
    assert item["linked_account"]["effective_display_name"] == "Everyday Visa"


def test_updating_minimum_changes_calculation_without_copying():
    account = LinkedAccountSnapshot(
        id=7,
        name="Visa",
        effective_display_name="Visa",
        account_type="CREDIT",
        status="active",
        is_active=True,
        is_hidden=False,
        minimum_payment_amount=Decimal("80.00"),
        current_balance=Decimal("2000.00"),
    )
    debt = _debt(
        "100.00",
        pk=1,
        debt_type="credit_card",
        payment_source="linked_account_minimum",
        balance="2000",
        account=account,
    )
    first = calculate_dti(
        household_id=1,
        profile=_profile(current_housing_payment=Decimal("0")),
        income_sources=[_income("4000")],
        debt_items=[debt],
    )
    updated_account = LinkedAccountSnapshot(
        id=7,
        name="Visa",
        effective_display_name="Visa",
        account_type="CREDIT",
        status="active",
        is_active=True,
        is_hidden=False,
        minimum_payment_amount=Decimal("140.00"),
        current_balance=Decimal("2000.00"),
    )
    second = calculate_dti(
        household_id=1,
        profile=_profile(current_housing_payment=Decimal("0")),
        income_sources=[_income("4000")],
        debt_items=[
            _debt(
                "100.00",
                pk=1,
                debt_type="credit_card",
                payment_source="linked_account_minimum",
                balance="2000",
                account=updated_account,
            )
        ],
    )
    assert serialize_dti_result(first)["inputs"]["non_housing_monthly_debt"] == "80.00"
    assert serialize_dti_result(second)["inputs"]["non_housing_monthly_debt"] == "140.00"
    assert serialize_dti_result(second)["debt_items"][0]["monthly_payment"] == "100.00"


def test_inactive_linked_account_warning():
    account = LinkedAccountSnapshot(
        id=7,
        name="Visa",
        effective_display_name="Visa",
        account_type="CREDIT",
        status="archived",
        is_active=False,
        is_hidden=False,
        minimum_payment_amount=Decimal("50.00"),
        current_balance=Decimal("900.00"),
    )
    result = calculate_dti(
        household_id=1,
        profile=_profile(current_housing_payment=Decimal("0")),
        income_sources=[_income("4000")],
        debt_items=[
            _debt(
                "50.00",
                debt_type="credit_card",
                payment_source="linked_account_minimum",
                balance="900",
                account=account,
            )
        ],
    )
    codes = [w.code for w in result.warnings]
    assert WARNING_LINKED_ACCOUNT_INACTIVE in codes


def test_repeating_decimal_percentages_round_half_up_only_at_output():
    result = calculate_dti(
        household_id=1,
        profile=_profile(
            current_housing_payment=Decimal("1000.00"),
            target_back_end_dti_percent=Decimal("36.00"),
        ),
        income_sources=[_income("3000.00")],
        debt_items=[],
    )
    # 1000/3000*100 = 33.333... → 33.33; unrounded ratio is not 33.33
    assert result.current.front_end_dti_percent != Decimal("33.33")
    assert percent_str(result.current.front_end_dti_percent) == "33.33"
    two_thirds = calculate_dti(
        household_id=1,
        profile=_profile(current_housing_payment=Decimal("2.00")),
        income_sources=[_income("3.00")],
        debt_items=[],
    )
    assert percent_str(two_thirds.current.front_end_dti_percent) == "66.67"


def test_proposed_empty_and_no_debts_warnings():
    result = calculate_dti(
        household_id=1,
        profile=_profile(),
        income_sources=[_income("8000")],
        debt_items=[_debt("100", included=False, balance="1")],
        proposed_housing=ProposedHousingInput(),
    )
    codes = [w.code for w in result.warnings]
    assert WARNING_NO_INCLUDED_DEBTS in codes
    assert WARNING_PROPOSED_HOUSING_EMPTY in codes


def test_payoff_does_not_treat_partial_balance_as_removed_payment():
    result = calculate_dti(
        household_id=1,
        profile=_profile(current_housing_payment=Decimal("0")),
        income_sources=[_income("5000")],
        debt_items=[
            _debt(
                "125.00",
                pk=4,
                name="Revolving card",
                debt_type="credit_card",
                balance="50.00",
            )
        ],
    )
    impact = result.payoff_impacts[0]
    assert impact.effective_monthly_payment == Decimal("125.00")
    assert impact.additional_housing_capacity_at_target == Decimal("125.00")
    # A leftover $50 balance still carries the $125 obligation until paid off.
    assert impact.effective_monthly_payment != Decimal("50.00")
