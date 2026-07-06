"""
Unmark transactions wrongly reconciled after the last session's period_end.

  python manage.py repair_post_period_reconciliations --account-id 6
  python manage.py repair_post_period_reconciliations --household-id 1
"""
from __future__ import annotations

import json

from django.core.management.base import BaseCommand

from accounts.models import Account
from transactions.services.reconciliation import unreconcile_transactions_after_period_end


class Command(BaseCommand):
    help = "Clear reconciled flags on rows dated after the last closed statement period."

    def add_arguments(self, parser):
        parser.add_argument("--account-id", type=int, action="append", dest="account_ids")
        parser.add_argument("--household-id", type=int, help="All accounts in household.")

    def handle(self, *args, **options):
        account_ids = options.get("account_ids") or []
        household_id = options.get("household_id")
        if household_id is not None:
            account_ids.extend(
                Account.objects.filter(household_id=household_id).values_list("pk", flat=True)
            )
        if not account_ids:
            self.stderr.write("Provide --account-id and/or --household-id.")
            return

        total = 0
        by_account: dict[str, int] = {}
        for aid in sorted(set(account_ids)):
            acc = Account.objects.filter(pk=aid).first()
            if acc is None:
                continue
            n = unreconcile_transactions_after_period_end(acc)
            if n:
                by_account[str(aid)] = n
                total += n

        self.stdout.write(json.dumps({"repaired": total, "by_account": by_account}))
