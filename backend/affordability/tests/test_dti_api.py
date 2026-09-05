"""DTI profile, CRUD, validation, and calculate API tests."""
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from accounts.models import Account
from affordability.models import DtiDebtItem, DtiIncomeSource, DtiProfile
from core.models import Household, HouseholdMembership
from timeline.models import RecurringRule, Scenario
from transactions.models import Transaction

User = get_user_model()

PROFILE_URL = "/api/affordability/dti/profile/"
INCOME_URL = "/api/affordability/dti/income-sources/"
DEBT_URL = "/api/affordability/dti/debt-items/"
CALC_URL = "/api/affordability/dti/calculate/"
SUGGEST_URL = "/api/affordability/dti/credit-card-suggestions/"


@pytest.fixture
def auth_client(api_client, user):
    api_client.force_authenticate(user=user)
    return api_client


@pytest.fixture
def other_user(db):
    return User.objects.create_user(username="otherdti", password="testpass123")


@pytest.fixture
def other_household(db, other_user):
    h = Household.objects.create(name="Other DTI Household")
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


@pytest.fixture
def checking(db, household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Checking",
        currency="USD",
    )


def _save_profile(client, household, **fields):
    payload = {
        "target_back_end_dti_percent": "47.00",
        "target_front_end_dti_percent": "31.00",
        "current_housing_payment": "3100.00",
        "current_housing_label": "Rent",
        "include_current_housing_in_current_dti": True,
    }
    payload.update(fields)
    return client.put(f"{PROFILE_URL}?household_id={household.id}", payload, format="json")


def _add_income(client, household, amount="10400.00", **fields):
    payload = {
        "household_id": household.id,
        "name": "Salary",
        "gross_monthly_amount": amount,
        "income_type": "employment",
        "included": True,
    }
    payload.update(fields)
    return client.post(INCOME_URL, payload, format="json")


def _add_debt(client, household, **fields):
    payload = {
        "household_id": household.id,
        "name": "Auto loan",
        "debt_type": "auto_loan",
        "monthly_payment": "1687.00",
        "outstanding_balance": "12000.00",
        "payment_source": "manual",
        "included": True,
    }
    payload.update(fields)
    return client.post(DEBT_URL, payload, format="json")


def test_profile_created_and_retrieved(auth_client, household):
    get_unsaved = auth_client.get(PROFILE_URL, {"household_id": household.id})
    assert get_unsaved.status_code == 200
    assert get_unsaved.json()["is_saved"] is False
    assert get_unsaved.json()["id"] is None
    assert DtiProfile.objects.count() == 0

    saved = _save_profile(auth_client, household)
    assert saved.status_code == 200
    assert saved.json()["is_saved"] is True
    assert saved.json()["current_housing_payment"] in ("3100.00", "3100.0")
    again = auth_client.get(PROFILE_URL, {"household_id": household.id})
    assert again.json()["id"] == saved.json()["id"]
    assert DtiProfile.objects.filter(household=household).count() == 1


def test_profile_values_can_be_updated(auth_client, household):
    _save_profile(auth_client, household)
    updated = _save_profile(
        auth_client,
        household,
        current_housing_payment="2800.00",
        include_current_housing_in_current_dti=False,
    )
    assert updated.status_code == 200
    data = updated.json()
    assert Decimal(data["current_housing_payment"]) == Decimal("2800.00")
    assert data["include_current_housing_in_current_dti"] is False


def test_income_sources_crud_order_include_exclude(auth_client, household):
    first = _add_income(auth_client, household, "5400.00", name="Job A")
    second = _add_income(auth_client, household, "5000.00", name="Job B", position=0)
    assert first.status_code == 201
    assert second.status_code == 201
    listed = auth_client.get(INCOME_URL, {"household_id": household.id})
    assert listed.status_code == 200
    names = [row["name"] for row in listed.json()]
    assert names[0] == "Job B"
    pk = first.json()["id"]
    patched = auth_client.patch(
        f"{INCOME_URL}{pk}/",
        {"included": False, "gross_monthly_amount": "5600.00"},
        format="json",
    )
    assert patched.status_code == 200
    assert patched.json()["included"] is False
    assert Decimal(patched.json()["gross_monthly_amount"]) == Decimal("5600.00")
    deleted = auth_client.delete(f"{INCOME_URL}{pk}/")
    assert deleted.status_code == 204
    assert DtiIncomeSource.objects.filter(pk=pk).count() == 0


def test_debt_items_created_and_updated(auth_client, household):
    created = _add_debt(auth_client, household)
    assert created.status_code == 201
    pk = created.json()["id"]
    patched = auth_client.patch(
        f"{DEBT_URL}{pk}/",
        {"monthly_payment": "1500.00", "included": False},
        format="json",
    )
    assert patched.status_code == 200
    assert Decimal(patched.json()["monthly_payment"]) == Decimal("1500.00")
    assert patched.json()["included"] is False


def test_manual_payment_source_uses_saved_monthly_payment(auth_client, household, credit_card):
    created = _add_debt(
        auth_client,
        household,
        name="Card manual",
        debt_type="credit_card",
        monthly_payment="90.00",
        payment_source="manual",
        linked_account_id=credit_card.id,
    )
    assert created.status_code == 201
    assert created.json()["effective_monthly_payment"] in ("90.00", "90.0")
    calc = auth_client.post(CALC_URL, {"household_id": household.id}, format="json")
    item = calc.json()["debt_items"][0]
    assert Decimal(item["effective_monthly_payment"]) == Decimal("90.00")
    assert Decimal(item["monthly_payment"]) == Decimal("90.00")


def test_linked_account_minimum_uses_account_minimum(auth_client, household, credit_card):
    created = _add_debt(
        auth_client,
        household,
        name="Credit Card",
        debt_type="credit_card",
        monthly_payment="100.00",
        payment_source="linked_account_minimum",
        linked_account_id=credit_card.id,
        outstanding_balance="2993.00",
    )
    assert created.status_code == 201
    data = created.json()
    assert Decimal(data["monthly_payment"]) == Decimal("100.00")
    assert Decimal(data["effective_monthly_payment"]) == Decimal("125.00")
    assert data["linked_account"]["effective_display_name"] == "Everyday Visa"


def test_updating_account_minimum_changes_next_calculation(auth_client, household, credit_card):
    _add_income(auth_client, household, "5000.00")
    created = _add_debt(
        auth_client,
        household,
        name="Credit Card",
        debt_type="credit_card",
        monthly_payment="100.00",
        payment_source="linked_account_minimum",
        linked_account_id=credit_card.id,
        outstanding_balance="2993.00",
    )
    first = auth_client.post(CALC_URL, {"household_id": household.id}, format="json")
    assert Decimal(first.json()["inputs"]["non_housing_monthly_debt"]) == Decimal("125.00")
    credit_card.minimum_payment_amount = Decimal("140.00")
    credit_card.save(update_fields=["minimum_payment_amount", "updated_at"])
    second = auth_client.post(CALC_URL, {"household_id": household.id}, format="json")
    assert Decimal(second.json()["inputs"]["non_housing_monthly_debt"]) == Decimal("140.00")
    saved = DtiDebtItem.objects.get(pk=created.json()["id"])
    assert saved.monthly_payment == Decimal("100.00")


def test_cross_household_linked_account_rejected(
    auth_client, household, other_household, other_user
):
    foreign_card = Account.objects.create(
        household=other_household,
        account_type=Account.AccountType.CREDIT,
        name="Foreign card",
        minimum_payment_amount=Decimal("40.00"),
    )
    res = _add_debt(
        auth_client,
        household,
        name="Stolen link",
        debt_type="credit_card",
        payment_source="linked_account_minimum",
        linked_account_id=foreign_card.id,
    )
    assert res.status_code == 400


def test_non_credit_account_cannot_use_linked_minimum(auth_client, household, checking):
    res = _add_debt(
        auth_client,
        household,
        name="Checking min",
        payment_source="linked_account_minimum",
        linked_account_id=checking.id,
    )
    assert res.status_code == 400


def test_duplicate_linked_account_debt_rejected(auth_client, household, credit_card):
    first = _add_debt(
        auth_client,
        household,
        name="Card 1",
        debt_type="credit_card",
        payment_source="linked_account_minimum",
        linked_account_id=credit_card.id,
    )
    assert first.status_code == 201
    second = _add_debt(
        auth_client,
        household,
        name="Card 2",
        debt_type="credit_card",
        payment_source="linked_account_minimum",
        linked_account_id=credit_card.id,
    )
    assert second.status_code == 400


def test_negative_money_values_rejected(auth_client, household):
    assert _save_profile(auth_client, household, current_housing_payment="-1.00").status_code == 400
    assert _add_income(auth_client, household, "-10.00").status_code == 400
    assert _add_debt(auth_client, household, monthly_payment="-5.00").status_code == 400
    assert _add_debt(auth_client, household, outstanding_balance="-1.00").status_code == 400


def test_invalid_target_percentages_rejected(auth_client, household):
    assert _save_profile(auth_client, household, target_back_end_dti_percent="0").status_code == 400
    assert _save_profile(auth_client, household, target_back_end_dti_percent="100.01").status_code == 400
    assert _save_profile(auth_client, household, target_front_end_dti_percent="-1").status_code == 400
    calc = auth_client.post(
        CALC_URL,
        {"household_id": household.id, "target_back_end_dti_percent": "0"},
        format="json",
    )
    assert calc.status_code == 400


def test_calculate_current_and_proposed_dti(auth_client, household):
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
            "target_back_end_dti_percent": "47.00",
            "target_front_end_dti_percent": "31.00",
        },
        format="json",
    )
    assert calc.status_code == 200
    data = calc.json()
    assert data["status"] == "calculated"
    assert data["current"]["front_end_dti_percent"] == "29.81"
    assert data["current"]["back_end_dti_percent"] == "46.03"
    assert data["proposed"]["housing"]["total"] == "2765.00"
    assert data["proposed"]["front_end_dti_percent"] == "26.59"
    assert data["proposed"]["back_end_dti_percent"] == "42.81"
    assert data["capacity"]["target_total_obligation_capacity"] == "4888.00"
    assert data["capacity"]["max_proposed_housing_payment_at_target"] == "3201.00"
    assert "Planning estimate only" in data["disclaimer"]


def test_zero_income_calculate_warning(auth_client, household):
    _add_debt(auth_client, household, monthly_payment="400.00")
    calc = auth_client.post(CALC_URL, {"household_id": household.id}, format="json")
    data = calc.json()
    assert data["status"] == "gross_income_required"
    assert data["current"]["front_end_dti_percent"] is None
    assert any(w["code"] == "gross_income_required" for w in data["warnings"])


def test_current_housing_exclusion_api(auth_client, household):
    _save_profile(auth_client, household, include_current_housing_in_current_dti=False)
    _add_income(auth_client, household, "10400.00")
    _add_debt(auth_client, household)
    calc = auth_client.post(CALC_URL, {"household_id": household.id}, format="json")
    assert calc.json()["inputs"]["current_housing_payment"] in ("0.00", "0.0")
    assert any(w["code"] == "current_housing_excluded" for w in calc.json()["warnings"])


def test_over_target_amount(auth_client, household):
    _save_profile(
        auth_client,
        household,
        target_back_end_dti_percent="20.00",
        current_housing_payment="2000.00",
    )
    _add_income(auth_client, household, "5000.00")
    _add_debt(auth_client, household, monthly_payment="1500.00")
    data = auth_client.post(CALC_URL, {"household_id": household.id}, format="json").json()
    assert data["current"]["remaining_capacity_at_target"] in ("0.00", "0.0")
    assert Decimal(data["current"]["amount_over_target"]) == Decimal("2500.00")


def test_payoff_and_excluded_debts_do_not_mutate_saved_rows(auth_client, household):
    _save_profile(auth_client, household, current_housing_payment="0.00")
    _add_income(auth_client, household, "10000.00")
    a = _add_debt(auth_client, household, name="A", monthly_payment="400.00").json()
    b = _add_debt(auth_client, household, name="B", monthly_payment="200.00").json()
    c = _add_debt(auth_client, household, name="C", monthly_payment="300.00").json()
    calc = auth_client.post(
        CALC_URL,
        {"household_id": household.id, "excluded_debt_item_ids": [a["id"], c["id"]]},
        format="json",
    )
    data = calc.json()
    assert Decimal(data["inputs"]["non_housing_monthly_debt"]) == Decimal("200.00")
    assert DtiDebtItem.objects.filter(household=household).count() == 3
    assert {row["id"] for row in data["debt_items"]} == {a["id"], b["id"], c["id"]}
    payoff = auth_client.post(CALC_URL, {"household_id": household.id}, format="json").json()
    auto = next(row for row in payoff["payoff_impacts"] if row["debt_item_id"] == a["id"])
    assert Decimal(auto["additional_housing_capacity_at_target"]) == Decimal("400.00")
    assert Decimal(auto["effective_monthly_payment"]) == Decimal("400.00")


def test_inactive_linked_account_warning(auth_client, household, credit_card):
    _add_income(auth_client, household, "5000.00")
    created = _add_debt(
        auth_client,
        household,
        name="Credit Card",
        debt_type="credit_card",
        payment_source="linked_account_minimum",
        linked_account_id=credit_card.id,
        outstanding_balance="2993.00",
    )
    assert created.status_code == 201
    credit_card.status = Account.Status.ARCHIVED
    credit_card.is_active = False
    credit_card.save()
    data = auth_client.post(CALC_URL, {"household_id": household.id}, format="json").json()
    codes = [w["code"] for w in data["warnings"]]
    assert "linked_account_inactive" in codes


def test_cannot_access_another_household_dti(
    auth_client, household, other_household, other_user
):
    other_client = APIClient()
    other_client.force_authenticate(user=other_user)
    _save_profile(other_client, other_household, current_housing_payment="900.00")
    income = _add_income(other_client, other_household, "3000.00")
    debt = _add_debt(other_client, other_household, monthly_payment="100.00")
    assert auth_client.get(PROFILE_URL, {"household_id": other_household.id}).status_code == 404
    assert auth_client.get(INCOME_URL, {"household_id": other_household.id}).status_code == 404
    assert auth_client.get(f"{INCOME_URL}{income.json()['id']}/").status_code == 404
    assert auth_client.patch(
        f"{DEBT_URL}{debt.json()['id']}/", {"included": False}, format="json"
    ).status_code == 404
    assert (
        auth_client.post(CALC_URL, {"household_id": other_household.id}, format="json").status_code
        == 400
    )


def test_calculation_overrides_are_not_persisted(auth_client, household):
    _save_profile(auth_client, household, target_back_end_dti_percent="36.00")
    _add_income(auth_client, household, "10000.00")
    auth_client.post(
        CALC_URL,
        {
            "household_id": household.id,
            "target_back_end_dti_percent": "47.00",
            "proposed_housing": {"principal_and_interest": "2000.00"},
        },
        format="json",
    )
    profile = DtiProfile.objects.get(household=household)
    assert profile.target_back_end_dti_percent == Decimal("36.00")
    assert profile.current_housing_payment == Decimal("3100.00")


def test_crud_does_not_create_transactions_rules_or_mutate_accounts(
    auth_client, household, credit_card
):
    txn_count = Transaction.objects.count()
    rule_count = RecurringRule.objects.count()
    scenario_count = Scenario.objects.count()
    min_pay = credit_card.minimum_payment_amount
    _save_profile(auth_client, household)
    _add_income(auth_client, household, "4000.00")
    _add_debt(
        auth_client,
        household,
        name="Credit Card",
        debt_type="credit_card",
        payment_source="linked_account_minimum",
        linked_account_id=credit_card.id,
    )
    auth_client.post(CALC_URL, {"household_id": household.id}, format="json")
    credit_card.refresh_from_db()
    assert Transaction.objects.count() == txn_count
    assert RecurringRule.objects.count() == rule_count
    assert Scenario.objects.count() == scenario_count
    assert credit_card.minimum_payment_amount == min_pay


def test_deleting_account_nulls_link_not_profile(auth_client, household, credit_card):
    _save_profile(auth_client, household)
    created = _add_debt(
        auth_client,
        household,
        name="Credit Card",
        debt_type="credit_card",
        payment_source="manual",
        monthly_payment="50.00",
        linked_account_id=credit_card.id,
    )
    profile_id = DtiProfile.objects.get(household=household).id
    credit_card.delete()
    item = DtiDebtItem.objects.get(pk=created.json()["id"])
    assert item.linked_account_id is None
    assert DtiProfile.objects.filter(pk=profile_id).exists()


def test_credit_card_suggestions_skip_linked_and_inactive(
    auth_client, household, credit_card, checking
):
    extra = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        name="Backup card",
        minimum_payment_amount=Decimal("25.00"),
    )
    archived = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        name="Old card",
        status=Account.Status.ARCHIVED,
        is_active=False,
        minimum_payment_amount=Decimal("10.00"),
    )
    _add_debt(
        auth_client,
        household,
        name="Visa",
        debt_type="credit_card",
        payment_source="linked_account_minimum",
        linked_account_id=credit_card.id,
    )
    res = auth_client.get(SUGGEST_URL, {"household_id": household.id})
    assert res.status_code == 200
    ids = [row["account_id"] for row in res.json()]
    assert extra.id in ids
    assert credit_card.id not in ids
    assert archived.id not in ids
    assert checking.id not in ids


def test_credit_card_suggestions_use_ledger_owed_not_stale_current_balance(
    auth_client, household
):
    from datetime import date

    from transactions.models import Transaction

    card = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        name="Savor",
        current_balance=Decimal("5413.31"),
        minimum_payment_amount=Decimal("25.00"),
    )
    Transaction.objects.create(
        account=card,
        date=date.today(),
        payee="Purchase",
        amount=Decimal("-812.44"),
        status=Transaction.Status.CLEARED,
        source=Transaction.Source.ONE_TIME,
    )
    res = auth_client.get(SUGGEST_URL, {"household_id": household.id})
    assert res.status_code == 200
    row = next(item for item in res.json() if item["account_id"] == card.id)
    assert row["current_balance"] == "812.44"
    assert row["current_balance"] != "5413.31"
    assert row["minimum_payment_amount"] == "25.00"


def test_months_remaining_must_be_positive(auth_client, household):
    res = _add_debt(auth_client, household, months_remaining=0)
    assert res.status_code == 400
