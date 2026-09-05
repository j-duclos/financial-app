"""
Report (and optionally apply) import-match rule-shadow cleanup.

Defaults to no writes. Only ``--apply`` deletes, and only unmatched RULE rows
that are shadows of an already-matched planned twin within ±5 days.

Never deletes Plaid imports. Never deletes user-entered ACTUAL/ONE_TIME rows.

  python manage.py inspect_transfer_cleanup --account-id 12
  python manage.py inspect_transfer_cleanup --account-id 12 --apply
"""
from __future__ import annotations

import json
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.db.models import Exists, OuterRef

from accounts.models import Account
from transactions.models import Transaction, TransactionMatch
from transactions.services.matching import (
    SAME_ACCOUNT_DATE_WINDOW_DAYS,
    _amounts_equal,
    purge_shadow_rule_occurrences_after_match,
)


def list_matched_rule_shadow_candidates(*, account_ids: list[int] | None) -> list[dict]:
    """Unmatched RULE rows shadowed by a MATCHED planned twin in the import window."""
    planned_qs = Transaction.objects.filter(
        rule_id__isnull=False,
        source=Transaction.Source.RULE,
        import_match_status=Transaction.ImportMatchStatus.MATCHED,
        scenario__isnull=True,
    )
    if account_ids:
        planned_qs = planned_qs.filter(account_id__in=account_ids)
    candidates: list[dict] = []
    seen: set[int] = set()
    for planned in planned_qs.order_by("date", "id").iterator(chunk_size=200):
        if not planned.rule_id or planned.date is None:
            continue
        low = planned.date - timedelta(days=SAME_ACCOUNT_DATE_WINDOW_DAYS)
        high = planned.date + timedelta(days=SAME_ACCOUNT_DATE_WINDOW_DAYS)
        dupes = (
            Transaction.objects.filter(
                rule_id=planned.rule_id,
                account_id=planned.account_id,
                date__gte=low,
                date__lte=high,
                source=Transaction.Source.RULE,
                scenario__isnull=True,
                status=Transaction.Status.PLANNED,
            )
            .exclude(pk=planned.pk)
            .exclude(import_match_status=Transaction.ImportMatchStatus.MATCHED)
            .exclude(Exists(TransactionMatch.objects.filter(planned_transaction_id=OuterRef("pk"))))
        )
        for dup in dupes:
            if dup.pk in seen:
                continue
            if planned.amount is not None and not _amounts_equal(dup.amount, planned.amount):
                continue
            if (dup.plaid_transaction_id or "").strip():
                continue
            if dup.source == Transaction.Source.PLAID:
                continue
            seen.add(dup.pk)
            candidates.append(
                {
                    "id": dup.pk,
                    "reason": "unmatched_rule_shadow_of_matched_planned",
                    "matched_planned_id": planned.pk,
                    "account_id": dup.account_id,
                    "date": dup.date.isoformat(),
                    "amount": str(dup.amount),
                    "rule_id": dup.rule_id,
                }
            )
    return candidates


class Command(BaseCommand):
    help = (
        "Dry-run-first report of RULE shadows for already-matched imports. "
        "Requires --apply to delete those RULE rows. Never deletes Plaid or manual posts."
    )

    def add_arguments(self, parser):
        parser.add_argument("--account-id", type=int, action="append", dest="account_ids")
        parser.add_argument(
            "--apply",
            action="store_true",
            help="Delete reported unmatched RULE shadows. Default is report only.",
        )

    def handle(self, *args, **options):
        account_ids = options.get("account_ids")
        apply = bool(options.get("apply"))
        if account_ids:
            ids = list(Account.objects.filter(pk__in=account_ids).values_list("pk", flat=True))
        else:
            ids = list(Account.objects.filter(is_active=True).values_list("pk", flat=True))
        candidates = list_matched_rule_shadow_candidates(account_ids=ids)
        report = {
            "dry_run": not apply,
            "window_days": SAME_ACCOUNT_DATE_WINDOW_DAYS,
            "candidate_count": len(candidates),
            "candidates": candidates,
            "deleted": 0,
        }
        if apply and candidates:
            deleted = 0
            planned_ids = {c["matched_planned_id"] for c in candidates}
            for planned in Transaction.objects.filter(pk__in=planned_ids):
                deleted += purge_shadow_rule_occurrences_after_match(planned)
            report["deleted"] = deleted
            report["dry_run"] = False
        self.stdout.write(json.dumps(report, indent=2))
