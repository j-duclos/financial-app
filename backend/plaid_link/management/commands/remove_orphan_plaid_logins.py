"""
Delete Plaid Items with zero linked accounts (empty boxes in Bank connections).

Run locally against Render Postgres (backend/.env DATABASE_URL):

  python manage.py remove_orphan_plaid_logins --dry-run
  python manage.py remove_orphan_plaid_logins --yes
"""
from django.core.management.base import BaseCommand
from django.db.models import Count

from plaid_link.models import PlaidItem
from plaid_link.services import remove_plaid_item_from_plaid


class Command(BaseCommand):
    help = "Remove Plaid logins that have no accounts mapped."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="List only; do not delete.")
        parser.add_argument("--yes", action="store_true", help="Delete orphans (required without --dry-run).")

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        if not dry_run and not options["yes"]:
            self.stderr.write("Pass --dry-run to preview or --yes to delete.")
            return

        orphans = list(
            PlaidItem.objects.annotate(n=Count("linked_accounts"))
            .filter(n=0)
            .order_by("institution_name", "id")
        )
        if not orphans:
            self.stdout.write("No orphan Plaid logins found.")
            return

        for item in orphans:
            self.stdout.write(
                f"  #{item.id} {item.institution_name or 'Bank'} (item_id={item.item_id})"
            )

        if dry_run:
            self.stdout.write(self.style.WARNING(f"Dry run — would remove {len(orphans)} login(s)."))
            return

        for item in orphans:
            remove_plaid_item_from_plaid(item)
            item.delete()

        self.stdout.write(self.style.SUCCESS(f"Removed {len(orphans)} orphan Plaid login(s)."))
