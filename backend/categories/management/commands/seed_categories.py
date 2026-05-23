"""Seed default categories for all households. Usage:
  python manage.py seed_categories           # seed ALL households
  python manage.py seed_categories 5         # seed only household 5 (optional)
"""
from django.core.management.base import BaseCommand

from categories.models import Category
from core.models import Household
from ._seed_data import seed_household_categories


class Command(BaseCommand):
    help = "Seed default Income and Expense categories for household(s)."

    def add_arguments(self, parser):
        parser.add_argument(
            "household_id",
            type=int,
            nargs="?",
            default=None,
            help="Optional household ID. If omitted, seeds ALL households.",
        )
        parser.add_argument(
            "--sync",
            action="store_true",
            help="Sync new categories to existing households (adds missing categories like Transfer).",
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
            sync = options.get("sync", False)
            for h in Household.objects.all():
                if sync or not Category.objects.filter(household=h, is_system=True).exists():
                    seed_household_categories(h, is_system=True)
                    count += 1
                    self.stdout.write(f"Seeded household {h.id} ({h.name})")
            if count == 0:
                self.stdout.write("All households already have categories. Use --sync to add new categories (e.g. Transfer).")
            else:
                self.stdout.write(self.style.SUCCESS(f"Seeded {count} household(s)."))
