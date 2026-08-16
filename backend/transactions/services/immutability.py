"""Reconciled and imported ledger rows: lock bank/financial fields, allow safe metadata."""
from __future__ import annotations

from rest_framework.exceptions import ValidationError

from ..models import Transaction

IMPORTED_LOCKED_FIELDS = frozenset(
    {
        "amount",
        "date",
        "account",
        "account_id",
        "source",
        "plaid_transaction_id",
        "pending_transaction_id",
        "imported_description",
        "posted_date",
        "is_pending",
        "status",
        "transaction_type",
    }
)

RECONCILED_LOCKED_FIELDS = frozenset(
    {
        "amount",
        "date",
        "account",
        "account_id",
        "source",
        "transaction_type",
        "transfer_group",
        "transfer_group_id",
        "status",
        "cleared",
        "reconciled",
        "category",
        "category_id",
        "payee",
        "rule_id",
        "rule",
    }
)

FINANCIAL_TXN_FIELDS = frozenset(
    {
        "amount",
        "date",
        "account",
        "account_id",
        "status",
        "source",
        "cleared",
        "reconciled",
        "transaction_type",
        "transfer_group",
        "transfer_group_id",
        "is_pending",
        "posted_date",
        "planned_date",
        "rule_id",
        "rule",
        "transfer_to_account_id",
    }
)

METADATA_TXN_FIELDS = frozenset(
    {
        "payee",
        "memo",
        "category",
        "category_id",
        "tags",
        "is_bill",
        "normalized_payee",
    }
)


def is_bank_imported(txn: Transaction) -> bool:
    if (getattr(txn, "plaid_transaction_id", None) or "").strip():
        return True
    return txn.source == Transaction.Source.PLAID


def reject_if_reconciled(txn: Transaction, *, action: str = "changed") -> None:
    if txn.reconciled:
        raise ValidationError(f"Reconciled transactions cannot be {action}.")


def reject_if_reconciled_bulk(txns) -> None:
    for txn in txns:
        reject_if_reconciled(txn)


def _field_changed(instance: Transaction, field: str, new_value) -> bool:
    current = getattr(instance, field, None)
    if field in {"account", "category", "rule", "transfer_group"} and hasattr(new_value, "pk"):
        return current != new_value and getattr(current, "pk", current) != new_value.pk
    if field.endswith("_id"):
        rel = field[:-3]
        current_id = getattr(instance, field, None)
        if current_id is None and hasattr(instance, rel):
            related = getattr(instance, rel)
            current_id = getattr(related, "pk", related)
        new_id = getattr(new_value, "pk", new_value)
        return current_id != new_id
    return current != new_value


def _locked_changes(instance: Transaction, data: dict, locked: frozenset[str]) -> list[str]:
    changed = []
    for field, value in data.items():
        if field not in locked:
            continue
        if _field_changed(instance, field, value):
            changed.append(field)
    return changed


def validate_transaction_update(instance: Transaction, validated_data: dict) -> None:
    """
    Reject unauthorized edits to imported bank-owned fields and reconciled financial fields.

    Reconciled metadata policy: memo and tags may change (they cannot alter ledger
    balance, reconciliation result, or transfer semantics). Category and payee are
    locked because they appear on reconciliation history.
    """
    if instance.reconciled:
        locked = _locked_changes(instance, validated_data, RECONCILED_LOCKED_FIELDS)
        if locked:
            raise ValidationError(
                {
                    field: (
                        "Reconciled transaction. Financial fields are locked. "
                        "Undo the reconciliation first to change accounting history."
                    )
                    for field in locked
                }
            )
        # transfer destination is not a model field but changes linkage
        if "transfer_to_account_id" in validated_data:
            raise ValidationError(
                {
                    "transfer_to_account_id": (
                        "Reconciled transaction. Transfer linkage is locked."
                    )
                }
            )

    if is_bank_imported(instance):
        locked = _locked_changes(instance, validated_data, IMPORTED_LOCKED_FIELDS)
        if locked:
            raise ValidationError(
                {
                    field: (
                        "Imported from your bank. Amount, posted date, account, "
                        "and other bank-owned fields cannot be changed."
                    )
                    for field in locked
                }
            )


def is_financial_update(validated_data: dict) -> bool:
    return any(field in FINANCIAL_TXN_FIELDS for field in validated_data)
