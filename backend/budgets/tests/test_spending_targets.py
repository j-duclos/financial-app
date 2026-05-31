"""Tests for spending target calculations and API."""
from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model

from accounts.models import Account
from budgets.models import SpendingTarget
from budgets.services.spending_targets import (
    STATUS_ABOVE,
    STATUS_APPROACHING,
    STATUS_WITHIN,
    calculate_target_metrics,
    period_bounds,
    recommendations_from_spending_targets,
    spending_targets_summary,
    suggest_target_type,
)
from categories.models import Category
from core.models import Household, HouseholdMembership
from timeline.models import RecurringRule
from transactions.models import Transaction

User = get_user_model()
AS_OF = date(2026, 5, 15)


@pytest.fixture
def user(db):
    return User.objects.create_user(username="stuser", password="testpass123")


@pytest.fixture
def household(user):
    h = Household.objects.create(name="ST Home")
    HouseholdMembership.objects.create(household=h, user=user, role=HouseholdMembership.Role.OWNER)
    return h


@pytest.fixture
def expense_category(household):
    return Category.objects.create(
        household=household,
        name="Groceries",
        category_type=Category.CategoryType.EXPENSE,
    )


@pytest.fixture
def transfer_category(household):
    return Category.objects.create(
        household=household,
        name="Transfer",
        category_type=Category.CategoryType.EXPENSE,
        is_system=True,
    )


@pytest.fixture
def checking(household):
    return Account.objects.create(
        household=household,
        name="Main",
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        starting_balance=Decimal("5000"),
    )


@pytest.fixture
def target(household, expense_category):
    return SpendingTarget.objects.create(
        household=household,
        category=expense_category,
        target_amount=Decimal("700"),
        period=SpendingTarget.Period.MONTHLY,
        target_type=SpendingTarget.TargetType.VARIABLE,
        warning_threshold_percent=Decimal("80"),
    )


@pytest.fixture
def fixed_target(household, expense_category):
    return SpendingTarget.objects.create(
        household=household,
        category=expense_category,
        target_amount=Decimal("700"),
        period=SpendingTarget.Period.MONTHLY,
        target_type=SpendingTarget.TargetType.FIXED,
        warning_threshold_percent=Decimal("80"),
    )


@pytest.mark.django_db
def test_period_bounds_monthly():
    start, end = period_bounds("monthly", date(2026, 5, 15))
    assert start == date(2026, 5, 1)
    assert end == date(2026, 5, 31)


@pytest.mark.django_db
def test_spent_excludes_transfers(
    user, household, checking, expense_category, transfer_category, target
):
    Transaction.objects.create(
        account=checking,
        date=AS_OF,
        payee="Groceries",
        amount=Decimal("-100"),
        category=expense_category,
        status=Transaction.Status.CLEARED,
    )
    Transaction.objects.create(
        account=checking,
        date=AS_OF,
        payee="Xfer",
        amount=Decimal("-200"),
        category=transfer_category,
        status=Transaction.Status.CLEARED,
    )
    metrics = calculate_target_metrics(target, anchor=AS_OF, today=AS_OF, include_scheduled=False)
    assert Decimal(metrics["spent_so_far"]) == Decimal("100")


@pytest.mark.django_db
def test_credit_card_payment_category_excluded(
    user, household, checking, expense_category, target
):
    cc_pay = Category.objects.create(
        household=household,
        name="Credit Card Payment",
        category_type=Category.CategoryType.EXPENSE,
        is_system=True,
    )
    Transaction.objects.create(
        account=checking,
        date=AS_OF,
        payee="Card pay",
        amount=Decimal("-500"),
        category=cc_pay,
        status=Transaction.Status.CLEARED,
    )
    Transaction.objects.create(
        account=checking,
        date=AS_OF,
        payee="Food",
        amount=Decimal("-50"),
        category=expense_category,
        status=Transaction.Status.CLEARED,
    )
    metrics = calculate_target_metrics(target, anchor=AS_OF, today=AS_OF, include_scheduled=False)
    assert Decimal(metrics["spent_so_far"]) == Decimal("50")


@pytest.mark.django_db
def test_future_planned_fixed_target(user, household, checking, expense_category, fixed_target):
    Transaction.objects.create(
        account=checking,
        date=AS_OF,
        payee="So far",
        amount=Decimal("-420"),
        category=expense_category,
        status=Transaction.Status.CLEARED,
    )
    Transaction.objects.create(
        account=checking,
        date=AS_OF + timedelta(days=10),
        payee="Future shop",
        amount=Decimal("-200"),
        category=expense_category,
        status=Transaction.Status.PLANNED,
    )
    metrics = calculate_target_metrics(fixed_target, anchor=AS_OF, today=AS_OF)
    assert Decimal(metrics["spent_so_far"]) == Decimal("420")
    assert Decimal(metrics["scheduled_in_period"]) == Decimal("200")
    assert Decimal(metrics["forecast_amount"]) == Decimal("620")
    assert metrics["forecast_method"] == "scheduled_only"
    assert metrics["status"] in (STATUS_ABOVE, STATUS_APPROACHING)


@pytest.mark.django_db
def test_variable_target_uses_scheduled_only(
    user, household, checking, expense_category, target
):
    Transaction.objects.create(
        account=checking,
        date=AS_OF,
        payee="So far",
        amount=Decimal("-420"),
        category=expense_category,
        status=Transaction.Status.CLEARED,
    )
    Transaction.objects.create(
        account=checking,
        date=AS_OF + timedelta(days=10),
        payee="Future shop",
        amount=Decimal("-200"),
        category=expense_category,
        status=Transaction.Status.PLANNED,
    )
    metrics = calculate_target_metrics(target, anchor=AS_OF, today=AS_OF)
    assert Decimal(metrics["spent_so_far"]) == Decimal("420")
    assert Decimal(metrics["scheduled_in_period"]) == Decimal("200")
    assert Decimal(metrics["forecast_amount"]) == Decimal("620")
    assert Decimal(metrics["remaining_to_target"]) == Decimal("80")
    assert metrics["forecast_method"] == "scheduled_only"


@pytest.mark.django_db
def test_groceries_no_future_txns_remaining_is_target_minus_spent(
    user, household, checking, expense_category, target
):
    target.target_amount = Decimal("550")
    target.save(update_fields=["target_amount"])
    Transaction.objects.create(
        account=checking,
        date=AS_OF,
        payee="Store",
        amount=Decimal("-177.13"),
        category=expense_category,
        status=Transaction.Status.CLEARED,
    )
    metrics = calculate_target_metrics(target, anchor=AS_OF, today=AS_OF)
    assert Decimal(metrics["spent_so_far"]) == Decimal("177.13")
    assert Decimal(metrics["scheduled_in_period"]) == Decimal("0")
    assert Decimal(metrics["remaining_to_target"]) == Decimal("372.87")
    assert metrics["forecast_summary"] is None
    assert metrics["status"] == STATUS_WITHIN


@pytest.mark.django_db
def test_groceries_no_future_txns_committed_equals_spent(
    user, household, checking, expense_category, target
):
    Transaction.objects.create(
        account=checking,
        date=AS_OF,
        payee="Store",
        amount=Decimal("-177.13"),
        category=expense_category,
        status=Transaction.Status.CLEARED,
    )
    metrics = calculate_target_metrics(target, anchor=AS_OF, today=AS_OF)
    assert Decimal(metrics["spent_so_far"]) == Decimal("177.13")
    assert Decimal(metrics["scheduled_in_period"]) == Decimal("0")
    assert Decimal(metrics["forecast_amount"]) == Decimal("177.13")
    assert metrics["status"] == STATUS_WITHIN


@pytest.mark.django_db
def test_fixed_insurance_no_phantom_pacing(user, household, checking):
    insurance = Category.objects.create(
        household=household,
        name="Auto Insurance",
        category_type=Category.CategoryType.EXPENSE,
    )
    ins_target = SpendingTarget.objects.create(
        household=household,
        category=insurance,
        target_amount=Decimal("404"),
        period=SpendingTarget.Period.MONTHLY,
        target_type=SpendingTarget.TargetType.FIXED,
        warning_threshold_percent=Decimal("100"),
    )
    Transaction.objects.create(
        account=checking,
        date=date(2026, 5, 1),
        payee="Geico",
        amount=Decimal("-403.43"),
        category=insurance,
        status=Transaction.Status.CLEARED,
    )
    metrics = calculate_target_metrics(
        ins_target, anchor=AS_OF, today=AS_OF, include_scheduled=True
    )
    assert Decimal(metrics["spent_so_far"]) == Decimal("403.43")
    assert Decimal(metrics["scheduled_in_period"]) == Decimal("0")
    assert Decimal(metrics["remaining_to_target"]) == Decimal("0.57")
    assert metrics["forecast_summary"] is None
    assert metrics["status"] == STATUS_APPROACHING
    assert metrics["forecast_method"] == "scheduled_only"


@pytest.mark.django_db
def test_fixed_insurance_no_double_count_after_midmonth_payment(user, household, checking):
    """May bill already posted; June bill must not appear in May scheduled remaining."""
    insurance = Category.objects.create(
        household=household,
        name="Auto Insurance",
        category_type=Category.CategoryType.EXPENSE,
    )
    rule = RecurringRule.objects.create(
        household=household,
        name="Geico",
        account=checking,
        category=insurance,
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("403.43"),
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        day_of_month=24,
        start_date=date(2026, 5, 24),
    )
    ins_target = SpendingTarget.objects.create(
        household=household,
        category=insurance,
        target_amount=Decimal("404"),
        period=SpendingTarget.Period.MONTHLY,
        target_type=SpendingTarget.TargetType.FIXED,
        warning_threshold_percent=Decimal("100"),
    )
    Transaction.objects.create(
        account=checking,
        date=date(2026, 5, 24),
        payee="Geico",
        amount=Decimal("-403.43"),
        category=insurance,
        rule=rule,
        status=Transaction.Status.PLANNED,
    )
    today = date(2026, 5, 28)
    metrics = calculate_target_metrics(
        ins_target, anchor=today, today=today, include_scheduled=True
    )
    assert Decimal(metrics["spent_so_far"]) == Decimal("403.43")
    assert Decimal(metrics["scheduled_in_period"]) == Decimal("0")
    assert Decimal(metrics["forecast_amount"]) == Decimal("403.43")
    assert metrics["status"] == STATUS_APPROACHING


@pytest.mark.django_db
def test_planned_on_or_before_today_in_spent(
    user, household, checking, expense_category, fixed_target
):
    Transaction.objects.create(
        account=checking,
        date=AS_OF,
        payee="Geico",
        amount=Decimal("-403.43"),
        category=expense_category,
        status=Transaction.Status.PLANNED,
    )
    metrics = calculate_target_metrics(fixed_target, anchor=AS_OF, today=AS_OF)
    assert Decimal(metrics["spent_so_far"]) == Decimal("403.43")
    assert Decimal(metrics["scheduled_in_period"]) == Decimal("0")


@pytest.mark.django_db
def test_above_target_status(user, household, checking, expense_category, target):
    Transaction.objects.create(
        account=checking,
        date=AS_OF,
        payee="Big shop",
        amount=Decimal("-750"),
        category=expense_category,
        status=Transaction.Status.CLEARED,
    )
    metrics = calculate_target_metrics(target, anchor=AS_OF, today=AS_OF, include_scheduled=False)
    assert metrics["status"] == STATUS_ABOVE
    assert Decimal(metrics["spent_so_far"]) > Decimal(metrics["target_amount"])


@pytest.mark.django_db
def test_approaching_threshold(user, household, checking, expense_category, target):
    Transaction.objects.create(
        account=checking,
        date=AS_OF,
        payee="Shop",
        amount=Decimal("-580"),
        category=expense_category,
        status=Transaction.Status.CLEARED,
    )
    metrics = calculate_target_metrics(target, anchor=AS_OF, today=AS_OF, include_scheduled=False)
    assert metrics["status"] == STATUS_APPROACHING


@pytest.mark.django_db
def test_recommendation_generated(user, target, household, checking, expense_category):
    Transaction.objects.create(
        account=checking,
        date=AS_OF,
        payee="Spend",
        amount=Decimal("-800"),
        category=expense_category,
        status=Transaction.Status.CLEARED,
    )
    recs = recommendations_from_spending_targets(user, anchor=AS_OF)
    assert len(recs) >= 1
    assert recs[0]["primary_action_label"] == "View spending limits"
    assert recs[0]["primary_action_url"] == "/spending-goals"
    assert "Groceries" in recs[0]["why"] or "groceries" in recs[0]["why"].lower()


@pytest.fixture
def api_client():
    from rest_framework.test import APIClient

    return APIClient()


@pytest.mark.django_db
def test_spent_aggregates_duplicate_category_names(user, household, checking, target):
    """Transactions on a duplicate category row still count toward the target."""
    dup = Category.objects.create(
        household=household,
        name="Groceries",
        category_type=Category.CategoryType.EXPENSE,
    )
    Transaction.objects.create(
        account=checking,
        date=AS_OF,
        payee="Store A",
        amount=Decimal("-40"),
        category=target.category,
        status=Transaction.Status.CLEARED,
    )
    Transaction.objects.create(
        account=checking,
        date=AS_OF,
        payee="Store B",
        amount=Decimal("-60"),
        category=dup,
        status=Transaction.Status.CLEARED,
    )
    metrics = calculate_target_metrics(target, anchor=AS_OF, today=AS_OF, include_scheduled=False)
    assert Decimal(metrics["spent_so_far"]) == Decimal("100")


@pytest.mark.django_db
def test_credit_card_payment_target_includes_payments(user, household, checking):
    cc_pay = Category.objects.create(
        household=household,
        name="Credit Card Payment",
        category_type=Category.CategoryType.EXPENSE,
        is_system=True,
    )
    cc_target = SpendingTarget.objects.create(
        household=household,
        category=cc_pay,
        target_amount=Decimal("500"),
        period=SpendingTarget.Period.MONTHLY,
    )
    Transaction.objects.create(
        account=checking,
        date=AS_OF,
        payee="Card pay",
        amount=Decimal("-450"),
        category=cc_pay,
        status=Transaction.Status.CLEARED,
    )
    metrics = calculate_target_metrics(cc_target, anchor=AS_OF, today=AS_OF, include_scheduled=False)
    assert Decimal(metrics["spent_so_far"]) == Decimal("450")


@pytest.mark.django_db
def test_suggest_fixed_when_recurring_rule(user, household, checking, expense_category):
    RecurringRule.objects.create(
        household=household,
        name="Rent",
        account=checking,
        category=expense_category,
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("1500"),
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        day_of_month=1,
        start_date=date(2025, 1, 1),
    )
    result = suggest_target_type(expense_category)
    assert result["target_type"] == SpendingTarget.TargetType.FIXED
    assert "recurring" in result["reason"].lower()


@pytest.mark.django_db
def test_credit_card_payment_with_scheduled_remaining(
    user, household, checking
):
    cc_pay = Category.objects.create(
        household=household,
        name="Credit Card Payment",
        category_type=Category.CategoryType.EXPENSE,
        is_system=True,
    )
    cc_target = SpendingTarget.objects.create(
        household=household,
        category=cc_pay,
        target_amount=Decimal("450"),
        period=SpendingTarget.Period.MONTHLY,
    )
    Transaction.objects.create(
        account=checking,
        date=AS_OF,
        payee="Card pay posted",
        amount=Decimal("-520"),
        category=cc_pay,
        status=Transaction.Status.CLEARED,
    )
    Transaction.objects.create(
        account=checking,
        date=AS_OF + timedelta(days=10),
        payee="Card pay planned",
        amount=Decimal("-620"),
        category=cc_pay,
        status=Transaction.Status.PLANNED,
    )
    metrics = calculate_target_metrics(cc_target, anchor=AS_OF, today=AS_OF)
    assert Decimal(metrics["spent_so_far"]) == Decimal("520")
    assert Decimal(metrics["scheduled_in_period"]) == Decimal("620")
    assert Decimal(metrics["remaining_to_target"]) == Decimal("-690")
    assert metrics["status"] == STATUS_ABOVE


@pytest.mark.django_db
def test_fixed_over_target_not_risky(user, household, checking, expense_category, fixed_target):
    Transaction.objects.create(
        account=checking,
        date=AS_OF,
        payee="Big bill",
        amount=Decimal("-800"),
        category=expense_category,
        status=Transaction.Status.CLEARED,
    )
    metrics = calculate_target_metrics(fixed_target, anchor=AS_OF, today=AS_OF, include_scheduled=False)
    assert metrics["status"] == STATUS_ABOVE
    assert metrics["status"] != "risky"
    assert metrics["forecast_summary"] is None or "Expected" not in metrics["forecast_summary"]


@pytest.mark.django_db
def test_summary_endpoint(api_client, user, household, target):
    api_client.force_authenticate(user=user)
    r = api_client.get("/api/spending-targets/summary/")
    assert r.status_code == 200
    assert "targets" in r.json()
    assert "total_monthly_targets" in r.json()


@pytest.mark.django_db
def test_future_planned_skipped_when_rule_already_posted_same_month(
    user, household, checking, expense_category, fixed_target
):
    rule = RecurringRule.objects.create(
        household=household,
        name="Card pay",
        account=checking,
        category=expense_category,
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("620"),
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        day_of_month=20,
        start_date=date(2026, 1, 20),
    )
    Transaction.objects.create(
        account=checking,
        date=AS_OF,
        payee="Card pay posted",
        amount=Decimal("-520"),
        category=expense_category,
        rule=rule,
        status=Transaction.Status.CLEARED,
    )
    Transaction.objects.create(
        account=checking,
        date=date(2026, 5, 20),
        payee="Card pay planned",
        amount=Decimal("-620"),
        category=expense_category,
        rule=rule,
        status=Transaction.Status.PLANNED,
    )
    metrics = calculate_target_metrics(fixed_target, anchor=AS_OF, today=AS_OF)
    assert Decimal(metrics["spent_so_far"]) == Decimal("520")
    assert Decimal(metrics["scheduled_in_period"]) == Decimal("0")
    assert Decimal(metrics["forecast_amount"]) == Decimal("520")
