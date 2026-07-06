"""
Merge Plaid imports that duplicate existing transfer/payment legs.

  python manage.py repair_transfer_leg_duplicates --user-id 1
  python manage.py repair_transfer_leg_duplicates --account-id 6 --dry-run
"""
from __future__ import annotations

import json

from django.core.management.base import BaseCommand

from transactions.services.matching import repair_broken_transfer_payment_wiring, repair_transfer_leg_duplicates


class Command(BaseCommand):
    help = "Merge duplicate bank imports into transfer/payment legs and restore missing source legs."

    def add_arguments(self, parser):
        parser.add_argument("--user-id", type=int, help="Repair accounts in this user's households.")
        parser.add_argument("--account-id", type=int, action="append", dest="account_ids", help="Limit to account(s).")
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report duplicates without merging.",
        )
        parser.add_argument(
            "--wiring-only",
            action="store_true",
            help="Only run broken wiring repair (orphan card imports / missing source legs).",
        )

    def handle(self, *args, **options):
        user_id = options.get("user_id")
        account_ids = options.get("account_ids")
        dry_run = bool(options.get("dry_run"))
        wiring_only = bool(options.get("wiring_only"))

        if user_id is None and not account_ids:
            self.stderr.write("Provide --user-id and/or --account-id.")
            return

        summary: dict = {}
        if not wiring_only:
            summary["leg_duplicates"] = repair_transfer_leg_duplicates(
                user_id=user_id,
                account_ids=account_ids,
                dry_run=dry_run,
            )
        summary["wiring"] = repair_broken_transfer_payment_wiring(
            user_id=user_id,
            account_ids=account_ids,
            dry_run=dry_run,
        )
        self.stdout.write(json.dumps(summary))
