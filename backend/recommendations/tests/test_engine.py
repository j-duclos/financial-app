"""Tests for deterministic recommendation engine."""
from datetime import date, timedelta
from decimal import Decimal

import pytest

from accounts.models import Account
from accounts.services.available_to_spend import RISK_STATUS_CRITICAL
from categories.models import Category
from core.models import Household, HouseholdMembership
from recommendations.services.calculators import (
    payment_to_reach_utilization,
    priority_score,
    rule_allows_payment_delay,
    transfer_amount_to_restore,
)
from recommendations.services.context import RecommendationContext
from recommendations.services.detectors import (
    Detection,
    detect_move_money_opportunities,
    detect_survival_mode,
    detect_utilization,
)
from recommendations.services.engine import (
    build_recommendations,
    build_recommendation_context,
)
from recommendations.services.generators import generate_from_detection
from recommendations.services.serializers import to_dashboard_recommendation
from timeline.models import RecurringRule

AS_OF = date(2025, 6, 1)


@pytest.fixture
def user(db):
    from django.contrib.auth import get_user_model

    User = get_user_model()
    return User.objects.create_user(username="recuser", password="test")


@pytest.fixture
def household(user):
    h = Household.objects.create(name="Rec HH")
    HouseholdMembership.objects.create(household=h, user=user, role="owner")
    return h


@pytest.fixture
def checking(household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        name="Main",
        starting_balance=Decimal("500"),
        minimum_buffer=Decimal("200"),
    )


@pytest.fixture
def savings(household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.SAVINGS,
        role=Account.AccountRole.SAVINGS,
        name="Savings",
        starting_balance=Decimal("5000"),
        minimum_buffer=Decimal("500"),
    )


@pytest.fixture
def credit_card(household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        role=Account.AccountRole.CREDIT_CARD,
        name="Venture",
        credit_limit=Decimal("5000"),
        starting_balance=Decimal("4000"),
        apr=Decimal("24"),
    )


class TestCalculators:
    def test_transfer_amount_negative_balance(self):
        assert transfer_amount_to_restore(Decimal("-42"), Decimal("200")) == Decimal("242.00")

    def test_payment_to_utilization(self):
        owed = Decimal("4000")
        limit = Decimal("5000")
        pay = payment_to_reach_utilization(owed, limit, Decimal("70"))
        assert pay == Decimal("500.00")

    def test_priority_score_critical_soon(self):
        assert priority_score(severity="critical", days_until=2) > priority_score(
            severity="info", days_until=30
        )

    def test_rule_delay_blocked_for_mortgage(self):
        rule = RecurringRule(
            name="Mortgage Payment",
            payment_flexibility_days=5,
            direction=RecurringRule.Direction.EXPENSE,
        )
        assert rule_allows_payment_delay(rule) is False

    def test_rule_delay_allowed(self):
        rule = RecurringRule(
            name="Hulu",
            payment_flexibility_days=5,
            direction=RecurringRule.Direction.EXPENSE,
        )
        assert rule_allows_payment_delay(rule) is True


class TestGenerators:
    def test_move_money_explainability(self, checking, savings):
        det = Detection(
            kind="move_money",
            severity="critical",
            account_id=checking.id,
            related_account_id=savings.id,
            amount=Decimal("300"),
            target_date=AS_OF + timedelta(days=10),
            reason="Main projected to reach -$42 on Jun 17.",
            projected_improvement="Avoids overdraft and restores buffer.",
            extra={"donor_name": "Savings", "dest_name": "Main"},
        )
        ctx = RecommendationContext(
            user=None,
            today=AS_OF,
            days=30,
            accounts=[checking, savings],
            accounts_by_id={checking.id: checking, savings.id: savings},
            forecasts={},
            st_aggregate={},
            timeline_rows=[],
            health_by_id={},
        )
        rec = generate_from_detection(det, ctx)
        assert rec["type"] == "move_money"
        assert "Savings" in rec["recommended_action"]
        assert rec["why"] == det.reason
        assert rec["projected_improvement"] == det.projected_improvement
        dash = to_dashboard_recommendation(rec)
        assert dash["severity"] == "critical"
        assert dash["primary_action_type"] == "move_money"


class TestDetectors:
    def test_utilization_detection(self, credit_card):
        ctx = RecommendationContext(
            user=None,
            today=AS_OF,
            days=30,
            accounts=[credit_card],
            accounts_by_id={credit_card.id: credit_card},
            forecasts={},
            st_aggregate={},
            timeline_rows=[],
            health_by_id={
                credit_card.id: {
                    "details": {"utilization_percent": "85"},
                }
            },
        )
        dets = detect_utilization(ctx)
        assert len(dets) >= 1
        assert dets[0].amount and dets[0].amount > 0

    def test_survival_mode_multiple_critical(self, checking, savings):
        ctx = RecommendationContext(
            user=None,
            today=AS_OF,
            days=30,
            accounts=[checking, savings],
            accounts_by_id={checking.id: checking, savings.id: savings},
            forecasts={
                checking.id: {"risk_status": RISK_STATUS_CRITICAL},
                savings.id: {"risk_status": RISK_STATUS_CRITICAL},
            },
            st_aggregate={"total_safe_to_spend": "-100"},
            timeline_rows=[],
            health_by_id={},
        )
        assert detect_survival_mode(ctx) is True

    def test_move_money_finds_donor(self, checking, savings):
        ctx = RecommendationContext(
            user=None,
            today=AS_OF,
            days=30,
            accounts=[checking, savings],
            accounts_by_id={checking.id: checking, savings.id: savings},
            forecasts={
                checking.id: {
                    "supports_available_to_spend": True,
                    "risk_status": RISK_STATUS_CRITICAL,
                    "lowest_projected_balance": "-50",
                    "minimum_buffer": "200",
                    "risk_date": (AS_OF + timedelta(days=5)).isoformat(),
                    "risk_reason": "Below zero",
                },
                savings.id: {
                    "supports_available_to_spend": True,
                    "lowest_projected_balance": "4000",
                    "minimum_buffer": "500",
                    "current_balance": "5000",
                },
            },
            st_aggregate={},
            timeline_rows=[],
            health_by_id={},
        )
        dets = detect_move_money_opportunities(ctx)
        assert any(d.kind == "move_money" for d in dets)


@pytest.mark.django_db
def test_build_recommendations_integration(user, checking, savings):
    ctx = build_recommendation_context(user, days=30, as_of_date=AS_OF)
    recs = build_recommendations(ctx, limit=10)
    assert isinstance(recs, list)
    for rec in recs:
        assert rec.get("id")
        assert rec.get("why")
        assert rec.get("priority_score") is not None


@pytest.mark.django_db
def test_recommendations_api(auth_client):
    r = auth_client.get("/api/recommendations/?days=30")
    assert r.status_code == 200
    data = r.json()
    assert "recommendations" in data
    assert data["days"] == 30


@pytest.fixture
def auth_client(api_client, user):
    api_client.force_authenticate(user=user)
    return api_client


@pytest.fixture
def api_client():
    from rest_framework.test import APIClient

    return APIClient()
