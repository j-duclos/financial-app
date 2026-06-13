"""Unit tests for recurrence generator and timeline."""
from datetime import date
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model

from core.models import Household, HouseholdMembership
from accounts.models import Account
from categories.models import Category
from timeline.models import RecurringRule, Scenario, ScenarioRuleOverride
from transactions.models import Transaction

from timeline.services.ledger import (
    generate_rule_occurrences,
    apply_scenario_overrides,
    build_timeline,
)

User = get_user_model()


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="Test Household")
    HouseholdMembership.objects.create(household=h, user=user, role=HouseholdMembership.Role.OWNER)
    return h


@pytest.fixture
def account(db, household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Checking",
        currency="USD",
    )


@pytest.fixture
def category(db, household):
    return Category.objects.create(
        household=household,
        name="Rent",
        category_type=Category.CategoryType.EXPENSE,
        sort_order=1,
    )


@pytest.fixture
def rule_weekly(db, household, account, category):
    return RecurringRule.objects.create(
        household=household,
        name="Weekly rent",
        account=account,
        category=category,
        direction=RecurringRule.Direction.EXPENSE,
        amount=100,
        currency="USD",
        frequency=RecurringRule.Frequency.WEEKLY,
        interval=1,
        day_of_week=0,  # Monday
        start_date=date(2025, 1, 6),
        end_date=None,
        active=True,
    )


@pytest.fixture
def rule_monthly_day(db, household, account, category):
    return RecurringRule.objects.create(
        household=household,
        name="Monthly on 15th",
        account=account,
        category=category,
        direction=RecurringRule.Direction.EXPENSE,
        amount=50,
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=15,
        start_date=date(2025, 1, 1),
        end_date=None,
        active=True,
    )


@pytest.fixture
def rule_monthly_nth(db, household, account, category):
    return RecurringRule.objects.create(
        household=household,
        name="2nd Tuesday",
        account=account,
        category=category,
        direction=RecurringRule.Direction.INCOME,
        amount=200,
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_NTH_WEEKDAY,
        interval=1,
        day_of_week=1,  # Tuesday
        nth_week=2,
        start_date=date(2025, 1, 1),
        end_date=None,
        active=True,
    )


@pytest.fixture
def rule_yearly(db, household, account, category):
    return RecurringRule.objects.create(
        household=household,
        name="Yearly",
        account=account,
        category=category,
        direction=RecurringRule.Direction.EXPENSE,
        amount=500,
        currency="USD",
        frequency=RecurringRule.Frequency.YEARLY,
        interval=1,
        start_date=date(2025, 6, 15),
        end_date=None,
        active=True,
    )


class TestGenerateRuleOccurrences:
    def test_weekly_basic(self, rule_weekly):
        start = date(2025, 1, 1)
        end = date(2025, 1, 31)
        occ = generate_rule_occurrences(rule_weekly, start, end)
        # Mondays in Jan 2025: 6, 13, 20, 27
        assert occ == [date(2025, 1, 6), date(2025, 1, 13), date(2025, 1, 20), date(2025, 1, 27)]

    def test_weekly_respects_end_date(self, rule_weekly):
        rule_weekly.end_date = date(2025, 1, 20)
        rule_weekly.save()
        occ = generate_rule_occurrences(rule_weekly, date(2025, 1, 1), date(2025, 2, 28))
        assert occ == [date(2025, 1, 6), date(2025, 1, 13), date(2025, 1, 20)]

    def test_weekly_interval_2(self, rule_weekly):
        rule_weekly.interval = 2
        rule_weekly.save()
        occ = generate_rule_occurrences(rule_weekly, date(2025, 1, 1), date(2025, 2, 28))
        # Every 2 weeks: Jan 6, 20, Feb 3, 17
        assert date(2025, 1, 6) in occ
        assert date(2025, 1, 20) in occ
        assert date(2025, 2, 3) in occ
        assert date(2025, 2, 17) in occ
        assert len(occ) == 4

    def test_monthly_day_basic(self, rule_monthly_day):
        occ = generate_rule_occurrences(rule_monthly_day, date(2025, 1, 1), date(2025, 4, 30))
        assert occ == [date(2025, 1, 15), date(2025, 2, 15), date(2025, 3, 15), date(2025, 4, 15)]

    def test_monthly_day_feb_short_month(self, rule_monthly_day):
        rule_monthly_day.day_of_month = 31
        rule_monthly_day.save()
        occ = generate_rule_occurrences(rule_monthly_day, date(2025, 1, 1), date(2025, 3, 31))
        # Jan 31, Feb 28, Mar 31
        assert occ == [date(2025, 1, 31), date(2025, 2, 28), date(2025, 3, 31)]

    def test_monthly_nth_weekday(self, rule_monthly_nth):
        occ = generate_rule_occurrences(rule_monthly_nth, date(2025, 1, 1), date(2025, 3, 31))
        # 2nd Tuesday: Jan 14, Feb 11, Mar 11
        assert date(2025, 1, 14) in occ
        assert date(2025, 2, 11) in occ
        assert date(2025, 3, 11) in occ

    def test_yearly_basic(self, rule_yearly):
        occ = generate_rule_occurrences(rule_yearly, date(2025, 1, 1), date(2026, 12, 31))
        assert date(2025, 6, 15) in occ
        assert date(2026, 6, 15) in occ
        assert len(occ) == 2

    def test_no_duplicates(self, rule_weekly):
        occ = generate_rule_occurrences(rule_weekly, date(2025, 1, 1), date(2025, 2, 28))
        assert len(occ) == len(set(occ))

    def test_inactive_rule_returns_empty(self, rule_weekly):
        rule_weekly.active = False
        rule_weekly.save()
        occ = generate_rule_occurrences(rule_weekly, date(2025, 1, 1), date(2025, 12, 31))
        assert occ == []

    def test_effective_start_after_range(self, rule_weekly):
        occ = generate_rule_occurrences(
            rule_weekly,
            date(2025, 1, 1),
            date(2025, 1, 10),
            effective_start=date(2025, 2, 1),
        )
        assert occ == []

    def test_monthly_day_respects_query_start_not_rule_start(self, rule_monthly_day):
        """Occurrences before the query start must not leak in (e.g. mid-month windows)."""
        rule_monthly_day.start_date = date(2026, 5, 24)
        rule_monthly_day.day_of_month = 24
        rule_monthly_day.save()
        occ = generate_rule_occurrences(rule_monthly_day, date(2026, 5, 29), date(2026, 5, 31))
        assert occ == []


class TestApplyScenarioOverrides:
    def test_no_scenario_returns_base(self, rule_weekly):
        eff = apply_scenario_overrides(rule_weekly, None)
        assert eff["amount"] == rule_weekly.amount
        assert eff["active"] is True

    def test_scenario_override_amount(self, rule_weekly, household):
        scenario = Scenario.objects.create(household=household, name="Test")
        ScenarioRuleOverride.objects.create(
            scenario=scenario,
            rule=rule_weekly,
            override_amount=150,
        )
        eff = apply_scenario_overrides(rule_weekly, scenario)
        assert eff["amount"] == 150
        assert eff["active"] is True


class TestBuildTimeline:
    def test_empty_returns_list(self, user, household, account):
        rows = build_timeline(user, date(2025, 1, 1), date(2025, 6, 30))
        assert isinstance(rows, list)

    def test_timeline_row_structure(self, user, rule_weekly):
        rows = build_timeline(user, date(2025, 1, 1), date(2025, 6, 30))
        for r in rows:
            assert "date" in r
            assert "description" in r
            assert "account_id" in r
            assert "amount" in r
            assert "running_balance" in r
            assert "source" in r
            assert r["source"] in ("actual", "rule", "interest", "scenario_event")
            assert "reconciled" in r
            assert "txn_source" in r

    def test_credit_card_interest_appears_on_cycle_end(self, user, household, db):
        """With billing_cycle_end_day and APR set, next cycle end gets one Projected Interest row."""
        from datetime import timedelta
        today = date.today()
        start = today
        end = today + timedelta(days=90)
        # Credit account: cycle closes on 15th, 12% APR
        credit = Account.objects.create(
            household=household,
            account_type=Account.AccountType.CREDIT,
            name="Credit Card",
            currency="USD",
            starting_balance=Decimal("0"),
            billing_cycle_end_day=15,
            apr=Decimal("12.00"),
        )
        Category.objects.get_or_create(
            household=household,
            name="Interest",
            category_type=Category.CategoryType.EXPENSE,
            defaults={"sort_order": 252},
        )
        # One charge so there is debt
        Transaction.objects.create(
            account=credit,
            date=today - timedelta(days=5),
            payee="Test charge",
            amount=Decimal("-500.00"),
            source=Transaction.Source.ACTUAL,
        )
        rows = build_timeline(user, start, end, account_id=credit.id)
        interest_rows = [r for r in rows if r.get("source") == "interest" and r.get("description") == "Projected Interest"]
        assert len(interest_rows) >= 1, "expected at least one projected interest row for credit card"
        first = interest_rows[0]
        assert first["amount"] < 0
        assert first["account_id"] == credit.id
        assert first["category_name"] == "Interest"

    def test_projected_interest_only_strictly_future_no_materialization(
        self, user, household, db
    ):
        """Projected Interest appears only for cycle ends after as_of; synthetic only; DB INTEREST hidden."""
        as_of = date(2026, 4, 2)
        start = date(2026, 3, 1)
        end = date(2026, 6, 30)
        credit = Account.objects.create(
            household=household,
            account_type=Account.AccountType.CREDIT,
            name="Credit Card",
            currency="USD",
            starting_balance=Decimal("0"),
            billing_cycle_end_day=2,
            apr=Decimal("12.00"),
        )
        Category.objects.get_or_create(
            household=household,
            name="Interest",
            category_type=Category.CategoryType.EXPENSE,
            defaults={"sort_order": 252},
        )
        Transaction.objects.create(
            account=credit,
            date=date(2026, 3, 15),
            payee="Test charge",
            amount=Decimal("-500.00"),
            source=Transaction.Source.ACTUAL,
        )
        legacy = Transaction.objects.create(
            account=credit,
            date=date(2026, 3, 2),
            payee="Projected Interest",
            amount=Decimal("-9.99"),
            source=Transaction.Source.INTEREST,
            interest_cycle_end_date=date(2026, 3, 2),
        )
        rows = build_timeline(user, start, end, account_id=credit.id, as_of_date=as_of)
        assert Transaction.objects.filter(account=credit, source=Transaction.Source.INTEREST).count() == 1
        interest_rows = [
            r
            for r in rows
            if r.get("source") == "interest" and r.get("description") == "Projected Interest"
        ]
        assert len(interest_rows) >= 1
        for r in interest_rows:
            assert r["date"] > as_of
            assert r.get("transaction_id") is None
        assert date(2026, 4, 2) not in {r["date"] for r in interest_rows}
        assert not any(r.get("transaction_id") == legacy.id for r in rows)

    def test_projected_interest_never_in_past_after_cycle_end_passes(
        self, user, household, db
    ):
        """After a billing cycle ends, projected interest for that cycle is omitted entirely."""
        as_of = date(2026, 5, 15)
        start = date(2026, 3, 1)
        end = date(2026, 8, 31)
        credit = Account.objects.create(
            household=household,
            account_type=Account.AccountType.CREDIT,
            name="Credit Card",
            currency="USD",
            starting_balance=Decimal("0"),
            billing_cycle_end_day=2,
            apr=Decimal("12.00"),
        )
        Category.objects.get_or_create(
            household=household,
            name="Interest",
            category_type=Category.CategoryType.EXPENSE,
            defaults={"sort_order": 252},
        )
        Transaction.objects.create(
            account=credit,
            date=date(2026, 3, 15),
            payee="Test charge",
            amount=Decimal("-500.00"),
            source=Transaction.Source.ACTUAL,
        )
        rows = build_timeline(user, start, end, account_id=credit.id, as_of_date=as_of)
        interest_rows = [
            r
            for r in rows
            if r.get("source") == "interest" and r.get("description") == "Projected Interest"
        ]
        assert all(r["date"] > as_of for r in interest_rows)
        assert date(2026, 5, 2) not in {r["date"] for r in interest_rows}
        assert date(2026, 4, 2) not in {r["date"] for r in interest_rows}

    def test_savings_interest_income_appears_on_cycle_end(self, user, household, db):
        """With interest_cycle_end_day and interest_rate set, next cycle end gets one Projected Interest Income row."""
        from datetime import timedelta
        today = date.today()
        start = today
        end = today + timedelta(days=90)
        savings = Account.objects.create(
            household=household,
            account_type=Account.AccountType.SAVINGS,
            name="Savings",
            currency="USD",
            starting_balance=Decimal("10000.00"),
            interest_rate=Decimal("4.50"),
            interest_cycle_end_day=1,
        )
        Category.objects.get_or_create(
            household=household,
            name="Interest Income",
            category_type=Category.CategoryType.INCOME,
            defaults={"sort_order": 6},
        )
        rows = build_timeline(user, start, end, account_id=savings.id)
        interest_rows = [
            r for r in rows
            if r.get("source") == "interest" and r.get("description") == "Projected Interest Income"
        ]
        assert len(interest_rows) >= 1, "expected at least one projected interest income row for savings"
        first = interest_rows[0]
        assert first["amount"] > 0
        assert first["account_id"] == savings.id
        assert first["category_name"] == "Interest Income"
        assert first["type"] == "INFLOW"

    def test_credit_card_no_projected_interest_when_balance_zero(self, user, household, db):
        """When credit card balance is 0 (paid off), no Projected Interest row should appear."""
        from datetime import timedelta
        today = date.today()
        start = today
        end = today + timedelta(days=90)
        credit = Account.objects.create(
            household=household,
            account_type=Account.AccountType.CREDIT,
            name="Credit Card",
            currency="USD",
            starting_balance=Decimal("0"),
            billing_cycle_end_day=15,
            apr=Decimal("18.00"),
        )
        Category.objects.get_or_create(
            household=household,
            name="Interest",
            category_type=Category.CategoryType.EXPENSE,
            defaults={"sort_order": 252},
        )
        # Charge then full payment — balance is 0
        Transaction.objects.create(
            account=credit,
            date=today - timedelta(days=10),
            payee="Charge",
            amount=Decimal("-100.00"),
            source=Transaction.Source.ACTUAL,
        )
        Transaction.objects.create(
            account=credit,
            date=today - timedelta(days=5),
            payee="Payment",
            amount=Decimal("100.00"),
            source=Transaction.Source.ACTUAL,
        )
        rows = build_timeline(user, start, end, account_id=credit.id)
        interest_rows = [
            r for r in rows
            if r.get("source") == "interest" and r.get("description") == "Projected Interest"
        ]
        assert len(interest_rows) == 0, "expected no projected interest when balance is zero"

    def test_credit_card_no_projected_interest_when_in_credit(self, user, household, db):
        """When credit card is in credit (overpayment), no Projected Interest row should appear."""
        from datetime import timedelta
        today = date.today()
        start = today
        end = today + timedelta(days=90)
        credit = Account.objects.create(
            household=household,
            account_type=Account.AccountType.CREDIT,
            name="Credit Card",
            currency="USD",
            starting_balance=Decimal("0"),
            billing_cycle_end_day=1,
            apr=Decimal("18.00"),
        )
        Category.objects.get_or_create(
            household=household,
            name="Interest",
            category_type=Category.CategoryType.EXPENSE,
            defaults={"sort_order": 252},
        )
        # Charge then overpay — raw balance +2 (in credit)
        Transaction.objects.create(
            account=credit,
            date=today - timedelta(days=10),
            payee="Charge",
            amount=Decimal("-100.00"),
            source=Transaction.Source.ACTUAL,
        )
        Transaction.objects.create(
            account=credit,
            date=today - timedelta(days=5),
            payee="Payment",
            amount=Decimal("102.00"),
            source=Transaction.Source.ACTUAL,
        )
        rows = build_timeline(user, start, end, account_id=credit.id)
        interest_rows = [
            r for r in rows
            if r.get("source") == "interest" and r.get("description") == "Projected Interest"
        ]
        assert len(interest_rows) == 0, "expected no projected interest when account is in credit"

    def test_credit_card_projected_interest_when_positive_starting_balance_owed(self, user, household, db):
        """When credit card has positive starting_balance (opening debt) and raw > 0 (still owe), show projected interest."""
        from datetime import timedelta
        today = date.today()
        start = today
        end = today + timedelta(days=90)
        credit = Account.objects.create(
            household=household,
            account_type=Account.AccountType.CREDIT,
            name="Credit Card",
            currency="USD",
            starting_balance=Decimal("95.61"),  # opening debt entered as positive
            billing_cycle_end_day=1,
            apr=Decimal("18.00"),
        )
        Category.objects.get_or_create(
            household=household,
            name="Interest",
            category_type=Category.CategoryType.EXPENSE,
            defaults={"sort_order": 252},
        )
        # Charge 100, pay 68.61 → raw = 95.61 - 100 + 68.61 = 64.22 (owe ~64) — or pay 68.61 so raw = 27
        Transaction.objects.create(
            account=credit,
            date=today - timedelta(days=10),
            payee="Charge",
            amount=Decimal("-100.00"),
            source=Transaction.Source.ACTUAL,
        )
        Transaction.objects.create(
            account=credit,
            date=today - timedelta(days=5),
            payee="Payment",
            amount=Decimal("68.61"),
            source=Transaction.Source.ACTUAL,
        )
        rows = build_timeline(user, start, end, account_id=credit.id)
        interest_rows = [
            r for r in rows
            if r.get("source") == "interest" and r.get("description") == "Projected Interest"
        ]
        assert len(interest_rows) >= 1, "expected projected interest when positive starting_balance and raw > 0 (owe)"

    def test_credit_card_no_projected_interest_when_scheduled_payment_zeroes_before_cycle_end(
        self, user, household, db
    ):
        """When a recurring payment zeroes the balance before the interest cycle end, do not show projected interest."""
        from datetime import timedelta
        today = date.today()
        start = today
        end = today + timedelta(days=90)
        credit = Account.objects.create(
            household=household,
            account_type=Account.AccountType.CREDIT,
            name="Credit Card",
            currency="USD",
            starting_balance=Decimal("0"),
            billing_cycle_end_day=1,  # cycle end e.g. April 1
            apr=Decimal("18.00"),
        )
        Category.objects.get_or_create(
            household=household,
            name="Interest",
            category_type=Category.CategoryType.EXPENSE,
            defaults={"sort_order": 252},
        )
        # Owe $2 today
        Transaction.objects.create(
            account=credit,
            date=today - timedelta(days=5),
            payee="Charge",
            amount=Decimal("-2.00"),
            source=Transaction.Source.ACTUAL,
        )
        # Recurring rule: $2 payment tomorrow (zeroes balance before April 1)
        pay_cat = Category.objects.create(
            household=household,
            name="Credit Card Payment",
            category_type=Category.CategoryType.EXPENSE,
            sort_order=1,
        )
        RecurringRule.objects.create(
            household=household,
            account=credit,
            name="Pay card",
            direction=RecurringRule.Direction.INCOME,
            amount=Decimal("2.00"),
            currency="USD",
            frequency=RecurringRule.Frequency.MONTHLY_DAY,
            interval=1,
            day_of_month=(today + timedelta(days=1)).day,
            start_date=today,
            active=True,
        )
        rows = build_timeline(user, start, end, account_id=credit.id)
        interest_rows = [
            r for r in rows
            if r.get("source") == "interest" and r.get("description") == "Projected Interest"
        ]
        assert len(interest_rows) == 0, (
            "expected no projected interest when scheduled payment zeroes balance before cycle end"
        )

    def test_credit_card_payment_rule_skips_second_when_first_pays_off_card(self, user, household, db):
        """When viewing bank only: rule pays card on 5th and 20th; card has $2 debt. Only first payment should appear."""
        from datetime import timedelta
        today = date.today()
        start = today
        end = today + timedelta(days=60)
        bank = Account.objects.create(
            household=household,
            account_type=Account.AccountType.CHECKING,
            name="Bank",
            currency="USD",
            starting_balance=Decimal("1000.00"),
        )
        card = Account.objects.create(
            household=household,
            account_type=Account.AccountType.CREDIT,
            name="Card",
            currency="USD",
            starting_balance=Decimal("0"),
        )
        Transaction.objects.create(
            account=card,
            date=today - timedelta(days=10),
            payee="Charge",
            amount=Decimal("-2.00"),
            source=Transaction.Source.ACTUAL,
        )
        cat = Category.objects.get_or_create(
            household=household,
            name="Credit Card Payment",
            category_type=Category.CategoryType.EXPENSE,
            defaults={"sort_order": 100},
        )[0]
        rule = RecurringRule.objects.create(
            household=household,
            name="Pay card",
            account=bank,
            transfer_to_account=card,
            category=cat,
            direction=RecurringRule.Direction.EXPENSE,
            amount=Decimal("2.00"),
            currency="USD",
            frequency=RecurringRule.Frequency.MONTHLY_DAY,
            interval=1,
            day_of_month=5,
            start_date=today,
            end_date=None,
            active=True,
        )
        occ = list(
            __import__("timeline.services.ledger", fromlist=["generate_rule_occurrences"]).generate_rule_occurrences(
                rule, start, end
            )
        )
        assert len(occ) >= 2, "need at least two occurrence dates in range"
        rows = build_timeline(user, start, end, account_id=bank.id)
        rule_rows = [
            r for r in rows
            if r.get("rule_id") == rule.id and r.get("account_id") == bank.id
        ]
        assert len(rule_rows) == 1, (
            f"expected exactly one projected payment when card is paid off by first; got {len(rule_rows)}: {rule_rows}"
        )

    def test_credit_card_minimum_payment_rule_hidden_when_card_balance_zero(self, user, household, db):
        """Do not project bank→card minimum payments when the card has no debt (uses DB balance)."""
        from datetime import timedelta

        today = date.today()
        start = today
        end = today + timedelta(days=90)
        bank = Account.objects.create(
            household=household,
            account_type=Account.AccountType.CHECKING,
            name="Bank",
            currency="USD",
            starting_balance=Decimal("5000.00"),
        )
        card = Account.objects.create(
            household=household,
            account_type=Account.AccountType.CREDIT,
            name="Savor",
            currency="USD",
            starting_balance=Decimal("0"),
        )
        cat = Category.objects.get_or_create(
            household=household,
            name="Credit Card Payment",
            category_type=Category.CategoryType.EXPENSE,
            defaults={"sort_order": 100},
        )[0]
        dom = min(max(today.day, 1), 28)
        rule = RecurringRule.objects.create(
            household=household,
            name="Minimum payment Savor",
            account=bank,
            transfer_to_account=card,
            category=cat,
            direction=RecurringRule.Direction.EXPENSE,
            amount=Decimal("35.00"),
            currency="USD",
            frequency=RecurringRule.Frequency.MONTHLY_DAY,
            interval=1,
            day_of_month=dom,
            start_date=today,
            end_date=None,
            active=True,
        )
        occ = list(
            __import__("timeline.services.ledger", fromlist=["generate_rule_occurrences"]).generate_rule_occurrences(
                rule, start, end
            )
        )
        assert len(occ) >= 1, "need at least one occurrence in range for assertion to be meaningful"
        rows = build_timeline(user, start, end, account_id=bank.id)
        rule_bank_rows = [r for r in rows if r.get("rule_id") == rule.id and r.get("account_id") == bank.id]
        assert len(rule_bank_rows) == 0, (
            f"expected no projected min payment when card owes nothing; got {rule_bank_rows}"
        )

    def test_bank_card_payment_projects_when_planned_charge_later_in_month(self, user, household, db):
        """Prefunding must appear when the card has no debt on payment day but known charges post shortly after."""
        from datetime import timedelta

        today = date.today()
        start = today
        end = today + timedelta(days=90)
        bank = Account.objects.create(
            household=household,
            account_type=Account.AccountType.CHECKING,
            name="Bank",
            currency="USD",
            starting_balance=Decimal("5000.00"),
        )
        card = Account.objects.create(
            household=household,
            account_type=Account.AccountType.CREDIT,
            name="Card",
            currency="USD",
            starting_balance=Decimal("0"),
        )
        Transaction.objects.create(
            account=card,
            date=today + timedelta(days=6),
            payee="Scheduled charge",
            amount=Decimal("-75.00"),
            source=Transaction.Source.ACTUAL,
        )
        cat = Category.objects.get_or_create(
            household=household,
            name="Credit Card Payment",
            category_type=Category.CategoryType.EXPENSE,
            defaults={"sort_order": 100},
        )[0]
        dom = min(max(today.day, 1), 28)
        rule = RecurringRule.objects.create(
            household=household,
            name="Med Ins prefund",
            account=bank,
            transfer_to_account=card,
            category=cat,
            direction=RecurringRule.Direction.EXPENSE,
            amount=Decimal("75.00"),
            currency="USD",
            frequency=RecurringRule.Frequency.MONTHLY_DAY,
            interval=1,
            day_of_month=dom,
            start_date=today,
            end_date=None,
            active=True,
        )
        rows = build_timeline(user, start, end, account_id=bank.id)
        rule_bank_rows = [r for r in rows if r.get("rule_id") == rule.id and r.get("account_id") == bank.id]
        assert len(rule_bank_rows) >= 1, (
            f"expected projected bank payment when a card charge is already dated after payment day; got {rule_bank_rows}"
        )

    def test_same_day_credit_payment_rules_process_in_date_order_so_min_skips_after_full_pay(
        self, user, household, db
    ):
        """Global occurrence queue: a larger same-day payment must run before a minimum on that card."""
        from datetime import timedelta

        today = date.today()
        start = today
        end = today + timedelta(days=60)
        bank = Account.objects.create(
            household=household,
            account_type=Account.AccountType.CHECKING,
            name="Bank",
            currency="USD",
            starting_balance=Decimal("5000.00"),
        )
        card = Account.objects.create(
            household=household,
            account_type=Account.AccountType.CREDIT,
            name="Platinum",
            currency="USD",
            starting_balance=Decimal("0"),
        )
        cat = Category.objects.get_or_create(
            household=household,
            name="Credit Card Payment",
            category_type=Category.CategoryType.EXPENSE,
            defaults={"sort_order": 100},
        )[0]
        dom = min(max(today.day, 1), 28)
        Transaction.objects.create(
            account=card,
            date=today - timedelta(days=3),
            payee="Stuff",
            amount=Decimal("-100.00"),
            source=Transaction.Source.ACTUAL,
        )
        # Lower pk runs first in (date, rule_id) order — full payment rule created first
        rule_full = RecurringRule.objects.create(
            household=household,
            name="Pay Platinum full",
            account=bank,
            transfer_to_account=card,
            category=cat,
            direction=RecurringRule.Direction.EXPENSE,
            amount=Decimal("100.00"),
            currency="USD",
            frequency=RecurringRule.Frequency.MONTHLY_DAY,
            interval=1,
            day_of_month=dom,
            start_date=today,
            active=True,
        )
        rule_min = RecurringRule.objects.create(
            household=household,
            name="Platinum minimum",
            account=bank,
            transfer_to_account=card,
            category=cat,
            direction=RecurringRule.Direction.EXPENSE,
            amount=Decimal("25.00"),
            currency="USD",
            frequency=RecurringRule.Frequency.MONTHLY_DAY,
            interval=1,
            day_of_month=dom,
            start_date=today,
            active=True,
        )
        rows = build_timeline(user, start, end, account_id=bank.id)
        min_bank = [r for r in rows if r.get("rule_id") == rule_min.id and r.get("account_id") == bank.id]
        full_bank = [r for r in rows if r.get("rule_id") == rule_full.id and r.get("account_id") == bank.id]
        assert len(full_bank) >= 1, f"expected full payment row; got {full_bank}"
        assert len(min_bank) == 0, f"expected min payment skipped after full pay same day; got {min_bank}"

    def test_filtered_bank_timeline_materializes_other_account_payment_to_card_skips_minimum(
        self, user, household, db
    ):
        """Chase-only view must still run other-household-account rules that pay the same card."""
        from datetime import timedelta

        today = date.today()
        start = today
        end = today + timedelta(days=60)
        chase = Account.objects.create(
            household=household,
            account_type=Account.AccountType.CHECKING,
            name="Chase",
            currency="USD",
            starting_balance=Decimal("5000.00"),
        )
        other_checking = Account.objects.create(
            household=household,
            account_type=Account.AccountType.CHECKING,
            name="Other Bank",
            currency="USD",
            starting_balance=Decimal("3000.00"),
        )
        card = Account.objects.create(
            household=household,
            account_type=Account.AccountType.CREDIT,
            name="Platinum",
            currency="USD",
            starting_balance=Decimal("0"),
        )
        cat = Category.objects.get_or_create(
            household=household,
            name="Credit Card Payment",
            category_type=Category.CategoryType.EXPENSE,
            defaults={"sort_order": 100},
        )[0]
        dom = min(max(today.day, 1), 28)
        Transaction.objects.create(
            account=card,
            date=today - timedelta(days=3),
            payee="Stuff",
            amount=Decimal("-100.00"),
            source=Transaction.Source.ACTUAL,
        )
        rule_other = RecurringRule.objects.create(
            household=household,
            name="Pay Platinum from other",
            account=other_checking,
            transfer_to_account=card,
            category=cat,
            direction=RecurringRule.Direction.EXPENSE,
            amount=Decimal("100.00"),
            currency="USD",
            frequency=RecurringRule.Frequency.MONTHLY_DAY,
            interval=1,
            day_of_month=dom,
            start_date=today,
            active=True,
        )
        rule_chase_min = RecurringRule.objects.create(
            household=household,
            name="Platinum minimum",
            account=chase,
            transfer_to_account=card,
            category=cat,
            direction=RecurringRule.Direction.EXPENSE,
            amount=Decimal("25.00"),
            currency="USD",
            frequency=RecurringRule.Frequency.MONTHLY_DAY,
            interval=1,
            day_of_month=dom,
            start_date=today,
            active=True,
        )
        rows = build_timeline(user, start, end, account_id=chase.id)
        chase_min = [
            r for r in rows
            if r.get("rule_id") == rule_chase_min.id and r.get("account_id") == chase.id
        ]
        assert len(chase_min) == 0, (
            f"expected Chase min hidden after other account paid card same day; got {chase_min}"
        )

    def test_materialized_future_minimum_hidden_on_bank_timeline_when_card_has_no_debt(
        self, user, household, db
    ):
        """DB already has PLANNED rule legs; Chase-only view must hide the checking outflow."""
        from datetime import timedelta

        today = date.today()
        start = today
        end = today + timedelta(days=120)
        bank = Account.objects.create(
            household=household,
            account_type=Account.AccountType.CHECKING,
            name="Chase",
            currency="USD",
            starting_balance=Decimal("5000.00"),
        )
        card = Account.objects.create(
            household=household,
            account_type=Account.AccountType.CREDIT,
            name="Platinum",
            currency="USD",
            starting_balance=Decimal("0"),
        )
        cat = Category.objects.get_or_create(
            household=household,
            name="Credit Card Payment",
            category_type=Category.CategoryType.EXPENSE,
            defaults={"sort_order": 100},
        )[0]
        dom = min(max(today.day, 1), 28)
        rule = RecurringRule.objects.create(
            household=household,
            name="Platinum minimum",
            account=bank,
            transfer_to_account=card,
            category=cat,
            direction=RecurringRule.Direction.EXPENSE,
            amount=Decimal("25.00"),
            currency="USD",
            frequency=RecurringRule.Frequency.MONTHLY_DAY,
            interval=1,
            day_of_month=dom,
            start_date=today,
            active=True,
        )
        occ = list(
            __import__("timeline.services.ledger", fromlist=["generate_rule_occurrences"]).generate_rule_occurrences(
                rule, start, end
            )
        )
        assert len(occ) >= 1
        pay_date = occ[0]
        Transaction.objects.create(
            account=bank,
            date=pay_date,
            payee=rule.name,
            amount=Decimal("-25.00"),
            category=cat,
            status=Transaction.Status.PLANNED,
            source=Transaction.Source.RULE,
            rule=rule,
        )
        Transaction.objects.create(
            account=card,
            date=pay_date,
            payee=rule.name,
            amount=Decimal("25.00"),
            category=None,
            status=Transaction.Status.PLANNED,
            source=Transaction.Source.RULE,
            rule=rule,
        )
        rows = build_timeline(user, start, end, account_id=bank.id)
        leaked = [r for r in rows if r.get("rule_id") == rule.id and r.get("account_id") == bank.id]
        assert len(leaked) == 0, f"expected no projected min on bank when card clear; got {leaked}"

    def test_each_monthly_occurrence_skips_when_destination_balance_zero_that_month(
        self, user, household, db
    ):
        """Across a long horizon, a later month must not show a min payment if the card is clear then."""
        fixed_today = date(2026, 1, 5)
        start = fixed_today
        end = date(2026, 6, 30)
        bank = Account.objects.create(
            household=household,
            account_type=Account.AccountType.CHECKING,
            name="Chase",
            currency="USD",
            starting_balance=Decimal("5000.00"),
        )
        card = Account.objects.create(
            household=household,
            account_type=Account.AccountType.CREDIT,
            name="Platinum",
            currency="USD",
            starting_balance=Decimal("0"),
        )
        cat = Category.objects.get_or_create(
            household=household,
            name="Credit Card Payment",
            category_type=Category.CategoryType.EXPENSE,
            defaults={"sort_order": 100},
        )[0]
        Transaction.objects.create(
            account=card,
            date=date(2026, 1, 2),
            payee="Past",
            amount=Decimal("-40.00"),
            source=Transaction.Source.ACTUAL,
        )
        Transaction.objects.create(
            account=card,
            date=date(2026, 1, 4),
            payee="Payoff",
            amount=Decimal("40.00"),
            source=Transaction.Source.ACTUAL,
        )
        rule = RecurringRule.objects.create(
            household=household,
            name="Platinum minimum",
            account=bank,
            transfer_to_account=card,
            category=cat,
            direction=RecurringRule.Direction.EXPENSE,
            amount=Decimal("25.00"),
            currency="USD",
            frequency=RecurringRule.Frequency.MONTHLY_DAY,
            interval=1,
            day_of_month=15,
            start_date=fixed_today,
            active=True,
        )
        rows = build_timeline(user, start, end, account_id=bank.id, as_of_date=fixed_today)
        leaked = [r for r in rows if r.get("rule_id") == rule.id and r.get("account_id") == bank.id]
        assert len(leaked) == 0, (
            f"expected no min rows Jan–Jun when card stays at zero; got {leaked}"
        )

    def test_orphan_bank_rule_leg_still_skips_when_transfer_to_card_has_no_balance(
        self, user, household, db
    ):
        """If only the checking outflow exists (no +leg on the card), use rule.transfer_to_account."""
        from datetime import timedelta

        today = date.today()
        start = today
        end = today + timedelta(days=90)
        bank = Account.objects.create(
            household=household,
            account_type=Account.AccountType.CHECKING,
            name="Chase",
            currency="USD",
            starting_balance=Decimal("5000.00"),
        )
        card = Account.objects.create(
            household=household,
            account_type=Account.AccountType.CREDIT,
            name="Platinum",
            currency="USD",
            starting_balance=Decimal("0"),
        )
        cat = Category.objects.get_or_create(
            household=household,
            name="Credit Card Payment",
            category_type=Category.CategoryType.EXPENSE,
            defaults={"sort_order": 100},
        )[0]
        dom = min(max(today.day, 1), 28)
        rule = RecurringRule.objects.create(
            household=household,
            name="Platinum minimum",
            account=bank,
            transfer_to_account=card,
            category=cat,
            direction=RecurringRule.Direction.EXPENSE,
            amount=Decimal("25.00"),
            currency="USD",
            frequency=RecurringRule.Frequency.MONTHLY_DAY,
            interval=1,
            day_of_month=dom,
            start_date=today,
            active=True,
        )
        occ = list(
            __import__("timeline.services.ledger", fromlist=["generate_rule_occurrences"]).generate_rule_occurrences(
                rule, start, end
            )
        )
        assert len(occ) >= 1
        pay_date = occ[0]
        # Intentionally only the bank leg — simulates a bad sync or partial delete
        Transaction.objects.create(
            account=bank,
            date=pay_date,
            payee=rule.name,
            amount=Decimal("-25.00"),
            category=cat,
            status=Transaction.Status.PLANNED,
            source=Transaction.Source.RULE,
            rule=rule,
        )
        rows = build_timeline(user, start, end, account_id=bank.id)
        leaked = [r for r in rows if r.get("rule_id") == rule.id]
        assert len(leaked) == 0, f"expected orphan leg hidden/purged; got {leaked}"
        assert not Transaction.objects.filter(rule_id=rule.id, date=pay_date).exists()

    def test_monthly_minimum_continues_while_card_still_owes_despite_projected_interest_later(
        self, user, household, db
    ):
        """
        Projected interest is added after the rule loop; skip logic must not treat balance+payment
        as overpaid using an interest-incomplete balance (regression: payments vanished after ~2mo).
        """
        fixed_today = date(2026, 3, 27)
        start = fixed_today
        end = date(2027, 3, 31)
        bank = Account.objects.create(
            household=household,
            account_type=Account.AccountType.CHECKING,
            name="Chase",
            currency="USD",
            starting_balance=Decimal("10000.00"),
        )
        card = Account.objects.create(
            household=household,
            account_type=Account.AccountType.CREDIT,
            name="Platinum",
            currency="USD",
            starting_balance=Decimal("0"),
            apr=Decimal("19.99"),
            billing_cycle_end_day=2,
        )
        cat = Category.objects.get_or_create(
            household=household,
            name="Credit Card Payment",
            category_type=Category.CategoryType.EXPENSE,
            defaults={"sort_order": 100},
        )[0]
        Transaction.objects.create(
            account=card,
            date=date(2026, 3, 1),
            payee="Purchase",
            amount=Decimal("-800.00"),
            source=Transaction.Source.ACTUAL,
        )
        rule = RecurringRule.objects.create(
            household=household,
            name="Platinum minimum",
            account=bank,
            transfer_to_account=card,
            category=cat,
            direction=RecurringRule.Direction.EXPENSE,
            amount=Decimal("25.00"),
            currency="USD",
            frequency=RecurringRule.Frequency.MONTHLY_DAY,
            interval=1,
            day_of_month=26,
            start_date=fixed_today,
            active=True,
        )
        rows = build_timeline(
            user, start, end, account_id=card.id, as_of_date=fixed_today
        )
        min_on_card = [r for r in rows if r.get("rule_id") == rule.id and r.get("account_id") == card.id]
        assert len(min_on_card) >= 10, (
            f"expected min payments on card through horizon; got {len(min_on_card)}: {min_on_card}"
        )

    def test_checking_to_savings_transfer_rule_materializes_with_positive_savings_balance(
        self, user, household, db
    ):
        """Regression: bank→savings transfers must not be skipped just because savings balance is >= 0."""
        fixed_today = date(2026, 3, 27)
        start = fixed_today
        end = date(2026, 4, 30)
        checking = Account.objects.create(
            household=household,
            account_type=Account.AccountType.CHECKING,
            name="Chase",
            currency="USD",
            starting_balance=Decimal("5000.00"),
        )
        savings = Account.objects.create(
            household=household,
            account_type=Account.AccountType.SAVINGS,
            name="Chase Savings",
            currency="USD",
            starting_balance=Decimal("3000.00"),
        )
        bt = Category.objects.get_or_create(
            household=household,
            name="Bank Transfer",
            category_type=Category.CategoryType.EXPENSE,
            defaults={"sort_order": 50},
        )[0]
        rule = RecurringRule.objects.create(
            household=household,
            name="Save For Rent",
            account=checking,
            transfer_to_account=savings,
            category=bt,
            direction=RecurringRule.Direction.EXPENSE,
            amount=Decimal("680.00"),
            currency="USD",
            frequency=RecurringRule.Frequency.WEEKLY,
            interval=1,
            day_of_week=5,
            start_date=date(2026, 3, 14),
            end_date=None,
            active=True,
        )
        rows = build_timeline(
            user, start, end, account_id=checking.id, as_of_date=fixed_today
        )
        xfer = [r for r in rows if r.get("rule_id") == rule.id and r.get("account_id") == checking.id]
        assert any(r.get("date") == date(2026, 3, 28) for r in xfer), (
            f"expected next Saturday transfer on Chase; got {xfer}"
        )

    def test_checking_to_savings_transfer_projects_on_source_with_projection_only(
        self, user, household, db
    ):
        """projection_only timeline reads must still show Chase outflows for Chase→Savings rules."""
        fixed_today = date(2026, 3, 27)
        start = fixed_today
        end = date(2026, 4, 30)
        checking = Account.objects.create(
            household=household,
            account_type=Account.AccountType.CHECKING,
            name="Chase",
            currency="USD",
            starting_balance=Decimal("5000.00"),
        )
        savings = Account.objects.create(
            household=household,
            account_type=Account.AccountType.SAVINGS,
            name="Chase Savings",
            currency="USD",
            starting_balance=Decimal("3000.00"),
        )
        bt = Category.objects.get_or_create(
            household=household,
            name="Bank Transfer",
            category_type=Category.CategoryType.EXPENSE,
            defaults={"sort_order": 50},
        )[0]
        rule = RecurringRule.objects.create(
            household=household,
            name="Save For Rent",
            account=checking,
            transfer_to_account=savings,
            category=bt,
            direction=RecurringRule.Direction.EXPENSE,
            amount=Decimal("680.00"),
            currency="USD",
            frequency=RecurringRule.Frequency.WEEKLY,
            interval=1,
            day_of_week=5,
            start_date=date(2026, 3, 14),
            end_date=None,
            active=True,
        )
        rows = build_timeline(
            user,
            start,
            end,
            account_id=checking.id,
            as_of_date=fixed_today,
            projection_only=True,
        )
        xfer = [r for r in rows if r.get("rule_id") == rule.id and r.get("account_id") == checking.id]
        assert any(r.get("date") == date(2026, 3, 28) for r in xfer), (
            f"expected projected Saturday transfer on Chase; got {xfer}"
        )
        on_savings = [r for r in rows if r.get("rule_id") == rule.id and r.get("account_id") == savings.id]
        assert len(on_savings) == 0

    def test_duplicate_named_accounts_rule_projects_only_on_bound_account(
        self, user, household, db
    ):
        """Two accounts named Chase: a recurring expense appears only on the account the rule references."""
        from datetime import timedelta

        fixed_today = date(2026, 5, 1)
        start = fixed_today - timedelta(days=90)
        end = fixed_today + timedelta(days=120)
        chase_a = Account.objects.create(
            household=household,
            account_type=Account.AccountType.CHECKING,
            name="Chase",
            last_four="1111",
            institution="Chase",
            currency="USD",
            starting_balance=Decimal("1000.00"),
        )
        chase_b = Account.objects.create(
            household=household,
            account_type=Account.AccountType.CHECKING,
            name="Chase",
            last_four="2222",
            institution="Chase",
            currency="USD",
            starting_balance=Decimal("2000.00"),
        )
        shop = Category.objects.get_or_create(
            household=household,
            name="Shopping",
            category_type=Category.CategoryType.EXPENSE,
            defaults={"sort_order": 10},
        )[0]
        rule = RecurringRule.objects.create(
            household=household,
            name="Affirm",
            account=chase_a,
            category=shop,
            direction=RecurringRule.Direction.EXPENSE,
            amount=Decimal("48.17"),
            currency="USD",
            frequency=RecurringRule.Frequency.MONTHLY_DAY,
            interval=1,
            day_of_month=21,
            start_date=date(2026, 2, 21),
            end_date=None,
            active=True,
        )
        rows_on_a = build_timeline(user, start, end, account_id=chase_a.id, as_of_date=fixed_today)
        rows_on_b = build_timeline(user, start, end, account_id=chase_b.id, as_of_date=fixed_today)
        on_a = [r for r in rows_on_a if r.get("rule_id") == rule.id]
        on_b = [r for r in rows_on_b if r.get("rule_id") == rule.id]
        assert len(on_a) >= 1, f"expected projections on rule.account chase_a; got {on_a}"
        assert len(on_b) == 0, f"other Chase-like account must not show rule rows; got {on_b}"


class TestBalanceAtEndOfDate:
    def test_credit_positive_starting_balance_matches_timeline(self, user, household, db):
        """Reconcile/register balance must match timeline when opening debt is stored as positive starting_balance."""
        from timeline.services.ledger import _balance_at_end_of_date

        credit = Account.objects.create(
            household=household,
            account_type=Account.AccountType.CREDIT,
            name="Card",
            currency="USD",
            starting_balance=Decimal("1000.00"),
        )
        Transaction.objects.create(
            account=credit,
            date=date(2026, 2, 1),
            payee="Store",
            amount=Decimal("-50.00"),
            source=Transaction.Source.ACTUAL,
        )
        Transaction.objects.create(
            account=credit,
            date=date(2026, 2, 15),
            payee="Payment",
            amount=Decimal("200.00"),
            source=Transaction.Source.ACTUAL,
        )
        as_of = date(2026, 2, 15)
        rows = build_timeline(user, date(2026, 1, 1), date(2026, 3, 1), account_id=credit.id)
        timeline_bal = next(
            r["running_balance"]
            for r in reversed(rows)
            if r["date"] <= as_of and r.get("transaction_id") is not None
        )
        ledger_bal = _balance_at_end_of_date(credit.id, as_of)
        assert ledger_bal == timeline_bal
        assert ledger_bal == Decimal("-850.00")


def test_timeline_running_balance_excludes_superseded_planned_duplicate(user, household):
    """Superseded PLANNED duplicates must not change running_balance (matches calendar / ledger sum)."""
    from timeline.services.ledger import _balance_at_end_of_date

    acc = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Main",
        currency="USD",
        starting_balance=Decimal("3730.38"),
    )
    dup_date = date(2026, 5, 30)
    jun1 = date(2026, 6, 1)
    Transaction.objects.create(
        account=acc,
        date=dup_date,
        payee="Credit Card Pmt",
        amount=Decimal("-100.00"),
        status=Transaction.Status.CLEARED,
    )
    Transaction.objects.create(
        account=acc,
        date=dup_date,
        payee="Credit Card Pmt (planned)",
        amount=Decimal("-100.00"),
        status=Transaction.Status.PLANNED,
    )
    Transaction.objects.create(
        account=acc,
        date=jun1,
        payee="Rent",
        amount=Decimal("-3100.00"),
        status=Transaction.Status.CLEARED,
    )
    Transaction.objects.create(
        account=acc,
        date=jun1,
        payee="Credit Card Pmt",
        amount=Decimal("-650.00"),
        status=Transaction.Status.CLEARED,
    )
    rows = build_timeline(user, date(2026, 5, 28), date(2026, 6, 30), account_id=acc.id)
    dup_cleared = next(r for r in rows if r["date"] == dup_date and r["status"] == Transaction.Status.CLEARED)
    dup_planned = next(r for r in rows if r["date"] == dup_date and r["status"] == Transaction.Status.PLANNED)
    cc_row = next(r for r in rows if r["date"] == jun1 and r["description"] == "Credit Card Pmt")
    assert dup_cleared["running_balance"] == Decimal("3630.38")
    assert dup_planned["running_balance"] == Decimal("3630.38")
    assert cc_row["running_balance"] == Decimal("-119.62")
    assert cc_row["running_balance"] == _balance_at_end_of_date(acc.id, jun1)
