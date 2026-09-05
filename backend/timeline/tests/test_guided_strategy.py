"""Guided What-If strategy API: persistence, validation, isolation from real ledger."""
from datetime import date
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from rest_framework.test import APIClient

from accounts.models import Account
from categories.models import Category
from core.models import Household, HouseholdMembership
from timeline.models import (
    RecurringRule,
    Scenario,
    ScenarioGuidedStrategy,
    ScenarioRuleOverride,
)
from timeline.services.scenario_comparison import build_scenario_comparison
from transactions.models import Transaction

User = get_user_model()


@pytest.fixture
def owner(db):
    return User.objects.create_user(username="guided_owner", password="pass1234")


@pytest.fixture
def outsider(db):
    return User.objects.create_user(username="guided_outsider", password="pass1234")


@pytest.fixture
def hh(db, owner):
    h = Household.objects.create(name="Guided HH")
    HouseholdMembership.objects.create(household=h, user=owner, role=HouseholdMembership.Role.OWNER)
    return h


@pytest.fixture
def other_hh(db, owner):
    h = Household.objects.create(name="Other Guided HH")
    HouseholdMembership.objects.create(household=h, user=owner, role=HouseholdMembership.Role.OWNER)
    return h


@pytest.fixture
def checking(db, hh):
    return Account.objects.create(
        household=hh,
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        name="Checking Source",
        starting_balance=Decimal("4000"),
        currency="USD",
        include_in_forecast=True,
    )


@pytest.fixture
def savings(db, hh):
    return Account.objects.create(
        household=hh,
        account_type=Account.AccountType.SAVINGS,
        role=Account.AccountRole.SAVINGS,
        name="Savings Dest",
        starting_balance=Decimal("1500"),
        currency="USD",
        include_in_forecast=True,
    )


@pytest.fixture
def card(db, hh):
    return Account.objects.create(
        household=hh,
        account_type=Account.AccountType.CREDIT,
        role=Account.AccountRole.CREDIT_CARD,
        name="Card A",
        starting_balance=Decimal("-800"),
        currency="USD",
        credit_limit=Decimal("3000"),
        apr=Decimal("19.99"),
        include_in_forecast=True,
    )


@pytest.fixture
def card_b(db, hh):
    return Account.objects.create(
        household=hh,
        account_type=Account.AccountType.CREDIT,
        role=Account.AccountRole.CREDIT_CARD,
        name="Card B",
        starting_balance=Decimal("-400"),
        currency="USD",
        credit_limit=Decimal("2000"),
        apr=Decimal("24.99"),
        include_in_forecast=True,
    )


@pytest.fixture
def savings_rule(db, hh, checking, savings):
    return RecurringRule.objects.create(
        household=hh,
        name="Savings transfer",
        account=checking,
        transfer_to_account=savings,
        direction=RecurringRule.Direction.TRANSFER,
        amount=Decimal("200"),
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=15,
        start_date=date(2020, 1, 1),
        active=True,
    )


@pytest.fixture
def paycheck_rule(db, hh, checking):
    cat = Category.objects.create(
        household=hh,
        name="Salary",
        category_type=Category.CategoryType.INCOME,
        sort_order=1,
    )
    return RecurringRule.objects.create(
        household=hh,
        name="Payroll",
        account=checking,
        category=cat,
        direction=RecurringRule.Direction.INCOME,
        amount=Decimal("2000"),
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=1,
        start_date=date(2020, 1, 1),
        active=True,
    )


@pytest.fixture
def scenario(db, hh):
    return Scenario.objects.create(household=hh, name="Guided plan", horizon_months=12)


@pytest.fixture
def override(db, scenario, paycheck_rule):
    return ScenarioRuleOverride.objects.create(
        scenario=scenario,
        rule=paycheck_rule,
        override_amount=Decimal("2200"),
    )


@pytest.fixture
def auth(owner):
    client = APIClient()
    client.force_authenticate(user=owner)
    return client


def _url(scenario_id: int) -> str:
    return f"/api/scenarios/{scenario_id}/guided-strategy/"


def _valid_payload(checking, savings, card, savings_rule, **overrides):
    payload = {
        "strategy_type": "debt_first_vs_save_first",
        "source_account_id": checking.id,
        "savings_account_id": savings.id,
        "included_debt_account_ids": [card.id],
        "savings_transfer_rule_ids": [savings_rule.id],
        "start_date": "2026-09-05",
        "minimum_cash_buffer": "500.00",
        "allocation_percent": "100.00",
        "payoff_strategy": "avalanche",
        "custom_debt_order_ids": [],
        "resume_savings_after_payoff": True,
    }
    payload.update(overrides)
    return payload


@pytest.mark.django_db
class TestGuidedStrategyApi:
    def test_create_valid_configuration(
        self, auth, scenario, checking, savings, card, savings_rule, override
    ):
        res = auth.put(
            _url(scenario.id),
            _valid_payload(checking, savings, card, savings_rule),
            format="json",
        )
        assert res.status_code == 200, res.content
        data = res.json()
        assert data["scenario_id"] == scenario.id
        assert data["strategy_type"] == "debt_first_vs_save_first"
        assert data["source_account"]["id"] == checking.id
        assert data["source_account"]["account_type"] == "CHECKING"
        assert data["source_account"]["effective_display_name"]
        assert data["savings_account"]["id"] == savings.id
        assert data["included_debt_accounts"][0]["id"] == card.id
        assert data["savings_transfer_rules"][0]["id"] == savings_rule.id
        assert data["savings_transfer_rules"][0]["account_id"] == checking.id
        assert data["savings_transfer_rules"][0]["transfer_to_account_id"] == savings.id
        assert data["start_date"] == "2026-09-05"
        assert data["minimum_cash_buffer"] == "500.00"
        assert data["allocation_percent"] == "100.00"
        assert data["payoff_strategy"] == "avalanche"
        assert data["custom_debt_order"] == []
        assert data["resume_savings_after_payoff"] is True

    def test_get_returns_normalized_configuration(
        self, auth, scenario, checking, savings, card, savings_rule
    ):
        created = auth.put(
            _url(scenario.id),
            _valid_payload(checking, savings, card, savings_rule),
            format="json",
        )
        assert created.status_code == 200
        res = auth.get(_url(scenario.id))
        assert res.status_code == 200
        assert res.json()["id"] == created.json()["id"]
        assert res.json()["source_account"]["id"] == checking.id

    def test_get_404_when_missing(self, auth, scenario):
        res = auth.get(_url(scenario.id))
        assert res.status_code == 404

    def test_put_replaces_configuration(
        self, auth, scenario, checking, savings, card, card_b, savings_rule
    ):
        first = auth.put(
            _url(scenario.id),
            _valid_payload(checking, savings, card, savings_rule, minimum_cash_buffer="100.00"),
            format="json",
        )
        assert first.status_code == 200
        first_id = first.json()["id"]
        second = auth.put(
            _url(scenario.id),
            _valid_payload(
                checking,
                savings,
                card,
                savings_rule,
                included_debt_account_ids=[card.id, card_b.id],
                minimum_cash_buffer="750.00",
                allocation_percent="50.00",
                payoff_strategy="snowball",
            ),
            format="json",
        )
        assert second.status_code == 200, second.content
        data = second.json()
        assert data["id"] == first_id
        assert data["minimum_cash_buffer"] == "750.00"
        assert data["allocation_percent"] == "50.00"
        assert data["payoff_strategy"] == "snowball"
        assert {a["id"] for a in data["included_debt_accounts"]} == {card.id, card_b.id}
        assert ScenarioGuidedStrategy.objects.filter(scenario=scenario).count() == 1

    def test_delete_leaves_scenario_and_manual_changes(
        self, auth, scenario, checking, savings, card, savings_rule, override, paycheck_rule
    ):
        created = auth.put(
            _url(scenario.id),
            _valid_payload(checking, savings, card, savings_rule),
            format="json",
        )
        assert created.status_code == 200
        res = auth.delete(_url(scenario.id))
        assert res.status_code == 204
        assert not ScenarioGuidedStrategy.objects.filter(scenario=scenario).exists()
        scenario.refresh_from_db()
        assert scenario.name == "Guided plan"
        assert ScenarioRuleOverride.objects.filter(pk=override.pk).exists()
        paycheck_rule.refresh_from_db()
        assert paycheck_rule.amount == Decimal("2000")

    def test_manual_changes_intact_after_create_update_delete(
        self, auth, scenario, checking, savings, card, savings_rule, override
    ):
        auth.put(
            _url(scenario.id),
            _valid_payload(checking, savings, card, savings_rule),
            format="json",
        )
        auth.put(
            _url(scenario.id),
            _valid_payload(checking, savings, card, savings_rule, allocation_percent="80.00"),
            format="json",
        )
        auth.delete(_url(scenario.id))
        override.refresh_from_db()
        assert override.override_amount == Decimal("2200")
        assert ScenarioRuleOverride.objects.filter(scenario=scenario).count() == 1

    def test_cannot_have_two_guided_strategies(
        self, auth, scenario, checking, savings, card, savings_rule
    ):
        first = auth.put(
            _url(scenario.id),
            _valid_payload(checking, savings, card, savings_rule),
            format="json",
        )
        assert first.status_code == 200
        second = auth.put(
            _url(scenario.id),
            _valid_payload(checking, savings, card, savings_rule, minimum_cash_buffer="10.00"),
            format="json",
        )
        assert second.status_code == 200
        assert first.json()["id"] == second.json()["id"]
        assert ScenarioGuidedStrategy.objects.filter(scenario=scenario).count() == 1

        with pytest.raises(IntegrityError):
            with transaction.atomic():
                ScenarioGuidedStrategy.objects.create(
                    scenario=scenario,
                    source_account=checking,
                    savings_account=savings,
                    start_date=date(2026, 9, 5),
                )

    def test_cross_household_source_rejected(
        self, auth, scenario, savings, card, savings_rule, other_hh
    ):
        other_checking = Account.objects.create(
            household=other_hh,
            account_type=Account.AccountType.CHECKING,
            name="Other checking",
            currency="USD",
        )
        res = auth.put(
            _url(scenario.id),
            _valid_payload(other_checking, savings, card, savings_rule),
            format="json",
        )
        assert res.status_code == 400
        assert "source_account_id" in res.json()

    def test_cross_household_savings_rejected(
        self, auth, scenario, checking, card, savings_rule, other_hh
    ):
        other_savings = Account.objects.create(
            household=other_hh,
            account_type=Account.AccountType.SAVINGS,
            role=Account.AccountRole.SAVINGS,
            name="Other savings",
            currency="USD",
        )
        res = auth.put(
            _url(scenario.id),
            _valid_payload(checking, other_savings, card, savings_rule),
            format="json",
        )
        assert res.status_code == 400
        assert "savings_account_id" in res.json()

    def test_cross_household_debt_rejected(
        self, auth, scenario, checking, savings, savings_rule, other_hh
    ):
        other_card = Account.objects.create(
            household=other_hh,
            account_type=Account.AccountType.CREDIT,
            role=Account.AccountRole.CREDIT_CARD,
            name="Other card",
            currency="USD",
        )
        res = auth.put(
            _url(scenario.id),
            _valid_payload(checking, savings, other_card, savings_rule),
            format="json",
        )
        assert res.status_code == 400
        assert "included_debt_account_ids" in res.json()

    def test_cross_household_rule_rejected(
        self, auth, scenario, checking, savings, card, other_hh
    ):
        other_checking = Account.objects.create(
            household=other_hh,
            account_type=Account.AccountType.CHECKING,
            name="Other src",
            currency="USD",
        )
        other_savings = Account.objects.create(
            household=other_hh,
            account_type=Account.AccountType.SAVINGS,
            role=Account.AccountRole.SAVINGS,
            name="Other dest",
            currency="USD",
        )
        other_rule = RecurringRule.objects.create(
            household=other_hh,
            name="Other transfer",
            account=other_checking,
            transfer_to_account=other_savings,
            direction=RecurringRule.Direction.TRANSFER,
            amount=Decimal("50"),
            currency="USD",
            frequency=RecurringRule.Frequency.MONTHLY_DAY,
            interval=1,
            day_of_month=1,
            start_date=date(2020, 1, 1),
            active=True,
        )
        res = auth.put(
            _url(scenario.id),
            _valid_payload(checking, savings, card, other_rule),
            format="json",
        )
        assert res.status_code == 400
        assert "savings_transfer_rule_ids" in res.json()

    def test_source_and_savings_cannot_be_same(
        self, auth, scenario, checking, card, savings_rule
    ):
        res = auth.put(
            _url(scenario.id),
            _valid_payload(checking, checking, card, savings_rule),
            format="json",
        )
        assert res.status_code == 400
        body = res.json()
        assert "savings_account_id" in body or "source_account_id" in body

    def test_invalid_debt_account_types_rejected(
        self, auth, scenario, checking, savings, savings_rule, hh
    ):
        loan = Account.objects.create(
            household=hh,
            account_type=Account.AccountType.OTHER,
            role=Account.AccountRole.LOAN,
            name="Auto loan",
            currency="USD",
        )
        res = auth.put(
            _url(scenario.id),
            _valid_payload(checking, savings, loan, savings_rule),
            format="json",
        )
        assert res.status_code == 400
        assert "included_debt_account_ids" in res.json()

        res = auth.put(
            _url(scenario.id),
            _valid_payload(checking, savings, checking, savings_rule),
            format="json",
        )
        assert res.status_code == 400
        assert "included_debt_account_ids" in res.json()

    def test_invalid_savings_transfer_rules_rejected(
        self, auth, scenario, checking, savings, card, paycheck_rule, hh
    ):
        res = auth.put(
            _url(scenario.id),
            _valid_payload(checking, savings, card, paycheck_rule),
            format="json",
        )
        assert res.status_code == 400
        assert "savings_transfer_rule_ids" in res.json()

        card_pay = RecurringRule.objects.create(
            household=hh,
            name="Card payment",
            account=checking,
            transfer_to_account=card,
            direction=RecurringRule.Direction.TRANSFER,
            amount=Decimal("75"),
            currency="USD",
            frequency=RecurringRule.Frequency.MONTHLY_DAY,
            interval=1,
            day_of_month=20,
            start_date=date(2020, 1, 1),
            active=True,
        )
        res = auth.put(
            _url(scenario.id),
            _valid_payload(checking, savings, card, card_pay),
            format="json",
        )
        assert res.status_code == 400
        assert "savings_transfer_rule_ids" in res.json()

    def test_empty_debt_selection_rejected(
        self, auth, scenario, checking, savings, card, savings_rule
    ):
        res = auth.put(
            _url(scenario.id),
            _valid_payload(checking, savings, card, savings_rule, included_debt_account_ids=[]),
            format="json",
        )
        assert res.status_code == 400
        assert "included_debt_account_ids" in res.json()

    def test_empty_transfer_rule_selection_rejected(
        self, auth, scenario, checking, savings, card, savings_rule
    ):
        res = auth.put(
            _url(scenario.id),
            _valid_payload(checking, savings, card, savings_rule, savings_transfer_rule_ids=[]),
            format="json",
        )
        assert res.status_code == 400
        assert "savings_transfer_rule_ids" in res.json()

    def test_start_date_required(
        self, auth, scenario, checking, savings, card, savings_rule
    ):
        payload = _valid_payload(checking, savings, card, savings_rule)
        del payload["start_date"]
        res = auth.put(_url(scenario.id), payload, format="json")
        assert res.status_code == 400
        assert "start_date" in res.json()

    def test_negative_buffer_rejected(
        self, auth, scenario, checking, savings, card, savings_rule
    ):
        res = auth.put(
            _url(scenario.id),
            _valid_payload(checking, savings, card, savings_rule, minimum_cash_buffer="-1.00"),
            format="json",
        )
        assert res.status_code == 400
        assert "minimum_cash_buffer" in res.json()

    @pytest.mark.parametrize("allocation", ["0", "0.00", "-5.00", "100.01", "150"])
    def test_invalid_allocation_percent_rejected(
        self, auth, scenario, checking, savings, card, savings_rule, allocation
    ):
        res = auth.put(
            _url(scenario.id),
            _valid_payload(checking, savings, card, savings_rule, allocation_percent=allocation),
            format="json",
        )
        assert res.status_code == 400
        assert "allocation_percent" in res.json()

    def test_unsupported_payoff_strategy_rejected(
        self, auth, scenario, checking, savings, card, savings_rule
    ):
        res = auth.put(
            _url(scenario.id),
            _valid_payload(
                checking, savings, card, savings_rule, payoff_strategy="minimum_payment"
            ),
            format="json",
        )
        assert res.status_code == 400
        assert "payoff_strategy" in res.json()

    def test_custom_payoff_requires_complete_unique_order(
        self, auth, scenario, checking, savings, card, card_b, savings_rule
    ):
        base = _valid_payload(
            checking,
            savings,
            card,
            savings_rule,
            included_debt_account_ids=[card.id, card_b.id],
            payoff_strategy="custom",
        )
        missing = auth.put(
            _url(scenario.id),
            {**base, "custom_debt_order_ids": [card.id]},
            format="json",
        )
        assert missing.status_code == 400
        assert "custom_debt_order_ids" in missing.json()

        dupes = auth.put(
            _url(scenario.id),
            {**base, "custom_debt_order_ids": [card.id, card.id]},
            format="json",
        )
        assert dupes.status_code == 400
        assert "custom_debt_order_ids" in dupes.json()

        extra_checking = auth.put(
            _url(scenario.id),
            {**base, "custom_debt_order_ids": [card.id, card_b.id, checking.id]},
            format="json",
        )
        assert extra_checking.status_code == 400
        assert "custom_debt_order_ids" in extra_checking.json()

        ok = auth.put(
            _url(scenario.id),
            {**base, "custom_debt_order_ids": [card_b.id, card.id]},
            format="json",
        )
        assert ok.status_code == 200, ok.content
        order = ok.json()["custom_debt_order"]
        assert [row["id"] for row in order] == [card_b.id, card.id]
        assert [row["priority"] for row in order] == [1, 2]

        non_custom_with_order = auth.put(
            _url(scenario.id),
            _valid_payload(
                checking,
                savings,
                card,
                savings_rule,
                payoff_strategy="avalanche",
                custom_debt_order_ids=[card.id],
            ),
            format="json",
        )
        assert non_custom_with_order.status_code == 400
        assert "custom_debt_order_ids" in non_custom_with_order.json()

    def test_unauthorized_users_cannot_access(
        self, owner, outsider, scenario, checking, savings, card, savings_rule
    ):
        payload = _valid_payload(checking, savings, card, savings_rule)
        anon = APIClient()
        assert anon.get(_url(scenario.id)).status_code in (401, 403, 404)
        assert anon.put(_url(scenario.id), payload, format="json").status_code in (401, 403, 404)
        assert anon.delete(_url(scenario.id)).status_code in (401, 403, 404)

        other = APIClient()
        other.force_authenticate(user=outsider)
        assert other.get(_url(scenario.id)).status_code == 404
        assert other.put(_url(scenario.id), payload, format="json").status_code == 404
        assert other.delete(_url(scenario.id)).status_code == 404

        owner_client = APIClient()
        owner_client.force_authenticate(user=owner)
        created = owner_client.put(_url(scenario.id), payload, format="json")
        assert created.status_code == 200
        assert other.get(_url(scenario.id)).status_code == 404
        assert other.delete(_url(scenario.id)).status_code == 404

    def test_write_creates_no_real_transactions_or_rules(
        self, auth, scenario, checking, savings, card, savings_rule, paycheck_rule
    ):
        txn_before = Transaction.objects.count()
        rule_before = RecurringRule.objects.count()
        auth.put(
            _url(scenario.id),
            _valid_payload(checking, savings, card, savings_rule),
            format="json",
        )
        auth.put(
            _url(scenario.id),
            _valid_payload(checking, savings, card, savings_rule, allocation_percent="40.00"),
            format="json",
        )
        auth.delete(_url(scenario.id))
        assert Transaction.objects.count() == txn_before
        assert RecurringRule.objects.count() == rule_before
        paycheck_rule.refresh_from_db()
        savings_rule.refresh_from_db()
        assert paycheck_rule.amount == Decimal("2000")
        assert savings_rule.amount == Decimal("200")
        assert savings_rule.active is True

    def test_comparison_unchanged_without_guided_strategy(
        self, owner, scenario, paycheck_rule, override
    ):
        before_txns = Transaction.objects.count()
        payload = build_scenario_comparison(
            owner, scenario.id, horizon="3m", household_id=scenario.household_id
        )
        assert "metrics" in payload
        assert payload["scenario_id"] == scenario.id
        assert "guided_strategy_result" not in payload
        assert Transaction.objects.count() == before_txns

    def test_comparison_applies_strategy_hypothetically(
        self, auth, owner, scenario, checking, savings, card, savings_rule, paycheck_rule, override
    ):
        baseline = build_scenario_comparison(
            owner, scenario.id, horizon="3m", household_id=scenario.household_id
        )
        txn_before = Transaction.objects.count()
        res = auth.put(
            _url(scenario.id),
            _valid_payload(
                checking,
                savings,
                card,
                savings_rule,
                start_date=date.today().isoformat(),
                minimum_cash_buffer="0.00",
            ),
            format="json",
        )
        assert res.status_code == 200
        with_strategy = build_scenario_comparison(
            owner, scenario.id, horizon="3m", household_id=scenario.household_id
        )
        assert with_strategy["metrics"] != baseline["metrics"]
        result = with_strategy["guided_strategy_result"]
        assert result["strategy_type"] == "debt_first_vs_save_first"
        assert ScenarioRuleOverride.objects.filter(pk=override.pk).exists()
        assert RecurringRule.objects.filter(pk=savings_rule.pk, active=True).exists()
        assert Transaction.objects.count() == txn_before
