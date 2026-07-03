"""Mark reconciled rows from closed statements and fix match-leg flags."""
from django.core.management.base import BaseCommand

from accounts.models import Account
from transactions.services.reconciliation import sync_reconciled_ledger_integrity


class Command(BaseCommand):
    help = "Seal closed-statement rows as reconciled and fix match-leg flags for one or all accounts."

    def add_arguments(self, parser):
        parser.add_argument(
            "--account-id",
            type=int,
            default=None,
            help="Single account pk; omit to run for all active accounts.",
        )

    def handle(self, *args, **options):
        account_id = options.get("account_id")
        qs = Account.objects.filter(is_active=True)
        if account_id is not None:
            qs = qs.filter(pk=account_id)
        if not qs.exists():
            self.stderr.write(self.style.ERROR("No matching accounts."))
            return

        for account in qs.order_by("pk"):
            result = sync_reconciled_ledger_integrity(account)
            if any(result.values()):
                self.stdout.write(f"{account.pk} {account.name}: {result}")
        self.stdout.write(self.style.SUCCESS("Done."))
