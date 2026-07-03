"""
Plaid / manual forecast matching — score candidates by account, amount, date window, not raw description.

================================================================================
INVARIANT — PLAID IMPORTS (do not change without explicit user approval)
================================================================================
Bank imports (source=PLAID) are the user's real money. They must ALWAYS appear in the
ledger UI and in running-balance math (once per bank post).

When a Plaid row is matched to a planned/manual/rule row via TransactionMatch:
  - SHOW the Plaid import (imported_transaction)
  - HIDE the planned twin (planned_transaction) from ledger_visible_transactions
  - NEVER hide matched Plaid imports to "dedupe" the UI
  - DELETE or hide (DUPLICATE) extra Plaid re-sync rows that duplicate an already-visible post
  - NEVER auto-restore all DUPLICATE rows on timeline read — that resurrects junk duplicates

Wrong approach (broke production repeatedly): hide matched Plaid imports and show only
the forecast row — users see transactions vanish and balances swing by thousands.

See also: .cursor/rules/plaid-imports-never-hide.mdc
================================================================================
"""
from __future__ import annotations

import logging
import re
import unicodedata
from decimal import Decimal
from difflib import SequenceMatcher
from datetime import date, timedelta
from typing import TYPE_CHECKING, Any, Iterable, Optional

from django.db import transaction as db_transaction
from django.db.models import Exists, OuterRef, Q, QuerySet, Subquery
from django.utils import timezone

from accounts.models import Account
from accounts.relationship_models import AccountRelationship

from ..models import MatchSuggestion, Reconciliation, Transaction, TransactionMatch, Transfer, TransferGroup

from .posting import attach_out_leg_for_existing_card_inflow

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)

# Tunables (business constants — adjust here only).
SAME_ACCOUNT_DATE_WINDOW_DAYS = 5
TRANSFER_GROUP_DATE_WINDOW_DAYS = 7
TRANSFER_PAIR_IMPORTED_DATE_WINDOW_DAYS = 5
AUTO_MATCH_THRESHOLD = 85
SUGGEST_MATCH_THRESHOLD = 65
AMOUNT_TOLERANCE = Decimal("0.01")

# Plaid rows eligible for auto-match (NONE = legacy imports never classified at sync).
PENDING_PLAID_IMPORT_STATUSES = (
    Transaction.ImportMatchStatus.NONE,
    Transaction.ImportMatchStatus.UNMATCHED,
    Transaction.ImportMatchStatus.SUGGESTED,
)


def _pending_plaid_import_status_q() -> Q:
    return Q(import_match_status__in=PENDING_PLAID_IMPORT_STATUSES)


def _is_rule_backed_planned_row(planned: Transaction) -> bool:
    """Scheduled / materialized automation occurrence (not a one-off manual row)."""
    return bool(planned.rule_id) and planned.source in (
        Transaction.Source.RULE,
        Transaction.Source.ACTUAL,
        Transaction.Source.ONE_TIME,
    )


def planned_leg_suppressed_by_import_match(txn: Transaction) -> bool:
    """
    True when a matched Plaid import is the canonical ledger row for this rule occurrence.

    The planned/rule twin is hidden from balances; timeline must not emit a second row on the
    scheduled occurrence date when the bank import already posted nearby.
    """
    if not txn.rule_id:
        return False
    if txn.import_match_status == Transaction.ImportMatchStatus.MATCHED:
        return True
    return TransactionMatch.objects.filter(planned_transaction_id=txn.pk).exists()


def _amounts_equal(a: Decimal | None, b: Decimal | None) -> bool:
    if a is None or b is None:
        return False
    return abs(a - b) <= AMOUNT_TOLERANCE


def _matched_rule_occurrence_covers(
    *,
    rule_id: int,
    account_id: int,
    on_date: date,
    amount: Decimal | None,
) -> Transaction | None:
    """Return a matched rule row that already satisfies this pay period (import posted nearby)."""
    low = on_date - timedelta(days=SAME_ACCOUNT_DATE_WINDOW_DAYS)
    high = on_date + timedelta(days=SAME_ACCOUNT_DATE_WINDOW_DAYS)
    for txn in Transaction.objects.filter(
        rule_id=rule_id,
        account_id=account_id,
        date__gte=low,
        date__lte=high,
        import_match_status=Transaction.ImportMatchStatus.MATCHED,
        scenario__isnull=True,
    ).order_by("-date", "-id"):
        if amount is None or txn.amount is None or _amounts_equal(txn.amount, amount):
            return txn
    return None


def purge_shadow_rule_occurrences_after_match(planned: Transaction) -> int:
    """
    Delete extra unmatched rule rows for the same paycheck after an import match.

    Weekly rules can materialize 06-18 and 06-19 rows for one bank deposit — keep only the
    matched canonical occurrence.

    PLAID INVARIANT: only deletes source=RULE rows. Never delete source=PLAID.
    """
    if not planned.rule_id or planned.source != Transaction.Source.RULE:
        return 0
    if planned.import_match_status != Transaction.ImportMatchStatus.MATCHED:
        return 0
    low = planned.date - timedelta(days=SAME_ACCOUNT_DATE_WINDOW_DAYS)
    high = planned.date + timedelta(days=SAME_ACCOUNT_DATE_WINDOW_DAYS)
    removed = 0
    dupes = (
        Transaction.objects.filter(
            rule_id=planned.rule_id,
            account_id=planned.account_id,
            date__gte=low,
            date__lte=high,
            source=Transaction.Source.RULE,
            scenario__isnull=True,
            status=Transaction.Status.PLANNED,
        )
        .exclude(pk=planned.pk)
        .exclude(import_match_status=Transaction.ImportMatchStatus.MATCHED)
        .exclude(Exists(TransactionMatch.objects.filter(planned_transaction_id=OuterRef("pk"))))
    )
    for dup in dupes:
        if planned.amount is not None and not _amounts_equal(dup.amount, planned.amount):
            continue
        dup.delete()
        removed += 1
    return removed


def repair_shadow_rule_occurrences_for_accounts(account_ids: Iterable[int]) -> int:
    """Remove duplicate rule rows shadowed by an already-matched sibling on the same account."""
    ids = list(account_ids)
    if not ids:
        return 0
    removed = 0
    for planned in (
        Transaction.objects.filter(
            account_id__in=ids,
            rule_id__isnull=False,
            source=Transaction.Source.RULE,
            import_match_status=Transaction.ImportMatchStatus.MATCHED,
            scenario__isnull=True,
        )
        .order_by("date", "id")
        .iterator(chunk_size=200)
    ):
        removed += purge_shadow_rule_occurrences_after_match(planned)
    return removed


def shadowed_rule_occurrence_ids(txns: Iterable[Transaction]) -> set[int]:
    """Unmatched rule rows superseded by a matched sibling for the same pay period."""
    rows = list(txns)
    hidden: set[int] = set()
    matched_rule_rows = [
        t
        for t in rows
        if t.rule_id
        and t.source == Transaction.Source.RULE
        and t.import_match_status == Transaction.ImportMatchStatus.MATCHED
    ]
    if not matched_rule_rows:
        return hidden
    for t in rows:
        if t.pk in hidden:
            continue
        if not t.rule_id or t.source != Transaction.Source.RULE:
            continue
        if t.import_match_status == Transaction.ImportMatchStatus.MATCHED:
            continue
        if TransactionMatch.objects.filter(planned_transaction_id=t.pk).exists():
            continue
        for m in matched_rule_rows:
            if m.pk == t.pk or m.rule_id != t.rule_id or m.account_id != t.account_id:
                continue
            if not _amounts_equal(m.amount, t.amount):
                continue
            if abs((m.date - t.date).days) <= SAME_ACCOUNT_DATE_WINDOW_DAYS:
                hidden.add(t.pk)
                break
    return hidden
# Auto-restore missing checking leg when a lone card inflow matches a Plaid outflow (see _try_orphan_card_inflow_repair).
ORPHAN_REPAIR_MIN_SCORE = 70
ORPHAN_REPAIR_SCORE_GAP = 10
RELATIONSHIP_SINGLE_LEG_BOOST = 20
RELATIONSHIP_BOTH_LEGS_BOOST = 30
_MERCHANT_TOKEN_STOPWORDS = frozenset(
    {
        "debit",
        "credit",
        "pos",
        "payment",
        "paypal",
        "ach",
        "web",
        "store",
        "online",
        "transfer",
        "purchase",
        "transaction",
        "pending",
        "authorized",
        "auth",
        "from",
        "with",
    }
)


_MERCHANT_FAMILY_KEYWORDS = (
    "exeterfina",
    "exeter",
    "synchrony",
    "syf",
    "carecredit",
    "care credit",
    "capital one",
    "geico",
    "myuhc",
    "exeterfina loan",
)


def _merchant_families(text: str) -> frozenset[str]:
    """Coarse payee families — Exeter car loan ≠ Synchrony credit card even at the same amount."""
    s = normalize_description(text).replace(" ", "")
    if not s:
        return frozenset()
    found: set[str] = set()
    for fam in _MERCHANT_FAMILY_KEYWORDS:
        key = fam.replace(" ", "")
        if key in s:
            found.add(key)
    return frozenset(found)


def normalize_description(text: str) -> str:
    """Collapse whitespace/punctuation for fuzzy comparison (not equality)."""
    if not text:
        return ""
    s = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    s = s.lower()
    s = re.sub(r"[^\w\s]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _plaid_description(txn: Transaction) -> str:
    return normalize_description(
        (txn.imported_description or txn.payee or txn.memo or "").strip()
    )


_BANK_UNIQUE_REF_PATTERNS = (
    re.compile(r"ca0[a-z0-9]{10,}"),
    re.compile(r"jpm[a-z0-9]{5,}"),
    re.compile(r"transaction#:\s*\d+"),
    re.compile(r"cash app\*?\s*([a-z0-9]+(?:\s+[a-z0-9]+)?)"),
    re.compile(r"ppd\s*id:?\s*(\d{4,})"),
    re.compile(r"\bid:?\s*(\d{6,})\b"),
)


def _extract_bank_reference_tokens(desc: str) -> frozenset[str]:
    """
    Per-transaction ids embedded in bank text (Zelle JPM…, Capital One CA0…, ACH PPD id).

    When two imports share amount/date but carry different reference tokens, they are separate
    bank posts — not a Plaid re-sync of the same movement.
    """
    s = normalize_description(desc)
    if not s:
        return frozenset()
    tokens: set[str] = set()
    for pat in _BANK_UNIQUE_REF_PATTERNS:
        for m in pat.finditer(s):
            token = re.sub(r"\s+", "", m.group(0) if m.lastindex is None else m.group(1))
            if token:
                tokens.add(token.lower())
    for word in s.split():
        if len(word) < 12:
            continue
        if not re.search(r"[a-z]", word) or not re.search(r"\d", word):
            continue
        if word in _MERCHANT_TOKEN_STOPWORDS:
            continue
        tokens.add(word)
    return frozenset(tokens)


def _bank_reference_tokens(txn: Transaction) -> frozenset[str]:
    return _extract_bank_reference_tokens(
        (txn.imported_description or txn.payee or txn.memo or "").strip()
    )


def _bank_reference_tokens_compatible(a: Transaction, b: Transaction) -> bool:
    """False when both rows carry distinct bank reference ids (separate Zelle/ACH posts)."""
    ref_a = _bank_reference_tokens(a)
    ref_b = _bank_reference_tokens(b)
    if ref_a and ref_b and ref_a.isdisjoint(ref_b):
        return False
    return True


def _plaid_ids_compatible_for_match(imported: Transaction, planned: Transaction) -> bool:
    """
    Each unique plaid_transaction_id is its own bank post.

    Blocks a second import (e.g. four $20 Arizona Humane donations) from latching onto a row
    that already represents a different Plaid id.
    """
    import_id = (imported.plaid_transaction_id or "").strip()
    planned_id = (planned.plaid_transaction_id or "").strip()
    if planned_id and import_id and planned_id != import_id:
        return False
    return True


def _auto_link_description_compatible(imported: Transaction, planned: Transaction) -> bool:
    """
    Auto-match only when bank text clearly describes the same charge as the planned row.

    Blocks Andrew / Elijah / Joseph Cash App $10 sends from collapsing onto one row.
    """
    if not _plaid_ids_compatible_for_match(imported, planned):
        return False
    if planned.transfer_group_id:
        return True
    pi = _plaid_description(imported)
    if not pi:
        return False
    labels = [
        planned.payee or "",
        planned.imported_description or "",
        planned.memo or "",
    ]
    if planned.source == Transaction.Source.RULE and planned.rule_id:
        from timeline.models import RecurringRule

        rule = (
            planned.rule
            if getattr(planned, "rule", None) is not None
            else RecurringRule.objects.filter(pk=planned.rule_id).first()
        )
        if rule and (rule.name or "").strip():
            labels.append(rule.name)
    for label in labels:
        if pi == normalize_description(label):
            return True
    ref_i = _bank_reference_tokens(imported)
    ref_p = _bank_reference_tokens(planned)
    if ref_i and ref_p:
        return bool(ref_i & ref_p)
    if not ref_i and not ref_p and _merchant_token_overlap_score(imported, planned) >= 16:
        return True
    # Rule-backed income/deposit: amount + account + date window is sufficient (payroll often posts early).
    if (
        _is_rule_backed_planned_row(planned)
        and imported.amount is not None
        and planned.amount is not None
        and imported.amount > 0
        and planned.amount > 0
        and abs(imported.amount - planned.amount) <= AMOUNT_TOLERANCE
        and abs((planned.date - imported.date).days) <= SAME_ACCOUNT_DATE_WINDOW_DAYS
    ):
        return True
    return False


def _merchant_token_overlap_score(imported: Transaction, planned: Transaction) -> int:
    """
    Boost when a merchant token from the cleaner import label appears in a long manual payee
    (e.g. import "Chewy" vs manual "POS DEBIT PAYPAL *CHEWY INC …").
    """
    np = normalize_description(planned.payee or "")
    ni = normalize_description(imported.imported_description or imported.payee or "")
    if not np or not ni:
        return 0
    short, long = (ni, np) if len(ni.split()) <= len(np.split()) else (np, ni)
    tokens = [
        w
        for w in short.split()
        if len(w) >= 4 and w not in _MERCHANT_TOKEN_STOPWORDS
    ]
    if not tokens:
        return 0
    hits = sum(1 for token in tokens if token in long)
    if hits == 0:
        return 0
    if len(tokens) == 1:
        return 20
    return min(16, hits * 8)


def _same_plaid_transaction_id(a: Transaction, b: Transaction) -> bool:
    """Two rows are the same Plaid import only when plaid_transaction_id matches exactly."""
    id_a = (a.plaid_transaction_id or "").strip()
    id_b = (b.plaid_transaction_id or "").strip()
    return bool(id_a) and id_a == id_b


def _plaid_imports_likely_same_bank_movement(a: Transaction, b: Transaction) -> bool:
    """Plaid-vs-Plaid dedupe is restricted to exact plaid_transaction_id only."""
    return _same_plaid_transaction_id(a, b)


def ledger_visible_transactions(qs: QuerySet[Transaction]) -> QuerySet[Transaction]:
    """
    Transactions that affect running balance / timeline totals.

    Reconciled rows are always visible — user-confirmed ledger lines must never disappear.

    ---------------------------------------------------------------------------
    PLAID INVARIANT (critical — do not invert this logic):
      Matched Plaid imports STAY VISIBLE. Hide the planned/manual twin instead.
      Never exclude imported_transaction from this queryset when source=PLAID.
    ---------------------------------------------------------------------------

    Hidden rows: (1) planned/manual leg of a TransactionMatch (import is canonical);
    (2) unreconciled Plaid rows marked IGNORED or DUPLICATE (re-sync dupes of a visible post).

    Matched imports are never hidden. DUPLICATE hides only *extra* Plaid rows — not the
    canonical matched import.
    """
    matched_planned_pks = TransactionMatch.objects.values("planned_transaction_id")
    matched_import_pks = TransactionMatch.objects.filter(
        imported_transaction__source=Transaction.Source.PLAID,
    ).values("imported_transaction_id")
    hide = Q(pk__in=Subquery(matched_planned_pks)) | (
        Q(reconciled=False)
        & Q(source=Transaction.Source.PLAID)
        & Q(
            import_match_status__in=[
                Transaction.ImportMatchStatus.IGNORED,
                Transaction.ImportMatchStatus.DUPLICATE,
            ]
        )
        & ~Q(pk__in=Subquery(matched_import_pks))
    )
    return qs.exclude(hide)


def ledger_visible_account_transactions_q(*, prefix: str = "transactions") -> Q:
    """
    Q filter for Account → Transaction relations (annotations, aggregates).

    Mirrors :func:`ledger_visible_transactions` exclusion rules.
    PLAID INVARIANT: same as ledger_visible_transactions — never hide matched imports.
    """
    matched_planned = TransactionMatch.objects.values("planned_transaction_id")
    matched_imports = TransactionMatch.objects.filter(
        imported_transaction__source=Transaction.Source.PLAID,
    ).values("imported_transaction_id")
    hide = Q(**{f"{prefix}__pk__in": Subquery(matched_planned)}) | (
        Q(**{f"{prefix}__reconciled": False})
        & Q(**{f"{prefix}__source": Transaction.Source.PLAID})
        & Q(
            **{
                f"{prefix}__import_match_status__in": [
                    Transaction.ImportMatchStatus.IGNORED,
                    Transaction.ImportMatchStatus.DUPLICATE,
                ]
            }
        )
        & ~Q(**{f"{prefix}__pk__in": Subquery(matched_imports)})
    )
    return ~hide


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
    if not _plaid_ids_compatible_for_match(imported, planned):
        return 0, {"reject": "plaid_id_mismatch"}
    if not _bank_reference_tokens_compatible(imported, planned):
        return 0, {"reject": "reference_token_mismatch"}
    score += 40
    parts["amount"] = 40

    ref_i = _bank_reference_tokens(imported)
    ref_p = _bank_reference_tokens(planned)
    if ref_i and ref_p and (ref_i & ref_p):
        score += 30
        parts["reference_token_match"] = 30

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

    merchant_pts = _merchant_token_overlap_score(imported, planned)
    score += merchant_pts
    if merchant_pts:
        parts["merchant_token"] = merchant_pts

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

    if score >= AUTO_MATCH_THRESHOLD and not _auto_link_description_compatible(imported, planned):
        parts["reject"] = "description_mismatch_for_auto_match"
        return SUGGEST_MATCH_THRESHOLD - 1, parts

    import_text = ni
    planned_labels = [np]
    if planned.source == Transaction.Source.RULE and planned.rule_id:
        from timeline.models import RecurringRule

        rule = (
            planned.rule
            if getattr(planned, "rule", None) is not None
            else RecurringRule.objects.filter(pk=planned.rule_id).first()
        )
        if rule and (rule.name or "").strip():
            planned_labels.append(normalize_description(rule.name))
            rn = normalize_description(rule.name)
            if rn and rn in ni:
                score += 28
                parts["rule_name_token"] = 28
            elif rn and ni and SequenceMatcher(None, rn, ni).ratio() >= 0.45:
                score += 22
                parts["rule_name_sim"] = 22

    import_families = _merchant_families(import_text)
    planned_families: set[str] = set()
    for label in planned_labels:
        planned_families.update(_merchant_families(label))
    if import_families and planned_families and import_families.isdisjoint(planned_families):
        return 0, {"reject": "merchant_family_mismatch"}

    if (
        _is_rule_backed_planned_row(planned)
        and imported.amount is not None
        and planned.amount is not None
        and imported.amount > 0
        and planned.amount > 0
        and abs(imported.amount - planned.amount) <= AMOUNT_TOLERANCE
    ):
        score += 22
        parts["rule_income_amount"] = 22

    max_ratio = max(ratios) if ratios else 0.0
    has_ref = bool(ref_i and ref_p and (ref_i & ref_p))
    has_transfer = bool(planned.transfer_group_id)
    has_rule_signal = bool(
        parts.get("rule_name_token")
        or parts.get("rule_name_sim")
        or parts.get("rule_income_amount")
    )
    if not has_transfer and not has_ref and not has_rule_signal:
        if max_ratio < 0.35 and merchant_pts < 8:
            return 0, {"reject": "payee_mismatch"}

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
            | Q(source__in=[Transaction.Source.ACTUAL, Transaction.Source.ONE_TIME])
        )
        .filter(Q(plaid_transaction_id__isnull=True) | Q(plaid_transaction_id=""))
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


def _unmatched_distinct_charge_slots(imported: Transaction) -> int:
    """
    Unmatched planned rows that should still receive their own import (e.g. four $20 donations).

    Excludes orphan ACTUAL rows with the same payee as the import when a transfer / reconciled row
    already represents this bank charge — those orphans are re-sync ghosts, not open slots.
    """
    if imported.amount is None:
        return 0
    count = 0
    for planned in _planned_candidate_base_qs(imported):
        if planned.amount is None:
            continue
        if abs(planned.amount - imported.amount) > AMOUNT_TOLERANCE:
            continue
        if (
            planned.transfer_group_id is None
            and not planned.reconciled
            and _plaid_imports_likely_same_bank_movement(imported, planned)
            and _find_confirmed_ledger_match_for_import(imported) is not None
        ):
            continue
        count += 1
    return count


def _find_confirmed_ledger_match_for_import(
    imported: Transaction,
    *,
    exclude_match_id: int | None = None,
) -> TransactionMatch | None:
    """
    Return an existing match that already represents this bank charge (transfer leg, reconciled row,
    or prior Plaid import with the same payee/amount).
    """
    if imported.amount is None:
        return None
    low = imported.date - timedelta(days=SAME_ACCOUNT_DATE_WINDOW_DAYS)
    high = imported.date + timedelta(days=SAME_ACCOUNT_DATE_WINDOW_DAYS)
    qs = (
        TransactionMatch.objects.filter(
            planned_transaction__account_id=imported.account_id,
            planned_transaction__date__gte=low,
            planned_transaction__date__lte=high,
            planned_transaction__amount=imported.amount,
        )
        .select_related("planned_transaction", "imported_transaction")
        .order_by("-planned_transaction__reconciled", "-planned_transaction__transfer_group_id")
    )
    if exclude_match_id is not None:
        qs = qs.exclude(pk=exclude_match_id)
    for match in qs:
        planned = match.planned_transaction
        peer = match.imported_transaction
        if peer.source != Transaction.Source.PLAID:
            continue
        if peer.pk == imported.pk:
            continue
        # Only compare against the prior Plaid bank row — not the planned/manual side, which may
        # have bank text copied from a wrong match (e.g. Exeter car payment merged onto Synchrony).
        if not _plaid_imports_likely_same_bank_movement(imported, peer):
            continue
        if _planned_match_allows_import_dedup(planned) or planned.reconciled:
            return match
    return None


def bank_movement_already_on_ledger(
    *,
    account_id: int,
    txn_date: date,
    amount: Decimal,
    payee: str = "",
    imported_description: str = "",
) -> bool:
    """Plaid imports are always kept — never pre-mark duplicate at insert time."""
    return False


def _planned_match_allows_import_dedup(planned: Transaction) -> bool:
    """
    When a planned row is already matched, hide a later Plaid row with the same payee/amount when:

    - the planned row is **reconciled** (bank-confirmed; a second Plaid id is a re-sync duplicate), or
    - the match is a transfer / rule row (single bank post expected).

    Unreconciled manual rows with the same amount still accept additional imports (e.g. four $20
    donations on one day) until the user reconciles.
    """
    if planned.reconciled:
        return True
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
    After a transfer/rule match, delete sibling Plaid re-sync rows (same account/amount/window).

    Keeps the matched import; permanently removes extras — not hide/unhide churn.
    """
    if anchor_import.source != Transaction.Source.PLAID:
        return 0
    match = (
        TransactionMatch.objects.filter(imported_transaction=anchor_import)
        .select_related("planned_transaction")
        .first()
    )
    if match is None:
        return 0
    planned = match.planned_transaction
    if not _planned_match_allows_import_dedup(planned):
        return 0
    return _delete_redundant_plaid_siblings(anchor_import)


def _delete_redundant_plaid_siblings(anchor: Transaction) -> int:
    """Delete unmatched Plaid siblings of ``anchor`` (same amount, ±date window)."""
    from transactions.services.posting import _delete_transaction_cascade

    removed = 0
    for sib in _plaid_sibling_imports_qs(anchor).iterator(chunk_size=50):
        if sib.reconciled:
            continue
        if TransactionMatch.objects.filter(imported_transaction_id=sib.pk).exists():
            continue
        TransactionMatch.objects.filter(imported_transaction_id=sib.pk).delete()
        MatchSuggestion.objects.filter(imported_transaction_id=sib.pk).delete()
        _delete_transaction_cascade(sib)
        removed += 1
    return removed


def delete_redundant_plaid_imports_for_accounts(
    account_ids: Iterable[int],
    *,
    dry_run: bool = False,
) -> int:
    """
    Permanently delete Plaid rows that duplicate an already-visible ledger post.

    Use after bad auto-restore resurrected re-sync duplicates (e.g. extra Capital One PMT rows).
    Never deletes matched imports or reconciled rows.
    """
    ids = list({int(a) for a in account_ids if a is not None})
    if not ids:
        return 0
    from transactions.services.posting import _delete_transaction_cascade

    removed = 0
    qs = (
        Transaction.objects.filter(
            account_id__in=ids,
            source=Transaction.Source.PLAID,
        )
        .exclude(plaid_transaction_id__isnull=True)
        .exclude(plaid_transaction_id="")
        .exclude(import_match_status=Transaction.ImportMatchStatus.IGNORED)
    )
    for imp in qs.select_related("account").iterator(chunk_size=200):
        if imp.reconciled:
            continue
        if TransactionMatch.objects.filter(imported_transaction_id=imp.pk).exists():
            continue
        if not duplicate_plaid_import_has_visible_ledger_twin(imp):
            continue
        if dry_run:
            removed += 1
            continue
        TransactionMatch.objects.filter(imported_transaction_id=imp.pk).delete()
        MatchSuggestion.objects.filter(imported_transaction_id=imp.pk).delete()
        _delete_transaction_cascade(imp)
        removed += 1
    if removed and not dry_run:
        from accounts.models import Account
        from common.services.cache import invalidate_financial_cache_for_household
        from core.timeline_cache import bump_timeline_cache_for_household

        for hid in Account.objects.filter(pk__in=ids).values_list("household_id", flat=True).distinct():
            if hid is not None:
                bump_timeline_cache_for_household(hid)
                invalidate_financial_cache_for_household(hid)
    return removed


def try_mark_plaid_import_as_duplicate_of_existing_match(imported: Transaction) -> bool:
    """Disabled — fuzzy Plaid-vs-Plaid dedupe is not allowed."""
    return imported.import_match_status == Transaction.ImportMatchStatus.DUPLICATE


def try_mark_resync_import_duplicate(imported: Transaction) -> bool:
    """Disabled — re-sync dedupe only happens via exact plaid_transaction_id at insert time."""
    return imported.import_match_status == Transaction.ImportMatchStatus.DUPLICATE


def reconcile_orphan_matched_plaid_imports(*, account_id: int | None = None) -> int:
    """Repair rows marked MATCHED without a TransactionMatch (stale metadata)."""
    qs = Transaction.objects.filter(
        source=Transaction.Source.PLAID,
        import_match_status=Transaction.ImportMatchStatus.MATCHED,
    ).exclude(plaid_transaction_id__isnull=True).exclude(plaid_transaction_id="")
    if account_id is not None:
        qs = qs.filter(account_id=account_id)
    fixed = 0
    for imp in qs:
        if TransactionMatch.objects.filter(imported_transaction_id=imp.pk).exists():
            continue
        imp.import_match_status = Transaction.ImportMatchStatus.UNMATCHED
        imp.save(update_fields=["import_match_status", "updated_at"])
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


def _best_manual_twin_for_import(imported: Transaction) -> Optional[Transaction]:
    """Find the hand-entered row that represents the same bank charge as an import (or materialized duplicate)."""
    if imported.amount is None:
        return None
    low = imported.date - timedelta(days=SAME_ACCOUNT_DATE_WINDOW_DAYS)
    high = imported.date + timedelta(days=SAME_ACCOUNT_DATE_WINDOW_DAYS)
    candidates = (
        Transaction.objects.filter(
            account_id=imported.account_id,
            date__gte=low,
            date__lte=high,
            amount=imported.amount,
            source__in=[Transaction.Source.ACTUAL, Transaction.Source.ONE_TIME],
            rule__isnull=True,
            plaid_transaction_id__isnull=True,
            scenario__isnull=True,
        )
        .exclude(pk=imported.pk)
        .filter(transfer_out__isnull=True, transfer_in__isnull=True, transfer_group__isnull=True)
        .exclude(Exists(TransactionMatch.objects.filter(planned_transaction_id=OuterRef("pk"))))
    )
    best: Optional[Transaction] = None
    best_score = -1
    for manual in candidates:
        sc, _parts = score_candidate(imported, manual)
        if sc > best_score:
            best_score = sc
            best = manual
    if best is None or best_score < AUTO_MATCH_THRESHOLD:
        return None
    return best


def collapse_materialized_actual_duplicates(*, account_id: int | None = None) -> int:
    """
    Previously merged materialized Plaid rows onto manual twins — disabled.

    Each Plaid bank post keeps its own row; same amount/date with different descriptions
    (e.g. three Cash App sends) must never be deleted or merged.
    """
    return 0


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
    if bank_desc:
        stale = (planned.imported_description or "").strip()
        if not stale or _merchant_families(stale) != _merchant_families(bank_desc):
            planned.imported_description = bank_desc[:2000]
            update_fields.append("imported_description")
    np = normalize_description(imported.payee or bank_desc or "")[:512]
    if np and planned.normalized_payee != np:
        planned.normalized_payee = np
        update_fields.append("normalized_payee")
    if planned.source in (Transaction.Source.ACTUAL, Transaction.Source.ONE_TIME):
        bank_payee = (bank_desc or imported.payee or "").strip()
        if bank_payee and planned.payee != bank_payee[:255]:
            planned.payee = bank_payee[:255]
            update_fields.append("payee")
    pid = (imported.plaid_transaction_id or "").strip()
    # Plaid import rows keep the unique plaid_transaction_id; only copy when the import side is
    # being absorbed (e.g. materialized ACTUAL duplicate deleted after collapse).
    if (
        pid
        and not (planned.plaid_transaction_id or "").strip()
        and imported.source != Transaction.Source.PLAID
    ):
        planned.plaid_transaction_id = pid[:255]
        update_fields.append("plaid_transaction_id")
    return update_fields


def _should_absorb_planned_into_import(planned: Transaction, imported: Transaction) -> bool:
    """
    True when ``planned`` is a shadow of the same bank post as ``imported`` (including transfer outflows).

    Rule forecast rows stay matched (hidden); ACTUAL/materialized duplicates are deleted.
    """
    if imported.source != Transaction.Source.PLAID:
        return False
    if planned.source not in (Transaction.Source.ACTUAL, Transaction.Source.ONE_TIME):
        return False
    if planned.rule_id or planned.scenario_id:
        return False
    return True


def _rewire_transfer_from_leg(*, old_from: Transaction, new_from: Transaction) -> None:
    transfer = Transfer.objects.filter(from_transaction_id=old_from.pk).first()
    if transfer is None:
        return
    transfer.from_transaction = new_from
    transfer.save(update_fields=["from_transaction_id"])


def _absorb_planned_duplicate_into_import(
    planned: Transaction,
    imported: Transaction,
    match: TransactionMatch,
) -> None:
    """Merge metadata onto the Plaid row, rewire transfer legs, delete the ACTUAL shadow and match."""
    from transactions.services.posting import _delete_transaction_cascade

    update_fields: list[str] = []
    if planned.category_id and not imported.category_id:
        imported.category_id = planned.category_id
        update_fields.append("category_id")
    if planned.tags and (not imported.tags or imported.tags == []):
        imported.tags = list(planned.tags) if isinstance(planned.tags, list) else planned.tags
        update_fields.append("tags")
    if (planned.memo or "").strip() and not (imported.memo or "").strip():
        imported.memo = planned.memo
        update_fields.append("memo")
    if planned.transfer_group_id and not imported.transfer_group_id:
        imported.transfer_group_id = planned.transfer_group_id
        update_fields.append("transfer_group_id")
    if planned.reconciled:
        imported.reconciled = True
        imported.cleared = True
        imported.status = Transaction.Status.RECONCILED
        update_fields.extend(["reconciled", "cleared", "status"])
    imported.import_match_status = Transaction.ImportMatchStatus.NONE
    update_fields.append("import_match_status")
    if update_fields:
        imported.save(update_fields=[*update_fields, "updated_at"])
    _rewire_transfer_from_leg(old_from=planned, new_from=imported)
    if imported.transfer_group_id:
        tg = TransferGroup.objects.filter(pk=imported.transfer_group_id).first()
        if tg:
            _refresh_transfer_group_status(tg)
    match.delete()
    _delete_transaction_cascade(planned)


def collapse_matched_actual_planned_duplicates(*, account_id: int | None = None) -> int:
    """
    One bank post must be one row. Remove ACTUAL shadows already linked to a Plaid import match.
    """
    qs = TransactionMatch.objects.filter(
        imported_transaction__source=Transaction.Source.PLAID,
        planned_transaction__source__in=[Transaction.Source.ACTUAL, Transaction.Source.ONE_TIME],
        planned_transaction__rule__isnull=True,
    ).select_related("planned_transaction", "imported_transaction")
    if account_id is not None:
        qs = qs.filter(planned_transaction__account_id=account_id)
    collapsed = 0
    for match in qs.iterator(chunk_size=200):
        planned = match.planned_transaction
        imported = match.imported_transaction
        if not _should_absorb_planned_into_import(planned, imported):
            continue
        _absorb_planned_duplicate_into_import(planned, imported, match)
        collapsed += 1
    if collapsed and account_id is not None:
        from accounts.models import Account
        from common.services.cache import invalidate_financial_cache_for_household
        from core.timeline_cache import bump_timeline_cache_for_household

        hid = Account.objects.filter(pk=account_id).values_list("household_id", flat=True).first()
        if hid is not None:
            bump_timeline_cache_for_household(hid)
            invalidate_financial_cache_for_household(hid)
    return collapsed


def _create_match_record(
    *,
    planned: Transaction,
    imported: Transaction,
    match_type: str,
    score: int,
    confidence: str,
) -> TransactionMatch:
    """
    Persist match and update row metadata.

    PLAID INVARIANT: after match, ledger_visible_transactions shows the Plaid import and
    hides this planned row — the bank post is what the user must see.
    """
    if imported.source != Transaction.Source.PLAID:
        raise ValueError("Import side of a match must be a Plaid row.")
    if planned.source == Transaction.Source.PLAID:
        raise ValueError("Planned side of a match cannot be a Plaid row.")
    if confidence != TransactionMatch.Confidence.MANUAL:
        sc, parts = score_candidate(imported, planned)
        if sc < AUTO_MATCH_THRESHOLD or parts.get("reject"):
            raise ValueError("Cannot auto-match: account/amount/date/payee do not align.")
        if not _auto_link_description_compatible(imported, planned):
            raise ValueError("Cannot auto-match: import payee does not describe this row.")
        if not _plaid_ids_compatible_for_match(imported, planned):
            raise ValueError("Cannot auto-match: import belongs to a different Plaid transaction id.")
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
        if _should_absorb_planned_into_import(planned, imported):
            _absorb_planned_duplicate_into_import(planned, imported, tm)
            mark_redundant_plaid_imports_after_match(imported)
            return tm
        purge_shadow_rule_occurrences_after_match(planned)
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
    if planned.source == Transaction.Source.RULE:
        pass
    elif planned.source in (Transaction.Source.ACTUAL, Transaction.Source.ONE_TIME):
        if planned.rule_id is None:
            pass  # manual / one-time
        elif not _is_rule_backed_planned_row(planned):
            return False
    else:
        return False
    if (planned.plaid_transaction_id or "").strip():
        return False
    if planned.transfer_group_id:
        return True
    # Mirror Q(transfer_out__isnull=True) & Q(transfer_in__isnull=True) — no Transfer row wiring.
    if Transfer.objects.filter(from_transaction_id=planned.pk).exists():
        return False
    if Transfer.objects.filter(to_transaction_id=planned.pk).exists():
        return False
    return True


def _unmatched_plaid_imports_for_planned(planned: Transaction) -> QuerySet[Transaction]:
    low = planned.date - timedelta(days=SAME_ACCOUNT_DATE_WINDOW_DAYS)
    high = planned.date + timedelta(days=SAME_ACCOUNT_DATE_WINDOW_DAYS)
    return (
        Transaction.objects.filter(
            account_id=planned.account_id,
            date__gte=low,
            date__lte=high,
            source=Transaction.Source.PLAID,
            scenario__isnull=True,
        )
        .exclude(plaid_transaction_id__isnull=True)
        .exclude(plaid_transaction_id="")
        .filter(_pending_plaid_import_status_q())
        .exclude(Exists(TransactionMatch.objects.filter(imported_transaction_id=OuterRef("pk"))))
    )


def _best_match_for_planned(planned: Transaction) -> tuple[Optional[Transaction], int]:
    best_imp: Optional[Transaction] = None
    best_score = -1
    for imp in _unmatched_plaid_imports_for_planned(planned).select_related("account"):
        if imp.amount is None or planned.amount is None:
            continue
        if abs(imp.amount - planned.amount) > AMOUNT_TOLERANCE:
            continue
        if not _plaid_ids_compatible_for_match(imp, planned):
            continue
        sc, _parts = score_candidate(imp, planned)
        if sc > best_score:
            best_score = sc
            best_imp = imp
    return best_imp, best_score


def find_import_candidates_for_planned(
    planned: Transaction,
) -> list[tuple[Transaction, int, dict[str, Any]]]:
    """Return sorted unmatched Plaid imports that could fulfill this planned row."""
    if not _planned_row_eligible_as_import_match_candidate(planned):
        return []
    out: list[tuple[Transaction, int, dict[str, Any]]] = []
    for imp in _unmatched_plaid_imports_for_planned(planned).select_related("account"):
        if imp.amount is None or planned.amount is None:
            continue
        if abs(imp.amount - planned.amount) > AMOUNT_TOLERANCE:
            continue
        if not _plaid_ids_compatible_for_match(imp, planned):
            continue
        sc, parts = score_candidate(imp, planned)
        if sc <= 0:
            continue
        out.append((imp, sc, parts))
    out.sort(key=lambda x: (-x[1], x[0].pk))
    return out


def try_match_rule_to_pending_imports(planned: Transaction) -> Optional[TransactionMatch]:
    """
    Link an existing unmatched Plaid row to a rule transaction when the rule row was created or
    surfaced after Plaid sync (match_imported_transaction only runs on import).

    Keeps the bank import visible in the ledger and hides the forecast-side twin from balances —
    same as a successful match_imported_transaction.
    """
    if not _is_rule_backed_planned_row(planned):
        return None
    if not _planned_row_eligible_as_import_match_candidate(planned):
        return None
    if TransactionMatch.objects.filter(planned_transaction_id=planned.pk).exists():
        return None

    best_imp, best_score = _best_match_for_planned(planned)
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


def try_match_pending_imports_to_manual(planned: Transaction) -> Optional[TransactionMatch]:
    """
    Link a manual ACTUAL row to an existing unmatched Plaid import when the user entered the
    charge before/after sync without an explicit match (mirror of try_match_rule_to_pending_imports).
    """
    if planned.source not in (Transaction.Source.ACTUAL, Transaction.Source.ONE_TIME):
        return None
    if planned.rule_id:
        return None
    if not _planned_row_eligible_as_import_match_candidate(planned):
        return None
    if TransactionMatch.objects.filter(planned_transaction_id=planned.pk).exists():
        return None

    best_imp, best_score = _best_match_for_planned(planned)
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


def heal_unmatched_rule_and_import_links(txns: Iterable[Transaction]) -> int:
    """
    Link existing rule rows to pending Plaid imports (and vice versa).

    Used when both sides already exist in the DB — e.g. payroll imported on the 18th and the
    automation occurrence on the 19th — without requiring a fresh Plaid sync.
    """
    linked = 0
    seen_planned: set[int] = set()
    seen_imports: set[int] = set()
    for txn in txns:
        if txn.source == Transaction.Source.RULE and txn.rule_id and txn.pk not in seen_planned:
            seen_planned.add(txn.pk)
            if TransactionMatch.objects.filter(planned_transaction_id=txn.pk).exists():
                continue
            if try_match_rule_to_pending_imports(txn):
                linked += 1
        elif (
            txn.source == Transaction.Source.PLAID
            and txn.pk not in seen_imports
            and txn.import_match_status in PENDING_PLAID_IMPORT_STATUSES
            and not TransactionMatch.objects.filter(imported_transaction_id=txn.pk).exists()
        ):
            seen_imports.add(txn.pk)
            if match_imported_transaction(txn):
                linked += 1
    return linked


def accounts_have_suppressed_plaid_imports(account_ids: Iterable[int]) -> bool:
    """True when Plaid rows are still marked DUPLICATE/IGNORED and hidden from the ledger."""
    ids = list(account_ids)
    if not ids:
        return False
    return (
        Transaction.objects.filter(
            account_id__in=ids,
            source=Transaction.Source.PLAID,
            import_match_status__in=[
                Transaction.ImportMatchStatus.DUPLICATE,
                Transaction.ImportMatchStatus.IGNORED,
            ],
        )
        .exclude(plaid_transaction_id__isnull=True)
        .exclude(plaid_transaction_id="")
        .exists()
    )


def restore_suppressed_plaid_imports_for_accounts(account_ids: Iterable[int]) -> int:
    """
    Unhide Plaid rows wrongly marked DUPLICATE/IGNORED (auto-repair on timeline/ledger read).

    Safe to call repeatedly — only touches suppressed Plaid imports, never deletes rows.
    """
    ids = list({int(a) for a in account_ids if a is not None})
    if not ids:
        return 0
    restored = 0
    for aid in ids:
        restored += repair_wrongly_suppressed_plaid_ledger(account_id=aid)["restored"]
    if restored:
        from accounts.models import Account
        from common.services.cache import invalidate_financial_cache_for_household
        from core.timeline_cache import bump_timeline_cache_for_household

        for hid in Account.objects.filter(pk__in=ids).values_list("household_id", flat=True).distinct():
            if hid is not None:
                bump_timeline_cache_for_household(hid)
                invalidate_financial_cache_for_household(hid)
    return restored


def accounts_have_pending_match_work(account_ids: Iterable[int]) -> bool:
    """Cheap exists() probe — skip full rematch on timeline reads when nothing is pending."""
    ids = list(account_ids)
    if not ids:
        return False
    if (
        Transaction.objects.filter(
            account_id__in=ids,
            source=Transaction.Source.PLAID,
            scenario__isnull=True,
        )
        .filter(_pending_plaid_import_status_q())
        .exclude(plaid_transaction_id__isnull=True)
        .exclude(plaid_transaction_id="")
        .exclude(Exists(TransactionMatch.objects.filter(imported_transaction_id=OuterRef("pk"))))
        .exists()
    ):
        return True
    return (
        Transaction.objects.filter(
            account_id__in=ids,
            rule_id__isnull=False,
            scenario__isnull=True,
        )
        .filter(
            Q(source=Transaction.Source.RULE)
            | Q(source__in=[Transaction.Source.ACTUAL, Transaction.Source.ONE_TIME])
        )
        .exclude(Exists(TransactionMatch.objects.filter(planned_transaction_id=OuterRef("pk"))))
        .exists()
    )


def heal_actual_plaid_rows_to_rule_matches(*, account_id: int | None = None) -> int:
    """
    Link ACTUAL rows that still carry a plaid_transaction_id to their rule occurrence twin.

    These are usually imports materialized as ACTUAL before rule matching ran; they duplicate
    forecast rows in the timeline until matched.
    """
    qs = (
        Transaction.objects.filter(
            source=Transaction.Source.ACTUAL,
            rule__isnull=True,
            scenario__isnull=True,
        )
        .exclude(plaid_transaction_id__isnull=True)
        .exclude(plaid_transaction_id="")
        .exclude(Exists(TransactionMatch.objects.filter(imported_transaction_id=OuterRef("pk"))))
        .exclude(Exists(TransactionMatch.objects.filter(planned_transaction_id=OuterRef("pk"))))
    )
    if account_id is not None:
        qs = qs.filter(account_id=account_id)
    healed = 0
    for actual in qs.order_by("date", "id").iterator(chunk_size=200):
        rule_row = (
            Transaction.objects.filter(
                account_id=actual.account_id,
                rule_id__isnull=False,
                source=Transaction.Source.RULE,
                date__gte=actual.date - timedelta(days=SAME_ACCOUNT_DATE_WINDOW_DAYS),
                date__lte=actual.date + timedelta(days=SAME_ACCOUNT_DATE_WINDOW_DAYS),
            )
            .exclude(Exists(TransactionMatch.objects.filter(planned_transaction_id=OuterRef("pk"))))
            .order_by("date", "id")
            .first()
        )
        if rule_row is None or actual.amount is None or rule_row.amount is None:
            continue
        if not _amounts_equal(actual.amount, rule_row.amount):
            continue
        actual.source = Transaction.Source.PLAID
        actual.import_match_status = Transaction.ImportMatchStatus.UNMATCHED
        actual.save(update_fields=["source", "import_match_status", "updated_at"])
        if match_imported_transaction(actual):
            healed += 1
    return healed


def rematch_unmatched_for_accounts(account_ids: Iterable[int]) -> int:
    """Retry pairing all unmatched rule rows and Plaid imports on the given accounts."""
    ids = list(account_ids)
    if not ids:
        return 0
    linked = 0
    for aid in ids:
        linked += heal_actual_plaid_rows_to_rule_matches(account_id=aid)
    for planned in (
        Transaction.objects.filter(
            account_id__in=ids,
            rule_id__isnull=False,
            scenario__isnull=True,
        )
        .filter(
            Q(source=Transaction.Source.RULE)
            | Q(source__in=[Transaction.Source.ACTUAL, Transaction.Source.ONE_TIME])
        )
        .exclude(Exists(TransactionMatch.objects.filter(planned_transaction_id=OuterRef("pk"))))
        .order_by("date", "id")
        .iterator(chunk_size=200)
    ):
        try:
            if try_match_rule_to_pending_imports(planned):
                linked += 1
        except Exception:
            logger.exception(
                "try_match_rule_to_pending_imports failed during rematch for transaction pk=%s",
                planned.pk,
            )
    for imp in (
        Transaction.objects.filter(
            account_id__in=ids,
            source=Transaction.Source.PLAID,
            scenario__isnull=True,
        )
        .filter(_pending_plaid_import_status_q())
        .exclude(plaid_transaction_id__isnull=True)
        .exclude(plaid_transaction_id="")
        .exclude(Exists(TransactionMatch.objects.filter(imported_transaction_id=OuterRef("pk"))))
        .order_by("date", "id")
        .iterator(chunk_size=200)
    ):
        try:
            if match_imported_transaction(imp):
                linked += 1
        except Exception:
            logger.exception(
                "match_imported_transaction failed during rematch for transaction pk=%s",
                imp.pk,
            )
    repair_shadow_rule_occurrences_for_accounts(ids)
    return linked


def rematch_unmatched_manual_actuals(*, account_id: int | None = None) -> int:
    """Retry linking manual rows to pending Plaid imports (e.g. after user hand-enters a charge)."""
    qs = (
        Transaction.objects.filter(
            source__in=[Transaction.Source.ACTUAL, Transaction.Source.ONE_TIME],
            rule__isnull=True,
            scenario__isnull=True,
        )
        .filter(transfer_out__isnull=True, transfer_in__isnull=True, transfer_group__isnull=True)
        .exclude(Exists(TransactionMatch.objects.filter(planned_transaction_id=OuterRef("pk"))))
    )
    if account_id is not None:
        qs = qs.filter(account_id=account_id)
    matched = 0
    for planned in qs.order_by("date", "id").iterator(chunk_size=200):
        if try_match_pending_imports_to_manual(planned):
            matched += 1
    return matched


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
        return existing

    if imported.import_match_status == Transaction.ImportMatchStatus.DUPLICATE:
        return None
    if imported.reconciled:
        return None

    MatchSuggestion.objects.filter(imported_transaction=imported).delete()

    ranked = find_candidate_matches(imported, allow_orphan_repair=not dry_run)
    if not ranked:
        if not dry_run:
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


def repair_cross_merchant_wrong_matches(*, account_id: int | None = None) -> int:
    """
    Undo auto-matches that paired different billers because the amount matched
    (e.g. Exeter car loan import linked to a Synchrony credit-card row).
    """
    qs = TransactionMatch.objects.select_related(
        "planned_transaction",
        "imported_transaction",
        "planned_transaction__rule",
    ).filter(imported_transaction__source=Transaction.Source.PLAID)
    if account_id is not None:
        qs = qs.filter(planned_transaction__account_id=account_id)
    repaired = 0
    for match in qs.iterator(chunk_size=200):
        imp = match.imported_transaction
        planned = match.planned_transaction
        import_text = (imp.imported_description or imp.payee or imp.memo or "").strip()
        planned_labels = [(planned.payee or "").strip()]
        if planned.source == Transaction.Source.RULE and planned.rule_id:
            rule = getattr(planned, "rule", None)
            if rule and (rule.name or "").strip():
                planned_labels.append(rule.name.strip())
        import_families = _merchant_families(import_text)
        planned_families: set[str] = set()
        for label in planned_labels:
            planned_families.update(_merchant_families(label))
        if not import_families or not planned_families or not import_families.isdisjoint(planned_families):
            continue
        unmatch_transaction(match)
        repaired += 1
    return repaired


def repair_mismatched_import_links(*, account_id: int | None = None) -> int:
    """Unlink Plaid imports auto-matched to the wrong row (e.g. Andrew Cash App → Elijah row)."""
    qs = TransactionMatch.objects.select_related(
        "planned_transaction",
        "imported_transaction",
        "planned_transaction__rule",
    ).filter(imported_transaction__source=Transaction.Source.PLAID)
    if account_id is not None:
        qs = qs.filter(planned_transaction__account_id=account_id)
    repaired = 0
    for match in qs.iterator(chunk_size=200):
        imp = match.imported_transaction
        planned = match.planned_transaction
        if _auto_link_description_compatible(imp, planned) and _plaid_ids_compatible_for_match(imp, planned):
            continue
        unmatch_transaction(match)
        repaired += 1
    return repaired


def repair_stale_planned_bank_text(*, account_id: int | None = None) -> int:
    """Fix planned rows whose bank text came from a prior wrong match (Exeter text on Synchrony row)."""
    qs = TransactionMatch.objects.select_related("planned_transaction", "imported_transaction").filter(
        imported_transaction__source=Transaction.Source.PLAID,
    )
    if account_id is not None:
        qs = qs.filter(planned_transaction__account_id=account_id)
    fixed = 0
    for match in qs.iterator(chunk_size=200):
        planned = match.planned_transaction
        imp = match.imported_transaction
        bank_desc = (imp.imported_description or imp.memo or imp.payee or "").strip()
        if not bank_desc:
            continue
        stale = (planned.imported_description or "").strip()
        if not stale:
            continue
        if _merchant_families(stale) == _merchant_families(bank_desc):
            continue
        if normalize_description(stale) == normalize_description(bank_desc):
            continue
        fields = apply_bank_fields_to_planned_from_import(planned, imp)
        if fields:
            planned.save(update_fields=list(dict.fromkeys([*fields, "updated_at"])))
            fixed += 1
    return fixed


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


def duplicate_plaid_import_has_visible_ledger_twin(imp: Transaction) -> bool:
    """
    True when another visible ledger row already represents this bank post.

    Materialized ACTUAL twins often share payee text but not plaid_transaction_id.
    """
    pid = (imp.plaid_transaction_id or "").strip()
    if pid and ledger_visible_transactions(
        Transaction.objects.filter(plaid_transaction_id=pid).exclude(pk=imp.pk)
    ).exists():
        return True
    label = (imp.payee or imp.imported_description or "").strip()
    if not label:
        return False
    for twin in ledger_visible_transactions(
        Transaction.objects.filter(
            account_id=imp.account_id,
            date=imp.date,
            amount=imp.amount,
        ).exclude(pk=imp.pk)
    ):
        twin_label = (twin.payee or twin.imported_description or "").strip()
        if twin_label == label:
            return True
    return False


def should_restore_duplicate_plaid_import(imp: Transaction) -> bool:
    """Restore wrongly hidden Plaid imports; keep true re-sync duplicates that have a visible twin."""
    if imp.reconciled:
        return True
    if imp.reconciliation_entries.filter(
        session__status=Reconciliation.Status.COMPLETED,
        session__is_active=True,
    ).exists():
        return True
    return not duplicate_plaid_import_has_visible_ledger_twin(imp)


def ensure_reconciled_plaid_ledger_visibility(*, account_id: int | None = None) -> int:
    """Clear DUPLICATE/IGNORED on Plaid rows that must stay in the ledger."""
    return restore_all_duplicate_plaid_imports(account_id=account_id)


def mark_import_duplicate(txn: Transaction) -> None:
    if txn.source != Transaction.Source.PLAID:
        raise ValueError("Only imported transactions can be marked duplicate.")
    if txn.reconciled:
        raise ValueError("Cannot mark a reconciled transaction as duplicate.")
    txn.import_match_status = Transaction.ImportMatchStatus.DUPLICATE
    txn.save(update_fields=["import_match_status", "updated_at"])


def repair_wrongly_suppressed_plaid_ledger(*, account_id: int | None = None) -> dict[str, int]:
    """
    Undo Plaid duplicate-suppression damage: restore hidden imports, drop orphan ACTUAL twins,
    and re-sync reconciled flags from completed reconciliation entries.
    """
    from transactions.models import ReconciliationEntry

    hidden_qs = Transaction.objects.filter(
        source=Transaction.Source.PLAID,
        import_match_status__in=[
            Transaction.ImportMatchStatus.DUPLICATE,
            Transaction.ImportMatchStatus.IGNORED,
        ],
    ).exclude(plaid_transaction_id__isnull=True).exclude(plaid_transaction_id="")
    if account_id is not None:
        hidden_qs = hidden_qs.filter(account_id=account_id)

    restored = 0
    for imp in hidden_qs.select_related("account").iterator(chunk_size=200):
        if imp.import_match_status == Transaction.ImportMatchStatus.IGNORED:
            if not should_restore_duplicate_plaid_import(imp):
                continue
        elif imp.import_match_status == Transaction.ImportMatchStatus.DUPLICATE:
            if not should_restore_duplicate_plaid_import(imp):
                continue
        imp.import_match_status = Transaction.ImportMatchStatus.UNMATCHED
        imp.save(update_fields=["import_match_status", "updated_at"])
        restored += 1

    orphans_removed = 0
    plaid_qs = Transaction.objects.filter(source=Transaction.Source.PLAID).exclude(
        import_match_status__in=[
            Transaction.ImportMatchStatus.DUPLICATE,
            Transaction.ImportMatchStatus.IGNORED,
        ]
    )
    if account_id is not None:
        plaid_qs = plaid_qs.filter(account_id=account_id)
    for imp in plaid_qs.iterator(chunk_size=200):
        label = (imp.payee or imp.imported_description or "").strip()
        if not label:
            continue
        orphan_actuals = Transaction.objects.filter(
            account_id=imp.account_id,
            date=imp.date,
            amount=imp.amount,
            source=Transaction.Source.ACTUAL,
            reconciled=False,
            rule__isnull=True,
            scenario__isnull=True,
        ).exclude(pk=imp.pk)
        orphan_actuals = orphan_actuals.filter(
            Q(payee=label) | Q(imported_description=label)
        ).exclude(
            reconciliation_entries__session__status=Reconciliation.Status.COMPLETED,
        )
        for orphan in orphan_actuals:
            if TransactionMatch.objects.filter(planned_transaction_id=orphan.pk).exists():
                continue
            orphan.delete()
            orphans_removed += 1

    flags_fixed = 0
    entry_qs = ReconciliationEntry.objects.filter(
        session__status=Reconciliation.Status.COMPLETED,
        transaction__reconciled=False,
    ).select_related("transaction")
    if account_id is not None:
        entry_qs = entry_qs.filter(transaction__account_id=account_id)
    touched: set[int] = set()
    for entry in entry_qs.iterator(chunk_size=200):
        touched.add(entry.transaction_id)
    for pk in touched:
        txn = Transaction.objects.filter(pk=pk).first()
        if txn is None or txn.reconciled:
            continue
        txn.reconciled = True
        txn.cleared = True
        txn.status = Transaction.Status.RECONCILED
        txn.save(update_fields=["reconciled", "cleared", "status", "updated_at"])
        flags_fixed += 1

    dup_actuals_removed = 0
    rec_actuals = Transaction.objects.filter(source=Transaction.Source.ACTUAL, reconciled=True)
    if account_id is not None:
        rec_actuals = rec_actuals.filter(account_id=account_id)
    for rec in rec_actuals.only("pk", "account_id", "date", "amount", "payee"):
        label = (rec.payee or "").strip()
        if not label:
            continue
        dupes = Transaction.objects.filter(
            account_id=rec.account_id,
            date=rec.date,
            amount=rec.amount,
            source=Transaction.Source.ACTUAL,
            reconciled=False,
            payee=label,
        ).exclude(pk=rec.pk)
        dup_actuals_removed += dupes.count()
        dupes.delete()

    return {
        "restored": restored,
        "orphans_removed": orphans_removed,
        "reconciled_flags_fixed": flags_fixed,
        "duplicate_actuals_removed": dup_actuals_removed,
    }


def restore_all_duplicate_plaid_imports(*, account_id: int | None = None) -> int:
    """Unhide Plaid rows wrongly marked DUPLICATE (including canonical imports on locked dates)."""
    return repair_wrongly_suppressed_plaid_ledger(account_id=account_id)["restored"]


def release_excess_duplicate_plaid_imports(*, account_id: int | None = None) -> int:
    """Delete Plaid re-sync duplicates that already have a visible ledger twin."""
    if account_id is None:
        from accounts.models import Account

        ids = list(Account.objects.values_list("pk", flat=True))
        return delete_redundant_plaid_imports_for_accounts(ids)
    return delete_redundant_plaid_imports_for_accounts([account_id])


def propagate_reconciled_status_to_match_legs(*, account_id: int | None = None) -> int:
    """When one leg of a bank match is reconciled, mark the paired leg reconciled too."""
    match_qs = TransactionMatch.objects.filter(
        Q(planned_transaction__reconciled=True) | Q(imported_transaction__reconciled=True)
    )
    if account_id is not None:
        match_qs = match_qs.filter(planned_transaction__account_id=account_id)

    fixed = 0
    now = timezone.now()
    for match in match_qs.select_related("planned_transaction", "imported_transaction"):
        legs = [match.planned_transaction, match.imported_transaction]
        reconciled_leg = next((t for t in legs if t is not None and t.reconciled), None)
        if reconciled_leg is None:
            continue
        for txn in legs:
            if txn is None or txn.reconciled:
                continue
            txn.reconciled = True
            txn.cleared = True
            txn.status = Transaction.Status.RECONCILED
            if reconciled_leg.reconciliation_id and not txn.reconciliation_id:
                txn.reconciliation_id = reconciled_leg.reconciliation_id
            if not txn.reconciled_at:
                txn.reconciled_at = now
            txn.save(
                update_fields=[
                    "reconciled",
                    "cleared",
                    "status",
                    "reconciliation",
                    "reconciled_at",
                    "updated_at",
                ]
            )
            fixed += 1
    return fixed


def suppress_duplicate_plaid_imports_for_reconciled_transactions(
    *, account_id: int | None = None
) -> int:
    """
    Hide UNMATCHED Plaid imports when an already-reconciled ledger twin exists.

    Stops re-synced bank rows from re-entering the ledger and double-counting balances.
    """
    plaid_qs = Transaction.objects.filter(
        source=Transaction.Source.PLAID,
        import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        reconciled=False,
    ).exclude(plaid_transaction_id__isnull=True).exclude(plaid_transaction_id="")
    if account_id is not None:
        plaid_qs = plaid_qs.filter(account_id=account_id)

    suppressed = 0
    for imp in plaid_qs.select_related("account").iterator(chunk_size=200):
        label = (imp.payee or imp.imported_description or "").strip()
        twin_qs = Transaction.objects.filter(
            account_id=imp.account_id,
            reconciled=True,
            date=imp.date,
            amount=imp.amount,
        ).exclude(pk=imp.pk)
        if label:
            twin_qs = twin_qs.filter(Q(payee=label) | Q(imported_description=label))
        if not twin_qs.exists():
            continue
        imp.import_match_status = Transaction.ImportMatchStatus.DUPLICATE
        imp.save(update_fields=["import_match_status", "updated_at"])
        suppressed += 1
    return suppressed


def _reconciled_ledger_twin_exists(imp: Transaction) -> bool:
    label = (imp.payee or imp.imported_description or "").strip()
    twin_qs = Transaction.objects.filter(
        account_id=imp.account_id,
        reconciled=True,
        date=imp.date,
        amount=imp.amount,
    ).exclude(pk=imp.pk)
    if not label:
        return twin_qs.exists()
    return twin_qs.filter(Q(payee=label) | Q(imported_description=label)).exists()


def materialize_unmatched_plaid_imports(*, account_id: int | None = None) -> int:
    """
    Bank charges with no forecast/manual row to match become ACTUAL ledger lines (keep plaid id).
    Avoids orphan PLAID rows that never surface like matched imports in the UI.
    """
    from transactions.services.reconciliation import is_import_date_locked

    qs = Transaction.objects.filter(
        source=Transaction.Source.PLAID,
        import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
    ).exclude(plaid_transaction_id__isnull=True).exclude(plaid_transaction_id="")
    if account_id is not None:
        qs = qs.filter(account_id=account_id)
    qs = qs.exclude(Exists(TransactionMatch.objects.filter(imported_transaction_id=OuterRef("pk"))))
    materialized = 0
    for imp in qs.select_related("account"):
        if imp.reconciled:
            continue
        if is_import_date_locked(imp.account, imp.date):
            continue
        if _reconciled_ledger_twin_exists(imp):
            imp.import_match_status = Transaction.ImportMatchStatus.DUPLICATE
            imp.save(update_fields=["import_match_status", "updated_at"])
            continue
        match_imported_transaction(imp)
        imp.refresh_from_db()
        if TransactionMatch.objects.filter(imported_transaction_id=imp.pk).exists():
            continue
        if _best_manual_twin_for_import(imp) is not None:
            rematch_unmatched_manual_actuals(account_id=imp.account_id)
            match_imported_transaction(imp)
            imp.refresh_from_db()
            if TransactionMatch.objects.filter(imported_transaction_id=imp.pk).exists():
                continue
            continue
        imp.source = Transaction.Source.ACTUAL
        imp.import_match_status = Transaction.ImportMatchStatus.NONE
        imp.cleared = True
        imp.status = Transaction.Status.CLEARED
        imp.save(
            update_fields=[
                "source",
                "import_match_status",
                "cleared",
                "status",
                "updated_at",
            ]
        )
        materialized += 1
    return materialized


def repair_invalid_transaction_matches(*, account_id: int | None = None) -> int:
    """
    Remove TransactionMatch rows whose import leg is not ``source=PLAID`` (bad data from
    materialize / re-sync) and reset row metadata so ACTUAL lines reappear in the ledger.
    """
    qs = TransactionMatch.objects.exclude(
        imported_transaction__source=Transaction.Source.PLAID,
    ).select_related("planned_transaction", "imported_transaction")
    if account_id is not None:
        qs = qs.filter(planned_transaction__account_id=account_id)
    removed = 0
    touched: set[int] = set()
    for match in qs:
        touched.add(match.planned_transaction_id)
        touched.add(match.imported_transaction_id)
        match.delete()
        removed += 1
    for pk in touched:
        txn = Transaction.objects.filter(pk=pk).first()
        if txn is None:
            continue
        if TransactionMatch.objects.filter(planned_transaction_id=pk).exists():
            txn.import_match_status = Transaction.ImportMatchStatus.MATCHED
        elif TransactionMatch.objects.filter(imported_transaction_id=pk).exists():
            txn.import_match_status = Transaction.ImportMatchStatus.MATCHED
        elif txn.source == Transaction.Source.PLAID:
            txn.import_match_status = Transaction.ImportMatchStatus.UNMATCHED
        else:
            txn.import_match_status = Transaction.ImportMatchStatus.NONE
        txn.save(update_fields=["import_match_status", "updated_at"])
    return removed


def repair_orphan_absorbed_resync_matches(*, account_id: int | None = None) -> int:
    """
    Undo bad matches where a re-sync import latched onto an orphan ACTUAL row while the real
    transfer / reconciled row was already matched to a prior import.
    """
    qs = TransactionMatch.objects.filter(
        planned_transaction__transfer_group__isnull=True,
        imported_transaction__source=Transaction.Source.PLAID,
    ).select_related("planned_transaction", "imported_transaction")
    if account_id is not None:
        qs = qs.filter(planned_transaction__account_id=account_id)
    fixed = 0
    for match in list(qs):
        imported = match.imported_transaction
        planned = match.planned_transaction
        if planned.reconciled:
            continue
        prior = _find_confirmed_ledger_match_for_import(imported, exclude_match_id=match.pk)
        if prior is None:
            continue
        match.delete()
        imported.import_match_status = Transaction.ImportMatchStatus.UNMATCHED
        imported.save(update_fields=["import_match_status", "updated_at"])
        if (
            planned.source == Transaction.Source.ACTUAL
            and planned.transfer_group_id is None
            and not planned.reconciled
            and not TransactionMatch.objects.filter(planned_transaction_id=planned.pk).exists()
            and not TransactionMatch.objects.filter(imported_transaction_id=planned.pk).exists()
        ):
            planned.delete()
        fixed += 1
    return fixed


def repair_materialized_plaid_resync_duplicates(*, account_id: int | None = None) -> int:
    """Disabled — each unique plaid_transaction_id keeps its own row."""
    return 0
