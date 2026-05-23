"""Reconciliation: CSV import and match suggestions."""
import csv
import io
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation

from django.utils import timezone

from timeline.models import StatementTransaction, ReconciliationMatch
from timeline.services.ledger import build_timeline


def parse_csv_to_statement_rows(
    file_content: bytes | str,
    account_id: int,
    household_id: int,
    date_col: str = "date",
    description_col: str = "description",
    amount_col: str = "amount",
) -> list[dict]:
    """
    Parse CSV and return list of dicts with keys: posted_date, description, amount.
    date_col/description_col/amount_col can be column names or 0-based indices.
    """
    if isinstance(file_content, bytes):
        file_content = file_content.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(file_content))
    rows = []
    for row in reader:
        if not row:
            continue
        # Support both header names and numeric keys
        date_val = row.get(date_col) or row.get("0", "")
        desc_val = row.get(description_col) or row.get("1", "")
        amt_val = row.get(amount_col) or row.get("2", "")
        if not date_val and not amt_val:
            continue
        try:
            posted_date = _parse_date(date_val)
        except (ValueError, TypeError):
            continue
        try:
            amount = Decimal(str(amt_val).replace(",", "").strip())
        except (InvalidOperation, ValueError):
            continue
        rows.append({
            "posted_date": posted_date,
            "description": (desc_val or "").strip()[:512],
            "amount": amount,
            "account_id": account_id,
            "household_id": household_id,
        })
    return rows


def _parse_date(s: str):
    s = (s or "").strip()
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%d/%m/%Y", "%Y/%m/%d", "%m-%d-%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    raise ValueError(f"Cannot parse date: {s}")


def get_suggestions(account_id: int, start_date, end_date, user, household_ids):
    """
    Return suggested matches: statement transactions without a MATCHED match,
    each with suggested ledger items (same amount within ±2 days).
    """
    from transactions.models import Transaction

    stmt_txns = StatementTransaction.objects.filter(
        account_id=account_id,
        household_id__in=household_ids,
        posted_date__gte=start_date,
        posted_date__lte=end_date,
    ).select_related("account").prefetch_related("match")

    matched_stmt_ids = set(
        ReconciliationMatch.objects.filter(
            statement_txn__account_id=account_id,
            status=ReconciliationMatch.Status.MATCHED,
        ).values_list("statement_txn_id", flat=True)
    )

    # Ledger items in range: actual transactions
    ledger_txns = Transaction.objects.filter(
        account_id=account_id,
        date__gte=start_date,
        date__lte=end_date,
    ).select_related("account", "category").order_by("date", "id")

    suggestions = []
    for st in stmt_txns:
        if st.id in matched_stmt_ids:
            continue
        st_amount = st.amount
        st_date = st.posted_date
        window_start = st_date - timedelta(days=2)
        window_end = st_date + timedelta(days=2)
        suggested = []
        for t in ledger_txns:
            if window_start <= t.date <= window_end and t.amount == st_amount:
                suggested.append({
                    "id": t.id,
                    "date": t.date,
                    "payee": t.payee,
                    "amount": str(t.amount),
                    "category": t.category.name if t.category else None,
                })
        suggestions.append({
            "statement_transaction": {
                "id": st.id,
                "posted_date": st.posted_date,
                "description": st.description,
                "amount": str(st.amount),
            },
            "suggested_matches": suggested,
        })
    return suggestions
