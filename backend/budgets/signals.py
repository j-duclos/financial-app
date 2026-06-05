from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from budgets.models import SpendingTarget
from common.services.cache import invalidate_financial_cache_for_household


@receiver(post_save, sender=SpendingTarget)
@receiver(post_delete, sender=SpendingTarget)
def invalidate_financial_cache_on_spending_target_change(sender, instance: SpendingTarget, **kwargs):
    invalidate_financial_cache_for_household(instance.household_id)
