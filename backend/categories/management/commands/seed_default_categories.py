"""Seed default categories for households. Usage:
  python manage.py seed_default_categories [household_id]
  If household_id omitted, seeds all households without categories.
"""
from django.core.management.base import BaseCommand

from categories.models import Category
from core.models import Household
from ._seed_data import DEFAULT_CATEGORIES, seed_household_categories


class Command(BaseCommand):
    help = "Seed default Income and Expense categories for household(s)."

    def add_arguments(self, parser):
        parser.add_argument(
            "household_id",
            type=int,
            nargs="?",
            help="Household ID to seed (optional; if omitted, seeds all households without categories)",
        )

    def handle(self, *args, **options):
        household_id = options.get("household_id")
        if household_id is not None:
            try:
                household = Household.objects.get(pk=household_id)
            except Household.DoesNotExist:
                self.stderr.write(self.style.ERROR(f"Household {household_id} not found."))
                return
            seed_household_categories(household, is_system=True)
            self.stdout.write(
                self.style.SUCCESS(f"Seeded categories for household {household_id} ({household.name}).")
            )
        else:
            count = 0
            for h in Household.objects.all():
                if not Category.objects.filter(household=h, is_system=True).exists():
                    seed_household_categories(h, is_system=True)
                    count += 1
                    self.stdout.write(f"Seeded household {h.id} ({h.name})")
            self.stdout.write(self.style.SUCCESS(f"Seeded {count} household(s)."))
