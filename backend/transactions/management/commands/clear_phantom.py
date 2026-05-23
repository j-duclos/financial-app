"""
Find and delete a phantom transaction by amount (e.g. the $3100 affecting balance but not visible).
Usage:
  python manage.py clear_phantom --account "Chase" --amount 3100
  python manage.py clear_phantom --account "Chase" --amount 3100 --dry-run   # show only, don't delete
"""
from decimal import Decimal

from django.core.management.base import BaseCommand

from accounts.models import Account
from transactions.models import Transaction, Transfer


def delete_transaction(txn: Transaction) -> None:
    """Same cascade as TransactionViewSet.perform_destroy: remove transfer partner if present."""
    try:
        transfer_out = txn.transfer_out
    except Transfer.DoesNotExist:
        transfer_out = None
    try:
        transfer_in = txn.transfer_in
    except Transfer.DoesNotExist:
        transfer_in = None
    transfer = transfer_out or transfer_in
    if transfer:
        other = (
            transfer.to_transaction
            if transfer.from_transaction_id == txn.pk
            else transfer.from_transaction
        )
        transfer.delete()
        other.delete()
    txn.delete()


class Command(BaseCommand):
    help = "Find and delete transaction(s) on an account by amount (clears phantom entries)."

    def add_arguments(self, parser):
        parser.add_argument("--account", type=str, required=True, help="Account name (e.g. Chase)")
        parser.add_argument(
            "--amount",
            type=str,
            default="3100",
            help="Amount to match (positive or negative). Default 3100.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Only list matching transactions, do not delete.",
        )

    def handle(self, *args, **options):
        account_name = options["account"].strip()
        amount_str = options["amount"].strip()
        dry_run = options["dry_run"]
        try:
            amount = Decimal(amount_str)
        except Exception:
            self.stderr.write(self.style.ERROR(f"Invalid amount: {amount_str}"))
            return
        acc = None
        if account_name.isdigit():
            acc = Account.objects.filter(pk=int(account_name)).first()
        if not acc:
            acc = Account.objects.filter(name__iexact=account_name).first()
        if not acc:
            acc = Account.objects.filter(name__icontains=account_name).first()
        if not acc:
            self.stderr.write(self.style.ERROR(f"Account not found: {account_name!r}"))
            self.stdout.write("Available accounts:")
            for a in Account.objects.order_by("name").values_list("id", "name", named=True):
                self.stdout.write(f"  id={a.id}  name={a.name!r}")
            self.stdout.write("  (Use: --account \"Exact Name\" or --account ID with account id)")
            return
        # Match both + and - amount
        matches = list(
            Transaction.objects.filter(account=acc).filter(
                amount__in=[amount, -amount]
            )
        )
        if not matches:
            self.stdout.write(
                self.style.WARNING(
                    f"No transaction(s) with amount {amount} or {-amount} on account '{acc.name}' (id={acc.id})."
                )
            )
            return
        for t in matches:
            self.stdout.write(
                f"  id={t.id} date={t.date} payee={t.payee!r} amount={t.amount}"
            )
        if dry_run:
            self.stdout.write(self.style.SUCCESS(f"Dry run: would delete {len(matches)} transaction(s)."))
            return
        for t in matches:
            delete_transaction(t)
        self.stdout.write(self.style.SUCCESS(f"Deleted {len(matches)} transaction(s)."))
