"""
Merge duplicate Accounts created when Plaid re-link did not reuse existing rows.

Keeps the account with the most transactions (tie: lowest id). Moves transactions and
the newer Plaid link onto the keeper, then soft-deletes the duplicate.

  python manage.py dedupe_plaid_accounts --dry-run
  python manage.py dedupe_plaid_accounts --yes
"""
from collections import defaultdict

from django.core.management.base import BaseCommand
from django.db import transaction
from django.db.models import Count
from django.utils import timezone

from accounts.models import Account
from plaid_link.models import PlaidLinkedAccount
from plaid_link.services import remove_plaid_item_from_plaid
from transactions.models import Transaction


class Command(BaseCommand):
    help = "Merge duplicate accounts that share household, type, and last_four."

    def add_arguments(self, parser):
        parser.add_argument(
            "--household-id",
            type=int,
            help="Limit to one household (default: all).",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Print actions without writing.",
        )
        parser.add_argument(
            "--yes",
            action="store_true",
            help="Apply merges (required without --dry-run).",
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        if not dry_run and not options["yes"]:
            self.stderr.write("Pass --dry-run to preview or --yes to apply.")
            return

        qs = (
            Account.objects.filter(last_four__regex=r"^\d{4}$")
            .exclude(status=Account.Status.DELETED)
            .annotate(txn_count=Count("transactions"))
        )
        if options["household_id"]:
            qs = qs.filter(household_id=options["household_id"])

        groups: dict[tuple[int, str, str], list[Account]] = defaultdict(list)
        for acct in qs.order_by("id"):
            key = (acct.household_id, acct.account_type, acct.last_four)
            groups[key].append(acct)

        merged = 0
        for key, accounts in sorted(groups.items()):
            if len(accounts) < 2:
                continue
            keeper = max(accounts, key=lambda a: (a.txn_count, -a.id))
            dupes = [a for a in accounts if a.id != keeper.id]
            self.stdout.write(
                f"Group {key}: keep #{keeper.id} ({keeper.name!r}, {keeper.txn_count} txns), "
                f"merge {len(dupes)} duplicate(s)"
            )
            for dup in dupes:
                self.stdout.write(f"  - remove #{dup.id} ({dup.name!r}, {dup.txn_count} txns)")
                if dry_run:
                    continue
                with transaction.atomic():
                    self._merge_pair(keeper, dup)
                merged += 1

        if dry_run:
            self.stdout.write(self.style.WARNING("Dry run — no changes made."))
        else:
            self.stdout.write(self.style.SUCCESS(f"Merged {merged} duplicate account(s)."))

    def _merge_pair(self, keeper: Account, dup: Account) -> None:
        moved_txns = Transaction.objects.filter(account=dup).update(account=keeper)
        self.stdout.write(f"    moved {moved_txns} transaction(s) to #{keeper.id}")

        keeper_link = PlaidLinkedAccount.objects.filter(account=keeper).first()
        dup_link = PlaidLinkedAccount.objects.filter(account=dup).first()

        if dup_link and keeper_link:
            keep_dup = dup_link.item.created_at >= keeper_link.item.created_at
            if keep_dup:
                stale_item = keeper_link.item
                keeper_link.delete()
                dup_link.account = keeper
                dup_link.save(update_fields=["account"])
                if not stale_item.linked_accounts.exists():
                    remove_plaid_item_from_plaid(stale_item)
                    stale_item.delete()
            else:
                stale_item = dup_link.item
                dup_link.delete()
                if not stale_item.linked_accounts.exists():
                    remove_plaid_item_from_plaid(stale_item)
                    stale_item.delete()
        elif dup_link:
            dup_link.account = keeper
            dup_link.save(update_fields=["account"])

        dup.status = Account.Status.DELETED
        dup.deleted_at = timezone.now()
        dup.is_hidden = True
        dup.is_active = False
        dup.save(update_fields=["status", "deleted_at", "is_hidden", "is_active", "updated_at"])
