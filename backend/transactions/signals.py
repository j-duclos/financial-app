from django.db import transaction as db_transaction
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from common.services.cache import invalidate_financial_cache_for_household

from .models import Transaction


def _invalidate_household_financial_cache(account_id: int | None) -> None:
    if account_id is None:
        return
    from accounts.models import Account

    hid = (
        Account.objects.filter(pk=account_id)
        .values_list("household_id", flat=True)
        .first()
    )
    invalidate_financial_cache_for_household(hid)


@receiver(post_save, sender=Transaction)
@receiver(post_delete, sender=Transaction)
def invalidate_timeline_cache_on_transaction_change(sender, instance: Transaction, **kwargs):
    """Defer cache bust until commit; coalesce via invalidate_financial_cache_for_household only."""
    account_id = getattr(instance, "account_id", None)
    db_transaction.on_commit(lambda: _invalidate_household_financial_cache(account_id))
