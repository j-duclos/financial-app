"""Category system_code semantics for transfer destinations."""
from categories.models import Category
from categories.semantics import (
    SYSTEM_CODE_BANK_TRANSFER,
    SYSTEM_CODE_CREDIT_CARD_PAYMENT,
    category_allows_transfer_destination,
    category_is_bank_transfer,
)
from core.models import Household


def test_transfer_destination_uses_system_code_not_display_name(db):
    household = Household.objects.create(name="Semantics HH")
    bank = Category.objects.create(
        household=household,
        name="Renamed Transfer Label",
        category_type=Category.CategoryType.EXPENSE,
        system_code=SYSTEM_CODE_BANK_TRANSFER,
        is_system=True,
    )
    shopping = Category.objects.create(
        household=household,
        name="Looks Like Transfer But Is Not",
        category_type=Category.CategoryType.EXPENSE,
        system_code=None,
    )
    assert category_allows_transfer_destination(bank) is True
    assert category_is_bank_transfer(bank) is True
    assert category_allows_transfer_destination(shopping) is False
    # Display name alone must not grant transfer semantics
    assert category_allows_transfer_destination(
        Category(name="Bank Transfer", system_code=None)
    ) is False


def test_credit_card_payment_code_allows_destination(db):
    household = Household.objects.create(name="CC Semantics")
    cc = Category.objects.create(
        household=household,
        name="Card Pay",
        category_type=Category.CategoryType.EXPENSE,
        system_code=SYSTEM_CODE_CREDIT_CARD_PAYMENT,
        is_system=True,
    )
    assert category_allows_transfer_destination(cc) is True
