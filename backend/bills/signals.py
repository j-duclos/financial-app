from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from bills.models import BillOccurrence
from common.services.cache import invalidate_financial_cache_for_household


@receiver(post_save, sender=BillOccurrence)
@receiver(post_delete, sender=BillOccurrence)
def invalidate_financial_cache_on_bill_occurrence_change(sender, instance: BillOccurrence, **kwargs):
    invalidate_financial_cache_for_household(instance.household_id)
