from django.db import transaction as db_transaction
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from common.services.cache import invalidate_financial_cache_for_household
from transactions.services.immutability import FINANCIAL_TXN_FIELDS

from .models import Transaction


def _invalidate_household_financial_cache(
    account_id: int | None,
    *,
    bump_revision: bool = True,
) -> None:
    if account_id is None:
        return
    from accounts.models import Account

    hid = (
        Account.objects.filter(pk=account_id)
        .values_list("household_id", flat=True)
        .first()
    )
    invalidate_financial_cache_for_household(hid, bump_revision=bump_revision)


@receiver(post_save, sender=Transaction)
@receiver(post_delete, sender=Transaction)
def invalidate_timeline_cache_on_transaction_change(sender, instance: Transaction, **kwargs):
    """Defer cache bust until commit; skip financial revision for metadata-only saves."""
    account_id = getattr(instance, "account_id", None)
    update_fields = kwargs.get("update_fields")
    bump = True
    if update_fields is not None:
        bump = bool(set(update_fields) & FINANCIAL_TXN_FIELDS)
    db_transaction.on_commit(
        lambda: _invalidate_household_financial_cache(account_id, bump_revision=bump)
    )
