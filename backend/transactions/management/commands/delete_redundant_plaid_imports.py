"""
Permanently delete extra Plaid re-sync rows that duplicate an already-visible bank post.

Use when duplicate Capital One / Zelle imports reappeared after a bad auto-restore.

  python manage.py delete_redundant_plaid_imports --account-name Chase --dry-run
  python manage.py delete_redundant_plaid_imports --account-id 1 --execute
  python manage.py delete_redundant_plaid_imports --household-id 1 --execute
"""
from __future__ import annotations

from django.core.management.base import BaseCommand

from accounts.models import Account
from transactions.services.matching import delete_redundant_plaid_imports_for_accounts


class Command(BaseCommand):
    help = "Delete Plaid re-sync duplicates that already have a visible ledger twin."

    def add_arguments(self, parser):
        parser.add_argument("--account-id", type=int)
        parser.add_argument("--account-name", type=str, help="Case-insensitive substring on account name")
        parser.add_argument("--household-id", type=int)
        parser.add_argument("--dry-run", action="store_true", help="Count only (default)")
        parser.add_argument("--execute", action="store_true", help="Delete rows")

    def handle(self, *args, **options):
        account_ids = self._resolve_account_ids(options)
        if not account_ids:
            self.stderr.write("No accounts matched.")
            return

        dry_run = not options["execute"]
        if dry_run:
            self.stdout.write("Dry run — pass --execute to delete.\n")

        removed = delete_redundant_plaid_imports_for_accounts(account_ids, dry_run=dry_run)
        label = "Would delete" if dry_run else "Deleted"
        self.stdout.write(self.style.SUCCESS(f"{label} {removed} redundant Plaid row(s) on {len(account_ids)} account(s)."))

    def _resolve_account_ids(self, options) -> list[int]:
        if options.get("account_id"):
            return [int(options["account_id"])]
        if options.get("household_id"):
            return list(
                Account.objects.filter(household_id=options["household_id"]).values_list("pk", flat=True)
            )
        name = (options.get("account_name") or "").strip()
        if name:
            qs = Account.objects.filter(name__icontains=name)
            if options.get("household_id"):
                qs = qs.filter(household_id=options["household_id"])
            accounts = list(qs)
            if not accounts:
                raise SystemExit(f"No account matching {name!r}.")
            if len(accounts) > 1:
                rows = "\n".join(f"  id={a.id} name={a.name!r}" for a in accounts[:20])
                raise SystemExit(f"Multiple accounts match {name!r} — use --account-id.\n{rows}")
            return [accounts[0].pk]
        raise SystemExit("Provide --account-id, --account-name, or --household-id.")
