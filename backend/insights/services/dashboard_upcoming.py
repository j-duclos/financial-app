"""
Dashboard upcoming transactions: classification and grouping by day with daily subtotals.

Credit card payments: the outflow from checking/bills accounts counts as an expense;
the inflow leg on the card is listed but excluded from income/expense/net (internal transfer).
Bank-to-bank transfers remain excluded from daily totals on both legs.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date
from decimal import Decimal
from typing import Any

from accounts.models import Account
from accounts.services.account_health_constants import HEALTH_STATUS_HEALTHY
from accounts.services.available_to_spend import _decimal
from insights.services.day_heat import (
    account_balances_from_txn_lows,
    calculate_day_heat,
)
from insights.services.day_credit_warnings import scan_credit_day_warnings
from insights.services.day_biggest_drivers import compute_biggest_drivers
from insights.services.day_recovery import attach_recovery_to_days
from insights.services.day_lowest_balance import (
    account_balance_rows_from_transactions,
    calculate_day_lowest_marker,
    calculate_day_lowest_marker_from_snapshots,
    carry_forward_lowest_markers,
)

BANK_TRANSFER_CATEGORY_NAMES = frozenset({"Bank Transfer", "Transfer"})
CREDIT_CARD_PAYMENT_CATEGORY = "Credit Card Payment"

UPCOMING_DAYS = 14
UPCOMING_MAX_TRANSACTIONS = 25
UPCOMING_PER_DAY_VISIBLE = 5


def load_transfer_rule_context(
    households,
) -> tuple[set[int], dict[int, int], dict[int, int]]:
    """Active transfer rules: ids, rule → destination account, rule → source account."""
    from timeline.models import RecurringRule

    rows = RecurringRule.objects.filter(
        household__in=households,
        active=True,
        transfer_to_account__isnull=False,
    ).values_list("id", "transfer_to_account_id", "account_id")
    rule_ids: set[int] = set()
    targets: dict[int, int] = {}
    sources: dict[int, int] = {}
    for rule_id, dest_id, source_id in rows:
        rule_ids.add(rule_id)
        targets[rule_id] = dest_id
        sources[rule_id] = source_id
    return rule_ids, targets, sources


def transfer_endpoint_names(
    event: dict[str, Any],
    *,
    transfer_rule_targets: dict[int, int],
    transfer_rule_sources: dict[int, int],
    accounts_by_id: dict[int, Account],
) -> tuple[str | None, str | None]:
    """Source and destination account display names for a transfer rule leg."""
    rule_id = event.get("rule_id")
    if rule_id is None or rule_id not in transfer_rule_targets:
        return None, None
    from_id = transfer_rule_sources.get(rule_id)
    to_id = transfer_rule_targets.get(rule_id)
    if from_id is None or to_id is None:
        return None, None
    from_acc = accounts_by_id.get(from_id)
    to_acc = accounts_by_id.get(to_id)
    if not from_acc or not to_acc:
        return None, None
    return from_acc.effective_display_name, to_acc.effective_display_name


def _format_group_label(d: date) -> str:
    return d.strftime("%b %d").replace(" 0", " ")


def _format_day_of_week(d: date) -> str:
    return d.strftime("%a")


def is_transfer_category(category_name: str | None) -> bool:
    return (category_name or "").strip() in BANK_TRANSFER_CATEGORY_NAMES


def is_credit_card_payment_outflow(
    event: dict[str, Any],
    *,
    transfer_rule_targets: dict[int, int],
    accounts_by_id: dict[int, Account],
) -> bool:
    """Payment leaving a bank/spending account toward a credit card (counts as expense)."""
    account_id = event.get("account_id")
    account = accounts_by_id.get(account_id) if account_id else None
    if not account or account.is_credit_card():
        return False
    if _decimal(event.get("amount") or 0) >= 0:
        return False

    category = (event.get("category") or "").strip()
    if category == CREDIT_CARD_PAYMENT_CATEGORY:
        return True

    rule_id = event.get("rule_id")
    if rule_id is not None and rule_id in transfer_rule_targets:
        dest = accounts_by_id.get(transfer_rule_targets[rule_id])
        if dest and dest.is_credit_card():
            return True

    return False


def is_credit_card_payment_inflow(
    event: dict[str, Any],
    *,
    accounts_by_id: dict[int, Account],
) -> bool:
    """Payment arriving on a credit card (internal leg — not income or expense)."""
    account_id = event.get("account_id")
    account = accounts_by_id.get(account_id) if account_id else None
    amount = _decimal(event.get("amount") or 0)
    if account and account.is_credit_card() and amount > 0:
        return True
    return False


def is_internal_money_movement(
    event: dict[str, Any],
    *,
    transfer_rule_ids: set[int],
    transfer_rule_targets: dict[int, int],
    accounts_by_id: dict[int, Account],
) -> bool:
    """Bank transfers and the inflow leg of credit card payments — excluded from daily net."""
    if event.get("transfer_group_id"):
        return True
    txn_type = (event.get("transaction_type") or "").strip().lower()
    if txn_type == "transfer":
        return True

    if is_credit_card_payment_outflow(
        event,
        transfer_rule_targets=transfer_rule_targets,
        accounts_by_id=accounts_by_id,
    ):
        return False

    if is_credit_card_payment_inflow(event, accounts_by_id=accounts_by_id):
        return True

    kind = event.get("kind")
    if kind == "transfer":
        return True

    rule_id = event.get("rule_id")
    if rule_id is not None and rule_id in transfer_rule_ids:
        return True

    if is_transfer_category(event.get("category")):
        return True

    if kind == "credit_card" and event.get("description") == "Payment due":
        return True

    return False


def is_income_for_dashboard_totals(
    event: dict[str, Any],
    *,
    transfer_rule_ids: set[int],
    transfer_rule_targets: dict[int, int],
    accounts_by_id: dict[int, Account],
) -> bool:
    if event.get("kind") == "risk":
        return False
    if is_internal_money_movement(
        event,
        transfer_rule_ids=transfer_rule_ids,
        transfer_rule_targets=transfer_rule_targets,
        accounts_by_id=accounts_by_id,
    ):
        return False
    return _decimal(event.get("amount") or 0) > 0


def is_expense_for_dashboard_totals(
    event: dict[str, Any],
    *,
    transfer_rule_ids: set[int],
    transfer_rule_targets: dict[int, int],
    accounts_by_id: dict[int, Account],
) -> bool:
    if event.get("kind") == "risk":
        return False
    if is_credit_card_payment_outflow(
        event,
        transfer_rule_targets=transfer_rule_targets,
        accounts_by_id=accounts_by_id,
    ):
        return True
    if is_internal_money_movement(
        event,
        transfer_rule_ids=transfer_rule_ids,
        transfer_rule_targets=transfer_rule_targets,
        accounts_by_id=accounts_by_id,
    ):
        return False
    return _decimal(event.get("amount") or 0) < 0


def _txn_risk_flag(
    event: dict[str, Any],
    accounts_by_id: dict[int, Account],
) -> bool:
    if event.get("is_risk"):
        return True
    projected = event.get("projected_balance") or event.get("balance_after")
    if projected is None:
        return False
    bal = _decimal(projected)
    account = accounts_by_id.get(event.get("account_id") or 0)
    if not account:
        return bal < 0
    if bal < 0:
        return True
    buffer = _decimal(account.minimum_buffer or 0)
    if buffer > 0 and bal < buffer and account.participates_in_forecast():
        return True
    return False


def _serialize_transaction(
    event: dict[str, Any],
    *,
    transfer_rule_ids: set[int],
    transfer_rule_targets: dict[int, int],
    transfer_rule_sources: dict[int, int],
    accounts_by_id: dict[int, Account],
) -> dict[str, Any]:
    cc_out = is_credit_card_payment_outflow(
        event,
        transfer_rule_targets=transfer_rule_targets,
        accounts_by_id=accounts_by_id,
    )
    cc_in = is_credit_card_payment_inflow(event, accounts_by_id=accounts_by_id)
    internal = is_internal_money_movement(
        event,
        transfer_rule_ids=transfer_rule_ids,
        transfer_rule_targets=transfer_rule_targets,
        accounts_by_id=accounts_by_id,
    )
    kind = event.get("kind") or "bill"
    category = event.get("category")
    from_name, to_name = transfer_endpoint_names(
        event,
        transfer_rule_targets=transfer_rule_targets,
        transfer_rule_sources=transfer_rule_sources,
        accounts_by_id=accounts_by_id,
    )
    display_transfer = internal or cc_out or cc_in
    payload: dict[str, Any] = {
        "id": event.get("id"),
        "date": event["date"],
        "account_id": event.get("account_id"),
        "account_name": event.get("account_name") or "",
        "description": event.get("description") or "—",
        "amount": event.get("amount"),
        "kind": "bill" if cc_out else kind,
        "category": category,
        "balance_after": event.get("projected_balance") or event.get("balance_after"),
        "is_transfer": display_transfer,
        "is_internal_transfer": internal,
        "is_credit_card_payment": cc_out or cc_in,
        "source": event.get("source"),
        "status": event.get("status"),
        "risk_flag": _txn_risk_flag(event, accounts_by_id),
    }
    if from_name and to_name:
        payload["transfer_from_account_name"] = from_name
        payload["transfer_to_account_name"] = to_name
    return payload


def _opposite_transfer_legs_match(a: dict[str, Any], b: dict[str, Any]) -> bool:
    amt_a = _decimal(a.get("amount") or 0)
    amt_b = _decimal(b.get("amount") or 0)
    if amt_a == 0 or amt_b == 0 or amt_a * amt_b >= 0:
        return False
    if abs(amt_a) != abs(amt_b):
        return False
    return (a.get("description") or "").strip() == (b.get("description") or "").strip()


def _collapse_pair_kind(a: dict[str, Any], b: dict[str, Any]) -> str | None:
    """``bank`` or ``credit_card`` when two legs are one human-facing movement."""
    if not _opposite_transfer_legs_match(a, b):
        return None
    if a.get("is_credit_card_payment") and b.get("is_credit_card_payment"):
        return "credit_card"
    if a.get("is_credit_card_payment") or b.get("is_credit_card_payment"):
        return None
    a_xfer = a.get("is_transfer") or a.get("is_internal_transfer")
    b_xfer = b.get("is_transfer") or b.get("is_internal_transfer")
    if a_xfer and b_xfer:
        return "bank"
    return None


def _merge_credit_card_payment_pair_for_display(
    negative: dict[str, Any], positive: dict[str, Any]
) -> dict[str, Any]:
    """One row for paying a card from a bank account (expense on the payer)."""
    from_name = (
        negative.get("transfer_from_account_name")
        or negative.get("account_name")
        or positive.get("transfer_from_account_name")
        or ""
    ).strip()
    to_name = (
        positive.get("transfer_to_account_name")
        or positive.get("account_name")
        or negative.get("transfer_to_account_name")
        or ""
    ).strip()
    amt = -abs(_decimal(negative.get("amount") or 0))
    merged = dict(negative)
    merged["id"] = f"ccpay-{negative.get('id')}-{positive.get('id')}"
    merged["kind"] = "bill"
    merged["is_credit_card_payment"] = True
    merged["is_transfer"] = True
    merged["is_internal_transfer"] = False
    merged["amount"] = str(amt.quantize(Decimal("0.01")))
    merged["account_name"] = from_name or negative.get("account_name") or ""
    merged["balance_after"] = negative.get("balance_after") or positive.get("balance_after")
    merged["risk_flag"] = bool(negative.get("risk_flag") or positive.get("risk_flag"))
    if from_name:
        merged["transfer_from_account_name"] = from_name
    if to_name:
        merged["transfer_to_account_name"] = to_name
    return merged


def _merge_transfer_pair_for_display(
    positive: dict[str, Any], negative: dict[str, Any]
) -> dict[str, Any]:
    """One human-facing row: money arriving on the destination account."""
    from_name = (
        positive.get("transfer_from_account_name")
        or negative.get("account_name")
        or ""
    ).strip()
    to_name = (
        positive.get("transfer_to_account_name")
        or positive.get("account_name")
        or ""
    ).strip()
    amt = abs(_decimal(positive.get("amount") or 0))
    merged = dict(positive)
    merged["id"] = f"xfer-{negative.get('id')}-{positive.get('id')}"
    merged["kind"] = "transfer"
    merged["is_transfer"] = True
    merged["is_internal_transfer"] = True
    merged["is_credit_card_payment"] = False
    merged["amount"] = str(amt.quantize(Decimal("0.01")))
    merged["account_name"] = to_name or positive.get("account_name") or ""
    merged["risk_flag"] = bool(positive.get("risk_flag") or negative.get("risk_flag"))
    if from_name:
        merged["transfer_from_account_name"] = from_name
    if to_name:
        merged["transfer_to_account_name"] = to_name
    return merged


def collapse_internal_transfer_pairs_for_display(
    transactions: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """One row per bank transfer or credit card payment (hide offsetting legs)."""
    if len(transactions) < 2:
        return transactions
    used: set[str] = set()
    out: list[dict[str, Any]] = []
    for i, txn in enumerate(transactions):
        tid = str(txn.get("id"))
        if tid in used:
            continue
        partner: dict[str, Any] | None = None
        pair_kind: str | None = None
        for j, other in enumerate(transactions):
            if i == j:
                continue
            oid = str(other.get("id"))
            if oid in used:
                continue
            kind = _collapse_pair_kind(txn, other)
            if kind:
                partner = other
                pair_kind = kind
                break
        if partner is not None and pair_kind:
            used.add(tid)
            used.add(str(partner.get("id")))
            neg = txn if _decimal(txn.get("amount") or 0) < 0 else partner
            pos = partner if neg is txn else txn
            if pair_kind == "credit_card":
                out.append(_merge_credit_card_payment_pair_for_display(neg, pos))
            else:
                out.append(_merge_transfer_pair_for_display(pos, neg))
        else:
            out.append(txn)
    return out


def _day_account_balance_rows(
    transactions: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Per-account lowest balance_after on this day (from timeline rows)."""
    return account_balance_rows_from_transactions(transactions)


def _day_lowest_projected_balances(
    transactions: list[dict[str, Any]],
    accounts_by_id: dict[int, Account],
) -> list[dict[str, Any]]:
    """Cash accounts at or below zero / below buffer for display emphasis."""
    rows = _day_account_balance_rows(transactions)
    buffers = {a.effective_display_name: _decimal(a.minimum_buffer or 0) for a in accounts_by_id.values()}
    credit_names = {
        a.effective_display_name
        for a in accounts_by_id.values()
        if a.is_credit_card()
    }
    out: list[dict[str, Any]] = []
    for row in rows:
        if row.get("account_name") in credit_names:
            continue
        bal = _decimal(row["balance"])
        if bal < Decimal("0"):
            out.append(row)
        elif buffers.get(row["account_name"], Decimal("0")) > 0 and bal < buffers[row["account_name"]]:
            out.append(row)
    return out


def _health_alert_names_for_date(
    date_iso: str,
    health_by_id: dict[int, dict[str, Any]],
    accounts_by_id: dict[int, Account],
) -> list[str]:
    names: list[str] = []
    for aid, health in health_by_id.items():
        if health.get("status") == HEALTH_STATUS_HEALTHY:
            continue
        if health.get("risk_date") != date_iso:
            continue
        account = accounts_by_id.get(aid)
        if account:
            label = account.effective_display_name
            if label not in names:
                names.append(label)
    return names


def _day_risk_reason(
    date_iso: str,
    transactions: list[dict[str, Any]],
    health_by_id: dict[int, dict[str, Any]],
    accounts_by_id: dict[int, Account],
) -> str | None:
    risky_names: list[str] = []
    for txn in transactions:
        if not txn.get("risk_flag"):
            continue
        name = txn.get("account_name") or "Account"
        if name not in risky_names:
            risky_names.append(name)
    for aid, health in health_by_id.items():
        if health.get("status") == HEALTH_STATUS_HEALTHY:
            continue
        if health.get("risk_date") != date_iso:
            continue
        account = accounts_by_id.get(aid)
        if account:
            label = account.effective_display_name
            if label not in risky_names:
                risky_names.append(label)
    if not risky_names:
        return None
    if len(risky_names) == 1:
        return f"{risky_names[0]} projected below buffer"
    return f"{risky_names[0]} and others projected at risk"


def build_upcoming_groups(
    events: list[dict[str, Any]],
    *,
    transfer_rule_ids: set[int],
    transfer_rule_targets: dict[int, int],
    transfer_rule_sources: dict[int, int],
    accounts_by_id: dict[int, Account],
    health_by_id: dict[int, dict[str, Any]],
    today: date | None = None,
    max_transactions: int = UPCOMING_MAX_TRANSACTIONS,
    per_day_visible: int = UPCOMING_PER_DAY_VISIBLE,
) -> dict[str, Any]:
    """Group upcoming events by date with daily subtotals."""
    today = today or date.today()
    display_events = list(events)
    truncated = len(display_events) > max_transactions
    visible_events = display_events[:max_transactions]

    by_date: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for ev in visible_events:
        by_date[ev["date"]].append(ev)

    groups: list[dict[str, Any]] = []
    for date_iso in sorted(by_date.keys()):
        day_events = by_date[date_iso]
        try:
            d = date.fromisoformat(date_iso[:10])
        except ValueError:
            continue

        income = Decimal("0")
        expense = Decimal("0")
        transfer = Decimal("0")
        has_transfer = False

        serialized: list[dict[str, Any]] = []
        for ev in day_events:
            txn = _serialize_transaction(
                ev,
                transfer_rule_ids=transfer_rule_ids,
                transfer_rule_targets=transfer_rule_targets,
                transfer_rule_sources=transfer_rule_sources,
                accounts_by_id=accounts_by_id,
            )
            serialized.append(txn)
            amt = _decimal(ev.get("amount") or 0)
            if is_income_for_dashboard_totals(
                ev,
                transfer_rule_ids=transfer_rule_ids,
                transfer_rule_targets=transfer_rule_targets,
                accounts_by_id=accounts_by_id,
            ):
                income += amt
            elif is_expense_for_dashboard_totals(
                ev,
                transfer_rule_ids=transfer_rule_ids,
                transfer_rule_targets=transfer_rule_targets,
                accounts_by_id=accounts_by_id,
            ):
                expense += abs(amt)
            elif is_internal_money_movement(
                ev,
                transfer_rule_ids=transfer_rule_ids,
                transfer_rule_targets=transfer_rule_targets,
                accounts_by_id=accounts_by_id,
            ) and amt != 0:
                has_transfer = True
                transfer += abs(amt)

        serialized = collapse_internal_transfer_pairs_for_display(serialized)

        net = income - expense
        risk_reason = _day_risk_reason(
            date_iso, serialized, health_by_id, accounts_by_id
        )
        has_risk = bool(risk_reason) or any(t.get("risk_flag") for t in serialized)
        balance_rows = _day_account_balance_rows(serialized)
        lowest_balances = _day_lowest_projected_balances(serialized, accounts_by_id)
        health_names = _health_alert_names_for_date(
            date_iso, health_by_id, accounts_by_id
        )
        account_balances = account_balances_from_txn_lows(balance_rows, accounts_by_id)
        heat = calculate_day_heat(
            has_activity=bool(serialized),
            account_balances=account_balances,
            health_alert_names=health_names,
        )
        credit_balance_warnings = scan_credit_day_warnings(serialized, accounts_by_id)
        lowest_marker = calculate_day_lowest_marker(
            serialized,
            accounts_by_id,
            date_iso=date_iso,
            heat_level=heat["heat_level"],
        )
        if not lowest_marker["show_lowest_balance_marker"] and heat["heat_level"] in (
            "tight",
            "dangerous",
        ):
            snapshot_marker = calculate_day_lowest_marker_from_snapshots(
                account_balances,
                accounts_by_id,
                date_iso=date_iso,
                heat_level=heat["heat_level"],
            )
            if snapshot_marker["show_lowest_balance_marker"]:
                lowest_marker = snapshot_marker
        hidden_count = max(0, len(serialized) - per_day_visible)

        groups.append(
            {
                "date": date_iso,
                "label": _format_group_label(d),
                "day_of_week": _format_day_of_week(d),
                "month_key": d.strftime("%Y-%m"),
                "month_label": d.strftime("%B %Y").upper(),
                "income_total": str(income.quantize(Decimal("0.01"))),
                "expense_total": str(expense.quantize(Decimal("0.01"))),
                "net_total": str(net.quantize(Decimal("0.01"))),
                "transfer_total": str(transfer.quantize(Decimal("0.01"))),
                "transfers_excluded": has_transfer,
                "has_risk": has_risk,
                "risk_reason": risk_reason,
                "heat_level": heat["heat_level"],
                "heat_label": heat["heat_label"],
                "heat_reason": heat["heat_reason"],
                "affected_account_name": heat["affected_account_name"],
                "lowest_projected_balance": lowest_marker["lowest_projected_balance"]
                or heat["lowest_projected_balance"],
                "below_buffer_amount": lowest_marker["below_buffer_amount"]
                or heat["below_buffer_amount"],
                "is_negative": heat["is_negative"],
                "lowest_projected_balance_account_id": lowest_marker[
                    "lowest_projected_balance_account_id"
                ],
                "lowest_projected_balance_account_name": lowest_marker[
                    "lowest_projected_balance_account_name"
                ],
                "lowest_projected_balance_transaction_id": lowest_marker[
                    "lowest_projected_balance_transaction_id"
                ],
                "lowest_projected_balance_after_description": lowest_marker[
                    "lowest_projected_balance_after_description"
                ],
                "lowest_projected_balance_date": lowest_marker[
                    "lowest_projected_balance_date"
                ],
                "amount_needed_to_zero": lowest_marker["amount_needed_to_zero"],
                "amount_needed_to_buffer": lowest_marker["amount_needed_to_buffer"],
                "show_lowest_balance_marker": lowest_marker["show_lowest_balance_marker"],
                "lowest_projected_balances": lowest_balances,
                "credit_balance_warnings": credit_balance_warnings,
                "transactions": serialized,
                "hidden_transaction_count": hidden_count,
                "total_transaction_count": len(serialized),
                "visible_transaction_limit": per_day_visible,
                "biggest_drivers": compute_biggest_drivers(serialized),
            }
        )

    for group in groups:
        balances: dict[str, str] = {}
        for txn in group.get("transactions") or []:
            aid = txn.get("account_id")
            bal = txn.get("balance_after")
            if aid is not None and bal is not None:
                balances[str(aid)] = str(bal)
        group["account_balances"] = balances
        if balances:
            group["ending_balance"] = str(
                sum(_decimal(v) for v in balances.values()).quantize(Decimal("0.01"))
            )
        else:
            group["ending_balance"] = group.get("net_total") or "0"
    carry_forward_lowest_markers(groups)
    attach_recovery_to_days(groups, accounts_by_id=accounts_by_id)
    for group in groups:
        group.pop("account_balances", None)

    return {
        "groups": groups,
        "truncated": truncated,
        "total_event_count": len(display_events),
        "visible_event_count": len(visible_events),
    }
