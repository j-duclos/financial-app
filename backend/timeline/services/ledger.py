"""
Projection engine: rule occurrence generation and timeline build.
Recurring rule instances are evaluated in date order; debt payments may materialize as PLANNED
rows or be skipped and purged when the destination balance is already clear on that date.
"""
import logging
import time
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal
from typing import Any, Collection, Iterable, Optional

from django.db.models import Q, Sum
from django.db.models.functions import Coalesce
from django.utils import timezone

from accounts.models import Account
from common.services.profiler import (
    QueryProfiler,
    PerfTimer,
    enter_build_timeline_context,
    exit_build_timeline_context,
    get_materialized_transaction_count,
    get_perf_caller,
    increment_build_timeline_count,
    log_perf,
    materialization_active,
    perf_enabled,
    perf_print,
    phase_end,
    phase_start,
    projection_only_build_active,
    record_materialization_created,
    record_materialization_skipped,
    record_materialization_updated,
    record_materialized_transaction,
    set_materialization_existing_loaded,
    set_materialization_occurrences_generated,
    should_materialize_rule,
)
from core.utils import get_households_for_user
from timeline.services.balance_cache import TimelineBalanceCache, get_active_balance_cache
from timeline.services.rule_occurrence_store import (
    RuleOccurrenceStore,
    activate_rule_occurrence_store,
    build_rule_occurrence_store,
    deactivate_rule_occurrence_store,
    get_rule_occurrence_store,
)


def _lookup_account(account_id: int, accs: dict[int, Account]) -> Account | None:
    """Resolve account from preloaded timeline cache, local map, or DB."""
    cache = get_active_balance_cache()
    if cache is not None:
        acc = cache.get_account(account_id)
        if acc is not None:
            return acc
    if account_id in accs:
        return accs[account_id]
    return Account.objects.filter(pk=account_id).first()
from timeline.models import (
    InterestCycleSkip,
    RecurringRule,
    RecurringRuleSkip,
    Scenario,
    ScenarioAddedRecurring,
    ScenarioRuleOverride,
)
from transactions.models import Transaction, TransactionMatch, TransferGroup
from transactions.services.matching import (
    ledger_visible_transactions,
    shadowed_rule_occurrence_ids,
    try_match_rule_to_pending_imports,
    _matched_rule_occurrence_covers,
)
from timeline.services.rule_schedule import (
    generate_rule_occurrence_dates,
    promote_due_schedules,
    resolve_rule_params,
)

logger = logging.getLogger(__name__)


def timeline_row_process_order(row: dict) -> tuple:
    """
    Within-day ordering for running balance and calendar heat.

    Matches apps/web compareTimelineRows: transaction_id (missing → -1), then description.
    """
    tid = row.get("transaction_id")
    if tid is None:
        tid_key = -1
    else:
        try:
            tid_key = int(tid)
        except (TypeError, ValueError):
            tid_key = -1
    desc = str(row.get("description") or "").lower()
    return (tid_key, desc)


def _rule_row_precedence(row: dict) -> tuple:
    """Lower is better — prefer materialized / cleared rows over synthetic duplicates."""
    status = (row.get("status") or "").upper()
    tid = row.get("transaction_id")
    source = (row.get("source") or "").lower()
    return (
        0 if tid is not None else 1,
        0 if status in ("CLEARED", "RECONCILED") else 1,
        0 if source == "actual" else 1,
    )


def _timeline_row_date(val) -> date | None:
    if val is None:
        return None
    if isinstance(val, date):
        return val
    try:
        return date.fromisoformat(str(val)[:10])
    except ValueError:
        return None


def dedupe_future_rule_occurrence_rows(rows: list[dict], today: date) -> list[dict]:
    """
    Keep one timeline row per (rule_id, date, account) for future occurrences.

    Duplicate planned + projected rows for the same paycheck were being patched twice
    (e.g. $2,100 + $2,100) and destroying what-if math.
    """
    groups: dict[tuple, list[tuple[int, dict]]] = defaultdict(list)
    for idx, row in enumerate(rows):
        rd = _timeline_row_date(row.get("date"))
        rid = row.get("rule_id")
        aid = row.get("account_id")
        if rid is None or rd is None or rd < today:
            continue
        groups[(rid, rd, aid)].append((idx, row))

    drop: set[int] = set()
    for items in groups.values():
        if len(items) <= 1:
            continue
        best_idx = min(items, key=lambda pair: _rule_row_precedence(pair[1]))[0]
        for idx, _ in items:
            if idx != best_idx:
                drop.add(idx)
    if not drop:
        return rows
    return [row for idx, row in enumerate(rows) if idx not in drop]


def signed_amount_for_rule(
    rule: RecurringRule,
    amount: Decimal,
    reference_row: dict | None = None,
) -> Decimal:
    """Signed ledger amount — when editing an existing row, keep that row's inflow/outflow sign."""
    amt = abs(amount) if not isinstance(amount, Decimal) else abs(Decimal(str(amount)))
    if reference_row is not None:
        ref_raw = reference_row.get("amount")
        if ref_raw is not None:
            return amt if Decimal(str(ref_raw)) >= 0 else -amt
    if rule.direction == RecurringRule.Direction.EXPENSE:
        return -amt
    if rule.direction == RecurringRule.Direction.INCOME:
        return amt
    return amt


def recompute_timeline_running_balances(
    rows: list[dict],
    *,
    opening: dict[int, Decimal],
    account_ids: set[int],
) -> None:
    """Re-sort rows and refresh running_balance after scenario edits."""
    for r in rows:
        if "sort_key" not in r and r.get("date"):
            tid = r.get("transaction_id")
            tier = 0 if tid is not None else 1
            r["sort_key"] = (r.get("date"), tier, tid or r.get("rule_id") or 0)

    rows.sort(key=timeline_rows_chronological_key)
    for r in rows:
        r.pop("sort_key", None)

    rows_by_account: dict[int, list[dict]] = defaultdict(list)
    for r in rows:
        aid = r.get("account_id")
        if aid is not None:
            rows_by_account[aid].append(r)

    running = dict(opening)
    for r in rows:
        aid = r.get("account_id")
        if aid is None or aid not in account_ids:
            continue
        acct_rows = rows_by_account.get(aid, [])
        if is_superseded_planned_row(r, acct_rows):
            r["running_balance"] = running.get(aid, opening.get(aid, Decimal("0")))
            continue
        amt = r["amount"] if isinstance(r["amount"], Decimal) else Decimal(str(r["amount"]))
        running[aid] = running.get(aid, opening.get(aid, Decimal("0"))) + amt
        r["running_balance"] = running[aid]


def recompute_future_timeline_running_balances(
    rows: list[dict],
    *,
    today: date,
    account_ids: set[int],
    opening: dict[int, Decimal] | None = None,
) -> None:
    """
    Refresh running_balance for today+ rows only.

    Opening defaults to end-of-yesterday balance per account (matches Transactions ledger).
    Past rows are left unchanged — avoids double-counting history when reopening at today.
    """
    if opening is None:
        opening = {
            aid: _balance_at_end_of_date(aid, today - timedelta(days=1)) for aid in account_ids
        }

    rows_by_account: dict[int, list[dict]] = defaultdict(list)
    for r in rows:
        aid = r.get("account_id")
        if aid is not None:
            rows_by_account[aid].append(r)

    for r in rows:
        if "sort_key" not in r and r.get("date"):
            tid = r.get("transaction_id")
            tier = 0 if tid is not None else 1
            r["sort_key"] = (r.get("date"), tier, tid or r.get("rule_id") or 0)
    rows.sort(key=timeline_rows_chronological_key)
    for r in rows:
        r.pop("sort_key", None)

    running = dict(opening)
    for r in rows:
        rd = _timeline_row_date(r.get("date"))
        if rd is None or rd < today:
            continue
        aid = r.get("account_id")
        if aid is None or aid not in account_ids:
            continue
        acct_rows = rows_by_account.get(aid, [])
        if is_superseded_planned_row(r, acct_rows):
            r["running_balance"] = running.get(aid, opening.get(aid, Decimal("0")))
            continue
        amt = r["amount"] if isinstance(r["amount"], Decimal) else Decimal(str(r["amount"]))
        running[aid] = running.get(aid, opening.get(aid, Decimal("0"))) + amt
        r["running_balance"] = running[aid]


def forecast_lowest_balance_from_rows(
    rows: list[dict],
    *,
    account_ids: set[int],
    today: date,
    end_date: date,
) -> tuple[Decimal | None, date | None, int | None]:
    """
    Lowest intra-day balance from today through end_date for the given accounts.

    Same walk as build_timeline_calendar and the Transactions ledger: opening at end of
    yesterday, then apply today+ rows in ledger display order (superseded planned skipped).
    """
    if not account_ids:
        return None, None, None

    opening: dict[int, Decimal] = {
        aid: _balance_at_end_of_date(aid, today - timedelta(days=1)) for aid in account_ids
    }

    rows_by_account: dict[int, list[dict]] = defaultdict(list)
    for r in rows:
        aid = r.get("account_id")
        if aid is not None:
            rows_by_account[aid].append(r)

    by_date: dict[date, list[dict]] = defaultdict(list)
    for r in rows:
        rd = _timeline_row_date(r.get("date"))
        if rd is None or rd < today or rd > end_date:
            continue
        aid = r.get("account_id")
        if aid not in account_ids:
            continue
        if is_superseded_planned_row(r, rows_by_account.get(aid, [])):
            continue
        by_date[rd].append(r)

    running = dict(opening)
    global_low: Decimal | None = None
    global_date: date | None = None
    global_aid: int | None = None

    d = today
    while d <= end_date:
        day_rows = by_date.get(d, [])
        day_lowest: Decimal | None = None
        day_lowest_aid: int | None = None

        for row in sorted(day_rows, key=timeline_row_process_order):
            aid = row.get("account_id")
            if aid not in account_ids:
                continue
            amt = (
                row["amount"]
                if isinstance(row["amount"], Decimal)
                else Decimal(str(row["amount"]))
            )
            running[aid] = running.get(aid, opening.get(aid, Decimal("0"))) + amt
            bal = running[aid]
            if day_lowest is None or bal < day_lowest:
                day_lowest = bal
                day_lowest_aid = aid

        if day_lowest is not None:
            if global_low is None or day_lowest < global_low:
                global_low = day_lowest
                global_date = d
                global_aid = day_lowest_aid
        else:
            for aid in account_ids:
                bal = running.get(aid, opening.get(aid, Decimal("0")))
                if global_low is None or bal < global_low:
                    global_low = bal
                    global_date = d
                    global_aid = aid

        d += timedelta(days=1)

    return global_low, global_date, global_aid


def timeline_rows_chronological_key(row: dict) -> tuple:
    """Full sort key for timeline rows (date, then ledger display order)."""
    d = row.get("date")
    if hasattr(d, "isoformat"):
        d_key = d.isoformat()
    else:
        d_key = str(d or "")
    tid_key, desc = timeline_row_process_order(row)
    return (d_key, tid_key, desc)


def _safe_try_match_rule_to_pending_imports(txn: Transaction) -> None:
    """Link rule materializations to Plaid rows that synced earlier (never break timeline build)."""
    try:
        try_match_rule_to_pending_imports(txn)
    except Exception:
        logger.exception("try_match_rule_to_pending_imports failed for transaction pk=%s", txn.pk)


def _timeline_row_meta(txn: Optional[Transaction]) -> dict[str, Any]:
    """Origin/reconcile metadata for timeline rows (txn_source is raw Transaction.source)."""
    if txn is None:
        return {
            "reconciled": False,
            "txn_source": None,
            "import_match_status": None,
            "plaid_transaction_id": None,
            "transaction_type": None,
            "transfer_group_id": None,
        }
    src = txn.source
    txn_type = getattr(txn, "transaction_type", None)
    ims = getattr(txn, "import_match_status", None) or ""
    return {
        "reconciled": bool(txn.reconciled),
        "txn_source": src.lower() if src else None,
        "import_match_status": ims.lower() if ims else None,
        "plaid_transaction_id": (txn.plaid_transaction_id or "").strip() or None,
        "transaction_type": txn_type.lower() if txn_type else None,
        "transfer_group_id": getattr(txn, "transfer_group_id", None),
    }


def _projected_rule_timeline_row(
    *,
    d: date,
    description: str,
    account_id: int,
    account_name: str,
    category_id: Optional[int],
    category_name: Optional[str],
    amount: Decimal,
    row_type: str,
    rule_id: int,
    sort_key: tuple,
) -> dict:
    """Synthetic future rule row for scenario timelines (never persisted as Transaction)."""
    return {
        "date": d,
        "description": description,
        "account_id": account_id,
        "account_name": account_name,
        "category_id": category_id,
        "category_name": category_name,
        "amount": amount,
        "type": row_type,
        "status": "planned",
        "source": "rule",
        "rule_id": rule_id,
        "transaction_id": None,
        "sort_key": sort_key,
        **_timeline_row_meta(None),
    }


def _materialized_rule_timeline_row_if_exists(
    *,
    rule_id: int,
    d: date,
    account_id: int,
    account_name: str,
    category_id: Optional[int],
    category_name: Optional[str],
    amount_decimal: Decimal,
    row_type: str,
    description: str,
    sort_key: tuple,
    ids_in_rows: set[int],
) -> Optional[dict]:
    """When a rule occurrence is already materialized, return a timeline row with transaction_id."""
    store = get_rule_occurrence_store()
    existing = store.get(rule_id, account_id, d) if store else None
    if existing is None:
        existing = (
            Transaction.objects.filter(rule_id=rule_id, account_id=account_id, date=d)
            .select_related("account", "category")
            .first()
        )
    if existing is None or existing.pk in ids_in_rows:
        return None
    from transactions.services.matching import planned_leg_suppressed_by_import_match

    if planned_leg_suppressed_by_import_match(existing):
        return None
    ids_in_rows.add(existing.pk)
    amt = existing.amount if existing.amount is not None else amount_decimal
    cat_id = category_id if category_id is not None else existing.category_id
    cat_name = category_name
    if cat_name is None and getattr(existing, "category", None):
        cat_name = existing.category.name
    desc = (existing.payee or description).strip() or description
    return {
        "date": d,
        "description": desc,
        "account_id": account_id,
        "account_name": account_name,
        "category_id": cat_id,
        "category_name": cat_name,
        "amount": amt,
        "type": row_type,
        "status": existing.status,
        "source": "actual",
        "rule_id": rule_id,
        "transaction_id": existing.pk,
        "sort_key": sort_key,
        **_timeline_row_meta(existing),
    }


def _append_rescheduled_rule_materializations(
    *,
    rows: list[dict],
    ids_in_rows: set[int],
    rule_ids: list[int],
    forecastable_account_ids: set[int],
    start_date: date,
    end_date: date,
    today: date,
    seen_rule_actual_key: set[tuple],
) -> None:
    """
    Include materialized rule transactions on dates outside the rule's generated schedule.

    projection_only skips future rule rows in the main loop and re-adds them only when
    iterating scheduled occurrence dates. One-off date moves (RecurringRuleSkip on the old
    date) leave the transaction on a non-schedule day — pick those up here.
    """
    if not rule_ids:
        return
    window_start = max(start_date, today)
    if window_start > end_date:
        return

    from transactions.services.matching import planned_leg_suppressed_by_import_match

    extra = (
        Transaction.objects.filter(
            rule_id__in=rule_ids,
            date__gte=window_start,
            date__lte=end_date,
            account_id__in=forecastable_account_ids,
            source=Transaction.Source.RULE,
        )
        .exclude(pk__in=ids_in_rows)
        .select_related("account", "category", "rule")
        .order_by("date", "pk")
    )
    for t in extra:
        if t.pk in ids_in_rows:
            continue
        if planned_leg_suppressed_by_import_match(t):
            ids_in_rows.add(t.pk)
            continue
        amt = t.amount
        sign = 1 if (amt is not None and amt >= 0) else -1
        if t.rule_id is not None:
            rule_actual_key = (t.account_id, t.date, t.rule_id, sign)
            if rule_actual_key in seen_rule_actual_key:
                ids_in_rows.add(t.pk)
                continue
            seen_rule_actual_key.add(rule_actual_key)
        rule = t.rule
        acc = t.account
        acc_name = acc.effective_display_name if acc else ""
        row_type = rule.direction if rule else RecurringRule.Direction.EXPENSE
        cat_name = t.category.name if getattr(t, "category", None) else None
        desc = (t.payee or (rule.name if rule else "")).strip() or "Scheduled"
        ids_in_rows.add(t.pk)
        rows.append(
            {
                "date": t.date,
                "description": desc,
                "account_id": t.account_id,
                "account_name": acc_name,
                "category_id": t.category_id,
                "category_name": cat_name,
                "amount": amt,
                "type": row_type,
                "status": t.status,
                "source": "actual",
                "rule_id": t.rule_id,
                "transaction_id": t.pk,
                "sort_key": (t.date, 1, t.rule_id or 0),
                **_timeline_row_meta(t),
            }
        )


def _category_suggests_loan_payment(category_name: Optional[str]) -> bool:
    if not category_name or not str(category_name).strip():
        return False
    n = str(category_name).lower()
    return any(k in n for k in ("loan", "mortgage", "debt", "heloc"))


def _account_is_debt_payment_destination(acc: Account, category_name: Optional[str]) -> bool:
    if acc.account_type == Account.AccountType.CREDIT:
        return True
    if acc.account_type == Account.AccountType.OTHER and _category_suggests_loan_payment(category_name):
        return True
    return False


def _category_name_allows_rule_transfer_destination(category_name: Optional[str]) -> bool:
    """
    RecurringRule.transfer_to_account is only meaningful for these categories (same as Rules UI).
    Stale FK rows must not force transfer/skip logic for plain expenses (e.g. Shopping).
    """
    n = (category_name or "").strip()
    return n in ("Credit Card Payment", "Bank Transfer")


def _has_paired_rule_transfer_leg(txn: Transaction) -> bool:
    """True when another RULE leg exists for the same rule occurrence (bank↔card transfer pair)."""
    if txn.rule_id is None:
        return False
    return (
        Transaction.objects.filter(
            rule_id=txn.rule_id,
            date=txn.date,
            source=Transaction.Source.RULE,
        )
        .exclude(account_id=txn.account_id)
        .exists()
    )


def _is_scheduled_rule_transfer(rule: RecurringRule, category_name: Optional[str]) -> bool:
    return bool(rule.transfer_to_account_id) and _category_name_allows_rule_transfer_destination(
        category_name
    )


def _link_rule_transfer_pair_transactions(
    *,
    rule: RecurringRule,
    d: date,
    txn_from: Transaction,
    txn_to: Transaction,
    from_acc_id: int,
    to_acc_id: int,
    in_amount: Decimal,
) -> None:
    """Attach a TransferGroup so paired rule legs are never treated as standalone debt payments."""
    if txn_from.transfer_group_id and txn_to.transfer_group_id:
        return
    existing_tg_id = txn_from.transfer_group_id or txn_to.transfer_group_id
    if existing_tg_id:
        updates: list[tuple[Transaction, list[str]]] = []
        if not txn_from.transfer_group_id:
            txn_from.transfer_group_id = existing_tg_id
            updates.append((txn_from, ["transfer_group_id", "updated_at"]))
        if not txn_to.transfer_group_id:
            txn_to.transfer_group_id = existing_tg_id
            updates.append((txn_to, ["transfer_group_id", "updated_at"]))
        for txn, fields in updates:
            txn.save(update_fields=fields)
        return
    from_acc = Account.objects.filter(pk=from_acc_id).first()
    if from_acc is None:
        return
    today = timezone.localdate()
    tg_status = TransferGroup.Status.PLANNED if d > today else TransferGroup.Status.CLEARED
    tg = TransferGroup.objects.create(
        household_id=from_acc.household_id,
        from_account_id=from_acc_id,
        to_account_id=to_acc_id,
        amount=abs(in_amount),
        scheduled_date=d,
        status=tg_status,
    )
    txn_from.transfer_group = tg
    txn_to.transfer_group = tg
    txn_from.save(update_fields=["transfer_group_id", "updated_at"])
    txn_to.save(update_fields=["transfer_group_id", "updated_at"])
    cache = get_active_balance_cache()
    if cache is not None:
        cache.note_transaction_saved(txn_from)
        cache.note_transaction_saved(txn_to)


def repair_unlinked_rule_transfer_pairs(account_ids: Iterable[int]) -> int:
    """Backfill TransferGroup links on materialized bank→card rule pairs missing transfer_group_id."""
    from collections import defaultdict

    from timeline.models import RecurringRule

    ids = list(account_ids)
    if not ids:
        return 0
    repaired = 0
    rules = RecurringRule.objects.filter(
        Q(account_id__in=ids) | Q(transfer_to_account_id__in=ids),
        transfer_to_account__isnull=False,
        active=True,
    ).select_related("category", "account", "transfer_to_account")
    today = timezone.localdate()
    for rule in rules:
        cat_name = rule.category.name if rule.category else None
        if not _is_scheduled_rule_transfer(rule, cat_name):
            continue
        by_date: dict[date, list[Transaction]] = defaultdict(list)
        for txn in Transaction.objects.filter(
            rule_id=rule.id,
            source=Transaction.Source.RULE,
            date__gte=today,
            transfer_group_id__isnull=True,
        ):
            by_date[txn.date].append(txn)
        for d, legs in by_date.items():
            out_leg = next((t for t in legs if t.amount is not None and t.amount < 0), None)
            in_leg = next((t for t in legs if t.amount is not None and t.amount > 0), None)
            if out_leg is None or in_leg is None:
                continue
            in_amt = in_leg.amount if in_leg.amount is not None else Decimal("0")
            _link_rule_transfer_pair_transactions(
                rule=rule,
                d=d,
                txn_from=out_leg,
                txn_to=in_leg,
                from_acc_id=out_leg.account_id,
                to_acc_id=in_leg.account_id,
                in_amount=in_amt,
            )
            repaired += 1
    return repaired


def _db_card_postings_in_exclusive_range(
    card_account_id: int,
    after_date: date,
    through_date: date,
) -> Decimal:
    """Signed sum of ledger-visible postings on the card with date in (after_date, through_date]."""
    cache = get_active_balance_cache()
    if cache is not None:
        return cache.db_card_postings_in_exclusive_range(card_account_id, after_date, through_date)
    qs = ledger_visible_transactions(
        Transaction.objects.filter(
            account_id=card_account_id,
            date__gt=after_date,
            date__lte=through_date,
        )
    )
    return sum((Decimal(str(a)) for a in qs.values_list("amount", flat=True)), start=Decimal("0"))


def _future_recurring_expense_impact_on_card(
    card_account_id: int,
    payment_date: date,
    through_date: date,
    households,
) -> Decimal:
    """
    Signed incremental debt from recurring EXPENSE rules that post on this card strictly after
    payment_date through through_date. Usually negative. Skips dates that already have any
    posting on this card (those are covered by DB sums). Omits rules with transfer_to_account set.
    """
    total = Decimal("0")
    rules = RecurringRule.objects.filter(
        household__in=households,
        active=True,
        account_id=card_account_id,
        direction=RecurringRule.Direction.EXPENSE,
        transfer_to_account__isnull=True,
    )
    occ_start = payment_date + timedelta(days=1)
    if occ_start > through_date:
        return Decimal("0")
    for rule in rules:
        for d in generate_rule_occurrence_dates(rule, occ_start, through_date):
            params = resolve_rule_params(rule, d)
            amt_delta = -abs(params.amount)
            if d <= payment_date:
                continue
            cache = get_active_balance_cache()
            if cache is not None:
                if cache.has_posting_on_date(card_account_id, d):
                    continue
            elif Transaction.objects.filter(account_id=card_account_id, date=d).exists():
                continue
            total += amt_delta
    return total


def _purge_skipped_rule_occurrence(rule_id: int, occurrence_date: date, as_of_today: date) -> None:
    """
    Remove all RULE-sourced rows for this occurrence (any status) so skipped payments do not
    respawn. Old rows were often status=CLEARED (model default) before we forced PLANNED, so
    filtering only PLANNED left ghosts in the DB.

    PLAID INVARIANT: only deletes source=RULE. Never delete source=PLAID.
    Never purge when a Plaid import is matched to this occurrence — the bank row must stay
    linked and visible even if the forecast row is skipped.
    """
    if occurrence_date < as_of_today:
        return
    deleted = Transaction.objects.filter(
        rule_id=rule_id,
        date=occurrence_date,
        source=Transaction.Source.RULE,
    )
    if not deleted.exists():
        return
    matched_import_on_occurrence = TransactionMatch.objects.filter(
        planned_transaction__rule_id=rule_id,
        planned_transaction__date=occurrence_date,
        imported_transaction__source=Transaction.Source.PLAID,
    ).exists()
    if matched_import_on_occurrence:
        return
    account_ids = list(deleted.values_list("account_id", flat=True).distinct())
    deleted.delete()
    cache = get_active_balance_cache()
    if cache is not None:
        for aid in account_ids:
            if aid is not None:
                cache.note_transactions_deleted(aid, rule_id=rule_id, on_date=occurrence_date)


def _liability_balance_through_date(
    account_id: int,
    as_of_date: date,
    rows: list[dict],
    *,
    include_row_leg_without_txn: bool,
    include_db_postings_on_as_of_date: bool = False,
    exclude_transaction_ids: Optional[Collection[int]] = None,
) -> Decimal:
    """
    Signed balance for a non-credit liability account (e.g. OTHER loan): starting_balance + txns.
    Convention matches bank-style accounts: negative balance = owed principal (payments are inflows).
    """
    cache = get_active_balance_cache()
    if cache is not None:
        return cache.balance_through_date(
            account_id,
            as_of_date,
            rows,
            include_row_leg_without_txn=include_row_leg_without_txn,
            include_db_postings_on_as_of_date=include_db_postings_on_as_of_date,
            exclude_transaction_ids=exclude_transaction_ids,
            credit_style=False,
        )
    acc = Account.objects.filter(pk=account_id).first()
    if not acc:
        return Decimal("0")
    ex = exclude_transaction_ids
    opening_one = Decimal(str(acc.starting_balance)) if acc.starting_balance is not None else Decimal("0")
    if include_db_postings_on_as_of_date:
        before_qs = ledger_visible_transactions(
            Transaction.objects.filter(account_id=account_id, date__lt=as_of_date)
        )
        on_day_qs = ledger_visible_transactions(
            Transaction.objects.filter(account_id=account_id, date=as_of_date)
        )
        if ex:
            before_qs = before_qs.exclude(pk__in=ex)
            on_day_qs = on_day_qs.exclude(pk__in=ex)
        balance = opening_one + sum(
            (Decimal(str(a)) for a in before_qs.values_list("amount", flat=True)), start=Decimal("0")
        )
        balance += sum(
            (Decimal(str(a)) for a in on_day_qs.values_list("amount", flat=True)), start=Decimal("0")
        )
        if include_row_leg_without_txn:
            for r in rows:
                if r.get("account_id") != account_id:
                    continue
                rd = r.get("date")
                if rd is None:
                    continue
                if isinstance(rd, str):
                    rd = date.fromisoformat(rd[:10]) if rd else None
                if rd != as_of_date or r.get("transaction_id") is not None:
                    continue
                amt = r.get("amount")
                try:
                    amt_d = Decimal(str(amt)) if amt is not None else Decimal("0")
                except (TypeError, ValueError):
                    continue
                balance += amt_d
        return balance

    txns_qs = ledger_visible_transactions(
        Transaction.objects.filter(account_id=account_id, date__lte=as_of_date)
    )
    if ex:
        txns_qs = txns_qs.exclude(pk__in=ex)
    balance = opening_one + sum(
        (Decimal(str(a)) for a in txns_qs.values_list("amount", flat=True)), start=Decimal("0")
    )
    for r in rows:
        if r.get("account_id") != account_id:
            continue
        rd = r.get("date")
        if rd is None:
            continue
        if isinstance(rd, str):
            rd = date.fromisoformat(rd[:10]) if rd else None
        if rd is None or rd > as_of_date:
            continue
        amt = r.get("amount")
        try:
            amt_d = Decimal(str(amt)) if amt is not None else Decimal("0")
        except (TypeError, ValueError):
            continue
        if include_row_leg_without_txn:
            if r.get("transaction_id") is not None:
                continue
            balance += amt_d
        else:
            if r.get("source") != "rule":
                continue
            balance += amt_d
    return balance


def _skip_payment_to_debt_destination(
    dest_account: Account,
    payment_date: date,
    rows: list[dict],
    payment_amount: Optional[Decimal],
    *,
    exclude_transaction_ids: Optional[Collection[int]] = None,
    category_name: Optional[str] = None,
) -> bool:
    """
    True if we should not project/materialize a payment into dest_account on payment_date
    because there is no debt before this payment (balance >= 0 in app convention).

    We intentionally do *not* skip based on (balance + payment) > 0 (would overpay): projected
    credit-card interest is appended to ``rows`` only *after* the rule loop, so during skip
    checks the balance often ignores interest that posts earlier in the same month. That made
    debt look smaller than it is and incorrectly skipped minimum payments after a few months.
    """
    _ = payment_amount  # reserved for API; skip uses balance only (see docstring)
    if not _account_is_debt_payment_destination(dest_account, category_name):
        return False
    if dest_account.account_type == Account.AccountType.CREDIT:
        balance = _credit_card_balance_through_date(
            dest_account.id,
            payment_date,
            rows,
            include_row_leg_without_txn=True,
            include_db_postings_on_as_of_date=True,
            exclude_transaction_ids=exclude_transaction_ids,
        )
    else:
        balance = _liability_balance_through_date(
            dest_account.id,
            payment_date,
            rows,
            include_row_leg_without_txn=True,
            include_db_postings_on_as_of_date=True,
            exclude_transaction_ids=exclude_transaction_ids,
        )
    return balance >= 0


def _rule_allows_materialization(rule: RecurringRule, d: date) -> bool:
    if not rule.active:
        return False
    if rule.paused_at and d >= rule.paused_at:
        return False
    return True


def _materialize_rule_occurrence(
    rule: RecurringRule,
    d: date,
    account_id: int,
    amount: Decimal,
    payee: str,
    category_id: Optional[int],
) -> Transaction:
    """Get or create a Transaction for this rule occurrence. If one already exists, return it as-is so user edits (e.g. "this occurrence only" amount change) are preserved."""
    if projection_only_build_active():
        raise RuntimeError("Materialization called during projection_only timeline build")
    store = get_rule_occurrence_store()
    if store is not None:
        txn = store.get(rule.pk, account_id, d)
    else:
        txn = (
            Transaction.objects.filter(rule=rule, date=d, account_id=account_id)
            .select_related("account", "category")
            .first()
        )
    if txn is not None:
        if materialization_active():
            record_materialization_skipped()
        _safe_try_match_rule_to_pending_imports(txn)
        return txn
    covered = _matched_rule_occurrence_covers(
        rule_id=rule.pk,
        account_id=account_id,
        on_date=d,
        amount=amount,
    )
    if covered is not None and covered.date == d:
        if materialization_active():
            record_materialization_skipped()
        return covered
    if not _rule_allows_materialization(rule, d):
        raise ValueError(
            f"Cannot materialize rule {rule.pk} on {d}: rule is inactive or paused as of {rule.paused_at}"
        )
    created = Transaction.objects.create(
        account_id=account_id,
        date=d,
        payee=payee or "—",
        memo="",
        amount=amount,
        category_id=category_id,
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.RULE,
        rule=rule,
    )
    if materialization_active():
        record_materialization_created()
    else:
        record_materialized_transaction()
    _safe_try_match_rule_to_pending_imports(created)
    # TODO: Batch Plaid import matching after materialization loop to avoid per-occurrence queries.
    has_bucket_allocations = (
        rule.pk in store.active_bucket_rule_ids
        if store is not None
        else rule.bucket_allocations.filter(active=True).exists()
    )
    if created.amount > 0 and has_bucket_allocations:
        try:
            from goals.bucket_services import process_rule_allocations_for_transaction

            process_rule_allocations_for_transaction(rule, created)
        except Exception:
            pass
    cache = get_active_balance_cache()
    if cache is not None:
        cache.note_transaction_saved(created)
    if store is not None:
        store.put(created)
    return created


def _twice_monthly_days_from_notes(notes: str | None) -> tuple[int, int] | None:
    import re

    if not notes:
        return None
    m = re.search(r"twice_monthly_days=(\d{1,2}),(\d{1,2})", notes)
    if not m:
        return None
    d1, d2 = int(m.group(1)), int(m.group(2))
    if 1 <= d1 <= 31 and 1 <= d2 <= 31 and d1 != d2:
        return d1, d2
    return None


def _twice_monthly_occurrence_dates(
    added: ScenarioAddedRecurring,
    start_date: date,
    end_date: date,
) -> list[date]:
    """Two fixed days per month (scenario-only extra debt payments)."""
    days = _twice_monthly_days_from_notes(added.notes)
    if not days:
        return []
    d1, d2 = days
    rule_start = added.start_date
    rule_end = added.end_date
    start = max(start_date, rule_start)
    end = end_date
    if rule_end:
        end = min(end, rule_end)
    if start > end:
        return []
    out: list[date] = []
    y, m = start.year, start.month
    while (y, m) <= (end.year, end.month):
        for day in (d1, d2):
            try:
                d = date(y, m, min(day, _days_in_month(y, m)))
            except ValueError:
                d = date(y, m, _days_in_month(y, m))
            if start <= d <= end and d >= rule_start and (not rule_end or d <= rule_end):
                out.append(d)
        m += 1
        if m > 12:
            m, y = 1, y + 1
    return sorted(set(out))


def _occurrence_dates_for_added_recurring(
    added: ScenarioAddedRecurring,
    start_date: date,
    end_date: date,
) -> list[date]:
    """Reuse rule occurrence scheduling for scenario-only recurring rows."""
    if _twice_monthly_days_from_notes(added.notes):
        return _twice_monthly_occurrence_dates(added, start_date, end_date)

    from types import SimpleNamespace

    stub = SimpleNamespace(
        active=True,
        start_date=added.start_date,
        end_date=added.end_date,
        paused_at=None,
        interval=added.interval or 1,
        frequency=added.frequency,
        day_of_week=added.day_of_week,
        day_of_month=added.day_of_month,
        nth_week=added.nth_week,
    )
    return generate_rule_occurrences(stub, start_date, end_date)


def append_scenario_added_recurring_projections(
    *,
    scenario: Scenario,
    rows: list[dict],
    start_date: date,
    end_date: date,
    forecastable_account_ids: set[int],
    seen_keys: set[tuple],
) -> None:
    """Project what-if-only recurring items — never persisted as RecurringRule or Transaction."""
    added_qs = ScenarioAddedRecurring.objects.filter(scenario=scenario).select_related(
        "account", "transfer_to_account", "category"
    )
    for added in added_qs:
        occ_dates = _occurrence_dates_for_added_recurring(added, start_date, end_date)
        if not occ_dates:
            continue
        amount_decimal = abs(Decimal(str(added.amount))).quantize(Decimal("0.01"))

        if (
            added.direction == ScenarioAddedRecurring.Direction.TRANSFER
            and added.transfer_to_account_id
        ):
            if added.account_id not in forecastable_account_ids:
                continue
            to_acc = added.transfer_to_account
            from_name = added.account.effective_display_name if added.account else ""
            to_name = to_acc.effective_display_name if to_acc else ""
            cat_name = _scenario_transfer_category_name(to_acc)
            label = added.name or f"Transfer to {to_name}"
            for d in occ_dates:
                if to_acc and to_acc.id in forecastable_account_ids:
                    in_key = ("added", added.id, d, to_acc.id, "in")
                    if in_key not in seen_keys:
                        seen_keys.add(in_key)
                        rows.append(
                            {
                                "date": d,
                                "description": label,
                                "account_id": to_acc.id,
                                "account_name": to_name,
                                "category_id": None,
                                "category_name": cat_name,
                                "amount": amount_decimal,
                                "type": "INFLOW",
                                "status": "planned",
                                "source": "scenario_added_recurring",
                                "rule_id": None,
                                "scenario_added_recurring_id": added.id,
                                "transaction_id": None,
                                "sort_key": (d, 1, added.id + 1),
                                **_timeline_row_meta(None),
                            }
                        )
                out_key = ("added", added.id, d, added.account_id, "out")
                if out_key in seen_keys:
                    continue
                seen_keys.add(out_key)
                rows.append(
                    {
                        "date": d,
                        "description": label,
                        "account_id": added.account_id,
                        "account_name": from_name,
                        "category_id": None,
                        "category_name": cat_name,
                        "amount": -amount_decimal,
                        "type": "OUTFLOW",
                        "status": "planned",
                        "source": "scenario_added_recurring",
                        "rule_id": None,
                        "scenario_added_recurring_id": added.id,
                        "transaction_id": None,
                        "sort_key": (d, 1, added.id),
                        **_timeline_row_meta(None),
                    }
                )
            continue

        if added.account_id not in forecastable_account_ids:
            continue
        signed = amount_decimal
        if added.direction == ScenarioAddedRecurring.Direction.EXPENSE:
            signed = -amount_decimal
        elif added.direction == ScenarioAddedRecurring.Direction.INCOME:
            signed = amount_decimal
        cat_name = added.category.name if added.category else None
        acc_name = added.account.name if added.account else ""
        for d in occ_dates:
            proj_key = ("added", added.id, d, added.account_id)
            if proj_key in seen_keys:
                continue
            seen_keys.add(proj_key)
            rows.append(
                {
                    "date": d,
                    "description": added.name,
                    "account_id": added.account_id,
                    "account_name": acc_name,
                    "category_id": added.category_id,
                    "category_name": cat_name,
                    "amount": signed,
                    "type": "INFLOW" if signed >= 0 else "OUTFLOW",
                    "status": "planned",
                    "source": "scenario_added_recurring",
                    "rule_id": None,
                    "scenario_added_recurring_id": added.id,
                    "transaction_id": None,
                    "sort_key": (d, 1, added.id),
                    **_timeline_row_meta(None),
                }
            )


def generate_rule_occurrences(
    rule: RecurringRule,
    start_date: date,
    end_date: date,
    effective_start: Optional[date] = None,
    effective_end: Optional[date] = None,
) -> list[date]:
    """
    Generate list of occurrence dates for a rule within [start_date, end_date].
    Uses rule's start_date/end_date unless effective_start/effective_end provided (e.g. from scenario).
    Respects interval and frequency. No duplicates; sorted ascending.
    """
    if not rule.active:
        return []
    start = max(start_date, effective_start or rule.start_date)
    end = end_date
    if effective_end is not None:
        end = min(end, effective_end)
    if (rule.end_date and rule.end_date < end) or (effective_end and effective_end < end):
        end = min(end, effective_end or rule.end_date or end)
    if rule.end_date:
        end = min(end, rule.end_date)
    if rule.paused_at:
        pause_cap = rule.paused_at - timedelta(days=1)
        if start > pause_cap:
            return []
        end = min(end, pause_cap)
    if start > end:
        return []

    interval = max(1, rule.interval or 1)
    out: list[date] = []
    freq = rule.frequency

    if freq == RecurringRule.Frequency.WEEKLY:
        dow = rule.day_of_week if rule.day_of_week is not None else (rule.start_date.weekday() % 7)
        # First occurrence of target weekday on or after start
        d = start
        while d.weekday() != dow:
            d += timedelta(days=1)
        # If that date is before rule.start_date, advance by full weeks to keep weekday correct
        while d < rule.start_date:
            d += timedelta(weeks=interval)
        while d <= end:
            if d >= rule.start_date and (not rule.end_date or d <= rule.end_date):
                out.append(d)
            d += timedelta(weeks=interval)

    elif freq == RecurringRule.Frequency.BIWEEKLY:
        dow = rule.day_of_week if rule.day_of_week is not None else (rule.start_date.weekday() % 7)
        d = start
        while d.weekday() != dow:
            d += timedelta(days=1)
        while d < rule.start_date:
            d += timedelta(weeks=2 * interval)
        while d <= end:
            if d >= rule.start_date and (not rule.end_date or d <= rule.end_date):
                out.append(d)
            d += timedelta(weeks=2 * interval)

    elif freq == RecurringRule.Frequency.MONTHLY_DAY:
        day = rule.day_of_month if rule.day_of_month is not None else rule.start_date.day
        day = max(1, min(31, day))
        y, m = start.year, start.month
        month_count = 0
        while (y, m) <= (end.year, end.month):
            try:
                d = date(y, m, min(day, _days_in_month(y, m)))
            except ValueError:
                d = date(y, m, _days_in_month(y, m))
            if start <= d <= end and (not rule.end_date or d <= rule.end_date):
                if month_count % interval == 0:
                    out.append(d)
            month_count += 1
            m += 1
            if m > 12:
                m, y = 1, y + 1

    elif freq == RecurringRule.Frequency.MONTHLY_NTH_WEEKDAY:
        dow = rule.day_of_week if rule.day_of_week is not None else (rule.start_date.weekday() % 7)
        nth = rule.nth_week if rule.nth_week is not None else 1
        nth = max(1, min(5, nth))
        y, m = start.year, start.month
        month_count = 0
        while (y, m) <= (end.year, end.month):
            d = _nth_weekday_in_month(y, m, dow, nth)
            if d and start <= d <= end and (not rule.end_date or d <= rule.end_date):
                if month_count % interval == 0:
                    out.append(d)
            month_count += 1
            m += 1
            if m > 12:
                m, y = 1, y + 1

    elif freq == RecurringRule.Frequency.YEARLY:
        ref = rule.start_date
        y = start.year
        while y <= end.year:
            try:
                d = date(y, ref.month, min(ref.day, _days_in_month(y, ref.month)))
            except ValueError:
                d = date(y, ref.month, _days_in_month(y, ref.month))
            if start <= d <= end and (not rule.end_date or d <= rule.end_date):
                if (y - rule.start_date.year) % interval == 0:
                    out.append(d)
            y += 1

    return sorted(set(out))


def _days_in_month(year: int, month: int) -> int:
    if month == 12:
        return 31
    return (date(year, month + 1, 1) - date(year, month, 1)).days


def _cycle_end_dates_in_range(
    cycle_day: int,
    start_date: date,
    end_date: date,
    on_or_after: Optional[date] = None,
) -> list[date]:
    """Return cycle end dates (day-of-month = cycle_day) in [start_date, end_date].
    If on_or_after is set, only include dates >= on_or_after."""
    cycle_day = max(1, min(31, cycle_day))
    out: list[date] = []
    y, m = start_date.year, start_date.month
    while (y, m) <= (end_date.year, end_date.month):
        last = _days_in_month(y, m)
        d = date(y, m, min(cycle_day, last))
        if start_date <= d <= end_date and (on_or_after is None or d >= on_or_after):
            out.append(d)
        m += 1
        if m > 12:
            m, y = 1, y + 1
    return out


def _balance_at_date_from_rows(
    account_id: int,
    as_of_date: date,
    rows: list[dict],
    opening: dict[int, Decimal],
) -> Decimal:
    """Balance for account at end of as_of_date from opening + rows with date <= as_of_date."""
    total = opening.get(account_id, Decimal("0"))
    for r in rows:
        if r["account_id"] == account_id and r["date"] <= as_of_date:
            amt = r["amount"] if isinstance(r["amount"], Decimal) else Decimal(str(r["amount"]))
            total += amt
    return total


def _nth_weekday_in_month(year: int, month: int, weekday: int, n: int) -> Optional[date]:
    """weekday 0=Monday..6=Sunday. n=1..5. Return nth occurrence of that weekday in month."""
    first = date(year, month, 1)
    # first weekday occurrence
    delta = (weekday - first.weekday()) % 7
    if delta == 0 and first.weekday() != weekday:
        delta = 7
    first_occ = first + timedelta(days=delta)
    # n-th occurrence
    occ = first_occ + timedelta(weeks=n - 1)
    if occ.month != month:
        return None
    return occ


def apply_scenario_overrides(rule: RecurringRule, scenario: Optional[Scenario]) -> dict[str, Any]:
    """
    Return an "effective rule" as a dict with base rule fields plus any overrides from the scenario.
    Used for timeline projection when scenario_id is set.
    """
    effective = {
        "id": rule.id,
        "name": rule.name,
        "account_id": rule.account_id,
        "category_id": getattr(rule.category_id, "pk", rule.category_id),
        "direction": rule.direction,
        "amount": rule.amount,
        "currency": rule.currency,
        "frequency": rule.frequency,
        "interval": rule.interval,
        "day_of_week": rule.day_of_week,
        "day_of_month": rule.day_of_month,
        "nth_week": rule.nth_week,
        "start_date": rule.start_date,
        "end_date": rule.end_date,
        "active": rule.active,
        "notes": rule.notes,
    }
    if not scenario:
        return effective
    try:
        override = ScenarioRuleOverride.objects.get(scenario=scenario, rule=rule)
    except ScenarioRuleOverride.DoesNotExist:
        return effective
    if override.override_amount is not None:
        effective["amount"] = override.override_amount
    if override.override_active is not None:
        effective["active"] = override.override_active
    if override.override_start_date is not None:
        effective["start_date"] = override.override_start_date
    if override.override_end_date is not None:
        effective["end_date"] = override.override_end_date
    if override.override_account_id is not None:
        effective["account_id"] = override.override_account_id
    if override.override_category_id is not None:
        effective["category_id"] = override.override_category_id
    return effective


def is_superseded_planned_row(row: dict, account_rows: list[dict]) -> bool:
    """Skip PLANNED rows when a matching CLEARED/RECONCILED posting exists same day (matches web ledger)."""
    status = (row.get("status") or "").upper()
    if status != "PLANNED":
        return False
    row_date = row.get("date")
    if hasattr(row_date, "isoformat") and not isinstance(row_date, date):
        row_date = date.fromisoformat(str(row_date)[:10])
    amt = Decimal(str(row.get("amount")))
    abs_amt = abs(amt)
    for other in account_rows:
        if other is row or other.get("account_id") != row.get("account_id"):
            continue
        other_date = other.get("date")
        if hasattr(other_date, "isoformat") and not isinstance(other_date, date):
            other_date = date.fromisoformat(str(other_date)[:10])
        if other_date != row_date:
            continue
        other_status = (other.get("status") or "").upper()
        if other_status not in ("CLEARED", "RECONCILED"):
            continue
        if row.get("rule_id") is not None and other.get("rule_id") == row.get("rule_id"):
            return True
        other_txn_src = (other.get("txn_source") or "").lower()
        other_plaid_id = (other.get("plaid_transaction_id") or "").strip()
        other_ims = (other.get("import_match_status") or "").lower()
        is_pending_plaid = (
            other_txn_src == "plaid" or bool(other_plaid_id)
        ) and other_ims not in ("matched", "ignored", "duplicate")
        if is_pending_plaid:
            continue
        other_amt = Decimal(str(other.get("amount")))
        if abs(abs(other_amt) - abs_amt) < Decimal("0.01"):
            return True
    return False


def sum_transaction_amounts_for_balance(
    account_id: int,
    *,
    date_lt: Optional[date] = None,
    date_lte: Optional[date] = None,
    exclude_interest: bool = True,
    sources: Optional[Collection[str]] = None,
) -> Decimal:
    """Sum signed transaction amounts, excluding superseded PLANNED duplicates."""
    qs = Transaction.objects.filter(account_id=account_id)
    if date_lt is not None:
        qs = qs.filter(date__lt=date_lt)
    if date_lte is not None:
        qs = qs.filter(date__lte=date_lte)
    if sources is not None:
        qs = qs.filter(source__in=sources)
    if exclude_interest:
        qs = qs.exclude(source=Transaction.Source.INTEREST)
    rows = [
        {
            "date": t["date"],
            "amount": t["amount"],
            "status": t["status"],
            "rule_id": t["rule_id"],
            "account_id": account_id,
        }
        for t in ledger_visible_transactions(qs.order_by("date", "id")).values(
            "date", "amount", "status", "rule_id"
        )
    ]
    total = Decimal("0")
    for row in rows:
        if is_superseded_planned_row(row, rows):
            continue
        total += Decimal(str(row["amount"]))
    return total


def _opening_balance(account_id: int, as_of_date: date) -> Decimal:
    """Balance for account as of end of day before as_of_date. amount is signed: positive=inflow, negative=outflow.
    For CREDIT accounts, negate so debt is negative: debits (expenses) make balance more negative, credits (payments) less negative.
    Includes all transaction sources (ACTUAL, RULE, ONE_TIME) so interest uses full balance."""
    cache = get_active_balance_cache()
    if cache is not None:
        return cache.opening_balance(account_id, as_of_date)
    acc = Account.objects.filter(pk=account_id).first()
    txn_sum = sum_transaction_amounts_for_balance(account_id, date_lt=as_of_date)
    opening = Decimal("0")
    credit_opening_pre_negated = False
    if acc and acc.starting_balance is not None:
        opening = Decimal(str(acc.starting_balance))
        # Match timeline: opening debt entered as a positive starting_balance is stored as negative signed balance.
        if acc.account_type == Account.AccountType.CREDIT and opening > 0:
            opening = -opening
            credit_opening_pre_negated = True
    total = opening + txn_sum
    # Legacy cards with unsigned (all-positive) activity and non-positive starting balance.
    if (
        acc
        and acc.account_type == Account.AccountType.CREDIT
        and total > 0
        and not credit_opening_pre_negated
    ):
        total = -total
    return total


def _balance_at_end_of_date(account_id: int, d: date) -> Decimal:
    """Balance at end of day d (only actual transactions)."""
    return _opening_balance(account_id, d + timedelta(days=1))


def payoff_projection(
    account_id: int,
    monthly_payment: Decimal,
    as_of_date: Optional[date] = None,
    max_months: int = 360,
) -> Optional[dict]:
    """
    For a CREDIT account: project how many months of fixed monthly payments until balance is zero.
    Returns dict with months_to_payoff, total_interest, payoff_date (last payment date), or None if not applicable.
    Simulates: each billing period apply payment then charge interest on remaining balance.
    """
    today = as_of_date or date.today()
    acc = Account.objects.filter(pk=account_id).first()
    if not acc or acc.account_type != Account.AccountType.CREDIT:
        return None
    cycle_day = acc.get_statement_closing_day() if hasattr(acc, "get_statement_closing_day") else getattr(acc, "billing_cycle_end_day", None)
    apr_val = getattr(acc, "apr", None)
    if cycle_day is None or apr_val is None or monthly_payment <= 0:
        return None
    balance = _balance_at_end_of_date(account_id, today)
    if balance >= 0:
        return {
            "months_to_payoff": 0,
            "total_interest": "0",
            "payoff_date": today.isoformat(),
            "current_balance": str(balance),
        }
    promo_end = getattr(acc, "promotional_end_date", None)
    promo_apr = getattr(acc, "promotional_apr", None)
    cycle_day = max(1, min(31, int(cycle_day)))
    total_interest = Decimal("0")
    months = 0
    payoff_date: Optional[date] = None
    # Next cycle end on or after today
    y, m = today.year, today.month
    try:
        d = date(y, m, min(cycle_day, _days_in_month(y, m)))
    except ValueError:
        d = date(y, m, _days_in_month(y, m))
    if d < today:
        m += 1
        if m > 12:
            m, y = 1, y + 1
        try:
            d = date(y, m, min(cycle_day, _days_in_month(y, m)))
        except ValueError:
            d = date(y, m, _days_in_month(y, m))
    prev_cycle_end = _previous_cycle_end(d) if d > today else today
    while balance < 0 and months < max_months:
        months += 1
        balance += monthly_payment
        if balance >= 0:
            payoff_date = d
            break
        period_start = prev_cycle_end + timedelta(days=1)
        period_end = d
        num_days = (period_end - period_start).days + 1
        if num_days <= 0:
            prev_cycle_end = d
            m += 1
            if m > 12:
                m, y = 1, y + 1
            try:
                d = date(y, m, min(cycle_day, _days_in_month(y, m)))
            except ValueError:
                d = date(y, m, _days_in_month(y, m))
            continue
        # Use promotional APR until promotional_end_date, then standard APR
        if promo_end is not None and d <= promo_end and promo_apr is not None:
            effective_apr = Decimal(str(promo_apr))
        else:
            effective_apr = Decimal(str(apr_val))
        interest = abs(balance) * effective_apr / Decimal("100") * Decimal(str(num_days)) / Decimal("365")
        interest = interest.quantize(Decimal("0.01"))
        total_interest += interest
        balance -= interest
        payoff_date = d
        prev_cycle_end = d
        m += 1
        if m > 12:
            m, y = 1, y + 1
        try:
            d = date(y, m, min(cycle_day, _days_in_month(y, m)))
        except ValueError:
            d = date(y, m, _days_in_month(y, m))
    return {
        "months_to_payoff": months,
        "total_interest": str(total_interest),
        "payoff_date": payoff_date.isoformat() if payoff_date else None,
        "current_balance": str(_balance_at_end_of_date(account_id, today)),
    }


def _sum_payments_to_card_from_other_accounts(
    card_account_id: int,
    card_name: str,
    through_date: date,
    households,
) -> Decimal:
    """Sum of actual outflows (payments) from any other account in the household where payee matches card name.
    Used when viewing the card only so we still count payments from Chase etc. that aren't in the timeline rows."""
    if not (households and card_name and card_name.strip()):
        return Decimal("0")
    name = card_name.strip()
    agg = ledger_visible_transactions(
        Transaction.objects.filter(
            account__household__in=households,
            date__lte=through_date,
            amount__lt=0,
            payee__iexact=name,
        )
    ).exclude(account_id=card_account_id).aggregate(s=Sum("amount"))
    s = agg.get("s")
    if s is None:
        return Decimal("0")
    return abs(s)


def _raw_balance_at_end_of_date(account_id: int, as_of_date: date) -> Decimal:
    """Balance at end of as_of_date from actual transactions only, without CREDIT sign flip.
    Used to detect 'no debt': raw <= 0 means paid off or in credit (overpayment)."""
    cache = get_active_balance_cache()
    if cache is not None:
        return cache.raw_balance_at_end_of_date(account_id, as_of_date)
    acc = Account.objects.filter(pk=account_id).first()
    txns = ledger_visible_transactions(
        Transaction.objects.filter(
            account_id=account_id,
            date__lte=as_of_date,
        )
    ).values_list("amount", flat=True)
    total = sum((Decimal(str(a)) for a in txns), start=Decimal("0"))
    if acc and acc.starting_balance is not None:
        total += Decimal(str(acc.starting_balance))
    return total


def _credit_card_balance_through_date(
    card_account_id: int,
    as_of_date: date,
    rows: list[dict],
    *,
    include_row_leg_without_txn: bool,
    include_db_postings_on_as_of_date: bool = False,
    exclude_transaction_ids: Optional[Collection[int]] = None,
) -> Decimal:
    """
    Signed balance for a CREDIT account (starting balance + activity).

    If include_db_postings_on_as_of_date is False: sum DB postings with date <= as_of_date
    (typically as_of_date = day before payment). Optionally add ``rows`` with date <= as_of_date
    and transaction_id None (or source rule when include_row_leg_without_txn is False).

    If True: as_of_date is the payment date; sum DB date < as_of_date, then all DB postings on
    that date (so earlier same-day rule payments are included). Add only non-DB rows on that
    date (transaction_id is None) when include_row_leg_without_txn is True.
    """
    cache = get_active_balance_cache()
    if cache is not None:
        acc = cache.get_account(card_account_id)
        if not acc or acc.account_type != Account.AccountType.CREDIT:
            return Decimal("0")
        return cache.balance_through_date(
            card_account_id,
            as_of_date,
            rows,
            include_row_leg_without_txn=include_row_leg_without_txn,
            include_db_postings_on_as_of_date=include_db_postings_on_as_of_date,
            exclude_transaction_ids=exclude_transaction_ids,
            credit_style=True,
        )
    acc = Account.objects.filter(pk=card_account_id).first()
    if not acc or acc.account_type != Account.AccountType.CREDIT:
        return Decimal("0")
    sb = Decimal(str(acc.starting_balance)) if acc.starting_balance is not None else Decimal("0")
    if acc.account_type == Account.AccountType.CREDIT and sb > 0:
        opening_one = -sb
    else:
        opening_one = sb
    ex = exclude_transaction_ids
    if include_db_postings_on_as_of_date:
        before_qs = ledger_visible_transactions(
            Transaction.objects.filter(
                account_id=card_account_id,
                date__lt=as_of_date,
            )
        )
        on_day_qs = ledger_visible_transactions(
            Transaction.objects.filter(
                account_id=card_account_id,
                date=as_of_date,
            )
        )
        if ex:
            before_qs = before_qs.exclude(pk__in=ex)
            on_day_qs = on_day_qs.exclude(pk__in=ex)
        before = before_qs.values_list("amount", flat=True)
        on_day = on_day_qs.values_list("amount", flat=True)
        balance = opening_one + sum((Decimal(str(a)) for a in before), start=Decimal("0"))
        balance += sum((Decimal(str(a)) for a in on_day), start=Decimal("0"))
        if include_row_leg_without_txn:
            for r in rows:
                if r.get("account_id") != card_account_id:
                    continue
                rd = r.get("date")
                if rd is None:
                    continue
                if isinstance(rd, str):
                    rd = date.fromisoformat(rd[:10]) if rd else None
                if rd != as_of_date or r.get("transaction_id") is not None:
                    continue
                amt = r.get("amount")
                try:
                    amt_d = Decimal(str(amt)) if amt is not None else Decimal("0")
                except (TypeError, ValueError):
                    continue
                balance += amt_d
        return balance

    txns_qs = ledger_visible_transactions(
        Transaction.objects.filter(
            account_id=card_account_id,
            date__lte=as_of_date,
        )
    )
    if ex:
        txns_qs = txns_qs.exclude(pk__in=ex)
    txns = txns_qs.values_list("amount", flat=True)
    balance = opening_one + sum((Decimal(str(a)) for a in txns), start=Decimal("0"))
    for r in rows:
        if r.get("account_id") != card_account_id:
            continue
        rd = r.get("date")
        if rd is None:
            continue
        if isinstance(rd, str):
            rd = date.fromisoformat(rd[:10]) if rd else None
        if rd is None or rd > as_of_date:
            continue
        amt = r.get("amount")
        try:
            amt_d = Decimal(str(amt)) if amt is not None else Decimal("0")
        except (TypeError, ValueError):
            continue
        if include_row_leg_without_txn:
            if r.get("transaction_id") is not None:
                continue
            balance += amt_d
        else:
            if r.get("source") != "rule":
                continue
            balance += amt_d
    return balance


def _previous_cycle_end(cycle_end: date) -> date:
    """Cycle end date for the month before cycle_end (same day of month, or last day if shorter)."""
    if cycle_end.month == 1:
        prev_year, prev_month = cycle_end.year - 1, 12
    else:
        prev_year, prev_month = cycle_end.year, cycle_end.month - 1
    last_day = _days_in_month(prev_year, prev_month)
    day = min(cycle_end.day, last_day)
    return date(prev_year, prev_month, day)


def _interest_for_cycle_from_rows(
    account_id: int,
    cycle_end: date,
    apr_pct: Decimal,
    rows: list[dict],
    opening: dict[int, Decimal],
) -> Optional[Decimal]:
    """
    Interest for the billing period ending on cycle_end using Average Daily Balance (ADB)
    computed from projected rows (so previous months' projected interest is included).
    Returns None if no debt (ADB >= 0) or zero interest.
    """
    prev = _previous_cycle_end(cycle_end)
    period_start = prev + timedelta(days=1)
    period_end = cycle_end
    num_days = (period_end - period_start).days + 1
    if num_days <= 0:
        return None
    balance_sum = Decimal("0")
    d = period_start
    while d <= period_end:
        balance_sum += _balance_at_date_from_rows(account_id, d, rows, opening)
        d += timedelta(days=1)
    adb = balance_sum / num_days
    if adb >= 0:
        return None
    interest = abs(adb) * apr_pct / Decimal("100") * Decimal(str(num_days)) / Decimal("365")
    return interest.quantize(Decimal("0.01"))


def _interest_average_daily_balance(
    account_id: int,
    cycle_end: date,
    apr_pct: Decimal,
    as_of_date: Optional[date] = None,
) -> Optional[Decimal]:
    """
    Interest for the billing period ending on cycle_end using Average Daily Balance (ADB).
    Period = day after previous cycle end through cycle_end. Interest = ADB × (APR/100) × (days/365).
    For days after as_of_date (default today), uses balance at end of as_of_date (for projected interest).
    Returns None if no debt (ADB non-negative) or zero interest.
    """
    today = as_of_date or date.today()
    raw_balance_today = _raw_balance_at_end_of_date(account_id, today)
    acc = Account.objects.filter(pk=account_id).first()
    # Don't project interest when there's no debt. For CREDIT: raw < 0 = debt when starting_balance <= 0;
    # when starting_balance > 0 (entered as "opening debt"), raw > 0 = debt.
    if acc and acc.account_type == Account.AccountType.CREDIT:
        sb = acc.starting_balance
        if sb is not None and sb > 0:
            if raw_balance_today <= 0:
                return None  # paid off or in credit
        else:
            if raw_balance_today >= 0:
                return None  # paid off or in credit
    else:
        if raw_balance_today >= 0:
            return None
    prev = _previous_cycle_end(cycle_end)
    period_start = prev + timedelta(days=1)
    period_end = cycle_end
    num_days = (period_end - period_start).days + 1
    if num_days <= 0:
        return None
    balance_sum = Decimal("0")
    d = period_start
    while d <= period_end:
        if d <= today:
            balance_sum += _balance_at_end_of_date(account_id, d)
        else:
            balance_sum += _balance_at_end_of_date(account_id, today)
        d += timedelta(days=1)
    adb = balance_sum / num_days
    if adb >= 0:
        return None
    # Interest = |ADB| × (APR/100) × (days/365)
    interest = abs(adb) * apr_pct / Decimal("100") * Decimal(str(num_days)) / Decimal("365")
    return interest.quantize(Decimal("0.01"))


def _savings_interest_earned(
    account_id: int,
    cycle_end: date,
    apy_pct: Decimal,
    as_of_date: Optional[date] = None,
) -> Optional[Decimal]:
    """
    Interest earned for a savings period ending on cycle_end using Average Daily Balance (ADB).
    Period = day after previous cycle end through cycle_end. Interest = ADB × (APY/100) × (days/365).
    For days after as_of_date, uses balance at end of as_of_date (for projected interest).
    Returns None if no positive balance (ADB <= 0) or zero interest.
    """
    prev = _previous_cycle_end(cycle_end)
    period_start = prev + timedelta(days=1)
    period_end = cycle_end
    num_days = (period_end - period_start).days + 1
    if num_days <= 0:
        return None
    today = as_of_date or date.today()
    balance_sum = Decimal("0")
    d = period_start
    while d <= period_end:
        if d <= today:
            balance_sum += _balance_at_end_of_date(account_id, d)
        else:
            balance_sum += _balance_at_end_of_date(account_id, today)
        d += timedelta(days=1)
    adb = balance_sum / num_days
    if adb <= 0:
        return None
    interest = adb * apy_pct / Decimal("100") * Decimal(str(num_days)) / Decimal("365")
    return interest.quantize(Decimal("0.01"))


def _scenario_event_signed_amount(direction: str, amount: Decimal) -> Decimal:
    from timeline.models import ScenarioOneTimeEvent

    amt = abs(amount)
    if direction == ScenarioOneTimeEvent.Direction.INCOME:
        return amt
    if direction == ScenarioOneTimeEvent.Direction.EXPENSE:
        return -amt
    return -amt


def _scenario_transfer_category_name(to_account) -> str:
    from accounts.models import Account

    if getattr(to_account, "account_type", None) == Account.AccountType.CREDIT:
        return "Credit Card Payment"
    return "Bank Transfer"


def _append_scenario_projection_rows(
    rows: list[dict],
    scenario: Optional["Scenario"],
    start_date: date,
    end_date: date,
    ephemeral_events: Optional[list] = None,
) -> None:
    """Append scenario-only synthetic rows (never materialized as Transaction)."""
    from timeline.models import ScenarioOneTimeEvent

    events = []
    if scenario:
        events.extend(
            ScenarioOneTimeEvent.objects.filter(
                scenario=scenario,
                date__gte=start_date,
                date__lte=end_date,
            ).select_related("account", "category", "transfer_to_account")
        )
    if ephemeral_events:
        events.extend(ephemeral_events)

    for ev in events:
        raw_amt = ev.amount if isinstance(ev.amount, Decimal) else Decimal(str(ev.amount))
        amt = abs(raw_amt).quantize(Decimal("0.01"))
        acc = getattr(ev, "account", None)
        to_acc = getattr(ev, "transfer_to_account", None)
        desc = ev.description
        cat_id = ev.category_id if hasattr(ev, "category_id") else (ev.category.id if ev.category else None)
        cat_name = ev.category.name if getattr(ev, "category", None) else None
        ev_id = getattr(ev, "id", 0) or 0

        if ev.direction == ScenarioOneTimeEvent.Direction.TRANSFER and to_acc is not None:
            if not cat_name:
                cat_name = _scenario_transfer_category_name(to_acc)
            label = desc or f"Transfer to {to_acc.effective_display_name}"
            rows.append({
                "date": ev.date,
                "description": label,
                "account_id": ev.account_id if hasattr(ev, "account_id") else acc.id,
                "account_name": acc.effective_display_name if acc else "",
                "category_id": cat_id,
                "category_name": cat_name,
                "amount": -amt,
                "type": "OUTFLOW",
                "status": "planned",
                "source": "scenario_event",
                "rule_id": None,
                "transaction_id": None,
                "sort_key": (ev.date, 3, ev_id),
                **_timeline_row_meta(None),
            })
            rows.append({
                "date": ev.date,
                "description": label,
                "account_id": to_acc.id,
                "account_name": to_acc.effective_display_name,
                "category_id": cat_id,
                "category_name": cat_name,
                "amount": amt,
                "type": "INFLOW",
                "status": "planned",
                "source": "scenario_event",
                "rule_id": None,
                "transaction_id": None,
                "sort_key": (ev.date, 3, ev_id + 1),
                **_timeline_row_meta(None),
            })
            continue

        signed = _scenario_event_signed_amount(ev.direction, raw_amt)
        rows.append({
            "date": ev.date,
            "description": desc,
            "account_id": ev.account_id if hasattr(ev, "account_id") else acc.id,
            "account_name": acc.effective_display_name if acc else "",
            "category_id": cat_id,
            "category_name": cat_name,
            "amount": signed,
            "type": "INFLOW" if signed >= 0 else "OUTFLOW",
            "status": "planned",
            "source": "scenario_event",
            "rule_id": None,
            "transaction_id": None,
            "sort_key": (ev.date, 3, ev_id),
            **_timeline_row_meta(None),
        })


def _apply_scenario_category_shocks(
    rows: list[dict],
    scenario: Optional["Scenario"],
) -> None:
    if not scenario:
        return
    from timeline.models import ScenarioCategoryShock

    shocks = list(
        ScenarioCategoryShock.objects.filter(scenario=scenario).select_related("category")
    )
    if not shocks:
        return
    for row in rows:
        if row.get("source") not in ("rule", "scenario_event"):
            continue
        cat_id = row.get("category_id")
        if not cat_id:
            continue
        amt = row["amount"] if isinstance(row["amount"], Decimal) else Decimal(str(row["amount"]))
        if amt >= 0:
            continue
        rd = row["date"]
        if hasattr(rd, "isoformat") and not isinstance(rd, date):
            rd = date.fromisoformat(str(rd)[:10])
        for shock in shocks:
            if cat_id != shock.category_id:
                continue
            if rd < shock.start_date:
                continue
            if shock.end_date and rd > shock.end_date:
                continue
            mult = Decimal("1") + Decimal(str(shock.percent_change)) / Decimal("100")
            row["amount"] = (amt * mult).quantize(Decimal("0.01"))
            break


def build_timeline(
    user,
    start_date: date,
    end_date: date,
    scenario_id: Optional[int] = None,
    account_id: Optional[int] = None,
    household_id: Optional[int] = None,
    as_of_date: Optional[date] = None,
    ephemeral_events: Optional[list] = None,
    projection_only: bool = False,
    exclude_reconciled_past: bool = False,
    caller: str = "unknown",
) -> list[dict]:
    """
    Build merged timeline: opening balances, actual transactions, projected rule occurrences,
    and one-time planned transactions. Sorted by date asc; running balance per account.

    Projected credit/savings interest appears only for **future** billing cycle ends (strictly
    after ``as_of_date`` / today): synthetic rows with ``transaction_id`` None. Past and current
    cycles are not shown on the timeline, and ``source=INTEREST`` rows from the database are
    omitted here (use a normal transaction to record actual bank interest if needed).
    """
    increment_build_timeline_count(caller=caller)
    enter_build_timeline_context(projection_only=projection_only)
    try:
        return _build_timeline_impl(
            user,
            start_date,
            end_date,
            scenario_id=scenario_id,
            account_id=account_id,
            household_id=household_id,
            as_of_date=as_of_date,
            ephemeral_events=ephemeral_events,
            projection_only=projection_only,
            exclude_reconciled_past=exclude_reconciled_past,
            caller=caller,
        )
    finally:
        exit_build_timeline_context()


def _build_timeline_impl(
    user,
    start_date: date,
    end_date: date,
    scenario_id: Optional[int] = None,
    account_id: Optional[int] = None,
    household_id: Optional[int] = None,
    as_of_date: Optional[date] = None,
    ephemeral_events: Optional[list] = None,
    projection_only: bool = False,
    exclude_reconciled_past: bool = False,
    caller: str = "unknown",
) -> list[dict]:
    timer = PerfTimer() if perf_enabled() else None
    query_profiler = QueryProfiler() if perf_enabled() else None
    wall_start = time.perf_counter() if perf_enabled() else None
    forecast_days = max((end_date - start_date).days, 0)
    if perf_enabled():
        perf_print(
            f"[PERF] build_timeline START caller={caller} "
            f"projection_only={projection_only} days={forecast_days}"
        )
    perf_generated_occurrences = 0
    if query_profiler is not None:
        query_profiler.start()

    _phase_setup = phase_start(timer, "setup")
    households = get_households_for_user(user)
    if household_id:
        households = households.filter(pk=household_id)
    if not households.exists():
        return []

    if not projection_only:
        promote_due_schedules(as_of_date=as_of_date)

    if account_id:
        accounts = Account.all_objects.for_historical_reporting().filter(
            household__in=households, pk=account_id,
        )
    else:
        accounts = Account.objects.for_historical_reporting().filter(household__in=households)
    account_ids = list(accounts.values_list("pk", flat=True))
    forecastable_account_ids = {
        a.pk
        for a in accounts
        if a.participates_in_forecast()
    }
    if not account_ids:
        return []

    if not projection_only:
        repair_unlinked_rule_transfer_pairs(account_ids)

    if perf_enabled():
        requested_days = max((end_date - start_date).days, 0)
        perf_print(
            "[PERF] forecast_requested "
            f"user={getattr(user, 'pk', user)} "
            f"days={requested_days} "
            f"start={start_date.isoformat()} "
            f"end={end_date.isoformat()}"
        )

    from timeline.services.balance_cache import (
        activate_balance_cache,
        deactivate_balance_cache,
        preload_household_balance_data,
    )

    balance_cache, balance_cache_token = activate_balance_cache()
    try:
        preload_household_balance_data(balance_cache, households, end_date)
        scenario = None
        if scenario_id:
            scenario = Scenario.objects.filter(household__in=households, pk=scenario_id).first()

        # 1) Actual transactions: fetch with date <= end_date so nothing is ever hidden in opening balance.
        #    PLAID INVARIANT: Matched Plaid imports stay visible; hide the matched planned/manual twin
        #    via ledger_visible_transactions (see matching.py). Do NOT re-hide imports here.
        #    When exclude_reconciled_past, omit reconciled rows at the database (ledger UI default).
        actual_qs = ledger_visible_transactions(
            Transaction.objects.filter(
                account_id__in=account_ids,
                date__lte=end_date,
            )
        )
        if exclude_reconciled_past:
            actual_qs = actual_qs.filter(reconciled=False)
        actual = list(
            actual_qs.select_related(
                "account",
                "category",
                "rule",
                "rule__transfer_to_account",
                "match_as_planned__imported_transaction",
            ).order_by("date", "id")
        )
        # DO NOT call rematch_unmatched_for_accounts() here — timeline reads must not mutate matches
        # or re-link imports (caused imports to disappear from UI and balances to swing).
        shadow_ids = shadowed_rule_occurrence_ids(actual)
        if shadow_ids:
            actual = [t for t in actual if t.pk not in shadow_ids]
        # Amount is stored signed: positive = inflow (payment), negative = outflow (expense).
        # Dedupe rule-created transactions by (account_id, date, rule_id, sign) so we only show
        # one row per rule occurrence when duplicates exist (e.g. after account change + materialization).
        # Do NOT hide rule-backed transactions by "rule's current account" — if the user moved a single
        # instance to another account (e.g. Savor), it should still show on that account.
        # Build map (rule_id, date) -> destination account name for transfer "from" legs so we can show "Move to CC (Savor)" in the list.
        from_leg_keys = [(t.rule_id, t.date) for t in actual if t.rule_id is not None and t.amount is not None and t.amount < 0]
        to_leg_account_name: dict[tuple[int, date], str] = {}
        tg_to_account_name: dict[int, str] = {}
        if from_leg_keys:
            rule_dates = {(r, d) for r, d in from_leg_keys}
            to_legs = Transaction.objects.filter(
                rule_id__in={r for r, _ in rule_dates},
                date__in={d for _, d in rule_dates},
            ).exclude(account_id__in=account_ids).select_related("account")
            for to_txn in to_legs:
                if to_txn.account_id and to_txn.rule_id:
                    to_leg_account_name[(to_txn.rule_id, to_txn.date)] = getattr(to_txn.account, "name", "") or ""
            tg_ids = {t.transfer_group_id for t in actual if t.transfer_group_id and t.amount is not None and t.amount < 0}
            if tg_ids:
                for to_txn in Transaction.objects.filter(
                    transfer_group_id__in=tg_ids,
                    amount__gt=0,
                ).exclude(account_id__in=account_ids).select_related("account"):
                    if to_txn.transfer_group_id and to_txn.account_id:
                        tg_to_account_name[to_txn.transfer_group_id] = getattr(to_txn.account, "name", "") or ""

        today = as_of_date or timezone.localdate()
        accs = {
            aid: balance_cache.get_account(aid)
            for aid in account_ids
            if balance_cache.get_account(aid) is not None
        }
        credit_account_ids = {
            aid for aid in account_ids
            if accs.get(aid) and getattr(accs[aid], "account_type", None) == Account.AccountType.CREDIT
        }

        # Opening balances (before actual + rule rows) — used with full row ledger when skipping min payments
        opening: dict[int, Decimal] = {}
        if exclude_reconciled_past:
            from transactions.services.reconciliation import last_reconciled_balance

            for aid in account_ids:
                acc = accs.get(aid)
                if acc is None:
                    opening[aid] = Decimal("0")
                    continue
                sb = last_reconciled_balance(acc, today)
                if acc.account_type == Account.AccountType.CREDIT and sb > 0:
                    sb = -sb
                opening[aid] = sb
        else:
            for aid in account_ids:
                acc = accs.get(aid)
                sb = Decimal(str(acc.starting_balance)) if acc and acc.starting_balance is not None else Decimal("0")
                if acc and acc.account_type == Account.AccountType.CREDIT and sb > 0:
                    sb = -sb
                opening[aid] = sb
        phase_end(timer, _phase_setup)

        rows: list[dict] = []
        ids_in_rows: set[int] = set()
        seen_rule_actual_key: set[tuple] = set()
        purged_rule_dates: set[tuple[int, date]] = set()
        scenario_projection_only = projection_only or scenario is not None
        _phase_load = phase_start(timer, "load_transactions")
        for t in actual:
            # Scenario timelines re-project future rule occurrences with overrides; skip DB rows.
            # Projection-only reads also skip materialized rule rows — the occurrence loop re-adds
            # them via _materialized_rule_timeline_row_if_exists (preserves edited amounts without
            # double-counting every DB materialized row in the ledger balance).
            if scenario_projection_only and t.rule_id is not None and t.date >= today:
                continue
            amt = t.amount
            sign = 1 if (amt is not None and amt >= 0) else -1
            if t.rule_id is not None and (t.rule_id, t.date) in purged_rule_dates:
                ids_in_rows.add(t.id)
                continue
            if t.rule_id is not None:
                rule_actual_key = (t.account_id, t.date, t.rule_id, sign)
                if rule_actual_key in seen_rule_actual_key:
                    ids_in_rows.add(t.id)
                    continue
                seen_rule_actual_key.add(rule_actual_key)
            if t.source == Transaction.Source.INTEREST:
                ids_in_rows.add(t.id)
                continue
            # Per-occurrence: skip (and purge) debt payments when destination owes nothing that day.
            # Never hide paired transfer legs — both sides must stay visible in the ledger.
            cat_nm = (t.category.name if getattr(t, "category", None) and t.category else None) or ""
            if (
                t.rule_id is not None
                and t.date >= today
                and amt is not None
                and not t.transfer_group_id
                and not _has_paired_rule_transfer_leg(t)
            ):
                hide_paid_off = False
                if t.account_id in credit_account_ids and amt > 0 and t.account:
                    hide_paid_off = _skip_payment_to_debt_destination(
                        t.account,
                        t.date,
                        rows,
                        amt,
                        exclude_transaction_ids=(t.id,),
                        category_name=cat_nm,
                    )
                elif amt < 0:
                    dest_account: Optional[Account] = None
                    payment_amt: Optional[Decimal] = None
                    exclude_ids: list[int] = []
                    for cand in (
                        Transaction.objects.filter(
                            rule_id=t.rule_id,
                            date=t.date,
                            amount__gt=0,
                        )
                        .exclude(account_id=t.account_id)
                        .select_related("account")
                    ):
                        acc_c = cand.account
                        if acc_c and _account_is_debt_payment_destination(acc_c, cat_nm):
                            dest_account = acc_c
                            payment_amt = cand.amount
                            exclude_ids.append(cand.id)
                            break
                    if dest_account is None:
                        rule_obj = getattr(t, "rule", None)
                        tac = None
                        if (
                            rule_obj is not None
                            and rule_obj.transfer_to_account_id
                            and _category_name_allows_rule_transfer_destination(cat_nm)
                        ):
                            tac = getattr(rule_obj, "transfer_to_account", None) or _lookup_account(
                                rule_obj.transfer_to_account_id, accs
                            )
                        if tac and _account_is_debt_payment_destination(tac, cat_nm):
                            dest_account = tac
                            try:
                                payment_amt = abs(Decimal(str(amt)))
                            except (TypeError, ValueError):
                                payment_amt = None
                            exclude_ids.extend(
                                Transaction.objects.filter(
                                    rule_id=t.rule_id,
                                    date=t.date,
                                    account_id=tac.id,
                                ).values_list("pk", flat=True)
                            )
                    if dest_account is not None and payment_amt is not None:
                        hide_paid_off = _skip_payment_to_debt_destination(
                            dest_account,
                            t.date,
                            rows,
                            payment_amt,
                            exclude_transaction_ids=tuple(exclude_ids) if exclude_ids else None,
                            category_name=cat_nm,
                        )
                if hide_paid_off:
                    if not scenario_projection_only:
                        _purge_skipped_rule_occurrence(t.rule_id, t.date, today)
                    purged_rule_dates.add((t.rule_id, t.date))
                    ids_in_rows.add(t.id)
                    continue
            desc = t.payee or ""
            try:
                mpl = t.match_as_planned
                imp = mpl.imported_transaction
                bank_hint = (imp.payee or imp.imported_description or "").strip()
                if bank_hint and bank_hint not in desc:
                    desc = f"{desc} — bank: {bank_hint}" if desc else f"Bank: {bank_hint}"
            except Exception:
                pass
            if t.rule_id and amt is not None and amt < 0:
                to_name = to_leg_account_name.get((t.rule_id, t.date))
                if not to_name and t.transfer_group_id:
                    to_name = tg_to_account_name.get(t.transfer_group_id)
                if to_name and to_name not in desc:
                    desc = f"{desc} ({to_name})" if desc else to_name
            row_source = (
                "interest" if t.source == Transaction.Source.INTEREST else "actual"
            )
            rows.append({
                "date": t.date,
                "description": desc,
                "account_id": t.account_id,
                "account_name": t.account.effective_display_name,
                "category_id": t.category_id,
                "category_name": t.category.name if t.category else None,
                "amount": amt,
                "type": "INFLOW" if amt >= 0 else "OUTFLOW",
                "status": t.status,
                "source": row_source,
                "rule_id": t.rule_id,
                "transaction_id": t.id,
                "sort_key": (t.date, 0, t.id),
                **_timeline_row_meta(t),
            })
            ids_in_rows.add(t.id)
        perf_transactions = len(actual)
        phase_end(timer, _phase_load)

        # 2) One-time planned (Transaction with source=ONE_TIME or status=PLANNED, in range)
        # Already included in actual queryset above; we tagged by source. So no duplicate.

        # 3) Projected recurring occurrences (computed, not stored).
        _phase_generate = phase_start(timer, "generate_occurrences")
        # Only dates >= today are emitted. Rule amount/schedule changes affect only these
        # future projections; past actual transactions in the DB are never modified.
        #
        # Use every active rule in the household (not only rules touching the filtered account).
        # Otherwise a Chase-only timeline would never materialize e.g. Savings→Platinum payments,
        # and bank→card minimum rules would still project because the card balance looked wrong.
        rules_qs = RecurringRule.objects.filter(
            household__in=households,
            active=True,
        ).select_related("account", "category", "transfer_to_account").prefetch_related(
            "bucket_allocations"
        )
        if scenario_id and scenario:
            rules_qs = rules_qs.prefetch_related("scenario_overrides")

        # Build rule list and sort by first occurrence date so that when we evaluate "skip 3/23?"
        # we have already added any earlier payment (e.g. 3/20) from the same or another rule.
        rules_with_occ: list[tuple] = []
        active_bucket_rule_ids: set[int] = set()
        for rule in rules_qs:
            if any(ba.active for ba in rule.bucket_allocations.all()):
                active_bucket_rule_ids.add(rule.id)
            eff = apply_scenario_overrides(rule, scenario)
            if not eff.get("active", True):
                continue
            eff_start = eff.get("start_date") or rule.start_date
            eff_end = eff.get("end_date")
            occ_dates = generate_rule_occurrence_dates(
                rule, start_date, end_date,
                effective_start=eff_start,
                effective_end=eff_end,
            )
            first_occ = min(occ_dates) if occ_dates else date.max
            rules_with_occ.append((rule, eff, eff_start, eff_end, occ_dates, first_occ))
        rules_with_occ.sort(key=lambda x: x[5])

        # User-deleted rule occurrences: do not re-materialize or show them.
        rule_ids = [r.id for r, *_ in rules_with_occ]
        skipped_occurrences = set(
            RecurringRuleSkip.objects.filter(
                rule_id__in=rule_ids, date__gte=start_date, date__lte=end_date
            ).values_list("rule_id", "date")
        )

        # Queue all occurrences, then process in global order. Same calendar day, same destination
        # card: larger transfers first (then rule_id) so a full payment materializes before a minimum.
        occurrence_events: list[tuple[date, Decimal, int, str, tuple]] = []

        def _rule_account_forecastable(rule_obj: RecurringRule, eff: dict) -> bool:
            """Include rules whose source account is in scope.

            Transfer destinations may be on other accounts (e.g. Chase→Savings). The output
            filter keeps only rows for the requested account(s), but we must still project
            those rules when projection_only=True — otherwise future materialized rows are
            hidden and the forecast loses every cross-account transfer.
            """
            acc_id = eff.get("account_id") or rule_obj.account_id
            return acc_id in forecastable_account_ids

        for rule, eff, eff_start, eff_end, occ_dates, _first_occ in rules_with_occ:
            if not _rule_account_forecastable(rule, eff):
                continue

            def _amount_for_date(d: date) -> Decimal:
                params = resolve_rule_params(rule, d)
                raw_amount = params.amount
                if scenario_id and scenario:
                    try:
                        override = rule.scenario_overrides.get(scenario=scenario)
                        if override.override_amount is not None:
                            raw_amount = override.override_amount
                    except ScenarioRuleOverride.DoesNotExist:
                        pass
                amount_decimal = Decimal(str(raw_amount))
                direction = eff.get("direction") or params.direction
                if direction == RecurringRule.Direction.EXPENSE and amount_decimal > 0:
                    amount_decimal = -amount_decimal
                elif direction == RecurringRule.Direction.INCOME and amount_decimal < 0:
                    amount_decimal = abs(amount_decimal)
                return amount_decimal

            cat_id = eff.get("category_id")
            cat_name = None
            if rule.category_id:
                from categories.models import Category
                c = Category.objects.filter(pk=cat_id or rule.category_id).first()
                cat_name = c.name if c else None

            use_transfer_branch = bool(rule.transfer_to_account_id) and _category_name_allows_rule_transfer_destination(
                cat_name
            )
            if use_transfer_branch:
                from_acc_id = eff.get("account_id") or rule.account_id
                to_acc_id = rule.transfer_to_account_id
                from_acc = next((a for a in accounts if a.pk == from_acc_id), None)
                to_acc = getattr(rule, "transfer_to_account", None) or next((a for a in accounts if a.pk == to_acc_id), None)
                if to_acc is None:
                    to_acc = _lookup_account(to_acc_id, accs)
                from_name = from_acc.name if from_acc else getattr(rule.account, "name", "")
                to_name = to_acc.name if to_acc else ""
                is_debt_dest = bool(to_acc and _account_is_debt_payment_destination(to_acc, cat_name))
                for d in occ_dates:
                    if d < today or (rule.id, d) in skipped_occurrences:
                        continue
                    amount_decimal = _amount_for_date(d)
                    out_amount = -abs(amount_decimal)
                    in_amount = abs(amount_decimal)
                    sort_amt = -in_amount if is_debt_dest else Decimal("0")
                    occurrence_events.append(
                        (
                            d,
                            sort_amt,
                            rule.id,
                            "transfer",
                            (
                                rule,
                                from_acc_id,
                                to_acc_id,
                                from_name,
                                to_name,
                                out_amount,
                                in_amount,
                                is_debt_dest,
                                cat_id,
                                cat_name,
                            ),
                        )
                    )
            else:
                acc_id = eff.get("account_id") or rule.account_id
                acc = next((a for a in accounts if a.pk == acc_id), None)
                acc_name = acc.name if acc else getattr(rule.account, "name", "")
                card_for_skip = None
                if acc and acc.account_type == Account.AccountType.CREDIT and rule.direction == RecurringRule.Direction.INCOME:
                    card_for_skip = acc
                elif (
                    rule.direction == RecurringRule.Direction.EXPENSE
                    and cat_name
                    and "credit" in (cat_name or "").lower()
                ):
                    rule_name_lower = (getattr(rule, "name", None) or "").lower()
                    for a in Account.objects.operational().filter(
                        household__in=households, account_type=Account.AccountType.CREDIT,
                    ):
                        an = (a.name or "").strip()
                        if not an:
                            continue
                        if an.lower() in rule_name_lower or rule_name_lower in an.lower() or rule_name_lower.startswith(an.lower()) or an.lower().startswith(rule_name_lower[:20]):
                            card_for_skip = a
                            break
                for d in occ_dates:
                    if d < today or (rule.id, d) in skipped_occurrences:
                        continue
                    occurrence_events.append(
                        (
                            d,
                            Decimal("0"),
                            rule.id,
                            "single",
                            (rule, acc_id, acc_name, _amount_for_date(d), cat_id, cat_name, card_for_skip),
                        )
                    )

        occurrence_events.sort(key=lambda x: (x[0], x[1], x[2]))
        perf_generated_occurrences = len(occurrence_events)
        if materialization_active():
            set_materialization_occurrences_generated(perf_generated_occurrences)
        phase_end(timer, _phase_generate)
        seen_scenario_rule_keys: set[tuple] = set()

        _phase_materialize = phase_start(timer, "materialize_occurrences")
        occurrence_store: RuleOccurrenceStore | None = None
        if rule_ids:
            occurrence_store = build_rule_occurrence_store(
                rule_ids=rule_ids,
                account_ids=account_ids,
                start_date=start_date,
                end_date=end_date,
                active_bucket_rule_ids=active_bucket_rule_ids,
            )
            activate_rule_occurrence_store(occurrence_store)
            if materialization_active():
                set_materialization_existing_loaded(occurrence_store.existing_loaded)
        for d, _sort_amt, _rid, kind, payload in occurrence_events:
            if kind == "transfer":
                (
                    rule,
                    from_acc_id,
                    to_acc_id,
                    from_name,
                    to_name,
                    out_amount,
                    in_amount,
                    is_debt_dest,
                    cat_id,
                    cat_name,
                ) = payload
                to_acc_for_skip = _lookup_account(to_acc_id, accs)
                if is_debt_dest and to_acc_for_skip:
                    if occurrence_store is not None:
                        dest_leg_ids = occurrence_store.get_leg_pks(rule.id, d, to_acc_id)
                    else:
                        dest_leg_ids = tuple(
                            Transaction.objects.filter(
                                rule_id=rule.id, date=d, account_id=to_acc_id
                            ).values_list("pk", flat=True)
                        )
                    from_acc_obj = _lookup_account(from_acc_id, accs)
                    fund_from_bank = (
                        from_acc_obj is not None
                        and from_acc_obj.account_type != Account.AccountType.CREDIT
                    )
                    lookahead_end = d + timedelta(days=45)
                    skip_payment = False
                    if fund_from_bank:
                        bal = _credit_card_balance_through_date(
                            to_acc_for_skip.id,
                            d,
                            rows,
                            include_row_leg_without_txn=True,
                            include_db_postings_on_as_of_date=True,
                            exclude_transaction_ids=dest_leg_ids if dest_leg_ids else None,
                        )
                        extra_scheduled = _future_recurring_expense_impact_on_card(
                            to_acc_for_skip.id,
                            d,
                            lookahead_end,
                            households,
                        )
                        extra_db = _db_card_postings_in_exclusive_range(
                            to_acc_for_skip.id,
                            d,
                            lookahead_end,
                        )
                        skip_payment = bal + extra_scheduled + extra_db >= 0
                    else:
                        skip_payment = _skip_payment_to_debt_destination(
                            to_acc_for_skip,
                            d,
                            rows,
                            in_amount,
                            exclude_transaction_ids=dest_leg_ids if dest_leg_ids else None,
                            category_name=cat_name,
                        )
                    if skip_payment:
                        if materialization_active():
                            record_materialization_skipped()
                        if not scenario_projection_only:
                            _purge_skipped_rule_occurrence(rule.id, d, today)
                        continue
                if scenario_projection_only:
                    if any(
                        r.get("rule_id") == rule.id
                        and r.get("date") == d
                        and r.get("account_id") in (from_acc_id, to_acc_id)
                        for r in rows
                    ):
                        continue
                    proj_key = (rule.id, d, "transfer")
                    if proj_key in seen_scenario_rule_keys:
                        continue
                    seen_scenario_rule_keys.add(proj_key)
                    desc_with_card = f"{rule.name} ({to_name})" if to_name else rule.name
                    from_row = _materialized_rule_timeline_row_if_exists(
                        rule_id=rule.id,
                        d=d,
                        account_id=from_acc_id,
                        account_name=from_name,
                        category_id=cat_id,
                        category_name=cat_name,
                        amount_decimal=out_amount,
                        row_type="OUTFLOW",
                        description=desc_with_card,
                        sort_key=(d, 1, rule.id * 2),
                        ids_in_rows=ids_in_rows,
                    )
                    if from_row is not None:
                        rows.append(from_row)
                    else:
                        rows.append(
                            _projected_rule_timeline_row(
                                d=d,
                                description=desc_with_card,
                                account_id=from_acc_id,
                                account_name=from_name,
                                category_id=cat_id,
                                category_name=cat_name,
                                amount=out_amount,
                                row_type="OUTFLOW",
                                rule_id=rule.id,
                                sort_key=(d, 1, rule.id * 2),
                            )
                        )
                    to_row = _materialized_rule_timeline_row_if_exists(
                        rule_id=rule.id,
                        d=d,
                        account_id=to_acc_id,
                        account_name=to_name,
                        category_id=None,
                        category_name=None,
                        amount_decimal=in_amount,
                        row_type="INFLOW",
                        description=desc_with_card,
                        sort_key=(d, 1, rule.id * 2 + 1),
                        ids_in_rows=ids_in_rows,
                    )
                    if to_row is not None:
                        rows.append(to_row)
                    else:
                        rows.append(
                            _projected_rule_timeline_row(
                                d=d,
                                description=desc_with_card,
                                account_id=to_acc_id,
                                account_name=to_name,
                                category_id=None,
                                category_name=None,
                                amount=in_amount,
                                row_type="INFLOW",
                                rule_id=rule.id,
                                sort_key=(d, 1, rule.id * 2 + 1),
                            )
                        )
                    continue
                if not should_materialize_rule(rule.id):
                    continue
                txn_from = _materialize_rule_occurrence(
                    rule, d, from_acc_id, out_amount, rule.name, cat_id
                )
                if occurrence_store is not None:
                    existing_to = occurrence_store.get_other_account_leg(rule.id, d, from_acc_id)
                else:
                    existing_to = Transaction.objects.filter(
                        rule_id=rule.id, date=d
                    ).exclude(account_id=from_acc_id).select_related("account").first()
                if existing_to is not None:
                    txn_to = existing_to
                    to_acc_id_actual = txn_to.account_id
                    to_name_actual = getattr(txn_to.account, "name", "") if txn_to.account else to_name
                else:
                    txn_to = _materialize_rule_occurrence(
                        rule, d, to_acc_id, in_amount, rule.name, None
                    )
                    to_acc_id_actual = to_acc_id
                    to_name_actual = to_name
                _link_rule_transfer_pair_transactions(
                    rule=rule,
                    d=d,
                    txn_from=txn_from,
                    txn_to=txn_to,
                    from_acc_id=from_acc_id,
                    to_acc_id=to_acc_id_actual,
                    in_amount=in_amount,
                )
                if txn_from.id in ids_in_rows or txn_to.id in ids_in_rows:
                    continue
                ids_in_rows.add(txn_from.id)
                ids_in_rows.add(txn_to.id)
                amt_from = txn_from.amount if txn_from.amount is not None else out_amount
                amt_to = txn_to.amount if txn_to.amount is not None else in_amount
                desc_with_card = f"{rule.name} ({to_name_actual})" if to_name_actual else rule.name
                rows.append({
                    "date": d,
                    "description": desc_with_card,
                    "account_id": from_acc_id,
                    "account_name": from_name,
                    "category_id": cat_id,
                    "category_name": cat_name,
                    "amount": amt_from,
                    "type": "OUTFLOW",
                    "status": txn_from.status,
                    "source": "actual",
                    "rule_id": rule.id,
                    "transaction_id": txn_from.id,
                    "sort_key": (d, 1, rule.id * 2),
                    **_timeline_row_meta(txn_from),
                })
                rows.append({
                    "date": d,
                    "description": desc_with_card,
                    "account_id": to_acc_id_actual,
                    "account_name": to_name_actual,
                    "category_id": None,
                    "category_name": None,
                    "amount": amt_to,
                    "type": "INFLOW",
                    "status": txn_to.status,
                    "source": "actual",
                    "rule_id": rule.id,
                    "transaction_id": txn_to.id,
                    "sort_key": (d, 1, rule.id * 2 + 1),
                    **_timeline_row_meta(txn_to),
                })
            else:
                rule, acc_id, acc_name, amount_decimal, cat_id, cat_name, card_for_skip = payload
                if card_for_skip is not None:
                    if _skip_payment_to_debt_destination(
                        card_for_skip,
                        d,
                        rows,
                        None,
                        exclude_transaction_ids=None,
                        category_name=cat_name,
                    ):
                        if materialization_active():
                            record_materialization_skipped()
                        if not scenario_projection_only:
                            _purge_skipped_rule_occurrence(rule.id, d, today)
                        continue
                if scenario_projection_only:
                    proj_key = (rule.id, d, acc_id)
                    if proj_key in seen_scenario_rule_keys:
                        continue
                    if any(
                        r.get("rule_id") == rule.id
                        and r.get("account_id") == acc_id
                        and r.get("date") == d
                        for r in rows
                    ):
                        continue
                    seen_scenario_rule_keys.add(proj_key)
                    materialized = _materialized_rule_timeline_row_if_exists(
                        rule_id=rule.id,
                        d=d,
                        account_id=acc_id,
                        account_name=acc_name,
                        category_id=cat_id,
                        category_name=cat_name,
                        amount_decimal=amount_decimal,
                        row_type=rule.direction,
                        description=rule.name,
                        sort_key=(d, 1, rule.id),
                        ids_in_rows=ids_in_rows,
                    )
                    if materialized is not None:
                        rows.append(materialized)
                    else:
                        rows.append(
                            _projected_rule_timeline_row(
                                d=d,
                                description=rule.name,
                                account_id=acc_id,
                                account_name=acc_name,
                                category_id=cat_id,
                                category_name=cat_name,
                                amount=amount_decimal,
                                row_type=rule.direction,
                                rule_id=rule.id,
                                sort_key=(d, 1, rule.id),
                            )
                        )
                    continue
                if not should_materialize_rule(rule.id):
                    continue
                txn = _materialize_rule_occurrence(
                    rule, d, acc_id, amount_decimal, rule.name, cat_id
                )
                from transactions.services.matching import planned_leg_suppressed_by_import_match

                if planned_leg_suppressed_by_import_match(txn):
                    ids_in_rows.add(txn.id)
                    continue
                if txn.id in ids_in_rows:
                    continue
                ids_in_rows.add(txn.id)
                amt = txn.amount if txn.amount is not None else amount_decimal
                rows.append({
                    "date": d,
                    "description": rule.name,
                    "account_id": acc_id,
                    "account_name": acc_name,
                    "category_id": cat_id,
                    "category_name": cat_name,
                    "amount": amt,
                    "type": rule.direction,
                    "status": txn.status,
                    "source": "actual",
                    "rule_id": rule.id,
                    "transaction_id": txn.id,
                    "sort_key": (d, 1, rule.id),
                    **_timeline_row_meta(txn),
                })
        deactivate_rule_occurrence_store()
        if scenario_projection_only and rule_ids:
            _append_rescheduled_rule_materializations(
                rows=rows,
                ids_in_rows=ids_in_rows,
                rule_ids=rule_ids,
                forecastable_account_ids=forecastable_account_ids,
                start_date=start_date,
                end_date=end_date,
                today=today,
                seen_rule_actual_key=seen_rule_actual_key,
            )
        phase_end(timer, _phase_materialize)

        if scenario_id and scenario:
            append_scenario_added_recurring_projections(
                scenario=scenario,
                rows=rows,
                start_date=start_date,
                end_date=end_date,
                forecastable_account_ids=forecastable_account_ids,
                seen_keys=seen_scenario_rule_keys,
            )

        # User-deleted projected interest: do not re-show or re-materialize that billing cycle.
        _phase_interest = phase_start(timer, "interest_calc")
        skipped_interest_by_account: dict[int, set[date]] = defaultdict(set)
        for sk in InterestCycleSkip.objects.filter(account_id__in=account_ids).values(
            "account_id", "cycle_end_date"
        ):
            skipped_interest_by_account[sk["account_id"]].add(sk["cycle_end_date"])

        # 4) Projected credit card interest: one row per CREDIT account per cycle end in range.
        # Each month's interest uses projected balance (actual + recurring + prior months' interest).
        from categories.models import Category
        interest_category_cache: dict[int, tuple[Optional[int], str]] = {}  # household_id -> (category_id, name)
        credit_accounts = [a for a in accounts if getattr(a, "account_type", "").upper() == "CREDIT"]
        for acc in credit_accounts:
            cycle_day = acc.get_statement_closing_day() if hasattr(acc, "get_statement_closing_day") else getattr(acc, "billing_cycle_end_day", None)
            apr_val = getattr(acc, "apr", None)
            if cycle_day is None or apr_val is None:
                continue
            cycle_dates = _cycle_end_dates_in_range(
                int(cycle_day), start_date, end_date, on_or_after=None
            )
            if not cycle_dates:
                continue
            if acc.id not in opening:
                sb = Decimal(str(acc.starting_balance)) if acc.starting_balance is not None else Decimal("0")
                if acc.account_type == Account.AccountType.CREDIT and sb > 0:
                    sb = -sb
                opening[acc.id] = sb
            if acc.household_id not in interest_category_cache:
                cat = Category.objects.filter(
                    household_id=acc.household_id, name="Interest", category_type="EXPENSE"
                ).first()
                interest_category_cache[acc.household_id] = (
                    (cat.id, cat.name) if cat else (None, "Interest")
                )
            cat_id, cat_name = interest_category_cache[acc.household_id]
            promo_end = getattr(acc, "promotional_end_date", None)
            promo_apr = getattr(acc, "promotional_apr", None)
            for cycle_end in cycle_dates:
                if cycle_end in skipped_interest_by_account.get(acc.id, ()):
                    continue
                if cycle_end <= today:
                    continue
                # Use promotional APR until promotional_end_date, then standard APR
                if promo_end is not None and cycle_end <= promo_end and promo_apr is not None:
                    effective_apr = Decimal(str(promo_apr))
                else:
                    effective_apr = Decimal(str(apr_val))
                if effective_apr <= 0:
                    continue
                projected_balance_at_cycle_end = _balance_at_date_from_rows(
                    acc.id, cycle_end, rows, opening
                )
                if projected_balance_at_cycle_end >= 0:
                    continue
                interest_amount = _interest_for_cycle_from_rows(
                    acc.id, cycle_end, effective_apr, rows, opening
                )
                if interest_amount is None or interest_amount <= 0:
                    continue
                rows.append({
                    "date": cycle_end,
                    "description": "Projected Interest",
                    "account_id": acc.id,
                    "account_name": acc.effective_display_name,
                    "category_id": cat_id,
                    "category_name": cat_name,
                    "amount": -interest_amount,
                    "type": "OUTFLOW",
                    "status": "planned",
                    "source": "interest",
                    "rule_id": None,
                    "transaction_id": None,
                    "sort_key": (cycle_end, 2, acc.id),
                    **_timeline_row_meta(None),
                })

        # 5) Savings interest: project next future cycle end only (no past/current rows).
        income_interest_category_cache: dict[int, tuple[Optional[int], str]] = {}
        savings_accounts = [a for a in accounts if getattr(a, "account_type", "").upper() == "SAVINGS"]
        for acc in savings_accounts:
            cycle_day = getattr(acc, "interest_cycle_end_day", None)
            rate_val = getattr(acc, "interest_rate", None)
            if cycle_day is None or rate_val is None:
                continue
            all_cycles = _cycle_end_dates_in_range(
                int(cycle_day), start_date, end_date, on_or_after=None
            )
            if not all_cycles:
                continue
            if acc.household_id not in income_interest_category_cache:
                cat = Category.objects.filter(
                    household_id=acc.household_id, name="Interest Income", category_type="INCOME"
                ).first()
                income_interest_category_cache[acc.household_id] = (
                    (cat.id, cat.name) if cat else (None, "Interest Income")
                )
            cat_id, cat_name = income_interest_category_cache[acc.household_id]
            rate_decimal = Decimal(str(rate_val))
            future_cycles = [d for d in all_cycles if d > today]
            if not future_cycles:
                continue
            cycle_end = min(future_cycles)
            if cycle_end in skipped_interest_by_account.get(acc.id, ()):
                continue
            interest_amount = _savings_interest_earned(
                acc.id, cycle_end, rate_decimal, as_of_date=today
            )
            if interest_amount is None or interest_amount <= 0:
                continue
                rows.append({
                    "date": cycle_end,
                    "description": "Projected Interest Income",
                    "account_id": acc.id,
                    "account_name": acc.effective_display_name,
                    "category_id": cat_id,
                    "category_name": cat_name,
                    "amount": interest_amount,
                    "type": "INFLOW",
                    "status": "planned",
                    "source": "interest",
                    "rule_id": None,
                    "transaction_id": None,
                    "sort_key": (cycle_end, 2, acc.id),
                    **_timeline_row_meta(None),
                })
        phase_end(timer, _phase_interest)

        _phase_scenario = phase_start(timer, "scenario_rows")
        _append_scenario_projection_rows(
            rows, scenario, start_date, end_date, ephemeral_events=ephemeral_events
        )
        _apply_scenario_category_shocks(rows, scenario)
        phase_end(timer, _phase_scenario)

        # Sort by date, then same order as Transactions ledger (transaction_id, description).
        _phase_finalize = phase_start(timer, "finalize")
        rows.sort(key=timeline_rows_chronological_key)
        for r in rows:
            r.pop("sort_key", None)
            r.setdefault("reconciled", False)
            r.setdefault("txn_source", None)

        # Opening balance for any account that appears in rows (e.g. card when we added both legs for CC rules)
        for r in rows:
            aid = r["account_id"]
            if aid not in opening:
                acc = _lookup_account(aid, accs)
                sb = Decimal(str(acc.starting_balance)) if acc and acc.starting_balance is not None else Decimal("0")
                if acc and acc.account_type == Account.AccountType.CREDIT and sb > 0:
                    sb = -sb
                opening[aid] = sb
        phase_end(timer, _phase_finalize)

        _phase_balances = phase_start(timer, "running_balances")
        recompute_timeline_running_balances(rows, opening=opening, account_ids=set(account_ids))
        phase_end(timer, _phase_balances)

        # Return only rows for requested accounts (we added both legs for CC transfers for balance math).
        _phase_output = phase_start(timer, "output_filter")
        # Projected interest is forecast-only — never surface on or before as_of (estimates, not history).
        rows = [
            r
            for r in rows
            if r["account_id"] in account_ids
            and not (r.get("source") == "interest" and r["date"] <= today)
        ]
        phase_end(timer, _phase_output)
    finally:
        deactivate_balance_cache(balance_cache_token)

    if perf_enabled() and wall_start is not None:
        if query_profiler is not None:
            query_profiler.stop()
        elapsed_ms = (time.perf_counter() - wall_start) * 1000
        perf_print(
            f"[PERF] build_timeline projection_only={projection_only} "
            f"generated_occurrences={perf_generated_occurrences} "
            f"created_transactions={get_materialized_transaction_count()}"
        )
        perf_print(
            f"[PERF] build_timeline END caller={caller} elapsed_ms={elapsed_ms:.0f}"
        )
        if query_profiler is not None:
            perf_print(f"[PERF] query_count={query_profiler.query_count}")
        if forecast_days > 90:
            perf_print(
                f"[PERF] non_dashboard forecast_days={forecast_days} caller={caller}"
            )
        log_perf(
            "build_timeline",
            timer=timer,
            query_profiler=query_profiler,
            caller=caller,
            user=getattr(user, "pk", user),
            accounts=len(account_ids),
            transactions=perf_transactions,
            generated_occurrences=perf_generated_occurrences,
            start_date=start_date.isoformat(),
            end_date=end_date.isoformat(),
            days=forecast_days,
            projection_only=projection_only,
            rows_returned=len(rows),
            elapsed_ms=f"{elapsed_ms:.0f}",
        )
    return rows
