"""
Remove duplicate Plaid imports created when the same bank rows were synced twice
(e.g. re-link assigned a new plaid_transaction_id for the same payment).

Keeps one row per (account, date, amount, payee) among PLAID sources. Prefers the
row already matched to a planned transaction, otherwise the oldest import.

Run locally against Render Postgres (backend/.env DATABASE_URL):

  python manage.py dedupe_reimported_plaid_txns --dry-run
  python manage.py dedupe_reimported_plaid_txns --yes
  python manage.py dedupe_reimported_plaid_txns --account-id 12 --dry-run
"""
from __future__ import annotations

from collections import defaultdict

from django.core.management.base import BaseCommand
from django.db import transaction

from accounts.models import Account
from transactions.models import Transaction, TransactionMatch


def _pick_keeper(rows: list[Transaction]) -> Transaction:
    """Choose the Plaid row to keep when several represent the same bank movement."""

    def rank(t: Transaction) -> tuple:
        has_match = TransactionMatch.objects.filter(imported_transaction=t).exists()
        matched = t.import_match_status == Transaction.ImportMatchStatus.MATCHED
        has_category = t.category_id is not None
        return (
            1 if has_match else 0,
            1 if matched else 0,
            1 if has_category else 0,
            -t.created_at.timestamp(),
            -t.id,
        )

    return max(rows, key=rank)


def _find_duplicate_groups(
    *,
    account_id: int | None = None,
    household_id: int | None = None,
) -> list[tuple[list[Transaction], Transaction, list[Transaction]]]:
    qs = (
        Transaction.objects.filter(
            source=Transaction.Source.PLAID,
            scenario__isnull=True,
        )
        .exclude(plaid_transaction_id__isnull=True)
        .exclude(plaid_transaction_id="")
        .select_related("account")
        .order_by("account_id", "date", "id")
    )
    if account_id is not None:
        qs = qs.filter(account_id=account_id)
    if household_id is not None:
        qs = qs.filter(account__household_id=household_id)

    groups: dict[tuple[int, object, object, str], list[Transaction]] = defaultdict(list)
    for t in qs:
        key = (t.account_id, t.date, t.amount, t.payee.strip().upper())
        groups[key].append(t)

    result: list[tuple[list[Transaction], Transaction, list[Transaction]]] = []
    for rows in groups.values():
        if len(rows) < 2:
            continue
        keeper = _pick_keeper(rows)
        losers = [r for r in rows if r.pk != keeper.pk]
        result.append((rows, keeper, losers))
    return result


class Command(BaseCommand):
    help = "Delete duplicate Plaid imports from re-link / double-sync (same date, amount, payee)."

    def add_arguments(self, parser):
        parser.add_argument("--account-id", type=int, help="Limit to one account.")
        parser.add_argument("--household-id", type=int, help="Limit to one household.")
        parser.add_argument("--dry-run", action="store_true", help="List duplicates only.")
        parser.add_argument("--yes", action="store_true", help="Delete redundant rows.")

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        if not dry_run and not options["yes"]:
            self.stderr.write("Pass --dry-run to preview or --yes to delete duplicates.")
            return

        groups = _find_duplicate_groups(
            account_id=options.get("account_id"),
            household_id=options.get("household_id"),
        )
        if not groups:
            self.stdout.write("No duplicate Plaid import groups found.")
            return

        by_account: dict[int, int] = defaultdict(int)
        for _rows, keeper, losers in groups:
            by_account[keeper.account_id] += len(losers)

        self.stdout.write(
            f"Found {len(groups)} duplicate group(s), {sum(len(l) for _, _, l in groups)} row(s) to remove:"
        )
        for acct_id, n in sorted(by_account.items(), key=lambda x: -x[1]):
            acct = Account.objects.filter(pk=acct_id).first()
            label = f"{acct.name} #{acct_id}" if acct else f"account #{acct_id}"
            self.stdout.write(f"  {label}: {n}")

        for rows, keeper, losers in sorted(groups, key=lambda g: (g[1].account_id, g[1].date, g[1].id)):
            self.stdout.write(
                f"\n  keep id={keeper.id} ({keeper.date} {keeper.amount} {keeper.payee!r})"
            )
            for loser in losers:
                self.stdout.write(
                    f"    remove id={loser.id} plaid={loser.plaid_transaction_id} "
                    f"created={loser.created_at.date()}"
                )

        if dry_run:
            self.stdout.write(self.style.WARNING("\nDry run — no rows deleted."))
            return

        removed = 0
        with transaction.atomic():
            for _rows, keeper, losers in groups:
                for loser in losers:
                    loser.delete()
                    removed += 1

        self.stdout.write(self.style.SUCCESS(f"\nRemoved {removed} duplicate Plaid import(s)."))
