"""Parity: shared JSON fixtures vs Django canonical ledger walk + metrics.

Does not change production behavior. Imports the existing pure reducers with
injected anchors so no extra fixture household is required.

    pytest timeline/tests/test_financial_engine_parity.py
"""
from __future__ import annotations

import json
from datetime import date
from decimal import Decimal
from pathlib import Path

from timeline.services.ledger_section_balances import (
    assign_canonical_ledger_balance_after,
    forecast_balance_metrics_from_transactions_ledger,
)

CENTS = Decimal("0.01")
FIXTURE_PATH = (
    Path(__file__).resolve().parents[3]
    / "packages"
    / "shared"
    / "fixtures"
    / "financial-engine"
    / "parity-cases.json"
)


def D(value) -> Decimal:
    return Decimal(str(value)).quantize(CENTS)


def _money(value) -> str:
    return format(D(value), "f")


def test_parity_fixture_file_exists():
    assert FIXTURE_PATH.is_file(), f"missing {FIXTURE_PATH}"


def test_shared_fixtures_match_backend_canonical_walk():
    payload = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    cases = payload["cases"]
    assert len(cases) >= 10

    for case in cases:
        today = date.fromisoformat(case["today"])
        end_date = date.fromisoformat(case["endDate"])
        rows = [dict(row) for row in case["rows"]]
        anchors = {
            int(acct["id"]): D(acct["posted_balance_before_pending"])
            for acct in case["accounts"]
        }
        assign_canonical_ledger_balance_after(rows, today=today, anchors=anchors, force=True)

        by_tid = {
            int(row["transaction_id"]): row
            for row in rows
            if row.get("transaction_id") is not None
        }
        for expected in case["expected"]["timeline"]:
            got = by_tid[int(expected["transaction_id"])]
            assert _money(got["balance_after"]) == expected["balance_after"], (
                f"{case['id']} txn {expected['transaction_id']}: "
                f"expected {expected['balance_after']}, got {got.get('balance_after')}"
            )

        if case["id"] == "inactive-row-skipped":
            assert by_tid[16].get("balance_after") is None

        for acct, expected in zip(case["accounts"], case["expected"]["projections"], strict=True):
            metrics = forecast_balance_metrics_from_transactions_ledger(
                rows,
                account_id=int(acct["id"]),
                today=today,
                end_date=end_date,
                minimum_buffer=D(acct.get("minimum_buffer") or "0"),
                ledger_anchor=D(acct["posted_balance_before_pending"]),
            )
            assert int(acct["id"]) == int(expected["account_id"])
            assert _money(metrics["opening_balance"]) == expected["opening_balance"]
            assert _money(metrics["ending"]) == expected["ending"]
            assert _money(metrics["lowest"]) == expected["lowest"]
            assert metrics["lowest_date"].isoformat() == expected["lowest_date"]
            got_neg = (
                None if metrics["first_negative_date"] is None else metrics["first_negative_date"].isoformat()
            )
            assert got_neg == expected["first_negative_date"]
            if expected["first_negative_balance"] is None:
                assert metrics["first_negative_balance"] is None
            else:
                assert _money(metrics["first_negative_balance"]) == expected["first_negative_balance"]
            assert metrics["first_negative_transaction_id"] == expected["first_negative_transaction_id"]
