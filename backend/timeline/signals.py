from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from common.services.cache import invalidate_financial_cache_for_household

from .models import RecurringRule


@receiver(post_save, sender=RecurringRule)
@receiver(post_delete, sender=RecurringRule)
def invalidate_forecast_cache_on_recurring_rule_change(sender, instance: RecurringRule, **kwargs):
    invalidate_financial_cache_for_household(instance.household_id)
