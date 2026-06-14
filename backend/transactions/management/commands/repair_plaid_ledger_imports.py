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
    repair_wrongly_suppressed_plaid_ledger,
    materialize_unmatched_plaid_imports,
    rematch_unmatched_manual_actuals,
    repair_cross_merchant_wrong_matches,
    repair_stale_planned_bank_text,
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
        stale_text = 0
        cross_merchant = 0
        reconciled_restored = 0
        flags_fixed_total = 0
        orphans_removed_total = 0
        for aid in account_ids:
            repair = repair_wrongly_suppressed_plaid_ledger(account_id=aid)
            n_reconciled = repair["restored"]
            orphans_removed = repair["orphans_removed"]
            flags_fixed = repair["reconciled_flags_fixed"]
            n_cross = repair_cross_merchant_wrong_matches(account_id=aid)
            n_stale = repair_stale_planned_bank_text(account_id=aid)
            n_invalid = repair_invalid_transaction_matches(account_id=aid)
            n_orphan = repair_orphan_absorbed_resync_matches(account_id=aid)
            n_resync = repair_materialized_plaid_resync_duplicates(account_id=aid)
            n_collapsed = collapse_materialized_actual_duplicates(account_id=aid)
            n_manual = rematch_unmatched_manual_actuals(account_id=aid)
            n_materialized = materialize_unmatched_plaid_imports(account_id=aid)
            stale_text += n_stale
            cross_merchant += n_cross
            invalid_matches += n_invalid
            orphan_resync += n_orphan
            resync_dupes += n_resync
            released += n_reconciled
            collapsed += n_collapsed
            manual_linked += n_manual
            materialized += n_materialized
            reconciled_restored += n_reconciled
            flags_fixed_total += flags_fixed
            orphans_removed_total += orphans_removed
            acct = Account.objects.filter(pk=aid).first()
            label = f"{acct.name} #{aid}" if acct else f"account #{aid}"
            self.stdout.write(
                f"  {label}: restored={n_reconciled} orphans_removed={orphans_removed} "
                f"reconciled_flags_fixed={flags_fixed} cross_merchant={n_cross} stale_text={n_stale} "
                f"invalid_matches={n_invalid} orphan_resync={n_orphan} resync_dupes={n_resync} "
                f"collapsed={n_collapsed} manual_linked={n_manual} materialized={n_materialized}"
            )

        for hid in {h for h in household_ids if h is not None}:
            bump_timeline_cache_for_household(hid)
            invalidate_financial_cache_for_household(hid)

        self.stdout.write(
            self.style.SUCCESS(
                f"Done — restored {released} hidden Plaid import(s), removed {orphans_removed_total} orphan "
                f"ACTUAL twin(s), fixed reconciled flags on {flags_fixed_total} row(s), fixed {stale_text} stale "
                f"unlinked {cross_merchant} cross-merchant match(es), removed {invalid_matches} invalid match(es), "
                f"fixed {orphan_resync} orphan re-sync match(es), dropped {resync_dupes} re-sync "
                f"duplicate(s), collapsed {collapsed} materialized duplicate(s), linked {manual_linked} manual "
                f"row(s) to imports, materialized {materialized} orphan import(s)."
            )
        )
