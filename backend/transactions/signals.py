from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from common.services.cache import invalidate_financial_cache_for_household
from core.timeline_cache import bump_timeline_cache_for_household

from .models import Transaction


@receiver(post_save, sender=Transaction)
@receiver(post_delete, sender=Transaction)
def invalidate_timeline_cache_on_transaction_change(sender, instance: Transaction, **kwargs):
    household_id = getattr(instance, "account_id", None)
    if household_id is None:
        return
    from accounts.models import Account

    hid = (
        Account.objects.filter(pk=instance.account_id)
        .values_list("household_id", flat=True)
        .first()
    )
    bump_timeline_cache_for_household(hid)
    invalidate_financial_cache_for_household(hid)
