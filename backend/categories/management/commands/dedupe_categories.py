"""Merge duplicate categories per household. Usage:
  python manage.py dedupe_categories
  python manage.py dedupe_categories --household 1
  python manage.py dedupe_categories --dry-run
"""
from django.core.management.base import BaseCommand

from categories.services.dedupe import merge_duplicate_categories


class Command(BaseCommand):
    help = "Merge duplicate categories (same household, name, type, parent) and archive extras."

    def add_arguments(self, parser):
        parser.add_argument(
            "household_id",
            nargs="?",
            type=int,
            help="Optional household id; omit to process all households.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report merges without writing changes.",
        )

    def handle(self, *args, **options):
        household_id = options.get("household_id")
        dry_run = options.get("dry_run", False)
        stats = merge_duplicate_categories(household_id=household_id, dry_run=dry_run)
        prefix = "Would merge" if dry_run else "Merged"
        self.stdout.write(
            self.style.SUCCESS(
                f"{prefix} {stats['merged']} duplicate(s) in {stats['groups']} group(s); "
                f"rewired {stats['rewired']} reference(s)."
            )
        )
