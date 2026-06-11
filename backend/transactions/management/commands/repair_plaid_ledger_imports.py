"""
Restore wrongly hidden Plaid imports and surface orphan bank charges in the ledger.

Use after duplicate-suppression hid legitimate repeated charges (e.g. four $20 donations)
or when an unmatched Plaid import never appeared like a normal transaction row.

  python manage.py repair_plaid_ledger_imports --account-id 1 --dry-run
  python manage.py repair_plaid_ledger_imports --account-id 1
  python manage.py repair_plaid_ledger_imports --household-id 1
"""
from __future__ import annotations

from django.core.management.base import BaseCommand

from accounts.models import Account
from common.services.cache import invalidate_financial_cache_for_household
from core.timeline_cache import bump_timeline_cache_for_household
from transactions.services.matching import (
    collapse_materialized_actual_duplicates,
    materialize_unmatched_plaid_imports,
    release_excess_duplicate_plaid_imports,
    rematch_unmatched_manual_actuals,
    repair_invalid_transaction_matches,
    repair_materialized_plaid_resync_duplicates,
    repair_orphan_absorbed_resync_matches,
)


class Command(BaseCommand):
    help = "Release excess DUPLICATE Plaid rows and materialize orphan imports for the ledger."

    def add_arguments(self, parser):
        parser.add_argument("--account-id", type=int, help="Repair one account.")
        parser.add_argument("--household-id", type=int, help="Repair all accounts in a household.")
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report counts only (no database changes).",
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

        if options["dry_run"]:
            from transactions.models import Transaction

            dup = Transaction.objects.filter(
                account_id__in=account_ids,
                source=Transaction.Source.PLAID,
                import_match_status=Transaction.ImportMatchStatus.DUPLICATE,
            ).count()
            orphan = Transaction.objects.filter(
                account_id__in=account_ids,
                source=Transaction.Source.PLAID,
                import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
            ).exclude(plaid_transaction_id__isnull=True).exclude(plaid_transaction_id="").count()
            self.stdout.write(
                f"Dry run — would repair up to {dup} DUPLICATE and {orphan} UNMATCHED Plaid row(s) "
                f"across {len(account_ids)} account(s)."
            )
            return

        released = 0
        materialized = 0
        manual_linked = 0
        collapsed = 0
        invalid_matches = 0
        resync_dupes = 0
        orphan_resync = 0
        for aid in account_ids:
            n_invalid = repair_invalid_transaction_matches(account_id=aid)
            n_orphan = repair_orphan_absorbed_resync_matches(account_id=aid)
            n_resync = repair_materialized_plaid_resync_duplicates(account_id=aid)
            n_released = release_excess_duplicate_plaid_imports(account_id=aid)
            n_collapsed = collapse_materialized_actual_duplicates(account_id=aid)
            n_manual = rematch_unmatched_manual_actuals(account_id=aid)
            n_materialized = materialize_unmatched_plaid_imports(account_id=aid)
            invalid_matches += n_invalid
            orphan_resync += n_orphan
            resync_dupes += n_resync
            released += n_released
            collapsed += n_collapsed
            manual_linked += n_manual
            materialized += n_materialized
            acct = Account.objects.filter(pk=aid).first()
            label = f"{acct.name} #{aid}" if acct else f"account #{aid}"
            self.stdout.write(
                f"  {label}: invalid_matches={n_invalid} orphan_resync={n_orphan} resync_dupes={n_resync} "
                f"released={n_released} collapsed={n_collapsed} manual_linked={n_manual} "
                f"materialized={n_materialized}"
            )

        for hid in {h for h in household_ids if h is not None}:
            bump_timeline_cache_for_household(hid)
            invalidate_financial_cache_for_household(hid)

        self.stdout.write(
            self.style.SUCCESS(
                f"Done — removed {invalid_matches} invalid match(es), fixed {orphan_resync} orphan re-sync "
                f"match(es), dropped {resync_dupes} re-sync "
                f"duplicate(s), restored {released} DUPLICATE row(s), collapsed {collapsed} materialized "
                f"duplicate(s), linked {manual_linked} manual row(s) to "
                f"imports, materialized {materialized} orphan import(s)."
            )
        )
