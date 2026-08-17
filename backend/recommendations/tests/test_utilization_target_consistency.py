"""Action Center, Accounts, and Dashboard share the account utilization target."""
from datetime import date
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model

from accounts.models import Account
from accounts.services.account_health import calculate_account_health
from accounts.services.credit_card import ledger_owed_balance
from core.models import Household, HouseholdMembership
from credit_cards.services.debt_engine import simulate_household_debt
from insights.services.dashboard_summary import build_dashboard_summary
from recommendations.services.calculators import payment_to_reach_utilization
from recommendations.services.context import RecommendationContext
from recommendations.services.detectors import detect_utilization
from recommendations.services.generators import generate_from_detection
from transactions.services.posting import post_transaction

User = get_user_model()
AS_OF = date(2025, 6, 1)


@pytest.fixture
def user(db):
    return User.objects.create_user(username="utiltarget", password="test")


@pytest.fixture
def household(user):
    h = Household.objects.create(name="Util HH")
    HouseholdMembership.objects.create(household=h, user=user, role="owner")
    return h


@pytest.fixture
def venture(household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        role=Account.AccountRole.CREDIT_CARD,
        name="Venture",
        credit_limit=Decimal("5000"),
        target_utilization_percent=Decimal("10"),
        apr=Decimal("24"),
        currency="USD",
    )


def _set_owed(user, card, owed: Decimal, as_of=AS_OF):
    current = ledger_owed_balance(card, as_of)
    delta = Decimal(str(owed)) - current
    if delta == 0:
        return
    post_transaction(
        user,
        card.id,
        as_of,
        "Test balance",
        -delta if delta > 0 else abs(delta),
    )
    card.refresh_from_db()


def _action_center_rec(card, owed: Decimal):
    health = {
        card.id: {
            "details": {
                "utilization_percent": str((owed / card.credit_limit * Decimal("100")).quantize(Decimal("0.01"))),
                "target_utilization_percent": str(card.target_utilization_percent),
            }
        }
    }
    ctx = RecommendationContext(
        user=None,
        today=AS_OF,
        days=30,
        accounts=[card],
        accounts_by_id={card.id: card},
        forecasts={},
        st_aggregate={},
        timeline_rows=[],
        health_by_id=health,
        owed_balances={card.id: owed},
    )
    dets = detect_utilization(ctx)
    assert dets
    return generate_from_detection(dets[0], ctx), dets[0]


@pytest.mark.django_db
@pytest.mark.parametrize("target", [Decimal("10"), Decimal("30"), Decimal("50")])
def test_action_center_accounts_dashboard_agree_on_target_payment(user, venture, target):
    owed = Decimal("4918.50")
    venture.target_utilization_percent = target
    venture.save(update_fields=["target_utilization_percent"])
    _set_owed(user, venture, owed)

    expected = payment_to_reach_utilization(owed, Decimal("5000"), target)
    rec, det = _action_center_rec(venture, owed)
    health = calculate_account_health(user, venture, as_of_date=AS_OF, days=30)
    summary = build_dashboard_summary(user, days=30, as_of_date=AS_OF)
    attention = next(a for a in summary["attention"] if a["account_id"] == venture.id)

    assert det.utilization_target == target
    assert det.amount == expected
    assert rec["recommended_amount"] == str(expected)
    assert f"your {target:.0f}% target" in rec["recommended_action"]
    assert "70%" not in rec["recommended_action"]
    assert Decimal(health["details"]["target_utilization_percent"]) == target
    assert f"target {target:.0f}%" in (health["reason"] or "").lower()
    assert health["status"] != "critical"
    assert Decimal(attention["amount"]) == expected
    assert f"{target:.0f}% target" in (attention["recommended_action"] or "")
    assert str(target).rstrip("0").rstrip(".") in str(attention["target_utilization_percent"])


@pytest.mark.django_db
def test_current_utilization_unchanged_when_target_changes(user, venture):
    owed = Decimal("4000")
    _set_owed(user, venture, owed)
    utils = []
    for target in (Decimal("10"), Decimal("30")):
        venture.target_utilization_percent = target
        venture.save(update_fields=["target_utilization_percent"])
        health = calculate_account_health(user, venture, as_of_date=AS_OF, days=30)
        utils.append(Decimal(health["details"]["utilization_percent"]))
        _, det = _action_center_rec(venture, owed)
        assert det.utilization_target == target
    assert utils[0] == utils[1]


@pytest.mark.django_db
def test_payment_planner_credit_score_uses_configured_target(user, venture):
    _set_owed(user, venture, Decimal("4000"))
    for target in (Decimal("10"), Decimal("30")):
        venture.target_utilization_percent = target
        venture.save(update_fields=["target_utilization_percent"])
        plan = simulate_household_debt(
            [venture],
            strategy="utilization_target",
            mode="credit_score",
            extra_monthly=Decimal("200"),
            as_of=AS_OF,
        )
        milestone = next(m for m in plan["milestones"] if m["id"] == "util_below_target")
        assert f"{target:.0f}%" in milestone["label"]
        util_recs = [r for r in plan["recommendations"] if r["id"] == "utilization"]
        assert util_recs
        assert f"{target:.0f}% utilization target" in util_recs[0]["message"]
        assert "30% utilization" not in util_recs[0]["message"] or target == Decimal("30")
