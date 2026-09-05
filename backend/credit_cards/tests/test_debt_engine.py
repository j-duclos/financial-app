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
        # Min must exceed monthly interest at typical test balances (~$40 on $2k @ 24%).
        minimum_payment_amount=Decimal("50"),
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
def test_card_priority_reason_metadata(user, card_a, card_b):
    _debt(card_a, user, Decimal("2000"))
    _debt(card_b, user, Decimal("300"))
    avalanche = simulate_household_debt(
        [card_a, card_b],
        strategy="avalanche",
        mode="aggressive",
        extra_monthly=Decimal("100"),
    )
    first = next(c for c in avalanche["cards"] if c["payoff_order"] == 1)
    assert first["priority_reason"]["code"] == "highest_apr"
    assert "APR" in first["priority_reason"]["label"]

    snowball = simulate_household_debt(
        [card_a, card_b],
        strategy="snowball",
        mode="aggressive",
        extra_monthly=Decimal("100"),
    )
    snow_first = next(c for c in snowball["cards"] if c["payoff_order"] == 1)
    assert snow_first["priority_reason"]["code"] == "lowest_balance"

    second = next(c for c in avalanche["cards"] if c["payoff_order"] == 2)
    assert second["priority_reason"]["code"] == "next_in_plan"


def _first_card(plan: dict) -> dict:
    return next(c for c in plan["cards"] if c["payoff_order"] == 1)


@pytest.mark.django_db
def test_payoff_order_follows_strategy_not_who_clears_on_minimums(user, card_a, card_b):
    """Avalanche vs snowball must differ when highest APR is not the smallest balance.

    With $0 extra, simulation elimination follows minimums (usually the small card).
    Pay-first ranking must still follow the selected strategy.
    """
    _debt(card_a, user, Decimal("2000"))
    _debt(card_b, user, Decimal("300"))
    avalanche = simulate_household_debt(
        [card_a, card_b],
        strategy="avalanche",
        mode="aggressive",
        extra_monthly=Decimal("0"),
    )
    snowball = simulate_household_debt(
        [card_a, card_b],
        strategy="snowball",
        mode="aggressive",
        extra_monthly=Decimal("0"),
    )
    av_first = _first_card(avalanche)
    sn_first = _first_card(snowball)
    assert av_first["account_id"] == card_a.id
    assert av_first["priority_reason"]["code"] == "highest_apr"
    assert sn_first["account_id"] == card_b.id
    assert sn_first["priority_reason"]["code"] == "lowest_balance"
    assert av_first["account_id"] != sn_first["account_id"]


@pytest.mark.django_db
def test_credit_score_pay_first_is_highest_utilization_not_smallest_amortizing(
    user, household
):
    """Credit-score strategy must target max utilization even if that card does not amortize.

    Mirrors the live mix: a small high-APR card that pays down on minimums vs a
    maxed-out lower-APR card that does not.
    """
    care = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        name="Care Credit",
        credit_limit=Decimal("4800"),
        apr=Decimal("32.99"),
        minimum_payment_amount=Decimal("63"),
    )
    savor = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        name="Savor",
        credit_limit=Decimal("2000"),
        apr=Decimal("28.24"),
        minimum_payment_amount=Decimal("25"),
    )
    venture = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        name="Venture",
        credit_limit=Decimal("3000"),
        apr=Decimal("28.24"),
        minimum_payment_amount=Decimal("26"),
    )
    _debt(care, user, Decimal("1070.96"))
    _debt(savor, user, Decimal("1968.31"))
    _debt(venture, user, Decimal("3141.42"))
    cards = [care, savor, venture]

    avalanche = simulate_household_debt(
        cards, strategy="avalanche", mode="aggressive", extra_monthly=Decimal("0")
    )
    snowball = simulate_household_debt(
        cards, strategy="snowball", mode="aggressive", extra_monthly=Decimal("0")
    )
    credit_score = simulate_household_debt(
        cards, strategy="utilization_target", mode="aggressive", extra_monthly=Decimal("0")
    )

    assert _first_card(avalanche)["account_id"] == care.id
    assert _first_card(avalanche)["priority_reason"]["code"] == "highest_apr"
    assert _first_card(snowball)["account_id"] == care.id
    assert _first_card(snowball)["priority_reason"]["code"] == "lowest_balance"
    assert _first_card(credit_score)["account_id"] == venture.id
    assert _first_card(credit_score)["priority_reason"]["code"] == "highest_utilization"
    assert "utilization" in _first_card(credit_score)["priority_reason"]["label"].lower()
    assert Decimal(_first_card(credit_score)["utilization_percent"]) > Decimal(
        _first_card(avalanche)["utilization_percent"]
    )
    rec_text = " ".join(r["message"] for r in credit_score["recommendations"])
    assert "Venture" in rec_text


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
    assert any("Card A" in m and "10% utilization target" in m for m in messages)
    assert not any("30% utilization" in m for m in messages)
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
    util_target = _milestone(plan, "util_below_target")
    debt_free = _milestone(plan, "debt_free")
    assert first["achieved"] is False
    assert first["month"] is not None
    assert util_50["achieved"] is False
    assert util_target["achieved"] is False
    assert "10%" in util_target["label"]
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
    assert Decimal(survival["monthly_payment_budget"]) == Decimal("75.00")
    assert Decimal(aggressive["monthly_payment_budget"]) == Decimal("575.00")


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
    assert Decimal(plan["monthly_payment_budget"]) == Decimal("135.00")


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
    assert plan["baseline_status"] == "payoffable"
    assert baseline >= selected
    assert saved == (baseline - selected).quantize(Decimal("0.01"))


@pytest.mark.django_db
def test_non_amortizing_baseline_returns_null_savings_not_millions(user, household):
    """Portfolio like Venture: min payment below monthly interest must not invent huge savings."""
    lowes = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        name="Lowe's",
        credit_limit=Decimal("2000"),
        apr=Decimal("31.99"),
        minimum_payment_amount=Decimal("8.28"),
    )
    care = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        name="Care Credit",
        credit_limit=Decimal("3000"),
        apr=Decimal("32.99"),
        minimum_payment_amount=Decimal("63"),
    )
    savor = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        name="Savor",
        credit_limit=Decimal("3000"),
        apr=Decimal("28.24"),
        minimum_payment_amount=Decimal("25"),
    )
    venture = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        name="Venture",
        credit_limit=Decimal("3000"),
        apr=Decimal("28.24"),
        minimum_payment_amount=Decimal("26"),
    )
    _debt(lowes, user, Decimal("8.28"))
    _debt(care, user, Decimal("1070.96"))
    _debt(savor, user, Decimal("1920.92"))
    _debt(venture, user, Decimal("2877.18"))
    cache.clear()
    plan = simulate_household_debt(
        [lowes, care, savor, venture],
        strategy="avalanche",
        mode="aggressive",
        extra_monthly=Decimal("150"),
    )
    total = Decimal(plan["total_debt"])
    assert total == Decimal("5877.34")
    expected_wapr = (
        Decimal("8.28") * Decimal("31.99")
        + Decimal("1070.96") * Decimal("32.99")
        + Decimal("1920.92") * Decimal("28.24")
        + Decimal("2877.18") * Decimal("28.24")
    ) / total
    assert Decimal(plan["weighted_apr"]) == expected_wapr.quantize(Decimal("0.01"))
    burn = Decimal(plan["monthly_interest_burn"])
    assert burn > 0
    assert burn < total  # sanity: one month interest << principal
    assert plan["baseline_status"] == "baseline_not_payoffable"
    assert plan["interest_saved_vs_minimums"] is None
    assert plan["total_interest_minimums_only"] is None
    assert venture.id in plan["non_amortizing_account_ids"]
    # Never invent multi-million "savings" on a ~$6k book.
    assert "NaN" not in str(plan["total_debt"])
    assert "Infinity" not in str(plan.values())
    messages = [r["message"] for r in plan["recommendations"]]
    assert any("would not pay off all debts" in m for m in messages)


@pytest.mark.django_db
def test_plan_numeric_fields_are_finite_or_null(user, card_a, card_b):
    _debt(card_a, user, Decimal("1500"))
    _debt(card_b, user, Decimal("400"))
    plan = simulate_household_debt(
        [card_a, card_b],
        strategy="avalanche",
        mode="aggressive",
        extra_monthly=Decimal("100"),
    )
    money_fields = [
        "total_debt",
        "weighted_apr",
        "monthly_interest_burn",
        "monthly_payment_budget",
        "extra_monthly",
        "total_interest",
        "total_paid",
    ]
    for field in money_fields:
        val = Decimal(plan[field])
        assert val.is_finite()
    for field in ("interest_saved_vs_minimums", "total_interest_minimums_only"):
        raw = plan[field]
        if raw is not None:
            assert Decimal(raw).is_finite()
    for card in plan["cards"]:
        for field in ("balance", "apr", "minimum_payment", "suggested_payment", "interest_this_month"):
            assert Decimal(card[field]).is_finite()


@pytest.mark.django_db
def test_household_non_amortizing_exits_without_max_horizon(user, household):
    card = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        name="Stuck",
        credit_limit=Decimal("5000"),
        apr=Decimal("30"),
        minimum_payment_amount=Decimal("20"),
    )
    _debt(card, user, Decimal("3000"))
    plan = simulate_household_debt(
        [card],
        strategy="avalanche",
        mode="survival",
        extra_monthly=Decimal("0"),
        max_months=360,
    )
    assert plan["debt_free_possible"] is False
    assert plan["simulation_status"] == "non_amortizing"
    assert plan["months_to_debt_free"] is None
    assert plan["baseline_status"] == "baseline_not_payoffable"
    assert plan["interest_saved_vs_minimums"] is None
    # Early exit — must not burn hundreds of months of timeline.
    assert len(plan["timeline"]) <= 2


@pytest.mark.django_db
def test_zero_balance_excluded_from_total_debt(user, card_a, card_b):
    _debt(card_a, user, Decimal("1000"))
    # card_b has no debt
    plan = simulate_household_debt([card_a, card_b], extra_monthly=Decimal("100"))
    assert Decimal(plan["total_debt"]) == Decimal("1000.00")
    assert all(c["account_id"] != card_b.id for c in plan["cards"])


@pytest.mark.django_db
def test_missing_apr_does_not_produce_nan(user, household):
    card = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        name="No APR",
        credit_limit=Decimal("2000"),
        apr=None,
        minimum_payment_amount=Decimal("25"),
    )
    _debt(card, user, Decimal("500"))
    plan = simulate_household_debt([card], extra_monthly=Decimal("50"))
    assert Decimal(plan["weighted_apr"]) == Decimal("0.00")
    assert Decimal(plan["monthly_interest_burn"]) == Decimal("0.00")
    assert Decimal(plan["total_debt"]) == Decimal("500.00")


@pytest.mark.django_db
def test_tiny_balance_payoff_is_one_month_not_two(user, household):
    card = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        name="Lowe's",
        credit_limit=Decimal("2000"),
        apr=Decimal("31.99"),
        minimum_payment_amount=Decimal("8.28"),
    )
    _debt(card, user, Decimal("8.28"))
    plan = simulate_household_debt(
        [card],
        strategy="snowball",
        mode="aggressive",
        extra_monthly=Decimal("0"),
    )
    row = plan["cards"][0]
    assert Decimal(row["balance"]) == Decimal("8.28")
    assert row["months_remaining"] == 1
    single = project_credit_card_payoff(
        card,
        "custom_amount",
        custom_amount=Decimal("8.28"),
        starting_balance=Decimal("8.28"),
    )
    assert single["payoff_possible"] is True
    assert single["months_to_payoff"] == 1


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
