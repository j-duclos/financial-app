"""
Top cash-flow drivers for a calendar day (deterministic, no AI).
"""
from __future__ import annotations

from decimal import Decimal
from typing import Any

from accounts.services.available_to_spend import _decimal

DEFAULT_DRIVER_LIMIT = 5


def compute_biggest_drivers(
    transactions: list[dict[str, Any]],
    *,
    limit: int = DEFAULT_DRIVER_LIMIT,
) -> list[dict[str, Any]]:
    """
    Sort by absolute impact; include income and expenses; skip transfer inflow legs
  that are marked is_transfer (both legs may appear — outflows still count as moves).
    """
    scored: list[tuple[Decimal, dict[str, Any]]] = []
    for txn in transactions:
        if txn.get("is_transfer") and _decimal(txn.get("amount") or 0) > 0:
            continue
        amt = _decimal(txn.get("amount") or 0)
        if amt == 0:
            continue
        scored.append(
            (
                abs(amt),
                {
                    "description": (txn.get("description") or "—").strip(),
                    "amount": str(amt.quantize(Decimal("0.01"))),
                    "kind": txn.get("kind") or ("income" if amt > 0 else "expense"),
                    "is_transfer": bool(txn.get("is_transfer")),
                    "account_name": txn.get("account_name"),
                },
            )
        )
    scored.sort(key=lambda x: (-x[0], x[1]["description"]))
    return [item for _, item in scored[:limit]]
