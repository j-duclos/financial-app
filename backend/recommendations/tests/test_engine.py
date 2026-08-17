"""Tests for deterministic recommendation engine."""
from datetime import date, timedelta
from decimal import Decimal
from unittest.mock import patch

import pytest

from accounts.models import Account
from accounts.services.available_to_spend import RISK_STATUS_CRITICAL
from categories.models import Category
from core.models import Household, HouseholdMembership
from recommendations.services.calculators import (
    latest_safe_transfer_date,
    parse_forecast_date,
    payment_to_reach_utilization,
    priority_score,
    rule_allows_payment_delay,
    transfer_amount_to_restore,
)
from recommendations.services.context import RecommendationContext
from recommendations.services.detectors import (
    Detection,
    detect_debt_payoff,
    detect_move_money_opportunities,
    detect_survival_mode,
    detect_utilization,
)
from recommendations.services.engine import (
    build_recommendations,
    build_recommendation_context,
    consolidate_recommendations,
)
from recommendations.services.generators import (
    debt_payoff_title,
    generate_from_detection,
    goal_action_title,
    spending_action_title,
)
from recommendations.services.serializers import sanitize_user_copy, to_dashboard_recommendation
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

    def test_latest_safe_transfer_date_is_two_days_before_unless_clamped(self):
        today = date(2026, 8, 15)
        assert latest_safe_transfer_date(date(2026, 8, 20), today=today) == date(2026, 8, 18)
        assert latest_safe_transfer_date(date(2026, 8, 16), today=today) == today

    def test_parse_forecast_date_accepts_date_datetime_and_iso(self):
        from datetime import datetime

        assert parse_forecast_date(date(2026, 8, 20)) == date(2026, 8, 20)
        assert parse_forecast_date("2026-08-20") == date(2026, 8, 20)
        assert parse_forecast_date(datetime(2026, 8, 20, 12, 0, 0)) == date(2026, 8, 20)
        assert parse_forecast_date(None) is None

    def test_payment_to_utilization(self):
        owed = Decimal("4000")
        limit = Decimal("5000")
        pay = payment_to_reach_utilization(owed, limit, Decimal("70"))
        assert pay == Decimal("500.00")
        assert payment_to_reach_utilization(owed, limit, Decimal("10")) == Decimal("3500.00")
        assert payment_to_reach_utilization(owed, limit, Decimal("30")) == Decimal("2500.00")
        assert payment_to_reach_utilization(owed, limit, Decimal("50")) == Decimal("1500.00")

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
        assert rec["title"] == "Move $300.00 from Savings to Main"
        assert rec["why"] == det.reason
        assert rec["recommended_action"] == (
            "Transfer $300.00 by Jun 9 to cover the lowest projected "
            "balance in the next 30 days."
        )
        assert rec["primary_action_label"] == "Transfer $300.00"
        assert rec["secondary_action_label"] == "View forecast"
        assert rec["recommended_amount"] == "300.00"
        assert rec["recommended_date"] == "2025-06-09"
        assert rec["projected_improvement"] == det.projected_improvement
        dash = to_dashboard_recommendation(rec)
        assert dash["severity"] == "critical"
        assert dash["primary_action_type"] == "move_money"
        assert "placeholder" not in (dash["why"] + (dash["projected_improvement"] or "")).lower()


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
            owed_balances={credit_card.id: Decimal("4000")},
        )
        dets = detect_utilization(ctx)
        assert len(dets) >= 1
        assert dets[0].amount and dets[0].amount > 0

    @pytest.mark.parametrize(
        "util,owed,target,expect_count",
        [
            ("0", Decimal("0"), Decimal("10"), 0),
            ("10", Decimal("500"), Decimal("10"), 0),
            ("15", Decimal("750"), Decimal("10"), 1),
            ("70", Decimal("3500"), Decimal("10"), 1),
            ("75", Decimal("3750"), Decimal("30"), 1),
            ("98", Decimal("4900"), Decimal("10"), 1),
            ("50", Decimal("2500"), Decimal("50"), 0),
            ("51", Decimal("2550"), Decimal("50"), 1),
        ],
    )
    def test_utilization_thresholds(self, credit_card, util, owed, target, expect_count):
        credit_card.target_utilization_percent = target
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
                    "details": {
                        "utilization_percent": util,
                        "target_utilization_percent": str(target),
                    }
                }
            },
            owed_balances={credit_card.id: owed},
        )
        dets = detect_utilization(ctx)
        assert len(dets) == expect_count
        if expect_count:
            assert dets[0].utilization_target == target
            assert dets[0].amount == payment_to_reach_utilization(owed, Decimal("5000"), target)
            assert "70%" not in (dets[0].projected_improvement or "")
            assert f"your {target:.0f}% target" in (dets[0].projected_improvement or "")

    def test_changing_target_changes_payment_not_current_utilization(self, credit_card):
        owed = Decimal("4900")
        limit = Decimal("5000")
        current_util = Decimal("98")
        amounts = {}
        for target in (Decimal("10"), Decimal("30"), Decimal("50")):
            credit_card.target_utilization_percent = target
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
                        "details": {
                            "utilization_percent": str(current_util),
                            "target_utilization_percent": str(target),
                        }
                    }
                },
                owed_balances={credit_card.id: owed},
            )
            dets = detect_utilization(ctx)
            assert len(dets) == 1
            assert dets[0].utilization_current == current_util
            assert dets[0].utilization_target == target
            amounts[target] = dets[0].amount
            assert dets[0].amount == payment_to_reach_utilization(owed, limit, target)
        assert amounts[Decimal("10")] > amounts[Decimal("30")] > amounts[Decimal("50")]

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

    def test_survival_mode_off_when_condition_false(self, checking, savings):
        ctx = RecommendationContext(
            user=None,
            today=AS_OF,
            days=30,
            accounts=[checking, savings],
            accounts_by_id={checking.id: checking, savings.id: savings},
            forecasts={
                checking.id: {"risk_status": "healthy"},
                savings.id: {"risk_status": "healthy"},
            },
            st_aggregate={"total_safe_to_spend": "500"},
            timeline_rows=[],
            health_by_id={},
        )
        assert detect_survival_mode(ctx) is False
        from recommendations.services.detectors import detect_survival_recommendations

        ctx.survival_mode = False
        assert detect_survival_recommendations(ctx) == []

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
                    "first_negative_date": (AS_OF + timedelta(days=5)).isoformat(),
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
        move = next(d for d in dets if d.kind == "move_money")
        assert "Main is projected to fall below $0 on" in move.reason
        assert "Jun 6" in move.reason
        assert move.target_date == AS_OF + timedelta(days=5)
        assert move.amount == Decimal("250.00")
        assert move.extra and move.extra.get("partial") is False
        assert move.extra.get("needed_amount") == "250.00"
        assert "placeholder" not in move.reason.lower()

    def test_move_money_partial_when_donor_cannot_cover(self, checking, savings):
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
                    "lowest_projected_balance": "-2000",
                    "lowest_projected_balance_date": (AS_OF + timedelta(days=20)).isoformat(),
                    "minimum_buffer": "200",
                    "risk_date": (AS_OF + timedelta(days=5)).isoformat(),
                    "first_negative_date": (AS_OF + timedelta(days=5)).isoformat(),
                },
                savings.id: {
                    "supports_available_to_spend": True,
                    "lowest_projected_balance": "400",
                    "minimum_buffer": "100",
                    "current_balance": "400",
                },
            },
            st_aggregate={},
            timeline_rows=[],
            health_by_id={},
        )
        dets = detect_move_money_opportunities(ctx)
        move = next(d for d in dets if d.kind == "move_money")
        assert move.extra and move.extra["partial"] is True
        assert move.amount == Decimal("300.00")
        assert move.extra["needed_amount"] == "2200.00"
        assert move.extra["remaining_shortfall"] == "1900.00"
        rec = generate_from_detection(move, ctx)
        assert "toward Main" in rec["title"]
        assert "Remaining shortfall after transfer: $1900.00" in rec["recommended_action"]
        assert "avoid the shortfall" not in rec["recommended_action"]


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


@pytest.mark.django_db
def test_recommendation_context_timeline_end_matches_requested_days(user, checking):
    from django.core.cache import cache

    cache.clear()
    with patch(
        "recommendations.services.engine.build_forecast_projection_timeline",
        return_value=[],
    ) as mock_build:
        build_recommendation_context(user, days=30, as_of_date=AS_OF)
        assert mock_build.call_args.kwargs["end_date"] == AS_OF + timedelta(days=30)
        mock_build.reset_mock()
        build_recommendation_context(user, days=180, as_of_date=AS_OF)
        assert mock_build.call_args.kwargs["end_date"] == AS_OF + timedelta(days=180)


@pytest.mark.django_db
def test_recommendations_api_isolates_forecast_windows(auth_client):
    r30 = auth_client.get("/api/recommendations/?days=30")
    r90 = auth_client.get("/api/recommendations/?days=90")
    assert r30.status_code == 200
    assert r90.status_code == 200
    assert r30.json()["days"] == 30
    assert r90.json()["days"] == 90


@pytest.fixture
def auth_client(api_client, user):
    api_client.force_authenticate(user=user)
    return api_client


@pytest.fixture
def api_client():
    from rest_framework.test import APIClient

    return APIClient()


class TestCopyAndTitles:
    def test_sanitize_strips_placeholder_notes(self):
        assert (
            sanitize_user_copy("Brings utilization toward 70% (score improvement placeholder).")
            == "Brings utilization toward 70%"
        )
        assert sanitize_user_copy("All good") == "All good"

    def test_goal_and_spending_titles_use_sentence_case(self):
        assert goal_action_title("Save for House Down Payment") == (
            "Increase house down-payment savings"
        )
        assert spending_action_title("Discretionary") == "Reduce discretionary spending"
        assert debt_payoff_title("Care Credit") == "Prioritize Care Credit payoff"

    def test_utilization_copy_has_no_placeholder(self, credit_card):
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
                credit_card.id: {"details": {"utilization_percent": "98"}},
            },
            owed_balances={credit_card.id: Decimal("4900")},
        )
        dets = detect_utilization(ctx)
        assert dets
        rec = generate_from_detection(dets[0], ctx)
        blob = " ".join(
            str(rec.get(k) or "")
            for k in ("title", "why", "recommended_action", "projected_improvement")
        ).lower()
        assert "placeholder" not in blob
        assert "todo" not in blob
        assert rec["why"].startswith("Venture is at 98% utilization")
        assert "reach your 10% target" in rec["recommended_action"].lower()
        assert "70%" not in rec["recommended_action"]


class TestDebtPayoffConsolidation:
    def _debt_ctx(self, credit_card, extra_card=None):
        accounts = [credit_card] + ([extra_card] if extra_card else [])
        return RecommendationContext(
            user=None,
            today=AS_OF,
            days=30,
            accounts=accounts,
            accounts_by_id={a.id: a for a in accounts},
            forecasts={},
            st_aggregate={},
            timeline_rows=[],
            health_by_id={},
            debt_summary={
                "interest_saved_vs_minimums": "3289.71",
                "plan": {
                    "payoff_order": [credit_card.id],
                    "cards": [
                        {
                            "account_id": credit_card.id,
                            "name": credit_card.name,
                            "apr": str(credit_card.apr),
                            "payoff_order": 1,
                        }
                    ],
                    "recommendations": [
                        {
                            "id": "focus_high_apr",
                            "priority": "high",
                            "message": (
                                f"Pay {credit_card.effective_display_name} first to attack "
                                f"{credit_card.apr}% APR debt."
                            ),
                        },
                        {
                            "id": "interest_saved",
                            "priority": "medium",
                            "message": "This plan saves about $3289.71 vs minimum payments only.",
                        },
                        {
                            "id": "utilization",
                            "priority": "medium",
                            "message": (
                                f"Bring {credit_card.effective_display_name} to your "
                                f"10% utilization target."
                            ),
                        },
                    ],
                },
            },
        )

    def test_overlapping_payoff_tips_become_one_detection(self, credit_card):
        dets = detect_debt_payoff(self._debt_ctx(credit_card))
        assert len(dets) == 1
        det = dets[0]
        assert det.kind == "debt_payoff"
        assert det.account_id == credit_card.id
        assert "highest APR" in det.reason
        assert "3289.71" in det.projected_improvement
        rec = generate_from_detection(det, self._debt_ctx(credit_card))
        assert rec["title"] == "Prioritize Venture payoff"
        assert rec["id"] == f"debt-payoff-{credit_card.id}"

    def test_engine_consolidates_duplicate_debt_payoff_recs(self):
        recs = consolidate_recommendations(
            [
                {
                    "id": "debt-payoff-household",
                    "type": "debt_payoff",
                    "title": "Debt payoff opportunity",
                    "why": "Pay Care Credit first to attack 32.99% APR debt.",
                    "recommended_action": "Pay Care Credit first to attack 32.99% APR debt.",
                    "projected_improvement": "Reduces interest and speeds payoff.",
                    "priority_score": 800,
                    "severity": "high",
                },
                {
                    "id": "debt-payoff-household",
                    "type": "debt_payoff",
                    "title": "Debt payoff opportunity",
                    "why": "This plan saves about $3289.71 vs minimum payments only.",
                    "recommended_action": "This plan saves about $3289.71 vs minimum payments only.",
                    "projected_improvement": "This plan saves about $3289.71 vs minimum payments only.",
                    "priority_score": 500,
                    "severity": "medium",
                },
            ]
        )
        assert len(recs) == 1
        assert "APR" in recs[0]["why"]
        assert "3289.71" in (recs[0].get("projected_improvement") or "")

    def test_independent_recs_are_not_consolidated(self):
        recs = consolidate_recommendations(
            [
                {
                    "id": "utilization-3-70",
                    "type": "reduce_utilization",
                    "title": "Pay $97.92 toward Savor",
                    "why": "Savor is at 75% utilization.",
                    "priority_score": 600,
                    "account_id": 3,
                },
                {
                    "id": "debt-payoff-9",
                    "type": "debt_payoff",
                    "title": "Prioritize Care Credit payoff",
                    "why": "Care Credit has the highest APR at 32.99%.",
                    "priority_score": 750,
                    "account_id": 9,
                },
                {
                    "id": "utilization-9-70",
                    "type": "reduce_utilization",
                    "title": "Pay $200.00 toward Care Credit",
                    "why": "Care Credit is at 91% utilization.",
                    "priority_score": 700,
                    "account_id": 9,
                },
                {
                    "id": "move-money-2-1",
                    "type": "move_money",
                    "title": "Move $50.00 from Savings to Main",
                    "why": "Main is projected to fall below $0 on Aug 20.",
                    "priority_score": 1000,
                    "account_id": 1,
                },
            ]
        )
        ids = [r["id"] for r in recs]
        assert ids == [
            "utilization-3-70",
            "debt-payoff-9",
            "utilization-9-70",
            "move-money-2-1",
        ]

    def test_consolidation_order_is_deterministic(self):
        a = {
            "id": "debt-payoff-a",
            "type": "debt_payoff",
            "title": "Prioritize A payoff",
            "why": "A has the highest APR at 20.00%.",
            "priority_score": 500,
        }
        b = {
            "id": "debt-payoff-b",
            "type": "debt_payoff",
            "title": "Prioritize B payoff",
            "why": "This plan saves about $10 vs minimum payments only.",
            "projected_improvement": "This plan saves about $10 vs minimum payments only.",
            "priority_score": 500,
        }
        first = consolidate_recommendations([a, b])
        second = consolidate_recommendations([b, a])
        assert len(first) == 1 and len(second) == 1
        assert first[0]["id"] == second[0]["id"]


class TestSurvivalExcludedFromActionLimit:
    def test_survival_is_generated_separately_from_action_cap(self):
        recs = consolidate_recommendations(
            [
                {
                    "id": "survival-mode",
                    "type": "survival_mode",
                    "title": "Survival mode recommended",
                    "why": "Multiple accounts are projected to fall below zero.",
                    "priority_score": 1200,
                },
                {
                    "id": "move-money-2-1",
                    "type": "move_money",
                    "title": "Move $10.00 from Savings to Main",
                    "why": "Main is projected to fall below $0 on Aug 20.",
                    "priority_score": 1100,
                },
            ]
        )
        types = [r["type"] for r in recs]
        assert types.count("survival_mode") == 1
        assert "move_money" in types

