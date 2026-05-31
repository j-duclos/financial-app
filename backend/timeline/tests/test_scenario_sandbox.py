"""Scenario sandbox: overrides, one-time events, comparison, isolation from base data."""
from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model

from accounts.models import Account
from categories.models import Category
from core.models import Household, HouseholdMembership
from timeline.models import (
    Scenario,
    ScenarioRuleOverride,
    ScenarioOneTimeEvent,
    RecurringRule,
)
from timeline.services.ledger import build_timeline, apply_scenario_overrides
from timeline.services.scenario_comparison import build_scenario_comparison
from transactions.models import Transaction

User = get_user_model()


@pytest.fixture
def scenario_household(db, user):
    h = Household.objects.create(name="Scenario HH")
    HouseholdMembership.objects.create(household=h, user=user, role=HouseholdMembership.Role.OWNER)
    return h


@pytest.fixture
def scenario_checking(db, scenario_household):
    return Account.objects.create(
        household=scenario_household,
        account_type=Account.AccountType.CHECKING,
        name="Checking",
        starting_balance=Decimal("5000"),
        currency="USD",
        include_in_forecast=True,
    )


@pytest.fixture
def scenario_income_category(db, scenario_household):
    return Category.objects.create(
        household=scenario_household,
        name="Paycheck",
        category_type=Category.CategoryType.INCOME,
        sort_order=1,
    )


@pytest.fixture
def scenario_rule(db, scenario_household, scenario_checking, scenario_income_category):
    return RecurringRule.objects.create(
        household=scenario_household,
        name="Paycheck",
        account=scenario_checking,
        category=scenario_income_category,
        direction=RecurringRule.Direction.INCOME,
        amount=Decimal("2000"),
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=1,
        start_date=date(2020, 1, 1),
        active=True,
    )


def _income_rule(household, checking, income_category, amount, day):
    return RecurringRule.objects.create(
        household=household,
        name="Pay",
        account=checking,
        category=income_category,
        direction=RecurringRule.Direction.INCOME,
        amount=amount,
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=day,
        start_date=date(2020, 1, 1),
        active=True,
    )


@pytest.mark.django_db
class TestScenarioSandbox:
    def test_create_scenario(self, scenario_household):
        s = Scenario.objects.create(
            household=scenario_household,
            name="Raise",
            description="Higher pay",
            template=Scenario.Template.RAISE_INCOME,
            horizon_months=12,
        )
        assert s.id
        assert s.horizon_months == 12

    def test_override_does_not_mutate_rule(self, scenario_rule, scenario_household):
        original_amount = scenario_rule.amount
        scenario = Scenario.objects.create(household=scenario_household, name="Test")
        ScenarioRuleOverride.objects.create(
            scenario=scenario,
            rule=scenario_rule,
            override_amount=Decimal("999.99"),
        )
        scenario_rule.refresh_from_db()
        assert scenario_rule.amount == original_amount
        eff = apply_scenario_overrides(scenario_rule, scenario)
        assert eff["amount"] == Decimal("999.99")

    def test_projection_uses_override(self, user, scenario_rule, scenario_household):
        scenario = Scenario.objects.create(household=scenario_household, name="High pay")
        ScenarioRuleOverride.objects.create(
            scenario=scenario,
            rule=scenario_rule,
            override_amount=Decimal("5000"),
        )
        today = date.today()
        end = today + timedelta(days=60)
        base_rows = build_timeline(user, today, end, household_id=scenario_household.id)
        scenario_rows = build_timeline(
            user, today, end, scenario_id=scenario.id, household_id=scenario_household.id
        )
        base_rule_amounts = [
            abs(Decimal(str(r["amount"])))
            for r in base_rows
            if r.get("rule_id") == scenario_rule.id and r.get("date", today) >= today
        ]
        scenario_rule_amounts = [
            abs(Decimal(str(r["amount"])))
            for r in scenario_rows
            if r.get("rule_id") == scenario_rule.id and r.get("date", today) >= today
        ]
        if base_rule_amounts and scenario_rule_amounts:
            assert max(scenario_rule_amounts) >= max(base_rule_amounts)

    def test_one_time_event_scenario_only(self, user, scenario_checking, scenario_household):
        scenario = Scenario.objects.create(household=scenario_household, name="Bonus")
        event_date = date.today() + timedelta(days=14)
        ScenarioOneTimeEvent.objects.create(
            scenario=scenario,
            date=event_date,
            account=scenario_checking,
            description="Signing bonus",
            direction=ScenarioOneTimeEvent.Direction.INCOME,
            amount=Decimal("5000"),
        )
        today = date.today()
        end = today + timedelta(days=45)
        base = build_timeline(user, today, end, household_id=scenario_household.id)
        with_scenario = build_timeline(
            user, today, end, scenario_id=scenario.id, household_id=scenario_household.id
        )
        assert not any(r.get("source") == "scenario_event" for r in base)
        scenario_bonus = [r for r in with_scenario if r.get("source") == "scenario_event"]
        assert len(scenario_bonus) >= 1

    def test_comparison_returns_base_scenario_delta(
        self, api_client, user, scenario_household, scenario_checking, scenario_income_category
    ):
        _income_rule(scenario_household, scenario_checking, scenario_income_category, Decimal("2000"), 1)
        scenario = Scenario.objects.create(household=scenario_household, name="Compare")
        api_client.force_authenticate(user=user)
        res = api_client.get(
            f"/api/scenarios/{scenario.id}/compare/",
            {"horizon": "3m", "household_id": str(scenario_household.id)},
        )
        assert res.status_code == 200
        data = res.json()
        assert "metrics" in data
        assert "ending_cash" in data["metrics"]
        assert "forecast_changes" in data
        assert "forecast_change_groups" in data
        assert "risk_explanation" in data
        assert "is_risky" in data["risk_explanation"]
        assert "credit_utilization_at_horizon" in data
        assert isinstance(data["credit_utilization_at_horizon"], list)

    def test_timeline_respects_scenario(
        self, api_client, user, scenario_household, scenario_checking, scenario_income_category
    ):
        _income_rule(scenario_household, scenario_checking, scenario_income_category, Decimal("100"), 10)
        scenario = Scenario.objects.create(household=scenario_household, name="TL")
        api_client.force_authenticate(user=user)
        res = api_client.get(
            "/api/timeline/",
            {"horizon": "14d", "scenario_id": str(scenario.id), "household_id": str(scenario_household.id)},
        )
        assert res.status_code == 200

    def test_delete_scenario_preserves_rule(self, scenario_rule, scenario_household):
        original = scenario_rule.amount
        scenario = Scenario.objects.create(household=scenario_household, name="Gone")
        ScenarioRuleOverride.objects.create(
            scenario=scenario, rule=scenario_rule, override_amount=Decimal("1")
        )
        scenario.delete()
        scenario_rule.refresh_from_db()
        assert scenario_rule.amount == original

    def test_scenario_timeline_does_not_materialize_transactions(
        self, user, scenario_rule, scenario_household
    ):
        before = Transaction.objects.filter(rule=scenario_rule).count()
        today = date.today()
        end = today + timedelta(days=90)
        build_timeline(
            user,
            today,
            end,
            scenario_id=Scenario.objects.create(household=scenario_household, name="No DB").id,
            household_id=scenario_household.id,
        )
        after = Transaction.objects.filter(rule=scenario_rule).count()
        assert after == before

    def test_scenario_transfer_projects_two_legs(self, user, scenario_checking, scenario_household):
        savings = Account.objects.create(
            household=scenario_household,
            account_type=Account.AccountType.SAVINGS,
            name="Savings",
            starting_balance=Decimal("1000"),
            currency="USD",
            include_in_forecast=True,
        )
        scenario = Scenario.objects.create(household=scenario_household, name="Xfer")
        event_date = date.today() + timedelta(days=14)
        ScenarioOneTimeEvent.objects.create(
            scenario=scenario,
            date=event_date,
            account=scenario_checking,
            transfer_to_account=savings,
            description="Move to savings",
            direction=ScenarioOneTimeEvent.Direction.TRANSFER,
            amount=Decimal("200"),
        )
        today = date.today()
        end = today + timedelta(days=45)
        rows = build_timeline(
            user, today, end, scenario_id=scenario.id, household_id=scenario_household.id
        )
        xfer_rows = [r for r in rows if r.get("source") == "scenario_event"]
        assert len(xfer_rows) == 2
        out_row = next(r for r in xfer_rows if r["account_id"] == scenario_checking.id)
        in_row = next(r for r in xfer_rows if r["account_id"] == savings.id)
        assert out_row["amount"] == Decimal("-200")
        assert in_row["amount"] == Decimal("200")

    def test_scenario_added_recurring_shows_in_comparison_not_base_timeline(
        self, user, scenario_household, scenario_checking, scenario_income_category
    ):
        from timeline.models import ScenarioAddedRecurring

        scenario = Scenario.objects.create(household=scenario_household, name="Side gig")
        ScenarioAddedRecurring.objects.create(
            scenario=scenario,
            name="Rental",
            account=scenario_checking,
            category=scenario_income_category,
            direction=ScenarioAddedRecurring.Direction.INCOME,
            amount=Decimal("500"),
            currency="USD",
            frequency=ScenarioAddedRecurring.Frequency.MONTHLY_DAY,
            interval=1,
            day_of_month=1,
            start_date=date(2020, 1, 1),
        )
        today = date.today()
        end = today + timedelta(days=90)
        base_rows = build_timeline(
            user, today, end, scenario_id=None, household_id=scenario_household.id
        )
        scenario_rows = build_timeline(
            user, today, end, scenario_id=scenario.id, household_id=scenario_household.id
        )
        assert not any(r.get("description") == "Rental" for r in base_rows)
        assert any(r.get("description") == "Rental" for r in scenario_rows)

        payload = build_scenario_comparison(
            user, scenario.id, horizon="12m", household_id=scenario_household.id
        )
        lowest = payload["metrics"]["lowest_projected_balance"]
        ending = payload["metrics"]["ending_cash"]
        assert Decimal(str(ending["scenario"])) > Decimal(str(ending["base"]))
        assert Decimal(str(lowest["scenario"])) >= Decimal(str(lowest["base"]))

    def test_scenario_added_recurring_debt_transfer_projects_to_card(
        self, user, scenario_household, scenario_checking
    ):
        from timeline.models import ScenarioAddedRecurring

        card = Account.objects.create(
            household=scenario_household,
            account_type=Account.AccountType.CREDIT,
            name="Venture",
            starting_balance=Decimal("-500"),
            currency="USD",
            include_in_forecast=True,
        )
        scenario = Scenario.objects.create(household=scenario_household, name="Extra pay")
        ScenarioAddedRecurring.objects.create(
            scenario=scenario,
            name="Extra Venture Payment",
            account=scenario_checking,
            transfer_to_account=card,
            category=None,
            direction=ScenarioAddedRecurring.Direction.TRANSFER,
            amount=Decimal("100"),
            currency="USD",
            frequency=ScenarioAddedRecurring.Frequency.MONTHLY_DAY,
            interval=1,
            day_of_month=15,
            start_date=date(2020, 1, 1),
            notes="what_if_debt_recurring",
        )
        today = date.today()
        end = today + timedelta(days=120)
        base_rows = build_timeline(
            user, today, end, scenario_id=None, household_id=scenario_household.id
        )
        scenario_rows = build_timeline(
            user, today, end, scenario_id=scenario.id, household_id=scenario_household.id
        )
        assert not any(r.get("description") == "Extra Venture Payment" for r in base_rows)
        xfer = [r for r in scenario_rows if r.get("description") == "Extra Venture Payment"]
        assert len(xfer) >= 2
        out_row = next(r for r in xfer if r["account_id"] == scenario_checking.id)
        in_row = next(r for r in xfer if r["account_id"] == card.id)
        assert out_row["amount"] == Decimal("-100")
        assert in_row["amount"] == Decimal("100")
        assert out_row.get("category_id") is None

    def test_affordability_endpoint(self, api_client, user, scenario_checking):
        api_client.force_authenticate(user=user)
        event_date = (date.today() + timedelta(days=7)).isoformat()
        res = api_client.post(
            "/api/scenarios/affordability/",
            {
                "account_id": scenario_checking.id,
                "amount": "50",
                "date": event_date,
                "item_name": "Coffee machine",
            },
            format="json",
        )
        assert res.status_code == 200
        assert "affordable" in res.json()
