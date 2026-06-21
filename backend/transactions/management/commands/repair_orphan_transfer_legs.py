"""
Recreate missing checking/bank legs for one-sided transfer groups (orphan card payments).

  python manage.py repair_orphan_transfer_legs --account-id 6 --dry-run
  python manage.py repair_orphan_transfer_legs --account-id 1
  python manage.py repair_orphan_transfer_legs --household-id 1
"""
from __future__ import annotations

from django.core.management.base import BaseCommand
from django.db.models import Count, Q

from accounts.models import Account
from common.services.cache import invalidate_financial_cache_for_household
from core.timeline_cache import bump_timeline_cache_for_household
from transactions.models import Transfer, TransferGroup, Transaction
from transactions.services.posting import (
    repair_orphan_transfer_group_legs,
    rollback_bogus_repair_transfer_legs,
)


class Command(BaseCommand):
    help = "Backfill missing transfer legs and Transfer rows for broken transfer groups."

    def add_arguments(self, parser):
        parser.add_argument("--account-id", type=int, help="Repair groups touching this account.")
        parser.add_argument("--household-id", type=int, help="Repair all accounts in a household.")
        parser.add_argument(
            "--rollback-synthetics",
            action="store_true",
            help="Remove duplicate synthetic outflows from a prior bad repair (rewire to real bank rows).",
        )
        parser.add_argument(
            "--synthetic-min-pk",
            type=int,
            default=6510,
            help="Minimum transaction pk treated as synthetic repair output (default 6510).",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report orphan counts only (no database changes).",
        )

    def handle(self, *args, **options):
        account_id = options.get("account_id")
        household_id = options.get("household_id")
        if account_id is None and household_id is None:
            self.stderr.write("Provide --account-id or --household-id.")
            return

        if account_id is not None:
            account_ids = [account_id]
            household_ids = list(
                Account.objects.filter(pk=account_id).values_list("household_id", flat=True)
            )
        else:
            account_ids = list(
                Account.objects.filter(household_id=household_id).values_list("pk", flat=True)
            )
            household_ids = [household_id]

        if not account_ids:
            self.stdout.write("No accounts matched.")
            return

        tg_qs = TransferGroup.objects.filter(
            Q(from_account_id__in=account_ids) | Q(to_account_id__in=account_ids)
        ).annotate(leg_count=Count("transactions"))
        one_leg = tg_qs.filter(leg_count=1).count()
        two_leg_no_bridge = 0
        for tg in tg_qs.filter(leg_count=2).iterator(chunk_size=200):
            legs = list(Transaction.objects.filter(transfer_group_id=tg.pk))
            if len(legs) != 2:
                continue
            out_leg = next((t for t in legs if t.amount is not None and t.amount < 0), None)
            in_leg = next((t for t in legs if t.amount is not None and t.amount > 0), None)
            if out_leg and in_leg and not Transfer.objects.filter(from_transaction=out_leg).exists():
                two_leg_no_bridge += 1

        self.stdout.write(
            f"Found {one_leg} transfer group(s) with exactly one leg and "
            f"{two_leg_no_bridge} pair(s) missing a Transfer row."
        )

        if options["dry_run"]:
            return

        if options["rollback_synthetics"]:
            stats = rollback_bogus_repair_transfer_legs(
                synthetic_min_pk=options["synthetic_min_pk"],
                account_ids=account_ids,
            )
            for hid in {h for h in household_ids if h is not None}:
                bump_timeline_cache_for_household(hid)
                invalidate_financial_cache_for_household(hid)
            self.stdout.write(
                self.style.SUCCESS(
                    f"Rollback — rewired {stats['rewired']}, removed {stats['removed']} bogus synthetic leg(s); "
                    f"kept {stats['kept']} future forecast leg(s)."
                )
            )
            return

        repaired = repair_orphan_transfer_group_legs(account_ids)
        for hid in {h for h in household_ids if h is not None}:
            bump_timeline_cache_for_household(hid)
            invalidate_financial_cache_for_household(hid)

        self.stdout.write(self.style.SUCCESS(f"Repaired {repaired} transfer group leg(s)."))
