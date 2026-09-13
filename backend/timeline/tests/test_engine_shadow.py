"""Shadow-mode assembly: explicit anchors, no identity DB fallbacks."""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest

from accounts.models import Account
from core.models import Household
from timeline.services.engine_shadow import (
    attach_engine_shadow_payload,
    ensure_explicit_financially_active,
)
from transactions.services.reconciliation import ledger_today_balance_before_pending

ENGINE_SHADOW_SRC = (
    Path(__file__).resolve().parents[1] / "services" / "engine_shadow.py"
).read_text(encoding="utf-8")


def test_engine_shadow_module_does_not_use_identity_or_anchor_fallbacks():
    assert "row_participates_financially(" not in ENGINE_SHADOW_SRC
    assert "_resolve_ledger_anchors(" not in ENGINE_SHADOW_SRC
    assert "_build_timeline_impl" not in ENGINE_SHADOW_SRC


@pytest.mark.django_db
def test_ensure_explicit_financially_active_fills_missing_without_queries(django_assert_num_queries):
    rows = [{"account_id": 1, "amount": "10.00"}, {"account_id": 1, "financially_active": 0}]
    with django_assert_num_queries(0):
        ensure_explicit_financially_active(rows)
    assert rows[0]["financially_active"] is True
    assert rows[1]["financially_active"] is False


@pytest.mark.django_db
def test_attach_engine_shadow_payload_copies_and_injects_anchors(household, checking):
    today = date.today()
    original_row = {
        "account_id": checking.pk,
        "date": today.isoformat(),
        "amount": "25.00",
        "type": "INFLOW",
        "status": "PLANNED",
        "source": "rule",
        "description": "Paycheck",
        "transaction_id": 9,
        "balance_after": "1025.00",
    }
    payload = {"timeline": [original_row], "account_summary": []}
    attached = attach_engine_shadow_payload(payload, as_of=today, account_id=checking.pk)

    assert "engine_shadow" not in payload
    assert "financially_active" not in original_row
    assert attached["timeline"][0]["financially_active"] is True
    assert attached["timeline"][0]["transaction_id"] == 9
    shadow = attached["engine_shadow"]
    assert shadow["as_of"] == today.isoformat()
    assert shadow["balance_walk_source"] == "server"
    acct = shadow["accounts"][0]
    assert acct["account_id"] == checking.pk
    expected = format(
        ledger_today_balance_before_pending(checking, today).quantize(Decimal("0.01")),
        "f",
    )
    assert acct["posted_balance_before_pending"] == expected
    assert set(acct.keys()) == {"account_id", "posted_balance_before_pending"}
    assert "." in acct["posted_balance_before_pending"]


@pytest.mark.django_db
def test_attach_engine_shadow_uses_injected_anchors_without_sql(checking, django_assert_num_queries):
    today = date.today()
    payload = {
        "timeline": [{"account_id": checking.pk, "amount": "10.00"}],
        "account_summary": [],
    }
    injected = {checking.pk: Decimal("1234.56")}
    with django_assert_num_queries(0):
        attached = attach_engine_shadow_payload(
            payload,
            as_of=today,
            account_id=checking.pk,
            anchors=injected,
        )
    assert attached["engine_shadow"]["accounts"][0]["posted_balance_before_pending"] == "1234.56"


@pytest.mark.django_db
def test_apply_client_balance_walk_contract_nulls_leftover_balances(checking):
    from timeline.services.engine_shadow import apply_client_balance_walk_contract

    original = {
        "timeline": [
            {
                "account_id": checking.pk,
                "running_balance": "900.00",
                "balance_after": "1025.00",
            }
        ],
        "account_summary": [{"account_id": checking.pk, "ending_balance": "1025.00"}],
    }
    out = apply_client_balance_walk_contract(original)
    assert original["timeline"][0]["balance_after"] == "1025.00"
    assert out["timeline"][0]["balance_after"] is None
    assert out["account_summary"][0]["ending_balance"] == "900.00"


@pytest.fixture
def household(db):
    return Household.objects.create(name="Shadow assembly HH")


@pytest.fixture
def checking(db, household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Checking",
        currency="USD",
        starting_balance=Decimal("1000.00"),
        include_in_forecast=True,
    )
