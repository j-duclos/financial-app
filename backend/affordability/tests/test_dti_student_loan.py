"""Deferred student-loan FHA 0.5% DTI payment tests."""
from decimal import Decimal
from pathlib import Path

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from accounts.models import Account
from affordability.models import DtiDebtItem
from affordability.services.dti import (
    FHA_DEFERRED_STUDENT_LOAN_MULTIPLIER,
    FHA_DEFERRED_STUDENT_LOAN_PERCENT,
    DebtInput,
    IncomeInput,
    ProfileInput,
    ProposedHousingInput,
    WARNING_STUDENT_LOAN_FHA_ESTIMATE_USED,
    WARNING_STUDENT_LOAN_ZERO_MANUAL_PAYMENT,
    calculate_dti,
    fha_deferred_student_loan_payment,
    quantize_money,
    serialize_dti_result,
)
from core.models import Household, HouseholdMembership
from timeline.models import RecurringRule, Scenario
from transactions.models import Transaction

from .test_dti_api import CALC_URL, DEBT_URL, _add_debt, _add_income, _save_profile

User = get_user_model()

SERVICE_PATH = Path(__file__).resolve().parents[1] / "services" / "dti.py"


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


def _income(amount="10400.00") -> IncomeInput:
    return IncomeInput(
        id=1,
        name="Job",
        gross_monthly_amount=Decimal(str(amount)),
        income_type="employment",
        included=True,
    )


def _fha_student(**kwargs) -> DebtInput:
    data = dict(
        id=12,
        name="Federal student loans",
        debt_type="student_loan",
        monthly_payment=Decimal("0.00"),
        payment_source="manual",
        included=True,
        outstanding_balance=Decimal("109058.00"),
        student_loan_status="deferred",
        student_loan_payment_method="fha_deferred_balance_percent",
    )
    data.update(kwargs)
    return DebtInput(**data)


def _manual_student(**kwargs) -> DebtInput:
    data = dict(
        id=13,
        name="Federal student loans",
        debt_type="student_loan",
        monthly_payment=Decimal("250.00"),
        payment_source="manual",
        included=True,
        outstanding_balance=Decimal("109058.00"),
        student_loan_status="repayment",
        student_loan_payment_method="manual",
    )
    data.update(kwargs)
    return DebtInput(**data)


def test_fha_example_balance_uses_half_percent_not_five_hundredths():
    assert FHA_DEFERRED_STUDENT_LOAN_MULTIPLIER == Decimal("0.005")
    assert FHA_DEFERRED_STUDENT_LOAN_MULTIPLIER != Decimal("0.0005")
    assert FHA_DEFERRED_STUDENT_LOAN_PERCENT == Decimal("0.50")
    assert fha_deferred_student_loan_payment(Decimal("109058.00")) == Decimal("545.29")
    wrong = quantize_money(Decimal("109058.00") * Decimal("0.0005"))
    assert wrong != Decimal("545.29")
    src = SERVICE_PATH.read_text(encoding="utf-8")
    assert 'FHA_DEFERRED_STUDENT_LOAN_MULTIPLIER = Decimal("0.005")' in src
    assert "0.0005" not in src
    assert " * Decimal(\"0.5\")" not in src


def test_fha_half_cent_rounds_half_up():
    assert fha_deferred_student_loan_payment(Decimal("1001.00")) == Decimal("5.01")
    assert fha_deferred_student_loan_payment(Decimal("2001.00")) == Decimal("10.01")


def test_manual_student_loan_uses_entered_monthly_payment():
    result = calculate_dti(
        household_id=1,
        profile=_profile(),
        income_sources=[_income()],
        debt_items=[_manual_student()],
    )
    payload = serialize_dti_result(result)
    item = payload["debt_items"][0]
    assert item["effective_monthly_payment"] == "250.00"
    assert item["payment_calculation"]["method"] == "manual"
    assert payload["inputs"]["non_housing_monthly_debt"] == "250.00"


def test_existing_null_student_loan_method_uses_stored_monthly_payment():
    result = calculate_dti(
        household_id=1,
        profile=_profile(),
        income_sources=[_income()],
        debt_items=[
            _manual_student(
                student_loan_payment_method=None,
                student_loan_status=None,
            )
        ],
    )
    payload = serialize_dti_result(result)
    assert payload["debt_items"][0]["effective_monthly_payment"] == "250.00"
    assert payload["inputs"]["non_housing_monthly_debt"] == "250.00"


def test_repayment_status_does_not_apply_fha_estimate():
    result = calculate_dti(
        household_id=1,
        profile=_profile(),
        income_sources=[_income()],
        debt_items=[
            _fha_student(
                student_loan_status="repayment",
                monthly_payment=Decimal("250.00"),
            )
        ],
    )
    payload = serialize_dti_result(result)
    assert payload["debt_items"][0]["effective_monthly_payment"] == "250.00"
    assert payload["debt_items"][0]["effective_monthly_payment"] != "545.29"


def test_fha_student_loan_is_included_in_non_housing_and_back_end_not_front_end():
    empty = calculate_dti(
        household_id=1,
        profile=_profile(),
        income_sources=[_income()],
        debt_items=[],
    )
    with_loan = calculate_dti(
        household_id=1,
        profile=_profile(),
        income_sources=[_income()],
        debt_items=[_fha_student()],
        proposed_housing=ProposedHousingInput(
            principal_and_interest=Decimal("2100.00"),
            property_taxes=Decimal("250.00"),
            homeowners_insurance=Decimal("150.00"),
            mortgage_insurance=Decimal("175.00"),
            hoa_dues=Decimal("90.00"),
        ),
    )
    empty_payload = serialize_dti_result(empty)
    payload = serialize_dti_result(with_loan)
    assert payload["inputs"]["non_housing_monthly_debt"] == "545.29"
    assert payload["current"]["front_end_dti_percent"] == empty_payload["current"]["front_end_dti_percent"]
    assert Decimal(payload["current"]["back_end_dti_percent"]) > Decimal(
        empty_payload["current"]["back_end_dti_percent"]
    )
    housing_only = calculate_dti(
        household_id=1,
        profile=_profile(),
        income_sources=[_income()],
        debt_items=[],
        proposed_housing=ProposedHousingInput(
            principal_and_interest=Decimal("2100.00"),
            property_taxes=Decimal("250.00"),
            homeowners_insurance=Decimal("150.00"),
            mortgage_insurance=Decimal("175.00"),
            hoa_dues=Decimal("90.00"),
        ),
    )
    housing_payload = serialize_dti_result(housing_only)
    assert payload["proposed"]["front_end_dti_percent"] == housing_payload["proposed"]["front_end_dti_percent"]
    assert Decimal(payload["proposed"]["back_end_dti_percent"]) > Decimal(
        housing_payload["proposed"]["back_end_dti_percent"]
    )
    empty_max = Decimal(empty_payload["capacity"]["max_proposed_housing_payment_at_target"])
    with_max = Decimal(payload["capacity"]["max_proposed_housing_payment_at_target"])
    assert empty_max - with_max == Decimal("545.29")


def test_fha_payoff_impact_removes_calculated_payment_once():
    auto = DebtInput(
        id=1,
        name="Auto",
        debt_type="auto_loan",
        monthly_payment=Decimal("400.00"),
        payment_source="manual",
        included=True,
        outstanding_balance=Decimal("8000.00"),
    )
    student = _fha_student(id=12)
    result = calculate_dti(
        household_id=1,
        profile=_profile(),
        income_sources=[_income()],
        debt_items=[auto, student],
    )
    payload = serialize_dti_result(result)
    impact = next(row for row in payload["payoff_impacts"] if row["debt_item_id"] == 12)
    assert impact["effective_monthly_payment"] == "545.29"
    assert impact["additional_housing_capacity_at_target"] == "545.29"
    excluded = calculate_dti(
        household_id=1,
        profile=_profile(),
        income_sources=[_income()],
        debt_items=[auto, student],
        excluded_debt_item_ids=[12, 12],
    )
    excluded_payload = serialize_dti_result(excluded)
    assert excluded_payload["inputs"]["non_housing_monthly_debt"] == "400.00"
    assert [row["debt_item_id"] for row in excluded_payload["payoff_impacts"]] == [1]


def test_zero_manual_deferred_payment_warns_and_fha_includes_traceability():
    zero_manual = calculate_dti(
        household_id=1,
        profile=_profile(),
        income_sources=[_income()],
        debt_items=[
            _manual_student(
                monthly_payment=Decimal("0.00"),
                student_loan_status="deferred",
                student_loan_payment_method="manual",
            )
        ],
    )
    zero_codes = [w.code for w in zero_manual.warnings]
    assert WARNING_STUDENT_LOAN_ZERO_MANUAL_PAYMENT in zero_codes

    fha = calculate_dti(
        household_id=1,
        profile=_profile(),
        income_sources=[_income()],
        debt_items=[_fha_student()],
    )
    payload = serialize_dti_result(fha)
    item = payload["debt_items"][0]
    calc = item["payment_calculation"]
    assert calc["method"] == "fha_deferred_balance_percent"
    assert calc["balance"] == "109058.00"
    assert calc["percentage"] == "0.50"
    assert calc["multiplier"] == "0.005"
    assert calc["calculated_monthly_payment"] == "545.29"
    assert calc["label"] == "FHA deferred/zero-payment estimate"
    assert isinstance(calc["balance"], str)
    assert isinstance(calc["multiplier"], str)
    assert isinstance(item["effective_monthly_payment"], str)
    assert not isinstance(item["effective_monthly_payment"], float)
    assert WARNING_STUDENT_LOAN_FHA_ESTIMATE_USED in [w.code for w in fha.warnings]


@pytest.fixture
def auth_client(api_client, user):
    api_client.force_authenticate(user=user)
    return api_client


@pytest.fixture
def other_user(db):
    return User.objects.create_user(username="otherstudentdti", password="testpass123")


@pytest.fixture
def other_household(db, other_user):
    h = Household.objects.create(name="Other student DTI Household")
    HouseholdMembership.objects.create(
        household=h, user=other_user, role=HouseholdMembership.Role.OWNER
    )
    return h


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


def _add_fha_student(client, household, **fields):
    payload = dict(
        name="Federal student loans",
        debt_type="student_loan",
        monthly_payment="0.00",
        outstanding_balance="109058.00",
        payment_source="manual",
        student_loan_status="deferred",
        student_loan_payment_method="fha_deferred_balance_percent",
        included=True,
    )
    payload.update(fields)
    return _add_debt(client, household, **payload)


def test_existing_manual_student_loan_rows_keep_null_method_after_migration(db, household):
    item = DtiDebtItem.objects.create(
        household=household,
        name="Federal student loans",
        debt_type=DtiDebtItem.DebtType.STUDENT_LOAN,
        monthly_payment=Decimal("250.00"),
        outstanding_balance=Decimal("80000.00"),
        payment_source=DtiDebtItem.PaymentSource.MANUAL,
        included=True,
        position=1,
    )
    item.refresh_from_db()
    assert item.student_loan_payment_method is None
    assert item.student_loan_status is None
    assert item.monthly_payment == Decimal("250.00")
    assert item.student_loan_payment_method != "fha_deferred_balance_percent"


def test_student_loan_migration_is_reversible():
    import importlib

    module = importlib.import_module("affordability.migrations.0002_dti_student_loan_payment_method")
    assert module.Migration.operations
    for operation in module.Migration.operations:
        assert getattr(operation, "reversible", True)


def test_api_fha_student_loan_calculation_and_traceability(auth_client, household):
    _save_profile(auth_client, household)
    _add_income(auth_client, household, "10400.00")
    created = _add_fha_student(auth_client, household)
    assert created.status_code == 201, created.content[:500]
    data = created.json()
    assert data["effective_monthly_payment"] in ("545.29", "545.290")
    assert data["payment_calculation"]["multiplier"] == "0.005"
    assert data["payment_calculation"]["percentage"] == "0.50"
    assert data["payment_calculation"]["calculated_monthly_payment"] in ("545.29", "545.290")
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
            },
        },
        format="json",
    )
    assert calc.status_code == 200, calc.content[:500]
    body = calc.json()
    assert body["inputs"]["non_housing_monthly_debt"] in ("545.29", "545.290")
    empty = calculate_dti(
        household_id=household.id,
        profile=_profile(),
        income_sources=[_income()],
        debt_items=[],
        proposed_housing=ProposedHousingInput(
            principal_and_interest=Decimal("2100.00"),
            property_taxes=Decimal("250.00"),
            homeowners_insurance=Decimal("150.00"),
            mortgage_insurance=Decimal("175.00"),
            hoa_dues=Decimal("90.00"),
        ),
    )
    empty_payload = serialize_dti_result(empty)
    assert body["current"]["front_end_dti_percent"] == empty_payload["current"]["front_end_dti_percent"]
    assert body["proposed"]["front_end_dti_percent"] == empty_payload["proposed"]["front_end_dti_percent"]
    assert Decimal(body["current"]["back_end_dti_percent"]) > Decimal(
        empty_payload["current"]["back_end_dti_percent"]
    )
    assert Decimal(body["proposed"]["back_end_dti_percent"]) > Decimal(
        empty_payload["proposed"]["back_end_dti_percent"]
    )
    empty_max = Decimal(empty_payload["capacity"]["max_proposed_housing_payment_at_target"])
    with_max = Decimal(body["capacity"]["max_proposed_housing_payment_at_target"])
    assert empty_max - with_max == Decimal("545.29")
    impact = next(row for row in body["payoff_impacts"] if row["debt_item_id"] == data["id"])
    assert Decimal(impact["additional_housing_capacity_at_target"]) == Decimal("545.29")
    assert isinstance(body["debt_items"][0]["effective_monthly_payment"], str)


def test_fha_method_rejected_for_non_student_and_unsupported_status(auth_client, household):
    auto = _add_debt(
        auth_client,
        household,
        student_loan_payment_method="fha_deferred_balance_percent",
        student_loan_status="deferred",
    )
    assert auto.status_code == 400
    assert "student_loan_payment_method" in auto.json()

    repayment = _add_fha_student(auth_client, household, student_loan_status="repayment")
    assert repayment.status_code == 400
    assert "student_loan_status" in repayment.json()

    unknown = _add_fha_student(auth_client, household, student_loan_status="unknown")
    assert unknown.status_code == 400
    assert "student_loan_status" in unknown.json()

    zero = _add_fha_student(auth_client, household, outstanding_balance="0.00")
    assert zero.status_code == 400
    assert "outstanding_balance" in zero.json()

    missing = _add_fha_student(auth_client, household, outstanding_balance=None)
    assert missing.status_code == 400
    assert "outstanding_balance" in missing.json()


def test_fha_method_cannot_use_linked_credit_card(auth_client, household, credit_card):
    created = _add_fha_student(
        auth_client,
        household,
        linked_account_id=credit_card.id,
    )
    assert created.status_code == 400
    assert "linked_account_id" in created.json() or "student_loan_payment_method" in created.json()

    linked_source = _add_fha_student(
        auth_client,
        household,
        payment_source="linked_account_minimum",
        linked_account_id=credit_card.id,
        debt_type="student_loan",
    )
    assert linked_source.status_code == 400


def test_switching_type_clears_student_fields_and_manual_switch_requires_payment(
    auth_client, household
):
    created = _add_fha_student(auth_client, household)
    assert created.status_code == 201, created.content[:400]
    pk = created.json()["id"]

    rejected = auth_client.patch(
        f"{DEBT_URL}{pk}/",
        {"debt_type": "auto_loan"},
        format="json",
    )
    assert rejected.status_code == 400
    assert "student_loan_payment_method" in rejected.json()

    cleared = auth_client.patch(
        f"{DEBT_URL}{pk}/",
        {
            "debt_type": "auto_loan",
            "student_loan_status": None,
            "student_loan_payment_method": None,
            "monthly_payment": "412.00",
        },
        format="json",
    )
    assert cleared.status_code == 200, cleared.content[:400]
    assert cleared.json()["student_loan_status"] is None
    assert cleared.json()["student_loan_payment_method"] is None

    restored = auth_client.patch(
        f"{DEBT_URL}{pk}/",
        {
            "debt_type": "student_loan",
            "student_loan_status": "deferred",
            "student_loan_payment_method": "fha_deferred_balance_percent",
            "outstanding_balance": "109058.00",
        },
        format="json",
    )
    assert restored.status_code == 200, restored.content[:400]
    missing_payment = auth_client.patch(
        f"{DEBT_URL}{pk}/",
        {"student_loan_payment_method": "manual"},
        format="json",
    )
    assert missing_payment.status_code == 400
    assert "monthly_payment" in missing_payment.json()
    switched = auth_client.patch(
        f"{DEBT_URL}{pk}/",
        {"student_loan_payment_method": "manual", "monthly_payment": "250.00"},
        format="json",
    )
    assert switched.status_code == 200, switched.content[:400]
    assert Decimal(switched.json()["effective_monthly_payment"]) == Decimal("250.00")


def test_custom_fha_percentage_cannot_be_supplied(auth_client, household):
    created = auth_client.post(
        DEBT_URL,
        {
            "household_id": household.id,
            "name": "Federal student loans",
            "debt_type": "student_loan",
            "monthly_payment": "0.00",
            "outstanding_balance": "109058.00",
            "payment_source": "manual",
            "student_loan_status": "deferred",
            "student_loan_payment_method": "fha_deferred_balance_percent",
            "percentage": "1.00",
            "fha_percent": "5.00",
            "multiplier": "0.05",
        },
        format="json",
    )
    assert created.status_code == 201, created.content[:400]
    calc = created.json()["payment_calculation"]
    assert calc["multiplier"] == "0.005"
    assert calc["percentage"] == "0.50"
    assert Decimal(created.json()["effective_monthly_payment"]) == Decimal("545.29")


def test_existing_clients_can_omit_student_loan_fields(auth_client, household):
    created = _add_debt(
        auth_client,
        household,
        name="Federal student loans",
        debt_type="student_loan",
        monthly_payment="250.00",
        outstanding_balance="80000.00",
        payment_source="manual",
    )
    assert created.status_code == 201, created.content[:400]
    assert Decimal(created.json()["effective_monthly_payment"]) == Decimal("250.00")
    auto = _add_debt(auth_client, household, name="Car")
    assert auto.status_code == 201
    assert auto.json()["student_loan_status"] is None
    assert auto.json()["student_loan_payment_method"] is None


def test_student_loan_calculate_does_not_mutate_records_or_other_household(
    auth_client, household, credit_card, other_household, other_user
):
    txn_count = Transaction.objects.count()
    rule_count = RecurringRule.objects.count()
    scenario_count = Scenario.objects.count()
    account_count = Account.objects.count()
    min_pay = credit_card.minimum_payment_amount
    _save_profile(auth_client, household)
    _add_income(auth_client, household, "10400.00")
    created = _add_fha_student(auth_client, household)
    assert created.status_code == 201
    calc = auth_client.post(CALC_URL, {"household_id": household.id}, format="json")
    assert calc.status_code == 200
    credit_card.refresh_from_db()
    assert Transaction.objects.count() == txn_count
    assert RecurringRule.objects.count() == rule_count
    assert Scenario.objects.count() == scenario_count
    assert Account.objects.count() == account_count
    assert credit_card.minimum_payment_amount == min_pay

    other_client = APIClient()
    other_client.force_authenticate(user=other_user)
    foreign = _add_fha_student(other_client, other_household, name="Other loans")
    assert foreign.status_code == 201
    assert auth_client.get(f"{DEBT_URL}{foreign.json()['id']}/").status_code == 404
    assert (
        auth_client.patch(
            f"{DEBT_URL}{foreign.json()['id']}/",
            {"included": False},
            format="json",
        ).status_code
        == 404
    )
    assert auth_client.post(
        CALC_URL, {"household_id": other_household.id}, format="json"
    ).status_code == 400


def test_forbearance_is_supported_for_fha_method(auth_client, household):
    created = _add_fha_student(auth_client, household, student_loan_status="forbearance")
    assert created.status_code == 201, created.content[:400]
    assert Decimal(created.json()["effective_monthly_payment"]) == Decimal("545.29")
