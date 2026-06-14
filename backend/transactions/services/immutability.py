"""Reconciled ledger rows are immutable — bank-closed history must not change."""
from __future__ import annotations

from rest_framework.exceptions import ValidationError

from ..models import Transaction


def reject_if_reconciled(txn: Transaction, *, action: str = "changed") -> None:
    if txn.reconciled:
        raise ValidationError(f"Reconciled transactions cannot be {action}.")


def reject_if_reconciled_bulk(txns) -> None:
    for txn in txns:
        reject_if_reconciled(txn)
