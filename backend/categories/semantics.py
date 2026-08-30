"""
Machine-readable category semantics for transfer / payment classification.

Clients and ledger code must use system_code (or allows_transfer_destination),
not English display names, for financial behavior.
"""
from __future__ import annotations

from typing import Optional

# Canonical codes for system-seeded categories that affect transfer pairing.
SYSTEM_CODE_TRANSFER = "TRANSFER"
SYSTEM_CODE_BANK_TRANSFER = "BANK_TRANSFER"
SYSTEM_CODE_CREDIT_CARD_PAYMENT = "CREDIT_CARD_PAYMENT"

#: Categories that may keep RecurringRule.transfer_to_account / paired transfer legs.
TRANSFER_DESTINATION_SYSTEM_CODES = frozenset(
    {
        SYSTEM_CODE_BANK_TRANSFER,
        SYSTEM_CODE_CREDIT_CARD_PAYMENT,
    }
)

#: Display-name → code used only when backfilling / seeding (not runtime classification).
SEED_NAME_TO_SYSTEM_CODE: dict[str, str] = {
    "Transfer": SYSTEM_CODE_TRANSFER,
    "Bank Transfer": SYSTEM_CODE_BANK_TRANSFER,
    "Credit Card Payment": SYSTEM_CODE_CREDIT_CARD_PAYMENT,
}


def category_system_code(category) -> Optional[str]:
    if category is None:
        return None
    code = getattr(category, "system_code", None)
    if code:
        return str(code).strip() or None
    return None


def category_allows_transfer_destination(category) -> bool:
    """True when a rule/category may legally bind a transfer destination account."""
    code = category_system_code(category)
    return code in TRANSFER_DESTINATION_SYSTEM_CODES


def category_is_bank_transfer(category) -> bool:
    return category_system_code(category) == SYSTEM_CODE_BANK_TRANSFER


def category_is_credit_card_payment(category) -> bool:
    return category_system_code(category) == SYSTEM_CODE_CREDIT_CARD_PAYMENT
