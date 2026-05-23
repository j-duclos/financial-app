"""Auto-seed default categories when a new household is created."""
from django.db.models.signals import post_save
from django.dispatch import receiver

from core.models import Household

from .management.commands._seed_data import seed_household_categories


@receiver(post_save, sender=Household)
def on_household_created(sender, instance, created, **kwargs):
    if created:
        seed_household_categories(instance, is_system=True)
