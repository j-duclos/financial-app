"""Tests for household debt payoff engine."""
from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.core.cache import cache
from django.db import connection
from django.test.utils import CaptureQueriesContext

from accounts.models import Account
from accounts.services.balances import bulk_signed_ledger_balances
from credit_cards.services.debt_engine import (
    _copy_card_states,
    _load_card_states,
    _run_payoff_loop,
    _weighted_apr,
    simulate_household_debt,
)
from credit_cards.services.payoff import project_credit_card_payoff
from transactions.services.posting import post_transaction


@pytest.fixture
def card_a(household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        name="High APR",
        credit_limit=Decimal("5000"),
        apr=Decimal("24"),
        minimum_payment_amount=Decimal("40"),
    )


@pytest.fixture
def card_b(household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        name="Low Balance",
        credit_limit=Decimal("3000"),
        apr=Decimal("18"),
        minimum_payment_amount=Decimal("25"),
    )


def _debt(card, user, amount):
    post_transaction(user, card.id, date.today(), "Charge", -amount)


def _milestone(plan, milestone_id: str) -> dict:
    for row in plan["milestones"]:
        if row["id"] == milestone_id:
            return row
    raise AssertionError(f"milestone {milestone_id} missing")


@pytest.mark.django_db
def test_simulate_avalanche_payoff(user, card_a, card_b):
    _debt(card_a, user, Decimal("2000"))
    _debt(card_b, user, Decimal("500"))
    plan = simulate_household_debt(
        [card_a, card_b],
        strategy="avalanche",
        mode="aggressive",
        extra_monthly=Decimal("200"),
    )
    assert Decimal(plan["total_debt"]) > 0
    assert plan["debt_free_possible"] is True
    assert len(plan["cards"]) >= 2
    assert card_a.id in plan["payoff_order"]
    assert plan["payoff_order"][0] == card_a.id


@pytest.mark.django_db
def test_simulate_snowball_order(user, card_a, card_b):
    _debt(card_a, user, Decimal("2000"))
    _debt(card_b, user, Decimal("300"))
    plan = simulate_household_debt(
        [card_a, card_b],
        strategy="snowball",
        mode="aggressive",
        extra_monthly=Decimal("300"),
    )
    assert plan["payoff_order"] and plan["payoff_order"][0] == card_b.id


@pytest.mark.django_db
def test_empty_when_no_debt(user, card_a):
    plan = simulate_household_debt([card_a], strategy="avalanche", mode="survival")
    assert plan["total_debt"] == "0.00"
    assert plan["weighted_apr"] == "0.00"
    assert plan["debt_free_possible"] is True


def _card_suggested(plan, account_id: int) -> Decimal:
    for row in plan["cards"]:
        if row["account_id"] == account_id:
            return Decimal(row["suggested_payment"])
    raise AssertionError(f"card {account_id} not in plan")


@pytest.mark.django_db
def test_extra_monthly_raises_focus_card_suggested_payment(user, card_a, card_b):
    _debt(card_a, user, Decimal("2000"))
    _debt(card_b, user, Decimal("500"))
    low_extra = simulate_household_debt(
        [card_a, card_b],
        strategy="avalanche",
        mode="aggressive",
        extra_monthly=Decimal("50"),
    )
    high_extra = simulate_household_debt(
        [card_a, card_b],
        strategy="avalanche",
        mode="aggressive",
        extra_monthly=Decimal("500"),
    )
    assert _card_suggested(high_extra, card_a.id) > _card_suggested(low_extra, card_a.id)
    assert Decimal(high_extra["monthly_payment_budget"]) > Decimal(
        low_extra["monthly_payment_budget"]
    )


@pytest.mark.django_db
def test_weighted_apr_uses_opening_balances_not_final_zeros(user, card_a, card_b):
    _debt(card_a, user, Decimal("1000"))
    _debt(card_b, user, Decimal("500"))
    plan = simulate_household_debt(
        [card_a, card_b],
        strategy="avalanche",
        mode="aggressive",
        extra_monthly=Decimal("400"),
    )
    expected = (Decimal("1000") * Decimal("24") + Decimal("500") * Decimal("18")) / Decimal("1500")
    assert Decimal(plan["weighted_apr"]) == expected.quantize(Decimal("0.01"))
    assert Decimal(plan["weighted_apr"]) > 0
    assert Decimal(plan["total_debt"]) == Decimal("1500.00")
    assert plan["debt_free_possible"] is True


@pytest.mark.django_db
def test_weighted_apr_zero_when_no_balances(user, card_a):
    assert _weighted_apr([]) == Decimal("0")
    plan = simulate_household_debt([card_a])
    assert plan["weighted_apr"] == "0.00"


@pytest.mark.django_db
def test_opening_states_unchanged_after_simulation(user, card_a, card_b):
    _debt(card_a, user, Decimal("2000"))
    _debt(card_b, user, Decimal("500"))
    today = date.today()
    opening = _load_card_states([card_a, card_b], as_of=today)
    before = {s.account.pk: s.balance for s in opening}
    sim = _copy_card_states(opening)
    _run_payoff_loop(
        sim,
        strategy="avalanche",
        mode="aggressive",
        extra_monthly=Decimal("300"),
        custom_order=None,
        today=today,
        max_months=360,
    )
    after = {s.account.pk: s.balance for s in opening}
    assert before == after
    assert all(v > 0 for v in after.values())
    assert all(s.balance == 0 or s.balance < before[s.account.pk] for s in sim)


@pytest.mark.django_db
def test_recommendations_use_opening_high_apr_and_utilization(user, household):
    high = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        name="Card A",
        credit_limit=Decimal("1112"),
        apr=Decimal("32"),
        minimum_payment_amount=Decimal("40"),
    )
    low = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        name="Card B",
        credit_limit=Decimal("2500"),
        apr=Decimal("15"),
        minimum_payment_amount=Decimal("25"),
    )
    _debt(high, user, Decimal("1000"))
    _debt(low, user, Decimal("500"))
    plan = simulate_household_debt(
        [high, low],
        strategy="avalanche",
        mode="aggressive",
        extra_monthly=Decimal("800"),
    )
    assert plan["debt_free_possible"] is True
    messages = [r["message"] for r in plan["recommendations"]]
    assert any("Card A" in m and "32.00% APR" in m for m in messages)
    assert any("Card A" in m and "30% utilization" in m for m in messages)
    assert not any("Card B" in m and "APR" in m for m in messages)


@pytest.mark.django_db
def test_milestones_achieved_from_opening_not_final_zeros(user, household):
    card = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        name="Maxed",
        credit_limit=Decimal("1000"),
        apr=Decimal("22"),
        minimum_payment_amount=Decimal("40"),
    )
    _debt(card, user, Decimal("900"))
    plan = simulate_household_debt(
        [card],
        strategy="avalanche",
        mode="aggressive",
        extra_monthly=Decimal("400"),
    )
    assert plan["debt_free_possible"] is True
    first = _milestone(plan, "first_card_paid")
    util_50 = _milestone(plan, "util_below_50")
    util_30 = _milestone(plan, "util_below_30")
    debt_free = _milestone(plan, "debt_free")
    assert first["achieved"] is False
    assert first["month"] is not None
    assert util_50["achieved"] is False
    assert util_30["achieved"] is False
    assert debt_free["achieved"] is False
    assert debt_free["month"] == plan["months_to_debt_free"]


@pytest.mark.django_db
def test_utilization_target_pays_highest_utilization_first(user, household):
    hot = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        name="Hot Util",
        credit_limit=Decimal("1000"),
        apr=Decimal("12"),
        minimum_payment_amount=Decimal("25"),
    )
    cool = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        name="Cool Util",
        credit_limit=Decimal("5000"),
        apr=Decimal("28"),
        minimum_payment_amount=Decimal("25"),
    )
    _debt(hot, user, Decimal("900"))
    _debt(cool, user, Decimal("500"))
    plan = simulate_household_debt(
        [hot, cool],
        strategy="utilization_target",
        mode="credit_score",
        extra_monthly=Decimal("400"),
    )
    assert plan["payoff_order"][0] == hot.id


@pytest.mark.django_db
def test_custom_order_respected(user, card_a, card_b, household):
    card_c = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        name="Custom First",
        credit_limit=Decimal("4000"),
        apr=Decimal("10"),
        minimum_payment_amount=Decimal("25"),
    )
    _debt(card_a, user, Decimal("2000"))
    _debt(card_b, user, Decimal("800"))
    _debt(card_c, user, Decimal("1500"))
    plan = simulate_household_debt(
        [card_a, card_b, card_c],
        strategy="custom",
        mode="aggressive",
        extra_monthly=Decimal("2000"),
        custom_order=[card_c.id, card_b.id, card_a.id],
    )
    assert plan["payoff_order"][0] == card_c.id


@pytest.mark.django_db
def test_survival_mode_uses_minimums_only_budget(user, card_a, card_b):
    _debt(card_a, user, Decimal("2000"))
    _debt(card_b, user, Decimal("500"))
    survival = simulate_household_debt(
        [card_a, card_b], strategy="avalanche", mode="survival", extra_monthly=Decimal("500")
    )
    aggressive = simulate_household_debt(
        [card_a, card_b], strategy="avalanche", mode="aggressive", extra_monthly=Decimal("500")
    )
    assert Decimal(survival["monthly_payment_budget"]) == Decimal("65.00")
    assert Decimal(aggressive["monthly_payment_budget"]) == Decimal("565.00")


@pytest.mark.django_db
def test_balanced_mode_uses_sixty_percent_of_extra(user, card_a, card_b):
    _debt(card_a, user, Decimal("2000"))
    _debt(card_b, user, Decimal("500"))
    plan = simulate_household_debt(
        [card_a, card_b],
        strategy="avalanche",
        mode="balanced",
        extra_monthly=Decimal("100"),
    )
    assert Decimal(plan["monthly_payment_budget"]) == Decimal("125.00")


@pytest.mark.django_db
def test_promo_apr_used_in_opening_weighted_apr(user, household):
    promo = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        name="Promo",
        credit_limit=Decimal("3000"),
        apr=Decimal("29.99"),
        promotional_apr=Decimal("0"),
        promotional_end_date=date.today() + timedelta(days=60),
        minimum_payment_amount=Decimal("25"),
    )
    regular = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        name="Regular",
        credit_limit=Decimal("3000"),
        apr=Decimal("20"),
        minimum_payment_amount=Decimal("25"),
    )
    _debt(promo, user, Decimal("1000"))
    _debt(regular, user, Decimal("1000"))
    plan = simulate_household_debt(
        [promo, regular],
        strategy="avalanche",
        mode="aggressive",
        extra_monthly=Decimal("200"),
    )
    expected = (Decimal("1000") * Decimal("0") + Decimal("1000") * Decimal("20")) / Decimal("2000")
    assert Decimal(plan["weighted_apr"]) == expected.quantize(Decimal("0.01"))


@pytest.mark.django_db
def test_interest_burn_and_total_debt_are_opening_state(user, card_a, card_b):
    _debt(card_a, user, Decimal("1200"))
    _debt(card_b, user, Decimal("600"))
    plan = simulate_household_debt(
        [card_a, card_b],
        strategy="avalanche",
        mode="aggressive",
        extra_monthly=Decimal("500"),
    )
    expected_burn = (
        Decimal("1200") * Decimal("24") / Decimal("100") / Decimal("12")
        + Decimal("600") * Decimal("18") / Decimal("100") / Decimal("12")
    ).quantize(Decimal("0.01"))
    assert Decimal(plan["total_debt"]) == Decimal("1800.00")
    assert Decimal(plan["monthly_interest_burn"]) == expected_burn


@pytest.mark.django_db
def test_interest_saved_compares_same_opening_balances(user, card_a, card_b):
    _debt(card_a, user, Decimal("2000"))
    _debt(card_b, user, Decimal("500"))
    cache.clear()
    plan = simulate_household_debt(
        [card_a, card_b],
        strategy="avalanche",
        mode="aggressive",
        extra_monthly=Decimal("200"),
    )
    baseline = Decimal(plan["total_interest_minimums_only"])
    selected = Decimal(plan["total_interest"])
    saved = Decimal(plan["interest_saved_vs_minimums"])
    assert baseline >= selected
    assert saved == (baseline - selected).quantize(Decimal("0.01"))


@pytest.mark.django_db
def test_minimum_baseline_reused_when_only_extra_monthly_changes(user, card_a, card_b):
    _debt(card_a, user, Decimal("2000"))
    _debt(card_b, user, Decimal("500"))
    cache.clear()
    today = date.today()
    balance_map = bulk_signed_ledger_balances([card_a, card_b], today)
    from unittest.mock import patch

    from credit_cards.services import debt_engine as engine

    with patch.object(engine, "_run_payoff_loop", wraps=engine._run_payoff_loop) as spy:
        simulate_household_debt(
            [card_a, card_b],
            extra_monthly=Decimal("150"),
            as_of=today,
            balance_by_account=balance_map,
        )
        first_calls = spy.call_count
        simulate_household_debt(
            [card_a, card_b],
            extra_monthly=Decimal("250"),
            as_of=today,
            balance_by_account=balance_map,
        )
        assert first_calls == 2
        assert spy.call_count == 3


@pytest.mark.django_db
def test_lump_sum_does_not_change_opening_total_debt(user, card_a, card_b):
    _debt(card_a, user, Decimal("2000"))
    _debt(card_b, user, Decimal("500"))
    plan = simulate_household_debt(
        [card_a, card_b],
        strategy="avalanche",
        mode="aggressive",
        extra_monthly=Decimal("100"),
        lump_sum_by_account={card_a.id: Decimal("500")},
    )
    assert Decimal(plan["total_debt"]) == Decimal("2500.00")
    assert Decimal(plan["weighted_apr"]) > 0


@pytest.mark.django_db
def test_simulation_and_projections_are_sql_free_with_balance_map(user, card_a, card_b):
    _debt(card_a, user, Decimal("2000"))
    _debt(card_b, user, Decimal("500"))
    today = date.today()
    cards = [card_a, card_b]
    balance_map = bulk_signed_ledger_balances(cards, today)
    connection.queries_log.clear()
    with CaptureQueriesContext(connection) as ctx:
        plan = simulate_household_debt(
            cards,
            strategy="avalanche",
            mode="aggressive",
            extra_monthly=Decimal("200"),
            as_of=today,
            balance_by_account=balance_map,
        )
        project_credit_card_payoff(
            card_a,
            "custom_amount",
            custom_amount=Decimal("150"),
            start_date=today,
            starting_balance=Decimal("2000"),
        )
    assert len(ctx.captured_queries) == 0
    assert Decimal(plan["weighted_apr"]) > 0
