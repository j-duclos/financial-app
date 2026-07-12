"""Tests for resolve-risk workflow."""
from datetime import date, timedelta
from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest

from accounts.models import Account
from recommendations.services.context import RecommendationContext
from recommendations.services.detectors import Detection
from timeline.services.resolve_risk import (
    account_eligible_for_resolve_risk,
    build_resolve_risk_plan,
    _horizon_simulation_preview,
)
from timeline.services.transfer_simulation import (
    TransferSimulationContext,
    prepare_transfer_simulation_context,
    simulate_transfer_impact,
)


@pytest.mark.django_db
def test_account_eligible_when_critical(user, household):
    checking = Account.objects.create(
        household=household,
        name="Main",
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        starting_balance=Decimal("500"),
        minimum_buffer=Decimal("200"),
        currency="USD",
        include_in_forecast=True,
    )
    forecast = {
        "supports_available_to_spend": True,
        "risk_status": "critical",
        "lowest_projected_balance": "-100.00",
        "risk_date": "2026-06-17",
        "minimum_buffer": "200",
    }
    assert account_eligible_for_resolve_risk(checking, forecast) is True


@pytest.mark.django_db
def test_credit_not_eligible(user, household):
    card = Account.objects.create(
        household=household,
        name="Venture",
        account_type=Account.AccountType.CREDIT,
        role=Account.AccountRole.CREDIT_CARD,
        currency="USD",
        include_in_forecast=True,
    )
    forecast = {
        "supports_available_to_spend": False,
        "risk_status": "critical",
        "lowest_projected_balance": "-500.00",
    }
    assert account_eligible_for_resolve_risk(card, forecast) is False


@pytest.mark.django_db
def test_build_resolve_risk_plan_structure(user, household):
    checking = Account.objects.create(
        household=household,
        name="Main",
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        starting_balance=Decimal("200"),
        minimum_buffer=Decimal("100"),
        currency="USD",
        include_in_forecast=True,
    )
    Account.objects.create(
        household=household,
        name="Savings",
        account_type=Account.AccountType.SAVINGS,
        role=Account.AccountRole.SAVINGS,
        starting_balance=Decimal("5000"),
        minimum_buffer=Decimal("500"),
        currency="USD",
        include_in_forecast=True,
    )
    plan = build_resolve_risk_plan(user, checking.id, days=30)
    assert "eligible" in plan
    if plan["eligible"]:
        assert plan["summary"]["account_name"] == "Main"
        assert isinstance(plan["actions"], list)


def test_horizon_simulation_preview_improvement_matches_horizon_metrics():
    preview = _horizon_simulation_preview(
        {
            "base_horizon_lowest_projected_balance": "-1565.79",
            "simulated_horizon_lowest_projected_balance": "0.00",
            "simulated_horizon_lowest_date": "2026-07-20",
            "risk_resolved": True,
            "result_status": "resolved",
            "transfer_date": "2026-07-15",
        }
    )
    assert preview["simulated_lowest_projected_balance"] == "0.00"
    assert preview["simulated_lowest_date"] == "2026-07-20"
    assert preview["improvement_amount"] == "1565.79"


def test_horizon_simulation_preview_no_mixed_focus_horizon_improvement():
    """Improvement must be horizon-lowest delta, not focus-date minus horizon."""
    preview = _horizon_simulation_preview(
        {
            "base_horizon_lowest_projected_balance": "-1565.79",
            "simulated_horizon_lowest_projected_balance": "-1565.79",
            "simulated_horizon_lowest_date": "2026-07-20",
            "risk_resolved": False,
            "result_status": "partial",
        }
    )
    assert preview["improvement_amount"] == "0.00"


@pytest.mark.django_db
def test_build_resolve_risk_reuses_prebuilt_context(user, household):
    checking = Account.objects.create(
        household=household,
        name="Main",
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        starting_balance=Decimal("50"),
        minimum_buffer=Decimal("100"),
        currency="USD",
        include_in_forecast=True,
    )
    savings = Account.objects.create(
        household=household,
        name="Savings",
        account_type=Account.AccountType.SAVINGS,
        role=Account.AccountRole.SAVINGS,
        starting_balance=Decimal("5000"),
        currency="USD",
        include_in_forecast=True,
    )
    today = date.today()
    forecast = {
        "supports_available_to_spend": True,
        "risk_status": "critical",
        "lowest_projected_balance": "-1565.79",
        "risk_date": (today + timedelta(days=7)).isoformat(),
        "minimum_buffer": "100",
        "available_to_spend": "0",
    }
    ctx = RecommendationContext(
        user=user,
        today=today,
        days=30,
        accounts=[checking, savings],
        accounts_by_id={checking.id: checking, savings.id: savings},
        forecasts={checking.id: forecast, savings.id: forecast},
        st_aggregate={"total_safe_to_spend": "1000"},
        timeline_rows=[],
        health_by_id={},
        recurring_rules=[],
        rules_by_id={},
    )
    with patch(
        "recommendations.services.engine.build_recommendation_context"
    ) as mock_build_ctx:
        with patch(
            "timeline.services.resolve_risk.run_detectors_for_account",
            return_value=[
                Detection(
                    kind="move_money",
                    severity="critical",
                    account_id=checking.id,
                    related_account_id=savings.id,
                    amount=Decimal("1565.79"),
                    target_date=today + timedelta(days=7),
                    reason="test",
                )
            ],
        ):
            with patch(
                "timeline.services.resolve_risk.prepare_transfer_simulation_context"
            ) as mock_prepare:
                prepared = MagicMock(spec=TransferSimulationContext)
                prepared.horizon = "14d"
                mock_prepare.return_value = prepared
                with patch(
                    "timeline.services.resolve_risk.simulate_transfer_impact",
                    return_value={
                        "base_horizon_lowest_projected_balance": "-1565.79",
                        "simulated_horizon_lowest_projected_balance": "0.00",
                        "simulated_horizon_lowest_date": (today + timedelta(days=10)).isoformat(),
                        "risk_resolved": True,
                        "result_status": "resolved",
                        "transfer_date": today.isoformat(),
                        "recovery_insight": "ok",
                    },
                ):
                    plan = build_resolve_risk_plan(user, checking.id, days=30, ctx=ctx)
        mock_build_ctx.assert_not_called()

    assert plan["eligible"] is True
    assert plan["actions"][0]["simulation"]["improvement_amount"] == "1565.79"


@pytest.mark.django_db
def test_build_resolve_risk_uses_account_detectors_not_all(user, household):
    checking = Account.objects.create(
        household=household,
        name="Main",
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        starting_balance=Decimal("50"),
        minimum_buffer=Decimal("100"),
        currency="USD",
        include_in_forecast=True,
    )
    with patch(
        "timeline.services.resolve_risk.run_detectors_for_account",
        return_value=[],
    ) as mock_account_detectors:
        with patch(
            "recommendations.services.detectors.run_all_detectors",
        ) as mock_all:
            with patch(
                "timeline.services.resolve_risk.prepare_transfer_simulation_context",
                return_value=MagicMock(horizon="14d"),
            ):
                build_resolve_risk_plan(user, checking.id, days=30)
    mock_account_detectors.assert_called_once()
    mock_all.assert_not_called()


@pytest.mark.django_db
def test_base_calendar_built_once_for_multiple_transfer_suggestions(user, household):
    checking = Account.objects.create(
        household=household,
        name="Main",
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        starting_balance=Decimal("50"),
        minimum_buffer=Decimal("100"),
        currency="USD",
        include_in_forecast=True,
    )
    savings = Account.objects.create(
        household=household,
        name="Savings",
        account_type=Account.AccountType.SAVINGS,
        role=Account.AccountRole.SAVINGS,
        starting_balance=Decimal("5000"),
        currency="USD",
        include_in_forecast=True,
    )
    donor2 = Account.objects.create(
        household=household,
        name="Other",
        account_type=Account.AccountType.SAVINGS,
        role=Account.AccountRole.SAVINGS,
        starting_balance=Decimal("3000"),
        currency="USD",
        include_in_forecast=True,
    )
    today = date.today()
    forecast = {
        "supports_available_to_spend": True,
        "risk_status": "critical",
        "lowest_projected_balance": "-500.00",
        "risk_date": (today + timedelta(days=7)).isoformat(),
        "minimum_buffer": "100",
    }
    detections = [
        Detection(
            kind="move_money",
            severity="critical",
            account_id=checking.id,
            related_account_id=savings.id,
            amount=Decimal("500"),
            target_date=today + timedelta(days=7),
            reason="a",
        ),
        Detection(
            kind="move_money",
            severity="high",
            account_id=checking.id,
            related_account_id=donor2.id,
            amount=Decimal("400"),
            target_date=today + timedelta(days=7),
            reason="b",
        ),
        Detection(
            kind="move_money",
            severity="medium",
            account_id=checking.id,
            related_account_id=donor2.id,
            amount=Decimal("300"),
            target_date=today + timedelta(days=7),
            reason="c",
        ),
    ]
    with patch(
        "timeline.services.resolve_risk.run_detectors_for_account",
        return_value=detections,
    ):
        with patch(
            "timeline.services.transfer_simulation.build_timeline_calendar"
        ) as mock_calendar:
            mock_calendar.return_value = {"days": [], "summary": {}}
            with patch(
                "timeline.services.transfer_simulation.build_timeline",
                return_value=[],
            ):
                with patch(
                    "timeline.services.resolve_risk.simulate_transfer_impact",
                    side_effect=lambda *args, **kwargs: {
                        "base_horizon_lowest_projected_balance": "-500.00",
                        "simulated_horizon_lowest_projected_balance": "0.00",
                        "simulated_horizon_lowest_date": today.isoformat(),
                        "risk_resolved": True,
                        "result_status": "resolved",
                        "transfer_date": today.isoformat(),
                    },
                ):
                    build_resolve_risk_plan(user, checking.id, days=30)

    base_calls = [
        c
        for c in mock_calendar.call_args_list
        if c.kwargs.get("timeline_rows") is not None and "ephemeral" not in str(c)
    ]
    assert len(base_calls) == 1


@pytest.mark.django_db
def test_unrelated_account_forecasts_not_recalculated_each_simulation(user, household):
    checking = Account.objects.create(
        household=household,
        name="Main",
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        starting_balance=Decimal("50"),
        currency="USD",
        include_in_forecast=True,
    )
    savings = Account.objects.create(
        household=household,
        name="Savings",
        account_type=Account.AccountType.SAVINGS,
        role=Account.AccountRole.SAVINGS,
        starting_balance=Decimal("5000"),
        currency="USD",
        include_in_forecast=True,
    )
    today = date.today()
    base_forecasts = {
        checking.id: {"lowest_projected_balance": "-100"},
        savings.id: {"lowest_projected_balance": "5000"},
    }
    prepared = prepare_transfer_simulation_context(
        user,
        horizon="14d",
        as_of_date=today,
        household_id=household.id,
        accounts=[checking, savings],
        accounts_by_id={checking.id: checking, savings.id: savings},
        base_forecasts=base_forecasts,
        base_sts={"total_safe_to_spend": "100"},
        timeline_rows=[],
    )
    recalculated_ids: list[int] = []

    def _track_forecast(_user, account, **kwargs):
        recalculated_ids.append(account.id)
        return {"lowest_projected_balance": "0"}

    with patch(
        "timeline.services.transfer_simulation.build_timeline",
        return_value=[],
    ):
        with patch(
            "timeline.services.transfer_simulation.build_timeline_calendar",
            return_value={"days": [], "summary": {}},
        ):
            with patch(
                "timeline.services.transfer_simulation.calculate_account_forecast_summary",
                side_effect=_track_forecast,
            ):
                simulate_transfer_impact(
                    user,
                    from_account_id=savings.id,
                    to_account_id=checking.id,
                    amount=Decimal("100"),
                    transfer_date=today,
                    prepared_context=prepared,
                )

    assert set(recalculated_ids) == {checking.id, savings.id}
    assert len(recalculated_ids) == 2


@pytest.mark.django_db
def test_transfer_rejected_when_source_account_shortfall(user, household):
    checking = Account.objects.create(
        household=household,
        name="Main",
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        starting_balance=Decimal("50"),
        minimum_buffer=Decimal("100"),
        currency="USD",
        include_in_forecast=True,
    )
    savings = Account.objects.create(
        household=household,
        name="Savings",
        account_type=Account.AccountType.SAVINGS,
        role=Account.AccountRole.SAVINGS,
        starting_balance=Decimal("200"),
        minimum_buffer=Decimal("500"),
        currency="USD",
        include_in_forecast=True,
    )
    today = date.today()
    with patch(
        "timeline.services.resolve_risk.run_detectors_for_account",
        return_value=[
            Detection(
                kind="move_money",
                severity="critical",
                account_id=checking.id,
                related_account_id=savings.id,
                amount=Decimal("1000"),
                target_date=today + timedelta(days=3),
                reason="test",
            )
        ],
    ):
        with patch(
            "timeline.services.resolve_risk.prepare_transfer_simulation_context",
            return_value=MagicMock(horizon="14d"),
        ):
            with patch(
                "timeline.services.resolve_risk.simulate_transfer_impact",
                return_value={
                    "base_horizon_lowest_projected_balance": "-500.00",
                    "simulated_horizon_lowest_projected_balance": "-100.00",
                    "simulated_horizon_lowest_date": today.isoformat(),
                    "risk_resolved": False,
                    "result_status": "failed",
                    "transfer_date": today.isoformat(),
                },
            ):
                plan = build_resolve_risk_plan(user, checking.id, days=30)

    assert plan["eligible"] is True
    assert plan["actions"] == []
