"""
Manual actual ↔ Plaid import matching.

When a user hand-enters a bank charge before Plaid syncs the same post, merge the
import onto the existing manual row instead of creating a duplicate ledger line.

Description equality is never required — scoring uses amount, account, direction,
date proximity, and normalized merchant similarity (e.g. "POS DEBIT WAL-MART …"
matches "Walmart").
"""
from __future__ import annotations

import logging
import re
import unicodedata
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
from difflib import SequenceMatcher
from typing import Any, Iterable, Optional

from django.db import transaction as db_transaction
from django.db.models import Exists, OuterRef, Q, QuerySet
from django.utils import timezone

from ..models import MatchSuggestion, Transaction, TransactionMatch

logger = logging.getLogger(__name__)

AMOUNT_TOLERANCE = Decimal("0.01")
MANUAL_MATCH_DATE_WINDOW_DAYS = 2
AUTO_MATCH_MIN_SCORE = 85
SUGGEST_MATCH_MIN_SCORE = 65

_NOISE_TOKENS = frozenset(
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
        "com",
        "www",
        "http",
        "https",
        "inc",
        "llc",
        "ltd",
    }
)

_HYPHEN_MERCHANT_ALIASES = {
    "walmart": ("wal mart", "walmart"),
    "afterpay": ("after pay", "afterpay"),
    "mcdonalds": ("mc donalds", "mcdonalds"),
    "homedepot": ("home depot",),
    "wholefoods": ("whole foods",),
}


@dataclass(frozen=True)
class MatchResult:
    """Outcome of scoring one manual row against one import payload."""

    score: int
    auto_match: bool
    reject_reason: str | None = None
    parts: dict[str, Any] = field(default_factory=dict)

    @property
    def rejected(self) -> bool:
        return self.reject_reason is not None or self.score <= 0


@dataclass
class ManualMatchDecision:
    """Result of candidate search for an incoming Plaid import."""

    action: str  # "merge" | "suggest" | "none"
    manual: Transaction | None = None
    candidates: list[tuple[Transaction, MatchResult]] = field(default_factory=list)
    reason: str = ""


def normalize_transaction_amount(amount: Decimal | int | float | str | None) -> Decimal | None:
    """Normalize a signed amount to Decimal with 2-place money precision."""
    if amount is None:
        return None
    try:
        value = amount if isinstance(amount, Decimal) else Decimal(str(amount))
    except (InvalidOperation, ValueError, TypeError):
        return None
    return value.quantize(Decimal("0.01"))


def normalize_merchant_text(text: str) -> str:
    """
    Normalize payee / bank description for fuzzy comparison.

    Collapses punctuation, lowercases, strips noise tokens, and joins hyphenated
    merchant fragments (wal-mart → walmart) so verbose POS text can match a short
    Plaid merchant name.
    """
    if not text:
        return ""
    s = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    s = s.lower()
    s = re.sub(r"[^\w\s]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    # Join single-letter / short hyphen splits already turned into spaces (wal mart → walmart
    # when either side is a known alias, and also general: if short side is one token).
    tokens = [t for t in s.split() if t and t not in _NOISE_TOKENS]
    collapsed = " ".join(tokens)
    # Alias pass: rewrite known spaced forms.
    compact = collapsed.replace(" ", "")
    for canon, variants in _HYPHEN_MERCHANT_ALIASES.items():
        for variant in variants:
            if variant.replace(" ", "") in compact or variant in collapsed:
                collapsed = re.sub(rf"\b{re.escape(variant)}\b", canon, collapsed)
                compact = collapsed.replace(" ", "")
    return collapsed


def _merchant_compact(text: str) -> str:
    return normalize_merchant_text(text).replace(" ", "")


def _amounts_equal(a: Decimal | None, b: Decimal | None) -> bool:
    if a is None or b is None:
        return False
    return abs(a - b) <= AMOUNT_TOLERANCE


def _same_direction(a: Decimal | None, b: Decimal | None) -> bool:
    if a is None or b is None or a == 0 or b == 0:
        return False
    return (a > 0) == (b > 0)


def _merchant_similarity(manual_text: str, import_text: str) -> tuple[float, int]:
    """Return (ratio 0–1, boost points 0–30)."""
    nm = normalize_merchant_text(manual_text)
    ni = normalize_merchant_text(import_text)
    if not nm or not ni:
        return 0.0, 0
    ratio = SequenceMatcher(None, nm, ni).ratio()
    cm, ci = _merchant_compact(manual_text), _merchant_compact(import_text)
    contained = bool(ci and ci in cm) or bool(cm and cm in ci)
    # Token containment: short merchant token inside long POS string.
    short, long = (ni, nm) if len(ni) <= len(nm) else (nm, ni)
    short_tokens = [t for t in short.split() if len(t) >= 4]
    token_hit = any(t in long or t in long.replace(" ", "") for t in short_tokens)
    if ci and cm and (ci == cm or contained):
        return max(ratio, 0.92), 30
    if token_hit or contained:
        return max(ratio, 0.75), 22
    if ratio >= 0.55:
        return ratio, int(round(ratio * 18))
    if ratio >= 0.35:
        return ratio, int(round(ratio * 10))
    return ratio, 0


def score_manual_import_match(
    manual_transaction: Transaction,
    plaid_transaction: Transaction | dict[str, Any],
) -> MatchResult:
    """
    Score whether a manual actual row is the same bank post as an incoming Plaid import.

    ``plaid_transaction`` may be a Transaction or a defaults dict from the sync importer.
    """
    parts: dict[str, Any] = {}
    account_id, txn_date, amount, payee, imported_description, category_id, plaid_id = (
        _plaid_fields(plaid_transaction)
    )

    if manual_transaction.account_id != account_id:
        return MatchResult(0, False, "different_account", {"reject": "different_account"})

    if (manual_transaction.plaid_transaction_id or "").strip():
        existing_pid = manual_transaction.plaid_transaction_id.strip()
        if plaid_id and existing_pid != plaid_id:
            return MatchResult(0, False, "already_matched", {"reject": "already_matched"})
        # Same plaid id already on manual — treat as identity hit.
        return MatchResult(100, True, None, {"identity": 100})

    if TransactionMatch.objects.filter(planned_transaction_id=manual_transaction.pk).exists():
        return MatchResult(0, False, "already_matched", {"reject": "already_matched"})

    if manual_transaction.import_match_status == Transaction.ImportMatchStatus.MATCHED:
        return MatchResult(0, False, "already_matched", {"reject": "already_matched"})

    if manual_transaction.source not in (
        Transaction.Source.ACTUAL,
        Transaction.Source.ONE_TIME,
    ):
        return MatchResult(0, False, "not_manual", {"reject": "not_manual"})

    if manual_transaction.rule_id or manual_transaction.scenario_id:
        return MatchResult(0, False, "not_manual", {"reject": "not_manual"})

    if manual_transaction.transfer_group_id:
        return MatchResult(0, False, "transfer_leg", {"reject": "transfer_leg"})

    man_amt = normalize_transaction_amount(manual_transaction.amount)
    imp_amt = normalize_transaction_amount(amount)
    if not _amounts_equal(man_amt, imp_amt):
        return MatchResult(0, False, "amount_mismatch", {"reject": "amount_mismatch"})
    if not _same_direction(man_amt, imp_amt):
        return MatchResult(0, False, "opposite_direction", {"reject": "opposite_direction"})

    score = 50
    parts["account"] = 50
    score += 40
    parts["amount"] = 40

    dd = abs((manual_transaction.date - txn_date).days)
    if dd == 0:
        score += 30
        parts["date_same"] = 30
    elif dd == 1:
        score += 22
        parts["date_1d"] = 22
    elif dd <= MANUAL_MATCH_DATE_WINDOW_DAYS:
        score += 15
        parts["date_2d"] = 15
    else:
        return MatchResult(0, False, "date_outside_window", {"reject": "date_outside_window", "days": dd})

    manual_text = " ".join(
        filter(
            None,
            [
                manual_transaction.payee or "",
                manual_transaction.memo or "",
                manual_transaction.imported_description or "",
            ],
        )
    )
    import_text = " ".join(filter(None, [payee or "", imported_description or ""]))
    ratio, merchant_pts = _merchant_similarity(manual_text, import_text)
    score += merchant_pts
    parts["merchant_sim"] = merchant_pts
    parts["merchant_ratio"] = round(ratio, 3)

    if category_id and manual_transaction.category_id and category_id == manual_transaction.category_id:
        score += 5
        parts["category"] = 5

    # Soft merchant gate: exact amount+account+date can auto-match even with weak text
    # when the date is exact and there is any merchant signal OR same-day unique candidate
    # is decided upstream. Reject only when text clearly conflicts and date is soft.
    if merchant_pts == 0 and ratio < 0.25 and dd > 0:
        return MatchResult(
            min(score, SUGGEST_MATCH_MIN_SCORE - 1),
            False,
            "payee_mismatch",
            {**parts, "reject": "payee_mismatch"},
        )

    # Prefer merchant evidence for auto-match — amount+date alone is too weak when several
    # same-amount charges land on the same day (Cash App John vs Mike).
    auto = (
        score >= AUTO_MATCH_MIN_SCORE
        and dd <= MANUAL_MATCH_DATE_WINDOW_DAYS
        and _amounts_equal(man_amt, imp_amt)
        and _same_direction(man_amt, imp_amt)
        and merchant_pts >= 15
    )

    return MatchResult(score, auto, None, parts)


def _plaid_fields(
    plaid_transaction: Transaction | dict[str, Any],
) -> tuple[int, date, Decimal | None, str, str, int | None, str]:
    if isinstance(plaid_transaction, Transaction):
        return (
            plaid_transaction.account_id,
            plaid_transaction.date,
            plaid_transaction.amount,
            plaid_transaction.payee or "",
            plaid_transaction.imported_description or "",
            plaid_transaction.category_id,
            (plaid_transaction.plaid_transaction_id or "").strip(),
        )
    account_id = int(plaid_transaction["account_id"])
    txn_date = plaid_transaction["date"]
    if not isinstance(txn_date, date):
        parts = str(txn_date).split("-")
        txn_date = date(int(parts[0]), int(parts[1]), int(parts[2]))
    return (
        account_id,
        txn_date,
        normalize_transaction_amount(plaid_transaction.get("amount")),
        str(plaid_transaction.get("payee") or ""),
        str(plaid_transaction.get("imported_description") or ""),
        plaid_transaction.get("category_id"),
        str(plaid_transaction.get("plaid_transaction_id") or "").strip(),
    )


def _manual_candidate_qs(
    *,
    account_id: int,
    amount: Decimal,
    on_date: date,
) -> QuerySet[Transaction]:
    low = on_date - timedelta(days=MANUAL_MATCH_DATE_WINDOW_DAYS)
    high = on_date + timedelta(days=MANUAL_MATCH_DATE_WINDOW_DAYS)
    return (
        Transaction.objects.filter(
            account_id=account_id,
            date__gte=low,
            date__lte=high,
            amount=amount,
            source__in=[Transaction.Source.ACTUAL, Transaction.Source.ONE_TIME],
            rule__isnull=True,
            scenario__isnull=True,
            transfer_group__isnull=True,
        )
        .filter(Q(plaid_transaction_id__isnull=True) | Q(plaid_transaction_id=""))
        .exclude(
            import_match_status__in=[
                Transaction.ImportMatchStatus.MATCHED,
                Transaction.ImportMatchStatus.IGNORED,
                Transaction.ImportMatchStatus.DUPLICATE,
            ]
        )
        .filter(transfer_out__isnull=True, transfer_in__isnull=True)
        .exclude(Exists(TransactionMatch.objects.filter(planned_transaction_id=OuterRef("pk"))))
        .exclude(Exists(TransactionMatch.objects.filter(imported_transaction_id=OuterRef("pk"))))
    )


def find_manual_match_for_import(
    plaid_transaction: Transaction | dict[str, Any],
) -> ManualMatchDecision:
    """
    Find unmatched manual actuals that could absorb this import.

    Auto-merge only when exactly one high-confidence candidate exists.
    Multiple equal high-confidence candidates → suggest (do not guess).
    """
    account_id, txn_date, amount, *_rest = _plaid_fields(plaid_transaction)
    if amount is None:
        return ManualMatchDecision("none", reason="missing_amount")

    scored: list[tuple[Transaction, MatchResult]] = []
    for manual in _manual_candidate_qs(account_id=account_id, amount=amount, on_date=txn_date):
        result = score_manual_import_match(manual, plaid_transaction)
        if result.rejected:
            continue
        if result.score >= SUGGEST_MATCH_MIN_SCORE:
            scored.append((manual, result))

    scored.sort(key=lambda x: (-x[1].score, x[0].pk))
    if not scored:
        return ManualMatchDecision("none", reason="no_candidates")

    high = [(m, r) for m, r in scored if r.auto_match and r.score >= AUTO_MATCH_MIN_SCORE]
    if len(high) == 1:
        return ManualMatchDecision("merge", manual=high[0][0], candidates=scored, reason="unique_high_confidence")
    if len(high) > 1:
        # Distinguishable manuals (different merchant text) → do not guess.
        compacts = {_merchant_compact(m.payee or m.memo or "") for m, _ in high}
        if len(compacts) > 1:
            return ManualMatchDecision(
                "suggest",
                candidates=scored,
                reason="multiple_high_confidence",
            )
        # Fungible duplicates (same merchant/amount/day) — claim oldest for 1:1 absorption.
        high.sort(key=lambda x: (x[0].date, x[0].pk))
        return ManualMatchDecision(
            "merge",
            manual=high[0][0],
            candidates=scored,
            reason="fungible_fifo",
        )

    return ManualMatchDecision("suggest", candidates=scored, reason="below_auto_or_ambiguous")


def merge_manual_transaction_with_import(
    manual: Transaction,
    plaid_transaction: Transaction | dict[str, Any],
    *,
    confidence: str = "AUTO",
) -> Transaction:
    """
    Attach Plaid identity/metadata onto the existing manual row.

    Preserves user category, tags, memo, reconciliation, and custom payee text
    (user payee kept when it looks intentionally different; bank text stored in
    imported_description). Ensures only the manual row remains balance-affecting.
    """
    from transactions.services.posting import _delete_transaction_cascade

    account_id, txn_date, amount, payee, imported_description, _cat, plaid_id = _plaid_fields(
        plaid_transaction
    )
    if not plaid_id:
        raise ValueError("Plaid transaction id is required to merge.")
    if manual.account_id != account_id:
        raise ValueError("Cannot merge across accounts.")

    posted_date = txn_date
    pending_id = ""
    is_pending = False
    normalized_payee = ""
    memo_from_import = ""
    if isinstance(plaid_transaction, Transaction):
        posted_date = plaid_transaction.posted_date or plaid_transaction.date
        pending_id = (getattr(plaid_transaction, "pending_transaction_id", None) or "").strip()
        is_pending = bool(getattr(plaid_transaction, "is_pending", False))
        normalized_payee = plaid_transaction.normalized_payee or ""
        memo_from_import = (plaid_transaction.memo or "").strip()
        import_row: Transaction | None = plaid_transaction
    else:
        posted_date = plaid_transaction.get("posted_date") or txn_date
        pending_id = str(plaid_transaction.get("pending_transaction_id") or "").strip()
        is_pending = bool(plaid_transaction.get("is_pending", False))
        normalized_payee = str(plaid_transaction.get("normalized_payee") or "")
        memo_from_import = str(plaid_transaction.get("memo") or "").strip()
        import_row = None
        if plaid_transaction.get("pk"):
            import_row = Transaction.objects.filter(pk=plaid_transaction["pk"]).first()

    with db_transaction.atomic():
        # Free unique plaid_transaction_id on any other row before attaching to manual.
        conflict = (
            Transaction.objects.filter(plaid_transaction_id=plaid_id)
            .exclude(pk=manual.pk)
            .first()
        )
        if conflict is not None:
            import_row = conflict

        if import_row is not None and import_row.pk != manual.pk:
            MatchSuggestion.objects.filter(
                Q(imported_transaction=import_row) | Q(planned_transaction=manual)
            ).delete()
            TransactionMatch.objects.filter(
                Q(imported_transaction=import_row) | Q(planned_transaction=manual)
            ).delete()
            # Release unique constraint, then hide the duplicate import row.
            import_row.plaid_transaction_id = None
            import_row.import_match_status = Transaction.ImportMatchStatus.DUPLICATE
            import_row.save(
                update_fields=["plaid_transaction_id", "import_match_status", "updated_at"]
            )

        update_fields: list[str] = []

        # Preserve user memo; if empty, optionally keep bank original_description.
        user_memo = (manual.memo or "").strip()
        user_payee = (manual.payee or "").strip()
        bank_payee = (payee or "").strip()
        bank_desc = (imported_description or memo_from_import or bank_payee).strip()

        if bank_desc and not (manual.imported_description or "").strip():
            manual.imported_description = bank_desc[:2000]
            update_fields.append("imported_description")
        elif bank_desc and (manual.imported_description or "").strip() != bank_desc:
            # Keep prior user-facing imported_description only if empty; otherwise refresh bank text.
            manual.imported_description = bank_desc[:2000]
            if "imported_description" not in update_fields:
                update_fields.append("imported_description")

        # Prefer short merchant name for display when bank provides one; stash verbose user payee.
        if bank_payee and bank_payee != user_payee:
            if user_payee and not user_memo and _looks_like_raw_bank_text(user_payee):
                # Verbose POS paste — replace with clean merchant; keep original in memo.
                manual.memo = user_payee[:2000]
                update_fields.append("memo")
                manual.payee = bank_payee[:255]
                update_fields.append("payee")
            elif user_payee and not _looks_like_raw_bank_text(user_payee):
                # Intentionally edited short label — keep user payee.
                pass
            else:
                manual.payee = bank_payee[:255]
                update_fields.append("payee")
            if not user_memo and memo_from_import and memo_from_import != bank_payee:
                if "memo" not in update_fields:
                    manual.memo = memo_from_import[:2000]
                    update_fields.append("memo")

        if posted_date and manual.posted_date != posted_date:
            manual.posted_date = posted_date
            update_fields.append("posted_date")
        # Prefer bank posted date as the ledger date when within window.
        if posted_date and abs((manual.date - posted_date).days) <= MANUAL_MATCH_DATE_WINDOW_DAYS:
            if manual.date != posted_date and not manual.reconciled:
                manual.date = posted_date
                update_fields.append("date")

        if normalized_payee and manual.normalized_payee != normalized_payee[:512]:
            manual.normalized_payee = normalized_payee[:512]
            update_fields.append("normalized_payee")
        elif bank_payee or bank_desc:
            np = normalize_merchant_text(f"{bank_payee} {bank_desc}")[:512]
            if np and manual.normalized_payee != np:
                manual.normalized_payee = np
                update_fields.append("normalized_payee")

        manual.plaid_transaction_id = plaid_id[:128]
        update_fields.append("plaid_transaction_id")

        if pending_id:
            manual.pending_transaction_id = pending_id[:128]
            update_fields.append("pending_transaction_id")
        manual.is_pending = is_pending
        update_fields.append("is_pending")

        if not manual.cleared and not is_pending:
            manual.cleared = True
            update_fields.append("cleared")
        if manual.status == Transaction.Status.PLANNED and not is_pending:
            manual.status = Transaction.Status.CLEARED
            update_fields.append("status")

        # Single surviving row — no TransactionMatch pair needed.
        manual.import_match_status = Transaction.ImportMatchStatus.NONE
        update_fields.append("import_match_status")

        # Category / tags / reconciled left untouched (preserve user metadata).
        manual.save(update_fields=[*dict.fromkeys(update_fields), "updated_at"])

        if import_row is not None and import_row.pk != manual.pk:
            # DUPLICATE Plaid rows stay in DB (invariant: never delete source=PLAID) but
            # are hidden from ledger_visible_transactions.
            if import_row.source != Transaction.Source.PLAID:
                _delete_transaction_cascade(import_row)

        _invalidate_caches_for_account(manual.account_id)

    logger.info(
        "Merged Plaid import %s onto manual txn %s (confidence=%s)",
        plaid_id,
        manual.pk,
        confidence,
    )
    return manual


def _looks_like_raw_bank_text(payee: str) -> bool:
    """Heuristic: verbose POS / ACH strings the user pasted from a bank site."""
    s = (payee or "").strip()
    if len(s) >= 28:
        return True
    upper = s.upper()
    return any(
        token in upper
        for token in ("POS DEBIT", "POS PURCHASE", "ACH DEBIT", "CHECKCARD", "VISA DEBIT")
    )


def create_match_review_suggestions(
    plaid_row: Transaction,
    candidates: Iterable[tuple[Transaction, MatchResult]],
) -> int:
    """Persist MatchSuggestion rows for ambiguous manual↔import pairs."""
    created = 0
    plaid_row.import_match_status = Transaction.ImportMatchStatus.SUGGESTED
    plaid_row.save(update_fields=["import_match_status", "updated_at"])
    for manual, result in candidates:
        if result.score < SUGGEST_MATCH_MIN_SCORE:
            continue
        _, was_created = MatchSuggestion.objects.update_or_create(
            imported_transaction=plaid_row,
            planned_transaction=manual,
            defaults={"score": result.score},
        )
        if was_created:
            created += 1
    return created


def keep_both_manual_and_import(*, imported_id: int, planned_id: int | None = None) -> None:
    """
    User chose 'Keep both' — dismiss suggestions and leave both rows unmatched.
    """
    imp = Transaction.objects.get(pk=imported_id)
    qs = MatchSuggestion.objects.filter(imported_transaction=imp)
    if planned_id is not None:
        qs = qs.filter(planned_transaction_id=planned_id)
    qs.delete()
    if not MatchSuggestion.objects.filter(imported_transaction=imp).exists():
        if imp.import_match_status == Transaction.ImportMatchStatus.SUGGESTED:
            imp.import_match_status = Transaction.ImportMatchStatus.UNMATCHED
            imp.save(update_fields=["import_match_status", "updated_at"])


def reject_manual_import_suggestion(*, imported_id: int, planned_id: int) -> None:
    """User chose 'Not a match' for one suggested pair."""
    keep_both_manual_and_import(imported_id=imported_id, planned_id=planned_id)


def try_merge_incoming_plaid_into_manual(
    *,
    account_pk: int,
    pid: str,
    defaults: dict[str, Any],
) -> Transaction | None:
    """
    Pre-create hook for Plaid sync: merge onto a unique high-confidence manual row.

    Returns the updated manual transaction when merged; None when the importer should
    create a new Plaid row (and optionally attach suggestions afterward).
    """
    payload = {**defaults, "plaid_transaction_id": pid, "account_id": account_pk}
    decision = find_manual_match_for_import(payload)
    if decision.action == "merge" and decision.manual is not None:
        return merge_manual_transaction_with_import(
            decision.manual,
            payload,
            confidence="AUTO",
        )
    return None


def suggest_manual_matches_for_new_import(imported: Transaction) -> int:
    """After creating an unmatched Plaid row, attach suggestions for soft/ambiguous manuals."""
    decision = find_manual_match_for_import(imported)
    if decision.action != "suggest" or not decision.candidates:
        return 0
    return create_match_review_suggestions(imported, decision.candidates)


def resolve_pending_to_posted(
    *,
    account_pk: int,
    posted_pid: str,
    pending_pid: str,
    defaults: dict[str, Any],
) -> Transaction | None:
    """
    Convert a previously imported pending Plaid row into the posted transaction.

    Looks up by pending plaid_transaction_id (or pending_transaction_id on a manual
    that already absorbed the pending post).
    """
    pending_pid = (pending_pid or "").strip()
    posted_pid = (posted_pid or "").strip()
    if not pending_pid or not posted_pid:
        return None

    existing_posted = Transaction.objects.filter(plaid_transaction_id=posted_pid).first()
    if existing_posted is not None:
        return existing_posted

    pending_row = (
        Transaction.objects.filter(plaid_transaction_id=pending_pid, account_id=account_pk).first()
        or Transaction.objects.filter(
            pending_transaction_id=pending_pid, account_id=account_pk
        ).first()
    )
    if pending_row is None:
        return None

    with db_transaction.atomic():
        update_fields: list[str] = []
        for key, val in defaults.items():
            if key in ("plaid_transaction_id", "import_match_status"):
                continue
            if getattr(pending_row, key, None) != val:
                # Do not wipe user category/tags/memo on a manual that absorbed pending.
                if pending_row.source in (
                    Transaction.Source.ACTUAL,
                    Transaction.Source.ONE_TIME,
                ) and key in ("category_id", "category", "tags", "memo"):
                    if key == "tags" and pending_row.tags:
                        continue
                    if key in ("category_id", "category") and pending_row.category_id:
                        continue
                    if key == "memo" and (pending_row.memo or "").strip():
                        continue
                setattr(pending_row, key, val)
                update_fields.append(key if key != "category" else "category_id")

        pending_row.plaid_transaction_id = posted_pid[:128]
        update_fields.append("plaid_transaction_id")
        pending_row.pending_transaction_id = pending_pid[:128]
        update_fields.append("pending_transaction_id")
        pending_row.is_pending = False
        update_fields.append("is_pending")
        if not pending_row.cleared:
            pending_row.cleared = True
            update_fields.append("cleared")
        if pending_row.status == Transaction.Status.PLANNED:
            pending_row.status = Transaction.Status.CLEARED
            update_fields.append("status")
        pending_row.save(update_fields=[*dict.fromkeys(update_fields), "updated_at"])
        _invalidate_caches_for_account(account_pk)
    return pending_row


def _invalidate_caches_for_account(account_id: int) -> None:
    from accounts.models import Account
    from common.services.cache import invalidate_financial_cache_for_household
    from core.timeline_cache import bump_timeline_cache_for_household

    hid = Account.objects.filter(pk=account_id).values_list("household_id", flat=True).first()
    if hid is not None:
        bump_timeline_cache_for_household(hid)
        invalidate_financial_cache_for_household(hid)
