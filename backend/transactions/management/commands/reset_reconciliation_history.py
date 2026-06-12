"""Deactivate reconciliation sessions so reconcile can start from the earliest ledger row."""

from django.core.management.base import BaseCommand

from accounts.models import Account
from transactions.services.reconciliation import (
    min_reconcile_start_date,
    reset_reconciliation_history_for_account,
)


class Command(BaseCommand):
    help = (
        "Deactivate active reconciliation sessions on one or more accounts. "
        "Use after clearing and re-importing transactions so reconcile is not locked "
        "to a prior period end."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--account-id",
            type=int,
            action="append",
            dest="account_ids",
            help="Account id to reset (repeatable). Omit to reset every account with active sessions.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show what would be reset without changing data.",
        )

    def handle(self, *args, **options):
        account_ids = options.get("account_ids")
        dry_run = options["dry_run"]

        if account_ids:
            accounts = Account.objects.filter(pk__in=account_ids).order_by("id")
        else:
            accounts = (
                Account.objects.filter(
                    reconciliations__status="COMPLETED",
                    reconciliations__is_active=True,
                )
                .distinct()
                .order_by("id")
            )

        if not accounts.exists():
            self.stdout.write("No accounts to reset.")
            return

        for account in accounts:
            floor_before = min_reconcile_start_date(account)
            active_count = account.reconciliations.filter(
                status="COMPLETED", is_active=True
            ).count()
            if dry_run:
                self.stdout.write(
                    f"Would reset account #{account.id} {account.name}: "
                    f"{active_count} active session(s), floor={floor_before}"
                )
                continue

            result = reset_reconciliation_history_for_account(
                account, reason="management_reset_reconciliation_history"
            )
            floor_after = min_reconcile_start_date(account)
            self.stdout.write(
                f"Reset account #{account.id} {account.name}: "
                f"deactivated {result['sessions_deactivated']} session(s), "
                f"cleared {result['transactions_unreconciled_count']} reconciled flag(s), "
                f"floor {floor_before} -> {floor_after}"
            )
