"""
Plaid / manual forecast matching — score candidates by account, amount, date window, not raw description.

Ledger rule: rows that are the *import* side of a TransactionMatch must not double-count balances
or timeline rows; the paired *planned* row remains canonical for forecast-first UX.
"""
from __future__ import annotations

import re
import unicodedata
from decimal import Decimal
from difflib import SequenceMatcher
from datetime import date, timedelta
from typing import TYPE_CHECKING, Any, Iterable, Optional

from django.db import transaction as db_transaction
from django.db.models import Exists, OuterRef, Q, QuerySet, Subquery

from accounts.models import Account
from accounts.relationship_models import AccountRelationship

from ..models import MatchSuggestion, Transaction, TransactionMatch, Transfer, TransferGroup

from .posting import attach_out_leg_for_existing_card_inflow

if TYPE_CHECKING:
    pass

# Tunables (business constants — adjust here only).
SAME_ACCOUNT_DATE_WINDOW_DAYS = 5
TRANSFER_GROUP_DATE_WINDOW_DAYS = 7
TRANSFER_PAIR_IMPORTED_DATE_WINDOW_DAYS = 5
AUTO_MATCH_THRESHOLD = 85
SUGGEST_MATCH_THRESHOLD = 65
AMOUNT_TOLERANCE = Decimal("0.01")
# Auto-restore missing checking leg when a lone card inflow matches a Plaid outflow (see _try_orphan_card_inflow_repair).
ORPHAN_REPAIR_MIN_SCORE = 70
ORPHAN_REPAIR_SCORE_GAP = 10
RELATIONSHIP_SINGLE_LEG_BOOST = 20
RELATIONSHIP_BOTH_LEGS_BOOST = 30


def normalize_description(text: str) -> str:
    """Collapse whitespace/punctuation for fuzzy comparison (not equality)."""
    if not text:
        return ""
    s = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    s = s.lower()
    s = re.sub(r"[^\w\s]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def ledger_visible_transactions(qs: QuerySet[Transaction]) -> QuerySet[Transaction]:
    """
    Transactions that affect running balance / timeline totals.

    Excludes: (1) Plaid rows linked as the import side of a TransactionMatch;
    (2) Plaid rows explicitly marked ignored or duplicate.
    """
    excluded_import_pks = TransactionMatch.objects.values("imported_transaction_id")
    return qs.exclude(pk__in=Subquery(excluded_import_pks)).exclude(
        source=Transaction.Source.PLAID,
        import_match_status__in=[
            Transaction.ImportMatchStatus.IGNORED,
            Transaction.ImportMatchStatus.DUPLICATE,
        ],
    )


def ledger_visible_account_transactions_q(*, prefix: str = "transactions") -> Q:
    """
    Q filter for Account → Transaction relations (annotations, aggregates).

    Mirrors :func:`ledger_visible_transactions` exclusion rules.
    """
    matched_imports = TransactionMatch.objects.values("imported_transaction_id")
    return (
        ~Q(**{f"{prefix}__pk__in": Subquery(matched_imports)})
        & ~(
            Q(**{f"{prefix}__source": Transaction.Source.PLAID})
            & Q(
                **{
                    f"{prefix}__import_match_status__in": [
                        Transaction.ImportMatchStatus.IGNORED,
                        Transaction.ImportMatchStatus.DUPLICATE,
                    ]
                }
            )
        )
    )


def _active_relationship_for_planned_leg(planned: Transaction) -> AccountRelationship | None:
    tg = getattr(planned, "transfer_group", None)
    if tg is None and planned.transfer_group_id:
        tg = TransferGroup.objects.filter(pk=planned.transfer_group_id).first()
    if tg and tg.relationship_id:
        rel = AccountRelationship.objects.filter(
            pk=tg.relationship_id, is_active=True,
        ).first()
        if rel:
            return rel
    if tg:
        rel = AccountRelationship.objects.filter(
            is_active=True,
            source_account_id=tg.from_account_id,
            destination_account_id=tg.to_account_id,
        ).first()
        if rel:
            return rel
    return None


def _relationship_score_boost(
    imported: Transaction,
    planned: Transaction,
) -> tuple[int, dict[str, Any]]:
    """Boost when import aligns with an active account relationship."""
    parts: dict[str, Any] = {}
    rel = _active_relationship_for_planned_leg(planned)
    if rel is None:
        return 0, parts
    tg = planned.transfer_group
    if tg is None and planned.transfer_group_id:
        tg = TransferGroup.objects.filter(pk=planned.transfer_group_id).first()
    if not tg:
        return 0, parts

    on_source = imported.account_id == rel.source_account_id and planned.amount is not None and planned.amount < 0
    on_dest = imported.account_id == rel.destination_account_id and planned.amount is not None and planned.amount > 0
    if not on_source and not on_dest:
        return 0, parts

    amt = rel.default_amount
    if amt is not None and planned.amount is not None:
        if abs(abs(planned.amount) - amt) > AMOUNT_TOLERANCE and tg.amount != abs(planned.amount):
            if abs(tg.amount - abs(imported.amount)) > AMOUNT_TOLERANCE:
                return 0, parts

    boost = RELATIONSHIP_SINGLE_LEG_BOOST
    parts["relationship_single"] = boost

    low = imported.date - timedelta(days=TRANSFER_PAIR_IMPORTED_DATE_WINDOW_DAYS)
    high = imported.date + timedelta(days=TRANSFER_PAIR_IMPORTED_DATE_WINDOW_DAYS)
    other_account_id = (
        rel.destination_account_id if on_source else rel.source_account_id
    )
    expected_sign = 1 if on_source else -1
    paired = Transaction.objects.filter(
        account_id=other_account_id,
        date__gte=low,
        date__lte=high,
        source=Transaction.Source.PLAID,
    ).exclude(pk=imported.pk)
    for peer in paired:
        if peer.amount is None:
            continue
        if expected_sign > 0 and peer.amount <= 0:
            continue
        if expected_sign < 0 and peer.amount >= 0:
            continue
        if abs(peer.amount + imported.amount) <= AMOUNT_TOLERANCE or abs(peer.amount - imported.amount) <= AMOUNT_TOLERANCE:
            boost = RELATIONSHIP_BOTH_LEGS_BOOST
            parts["relationship_both_legs"] = boost
            break

    return boost, parts


def score_candidate(imported: Transaction, planned: Transaction) -> tuple[int, dict[str, Any]]:
    """
    Return (score, debug_parts). Higher is better. Does not enforce thresholds here.
    """
    parts: dict[str, Any] = {}
    score = 0
    if planned.account_id != imported.account_id:
        return 0, {"reject": "different_account"}

    score += 50
    parts["account"] = 50

    if planned.amount is None or imported.amount is None:
        return score, parts
    if abs(planned.amount - imported.amount) > AMOUNT_TOLERANCE:
        return 0, {"reject": "amount_mismatch"}
    score += 40
    parts["amount"] = 40

    dd = abs((planned.date - imported.date).days)
    if dd <= 2:
        score += 25
        parts["date_close"] = 25
    elif dd <= SAME_ACCOUNT_DATE_WINDOW_DAYS:
        score += 15
        parts["date_window"] = 15
    else:
        return 0, {"reject": "date_outside_window"}

    np = normalize_description(planned.payee or "")
    ni = normalize_description(imported.imported_description or imported.payee or "")
    ratios: list[float] = []
    if np and ni:
        ratios.append(SequenceMatcher(None, np, ni).ratio())
    tg = getattr(planned, "transfer_group", None)
    if tg is None and planned.transfer_group_id:
        tg = TransferGroup.objects.select_related("to_account", "from_account").filter(pk=planned.transfer_group_id).first()
    if (
        tg
        and planned.amount is not None
        and planned.amount < 0
        and tg.from_account_id == imported.account_id
        and planned.account_id == imported.account_id
    ):
        to_a = tg.to_account
        for raw in (
            to_a.name,
            (to_a.display_name or "").strip(),
            (to_a.nickname or "").strip(),
            to_a.institution,
            f"{to_a.institution} {to_a.name}".strip(),
        ):
            nl = normalize_description(raw)
            if nl and ni:
                ratios.append(SequenceMatcher(None, ni, nl).ratio())
        for raw in (
            to_a.display_name,
            (to_a.nickname or "").strip(),
            to_a.name,
            to_a.institution,
        ):
            nl = normalize_description(raw)
            if len(nl) >= 3 and nl in ni:
                ratios.append(0.82)
                break
            for word in nl.split():
                if len(word) >= 4 and word in ni:
                    ratios.append(0.72)
                    break
    desc_pts = min(12, int(round(max(ratios) * 10))) if ratios else 0
    score += desc_pts
    parts["description_sim"] = desc_pts

    # Transfer-group coherence: planned leg aligns with scheduled payment/transfer plan.
    if planned.transfer_group_id:
        tg = TransferGroup.objects.filter(pk=planned.transfer_group_id).select_related(
            "to_account", "from_account"
        ).first()
        if tg:
            if tg.from_account_id == imported.account_id and planned.amount < 0:
                if abs(planned.amount) == tg.amount:
                    low = tg.scheduled_date - timedelta(days=TRANSFER_GROUP_DATE_WINDOW_DAYS)
                    high = tg.scheduled_date + timedelta(days=TRANSFER_GROUP_DATE_WINDOW_DAYS)
                    if low <= imported.date <= high:
                        score += 20
                        parts["transfer_pattern_from"] = 20
                dest = tg.to_account
                payee_l = (planned.payee or "").lower()
                for raw in (
                    dest.name,
                    (dest.display_name or "").strip(),
                    (dest.nickname or "").strip(),
                ):
                    token = (raw or "").strip().lower()
                    if len(token) >= 3 and token in payee_l:
                        score += 15
                        parts["payee_names_transfer_dest"] = 15
                        break
            if tg.to_account_id == imported.account_id and planned.amount > 0:
                if planned.amount == tg.amount:
                    low = tg.scheduled_date - timedelta(days=TRANSFER_GROUP_DATE_WINDOW_DAYS)
                    high = tg.scheduled_date + timedelta(days=TRANSFER_GROUP_DATE_WINDOW_DAYS)
                    if low <= imported.date <= high:
                        score += 20
                        parts["transfer_pattern_to"] = 20

    rel_boost, rel_parts = _relationship_score_boost(imported, planned)
    score += rel_boost
    parts.update(rel_parts)

    return score, parts


def _account_labels_match_score(imported: Transaction, dest_account: Account) -> int:
    """How well bank import text matches an account's labels / institution (0–45)."""
    ni = normalize_description(imported.imported_description or imported.payee or "")
    if not ni:
        return 0
    best = 0
    for raw in (
        dest_account.name,
        (dest_account.display_name or "").strip(),
        (dest_account.nickname or "").strip(),
        dest_account.institution,
        f"{dest_account.institution} {dest_account.name}".strip(),
    ):
        nl = normalize_description(raw)
        if not nl:
            continue
        best = max(best, int(round(SequenceMatcher(None, ni, nl).ratio() * 28)))
        if len(nl) >= 3 and nl in ni:
            best = max(best, 22)
        for word in nl.split():
            if len(word) >= 4 and word in ni:
                best = max(best, 18)
    return min(best, 45)


def _planned_candidate_base_qs(imported: Transaction) -> QuerySet[Transaction]:
    low = imported.date - timedelta(days=SAME_ACCOUNT_DATE_WINDOW_DAYS)
    high = imported.date + timedelta(days=SAME_ACCOUNT_DATE_WINDOW_DAYS)
    return (
        Transaction.objects.filter(
            account_id=imported.account_id,
            date__gte=low,
            date__lte=high,
            scenario__isnull=True,
        )
        .exclude(pk=imported.pk)
        .exclude(source__in=[Transaction.Source.PLAID, Transaction.Source.INTEREST, Transaction.Source.SYSTEM])
        .filter(
            Q(source=Transaction.Source.RULE)
            | (
                Q(source__in=[Transaction.Source.ACTUAL, Transaction.Source.ONE_TIME])
                & Q(rule__isnull=True)
            )
        )
        .filter(
            Q(transfer_group__isnull=False)
            | (Q(transfer_out__isnull=True) & Q(transfer_in__isnull=True))
        )
        .exclude(Exists(TransactionMatch.objects.filter(planned_transaction_id=OuterRef("pk"))))
    )


def _try_orphan_card_inflow_repair(imported: Transaction) -> None:
    """
    If Plaid posts an outflow on checking but the user only has the card inflow leg (common after
    clearing the bank side while ``preserve_partner_transfer_legs`` kept the card), recreate the
    missing out-leg + transfer wiring when amount/date align and import text best matches one card.
    """
    if imported.source != Transaction.Source.PLAID:
        return
    if not (imported.plaid_transaction_id or "").strip():
        return
    if imported.amount is None or imported.amount >= 0:
        return
    payer = imported.account
    if payer.account_type not in (
        Account.AccountType.CHECKING,
        Account.AccountType.SAVINGS,
        Account.AccountType.CASH,
    ):
        return
    if _planned_candidate_base_qs(imported).exists():
        return

    low = imported.date - timedelta(days=TRANSFER_PAIR_IMPORTED_DATE_WINDOW_DAYS)
    high = imported.date + timedelta(days=TRANSFER_PAIR_IMPORTED_DATE_WINDOW_DAYS)
    orphans = list(
        Transaction.objects.filter(
            account__household_id=payer.household_id,
            account__account_type=Account.AccountType.CREDIT,
            date__gte=low,
            date__lte=high,
            amount=-imported.amount,
            scenario__isnull=True,
            source__in=[Transaction.Source.ACTUAL, Transaction.Source.ONE_TIME],
            rule__isnull=True,
            transfer_group__isnull=True,
        )
        .filter(transfer_out__isnull=True, transfer_in__isnull=True)
        .exclude(Exists(TransactionMatch.objects.filter(planned_transaction_id=OuterRef("pk"))))
        .select_related("account")
    )
    if not orphans:
        return

    def repair_score(in_leg: Transaction) -> int:
        dd = abs((in_leg.date - imported.date).days)
        date_pts = 25 if dd <= 2 else 15 if dd <= TRANSFER_PAIR_IMPORTED_DATE_WINDOW_DAYS else 0
        desc = _account_labels_match_score(imported, in_leg.account)
        unique = 32 if len(orphans) == 1 else 0
        return date_pts + min(desc, 42) + unique

    ranked = sorted(orphans, key=lambda x: (-repair_score(x), x.pk))
    best = ranked[0]
    s0 = repair_score(best)
    s1 = repair_score(ranked[1]) if len(ranked) > 1 else -9999
    if s0 < ORPHAN_REPAIR_MIN_SCORE or (s0 - s1) < ORPHAN_REPAIR_SCORE_GAP:
        return
    attach_out_leg_for_existing_card_inflow(
        from_account_id=imported.account_id,
        in_leg=best,
        out_date=imported.date,
    )


def score_manual_cross_account(imported: Transaction, planned: Transaction) -> int:
    """Allow UI match of Plaid payer row to an opposite-leg card inflow (same household)."""
    if imported.source != Transaction.Source.PLAID or imported.amount is None or imported.amount >= 0:
        return 0
    if planned.amount is None or planned.amount <= 0:
        return 0
    if planned.amount != -imported.amount:
        return 0
    if planned.account_id == imported.account_id:
        return 0
    if planned.account.household_id != imported.account.household_id:
        return 0
    if planned.account.account_type != Account.AccountType.CREDIT:
        return 0
    if planned.source not in (Transaction.Source.ACTUAL, Transaction.Source.ONE_TIME):
        return 0
    if planned.scenario_id is not None:
        return 0
    dd = abs((planned.date - imported.date).days)
    if dd > SAME_ACCOUNT_DATE_WINDOW_DAYS:
        return 0
    score = 48
    if dd <= 2:
        score += 25
    elif dd <= SAME_ACCOUNT_DATE_WINDOW_DAYS:
        score += 15
    score += min(_account_labels_match_score(imported, planned.account), 38)
    rel = AccountRelationship.objects.filter(
        is_active=True,
        source_account_id=imported.account_id,
        destination_account_id=planned.account_id,
        relationship_type__in=(
            AccountRelationship.RelationshipType.CREDIT_CARD_PAYMENT,
            AccountRelationship.RelationshipType.DEBT_PAYMENT,
            AccountRelationship.RelationshipType.LOAN_PAYMENT,
        ),
    ).first()
    if rel:
        score += RELATIONSHIP_SINGLE_LEG_BOOST
        low = imported.date - timedelta(days=TRANSFER_PAIR_IMPORTED_DATE_WINDOW_DAYS)
        high = imported.date + timedelta(days=TRANSFER_PAIR_IMPORTED_DATE_WINDOW_DAYS)
        if Transaction.objects.filter(
            account_id=planned.account_id,
            date__gte=low,
            date__lte=high,
            source=Transaction.Source.PLAID,
            amount=-imported.amount,
        ).exclude(pk=imported.pk).exists():
            score += RELATIONSHIP_BOTH_LEGS_BOOST - RELATIONSHIP_SINGLE_LEG_BOOST
    return score


def find_candidate_matches(
    imported: Transaction,
    *,
    allow_orphan_repair: bool = True,
) -> list[tuple[Transaction, int, dict[str, Any]]]:
    """Return sorted list (planned_txn, score, parts) descending by score."""
    if imported.source != Transaction.Source.PLAID or not (imported.plaid_transaction_id or "").strip():
        return []

    if allow_orphan_repair:
        _try_orphan_card_inflow_repair(imported)

    candidates = _planned_candidate_base_qs(imported).select_related(
        "account", "transfer_group", "transfer_group__to_account", "transfer_group__from_account"
    )
    out: list[tuple[Transaction, int, dict[str, Any]]] = []
    for planned in candidates:
        if planned.amount is None or imported.amount is None:
            continue
        if abs(planned.amount - imported.amount) > AMOUNT_TOLERANCE:
            continue
        sc, parts = score_candidate(imported, planned)
        if sc <= 0:
            continue
        out.append((planned, sc, parts))
    out.sort(key=lambda x: (-x[1], x[0].pk))
    return out


def _unmatched_planned_same_amount_count(imported: Transaction) -> int:
    """How many still-unmatched forecast/manual rows could absorb this import amount."""
    if imported.amount is None:
        return 0
    count = 0
    for planned in _planned_candidate_base_qs(imported):
        if planned.amount is None:
            continue
        if abs(planned.amount - imported.amount) <= AMOUNT_TOLERANCE:
            count += 1
    return count


def _planned_match_allows_import_dedup(planned: Transaction) -> bool:
    """
    When a planned row is already matched, only auto-hide extra Plaid rows for patterns that
    should have a single bank post (transfers / rule materializations). Repeated ACTUAL entries
    with the same amount (e.g. four identical donations) must not suppress extra imports.
    """
    if planned.transfer_group_id:
        return True
    if planned.source == Transaction.Source.RULE and planned.rule_id:
        return True
    return False


def _plaid_sibling_imports_qs(anchor: Transaction) -> QuerySet[Transaction]:
    """Other Plaid rows on the same account with the same amount in the match date window."""
    if anchor.amount is None:
        return Transaction.objects.none()
    low = anchor.date - timedelta(days=SAME_ACCOUNT_DATE_WINDOW_DAYS)
    high = anchor.date + timedelta(days=SAME_ACCOUNT_DATE_WINDOW_DAYS)
    return (
        Transaction.objects.filter(
            account_id=anchor.account_id,
            source=Transaction.Source.PLAID,
            date__gte=low,
            date__lte=high,
            scenario__isnull=True,
        )
        .exclude(pk=anchor.pk)
        .exclude(plaid_transaction_id__isnull=True)
        .exclude(plaid_transaction_id="")
        .filter(import_match_status__in=[
            Transaction.ImportMatchStatus.UNMATCHED,
            Transaction.ImportMatchStatus.SUGGESTED,
            Transaction.ImportMatchStatus.MATCHED,
        ])
    ).filter(amount=anchor.amount)


def mark_redundant_plaid_imports_after_match(anchor_import: Transaction) -> int:
    """
    Plaid sometimes sends a second ``transaction_id`` for the same bank movement after refresh.
    Once one import is linked to the canonical planned row, mark siblings as DUPLICATE imports.
    """
    if anchor_import.source != Transaction.Source.PLAID:
        return 0
    if not TransactionMatch.objects.filter(imported_transaction_id=anchor_import.pk).exists():
        return 0
    anchor_match = TransactionMatch.objects.filter(imported_transaction_id=anchor_import.pk).select_related(
        "planned_transaction"
    ).first()
    if anchor_match is None:
        return 0
    if not _planned_match_allows_import_dedup(anchor_match.planned_transaction):
        return 0

    marked = 0
    for sibling in _plaid_sibling_imports_qs(anchor_import):
        if TransactionMatch.objects.filter(imported_transaction_id=sibling.pk).exists():
            continue
        if abs(sibling.amount - anchor_import.amount) > AMOUNT_TOLERANCE:
            continue
        if _unmatched_planned_same_amount_count(sibling) > 0:
            continue
        mark_import_duplicate(sibling)
        marked += 1
    return marked


def try_mark_plaid_import_as_duplicate_of_existing_match(imported: Transaction) -> bool:
    """
  When the manual / planned row is already matched to another Plaid import, later sync rows for
    the same payment should not appear as a second ledger line.
    """
    if imported.source != Transaction.Source.PLAID:
        return False
    if not (imported.plaid_transaction_id or "").strip():
        return False
    if TransactionMatch.objects.filter(imported_transaction_id=imported.pk).exists():
        return False
    if imported.import_match_status == Transaction.ImportMatchStatus.DUPLICATE:
        return True
    low = imported.date - timedelta(days=SAME_ACCOUNT_DATE_WINDOW_DAYS)
    high = imported.date + timedelta(days=SAME_ACCOUNT_DATE_WINDOW_DAYS)
    matched_peer = (
        TransactionMatch.objects.filter(
            imported_transaction__account_id=imported.account_id,
            imported_transaction__date__gte=low,
            imported_transaction__date__lte=high,
            imported_transaction__source=Transaction.Source.PLAID,
            planned_transaction__amount=imported.amount,
        )
        .exclude(imported_transaction_id=imported.pk)
        .first()
    )
    if matched_peer is None:
        return False
    if imported.amount is None or matched_peer.planned_transaction.amount is None:
        return False
    if abs(imported.amount - matched_peer.planned_transaction.amount) > AMOUNT_TOLERANCE:
        return False
    if _unmatched_planned_same_amount_count(imported) > 0:
        return False
    if not _planned_match_allows_import_dedup(matched_peer.planned_transaction):
        return False
    mark_import_duplicate(imported)
    return True


def reconcile_orphan_matched_plaid_imports(*, account_id: int | None = None) -> int:
    """
    Repair rows marked MATCHED without a TransactionMatch (stale metadata), then dedupe siblings.
    """
    qs = Transaction.objects.filter(
        source=Transaction.Source.PLAID,
        import_match_status=Transaction.ImportMatchStatus.MATCHED,
    ).exclude(plaid_transaction_id__isnull=True).exclude(plaid_transaction_id="")
    if account_id is not None:
        qs = qs.filter(account_id=account_id)
    fixed = 0
    for imp in qs:
        if TransactionMatch.objects.filter(imported_transaction_id=imp.pk).exists():
            mark_redundant_plaid_imports_after_match(imp)
            continue
        imp.import_match_status = Transaction.ImportMatchStatus.UNMATCHED
        imp.save(update_fields=["import_match_status", "updated_at"])
        if try_mark_plaid_import_as_duplicate_of_existing_match(imp):
            fixed += 1
    return fixed


def _refresh_transfer_group_status(tg: TransferGroup) -> None:
    txs = list(tg.transactions.all())
    matched_legs = sum(1 for t in txs if t.import_match_status == Transaction.ImportMatchStatus.MATCHED)
    if matched_legs == 0:
        return
    if matched_legs >= 2:
        tg.status = TransferGroup.Status.MATCHED
    elif matched_legs == 1:
        tg.status = TransferGroup.Status.PARTIALLY_MATCHED
    tg.save(update_fields=["status", "updated_at"])


def apply_bank_fields_to_planned_from_import(planned: Transaction, imported: Transaction) -> list[str]:
    """
    After a match, the planned row becomes the ledger line — use bank date/payee so imports
    replace hand-entered rows (authorization vs posting date, POS DEBIT vs merchant name).
    """
    update_fields: list[str] = []
    bank_date = imported.posted_date or imported.date
    if bank_date and planned.date != bank_date:
        planned.date = bank_date
        update_fields.append("date")
    if imported.posted_date or imported.date:
        posted = imported.posted_date or imported.date
        if planned.posted_date != posted:
            planned.posted_date = posted
            update_fields.append("posted_date")
    bank_desc = (imported.imported_description or imported.memo or imported.payee or "").strip()
    if bank_desc and not (planned.imported_description or "").strip():
        planned.imported_description = bank_desc[:2000]
        update_fields.append("imported_description")
    np = normalize_description(imported.payee or bank_desc or "")[:512]
    if np and planned.normalized_payee != np:
        planned.normalized_payee = np
        update_fields.append("normalized_payee")
    if planned.source in (Transaction.Source.ACTUAL, Transaction.Source.ONE_TIME):
        bank_payee = (imported.payee or bank_desc or "").strip()
        if bank_payee and planned.payee != bank_payee[:255]:
            planned.payee = bank_payee[:255]
            update_fields.append("payee")
    return update_fields


def _create_match_record(
    *,
    planned: Transaction,
    imported: Transaction,
    match_type: str,
    score: int,
    confidence: str,
) -> TransactionMatch:
    """Persist match and update row metadata (planned stays canonical for ledger)."""
    with db_transaction.atomic():
        tm = TransactionMatch.objects.create(
            planned_transaction=planned,
            imported_transaction=imported,
            match_type=match_type,
            score=score,
            confidence=confidence,
        )
        planned.import_match_status = Transaction.ImportMatchStatus.MATCHED
        imported.import_match_status = Transaction.ImportMatchStatus.MATCHED
        bank_fields = apply_bank_fields_to_planned_from_import(planned, imported)
        planned.save(
            update_fields=[
                "import_match_status",
                *bank_fields,
                "updated_at",
            ]
        )
        imported.save(update_fields=["import_match_status", "updated_at"])
        if planned.transfer_group_id:
            tg = TransferGroup.objects.filter(pk=planned.transfer_group_id).first()
            if tg:
                _refresh_transfer_group_status(tg)
        mark_redundant_plaid_imports_after_match(imported)
        return tm


def _planned_row_eligible_as_import_match_candidate(planned: Transaction) -> bool:
    """
    Same eligibility as _planned_candidate_base_qs: scenarios excluded; Plaid/system excluded;
    transfers must be via TransferGroup or no transfer wiring on this row.
    """
    if planned.scenario_id is not None:
        return False
    if planned.source in (
        Transaction.Source.PLAID,
        Transaction.Source.INTEREST,
        Transaction.Source.SYSTEM,
    ):
        return False
    eligible_source = planned.source == Transaction.Source.RULE or (
        planned.source in (Transaction.Source.ACTUAL, Transaction.Source.ONE_TIME) and planned.rule_id is None
    )
    if not eligible_source:
        return False
    if planned.transfer_group_id:
        return True
    # Mirror Q(transfer_out__isnull=True) & Q(transfer_in__isnull=True) — no Transfer row wiring.
    if Transfer.objects.filter(from_transaction_id=planned.pk).exists():
        return False
    if Transfer.objects.filter(to_transaction_id=planned.pk).exists():
        return False
    return True


def try_match_rule_to_pending_imports(planned: Transaction) -> Optional[TransactionMatch]:
    """
    Link an existing unmatched Plaid row to a rule transaction when the rule row was created or
    surfaced after Plaid sync (match_imported_transaction only runs on import).

    Keeps the forecast-side row as canonical and hides the import leg from balances — same as a
    successful match_imported_transaction.
    """
    if planned.source != Transaction.Source.RULE or not planned.rule_id:
        return None
    if not _planned_row_eligible_as_import_match_candidate(planned):
        return None
    if TransactionMatch.objects.filter(planned_transaction_id=planned.pk).exists():
        return None

    low = planned.date - timedelta(days=SAME_ACCOUNT_DATE_WINDOW_DAYS)
    high = planned.date + timedelta(days=SAME_ACCOUNT_DATE_WINDOW_DAYS)
    unmatched_imports = (
        Transaction.objects.filter(
            account_id=planned.account_id,
            date__gte=low,
            date__lte=high,
            source=Transaction.Source.PLAID,
            scenario__isnull=True,
        )
        .exclude(plaid_transaction_id__isnull=True)
        .exclude(plaid_transaction_id="")
        .filter(
            import_match_status__in=[
                Transaction.ImportMatchStatus.UNMATCHED,
                Transaction.ImportMatchStatus.SUGGESTED,
            ]
        )
        .exclude(Exists(TransactionMatch.objects.filter(imported_transaction_id=OuterRef("pk"))))
    )
    best_imp: Optional[Transaction] = None
    best_score = -1
    for imp in unmatched_imports.select_related("account"):
        if imp.amount is None or planned.amount is None:
            continue
        if abs(imp.amount - planned.amount) > AMOUNT_TOLERANCE:
            continue
        sc, _parts = score_candidate(imp, planned)
        if sc > best_score:
            best_score = sc
            best_imp = imp
    if best_imp is None or best_score < AUTO_MATCH_THRESHOLD:
        return None

    MatchSuggestion.objects.filter(imported_transaction=best_imp).delete()
    return _create_match_record(
        planned=planned,
        imported=best_imp,
        match_type=TransactionMatch.MatchType.SAME_ACCOUNT,
        score=best_score,
        confidence=TransactionMatch.Confidence.AUTO,
    )


def match_imported_transaction(imported: Transaction, *, dry_run: bool = False) -> Optional[TransactionMatch]:
    """
    Match one newly-imported Plaid row to at most one planned transaction.

    Creates TransactionMatch when score >= AUTO_MATCH_THRESHOLD; MatchSuggestion between thresholds;
    otherwise leaves import_match_status UNMATCHED (or SUGGESTED if suggestions exist).
    """
    if imported.source != Transaction.Source.PLAID:
        return None
    if not (imported.plaid_transaction_id or "").strip():
        return None
    existing = TransactionMatch.objects.filter(imported_transaction=imported).first()
    if existing:
        if not dry_run:
            mark_redundant_plaid_imports_after_match(imported)
        return existing

    if not dry_run and try_mark_plaid_import_as_duplicate_of_existing_match(imported):
        return None

    MatchSuggestion.objects.filter(imported_transaction=imported).delete()

    ranked = find_candidate_matches(imported, allow_orphan_repair=not dry_run)
    if not ranked:
        if not dry_run:
            if not try_mark_plaid_import_as_duplicate_of_existing_match(imported):
                imported.import_match_status = Transaction.ImportMatchStatus.UNMATCHED
                imported.save(update_fields=["import_match_status", "updated_at"])
        return None

    best_planned, best_score, _parts = ranked[0]

    if dry_run:
        return None

    if best_score >= AUTO_MATCH_THRESHOLD:
        return _create_match_record(
            planned=best_planned,
            imported=imported,
            match_type=TransactionMatch.MatchType.SAME_ACCOUNT,
            score=best_score,
            confidence=TransactionMatch.Confidence.AUTO,
        )

    if best_score >= SUGGEST_MATCH_THRESHOLD:
        imported.import_match_status = Transaction.ImportMatchStatus.SUGGESTED
        imported.save(update_fields=["import_match_status", "updated_at"])
        for planned, sc, _ in ranked:
            if sc < SUGGEST_MATCH_THRESHOLD:
                continue
            MatchSuggestion.objects.update_or_create(
                imported_transaction=imported,
                planned_transaction=planned,
                defaults={"score": sc},
            )
        return None

    imported.import_match_status = Transaction.ImportMatchStatus.UNMATCHED
    imported.save(update_fields=["import_match_status", "updated_at"])
    return None


def run_matching_for_import_batch(imported_ids: Iterable[int]) -> dict[str, int]:
    """Run matcher for a batch (e.g. after Plaid sync). Returns counts."""
    matched = unmatched = suggested = 0
    for pk in imported_ids:
        t = Transaction.objects.filter(pk=pk).first()
        if t is None:
            continue
        before = t.import_match_status
        m = match_imported_transaction(t)
        t.refresh_from_db()
        if m:
            matched += 1
        elif t.import_match_status == Transaction.ImportMatchStatus.SUGGESTED:
            suggested += 1
        elif before != Transaction.ImportMatchStatus.MATCHED:
            unmatched += 1
    return {"matched": matched, "unmatched": unmatched, "suggested": suggested}


def manual_match_transactions(
    *,
    planned_id: int,
    imported_id: int,
    user=None,
) -> TransactionMatch:
    """User-selected link between planned and imported rows."""
    planned = Transaction.objects.select_related("account", "transfer_group").get(pk=planned_id)
    imported = Transaction.objects.select_related("account").get(pk=imported_id)
    if planned.account.household_id != imported.account.household_id:
        raise ValueError("Accounts must belong to the same household.")
    if imported.source != Transaction.Source.PLAID:
        raise ValueError("Imported side must be a Plaid transaction.")

    if planned.account_id != imported.account_id:
        scm = score_manual_cross_account(imported, planned)
        if scm < SUGGEST_MATCH_THRESHOLD:
            raise ValueError("Cannot match: amount, date, or payee text do not align across accounts.")
        if planned.transfer_group_id is not None:
            raise ValueError(
                "That card payment already has a transfer link. Match this import to the checking-side payment instead."
            )
        if planned.account.account_type != Account.AccountType.CREDIT:
            raise ValueError("Cross-account manual match expects the credit-card inflow leg when the payer is different.")
        out = attach_out_leg_for_existing_card_inflow(
            from_account_id=imported.account_id,
            in_leg=planned,
            out_date=imported.date,
        )
        if out is None:
            raise ValueError("Could not create the missing checking payment leg for this transfer.")
        planned = out

    sc, _ = score_candidate(imported, planned)
    if sc <= 0:
        raise ValueError("Cannot match: account/amount/date outside tolerance.")
    MatchSuggestion.objects.filter(imported_transaction=imported).delete()
    TransactionMatch.objects.filter(
        Q(planned_transaction=planned) | Q(imported_transaction=imported)
    ).delete()
    return _create_match_record(
        planned=planned,
        imported=imported,
        match_type=TransactionMatch.MatchType.MANUAL,
        score=max(sc, SUGGEST_MATCH_THRESHOLD),
        confidence=TransactionMatch.Confidence.MANUAL,
    )


def unmatch_transaction(pair: TransactionMatch) -> None:
    """Remove match; both rows return to editable unmatched states."""
    planned = pair.planned_transaction
    imported = pair.imported_transaction
    with db_transaction.atomic():
        pair.delete()
        planned.import_match_status = Transaction.ImportMatchStatus.NONE
        imported.import_match_status = Transaction.ImportMatchStatus.UNMATCHED
        planned.save(update_fields=["import_match_status", "updated_at"])
        imported.save(update_fields=["import_match_status", "updated_at"])


def ignore_imported_transaction(txn: Transaction) -> None:
    if txn.source != Transaction.Source.PLAID:
        raise ValueError("Only imported transactions can be ignored.")
    txn.import_match_status = Transaction.ImportMatchStatus.IGNORED
    txn.save(update_fields=["import_match_status", "updated_at"])


def mark_import_duplicate(txn: Transaction) -> None:
    if txn.source != Transaction.Source.PLAID:
        raise ValueError("Only imported transactions can be marked duplicate.")
    txn.import_match_status = Transaction.ImportMatchStatus.DUPLICATE
    txn.save(update_fields=["import_match_status", "updated_at"])
