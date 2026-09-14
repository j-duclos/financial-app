"""Household-wide Home account pins. Display preference only — no financial math."""

from __future__ import annotations

from django.db import transaction
from django.utils import timezone

from accounts.models import Account

HOME_PIN_LIMIT = 4
HOME_PIN_LIMIT_MESSAGE = "You can pin up to 4 accounts to Home. Unpin one first."
HOME_PIN_INACTIVE_MESSAGE = "Only active accounts can be pinned to Home."


class HomePinError(Exception):
    def __init__(self, message: str, field: str = "pinned_to_home"):
        self.field = field
        super().__init__(message)


def account_is_home_pinnable(account: Account) -> bool:
    return account.status == Account.Status.ACTIVE and account.is_active


def _persist_pin_fields(account: Account, *, pinned: bool, order: int | None) -> None:
    Account.objects.filter(pk=account.pk).update(
        pinned_to_home=pinned,
        home_pin_order=order,
        updated_at=timezone.now(),
    )
    account.pinned_to_home = pinned
    account.home_pin_order = order


def compact_home_pins(household_id: int) -> None:
    pinned = list(
        Account.objects.filter(household_id=household_id, pinned_to_home=True).order_by(
            "home_pin_order", "id"
        )
    )
    for index, account in enumerate(pinned, start=1):
        if account.home_pin_order != index:
            _persist_pin_fields(account, pinned=True, order=index)


@transaction.atomic
def apply_home_pin(
    account: Account,
    *,
    pinned: bool | None = None,
    home_pin_order: int | None = None,
) -> Account:
    """
    Pin, unpin, or reorder a household account on Home.

    Unpinned accounts have home_pin_order=None. Remaining pins compact to 1..n.
    Does not silently replace an existing pin when the household is at the limit.
    """
    account = Account.objects.select_for_update().get(pk=account.pk)
    want_pinned = account.pinned_to_home if pinned is None else bool(pinned)

    if not want_pinned:
        if account.pinned_to_home or account.home_pin_order is not None:
            _persist_pin_fields(account, pinned=False, order=None)
            compact_home_pins(account.household_id)
        return account

    if not account_is_home_pinnable(account):
        raise HomePinError(HOME_PIN_INACTIVE_MESSAGE)

    if home_pin_order is not None and (home_pin_order < 1 or home_pin_order > HOME_PIN_LIMIT):
        raise HomePinError("home_pin_order must be between 1 and 4.", field="home_pin_order")

    others = list(
        Account.objects.select_for_update()
        .filter(household_id=account.household_id, pinned_to_home=True)
        .exclude(pk=account.pk)
        .order_by("home_pin_order", "id")
    )
    if not account.pinned_to_home and len(others) >= HOME_PIN_LIMIT:
        raise HomePinError(HOME_PIN_LIMIT_MESSAGE)

    insert_at = len(others) if home_pin_order is None else max(0, min(home_pin_order - 1, len(others)))
    ordered = others[:insert_at] + [account] + others[insert_at:]
    for index, item in enumerate(ordered, start=1):
        _persist_pin_fields(item, pinned=True, order=index)
    return account
