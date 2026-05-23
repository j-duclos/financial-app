"""
Retroactively remove duplicate manual or rule-shadow rows that match an existing Plaid-imported row.

During Plaid sync we merge new posts onto matching rows (manual or recurring-rule materializations);
this command fixes older duplicates where both a shadow row (no plaid_transaction_id) and a Plaid
row exist on the same account.

Keeps the bank/real row (Plaid import or a plain actual entry), copies category/tags from the
shadow row when missing, then removes the duplicate rule materialization. For recurring transfer
rules, the other account leg is removed and the occurrence is skipped so the rule does not
recreate that date.

Also pairs **ACTUAL** / **ONE_TIME** rows (no Plaid id) with same-amount **RULE** shadows in the
date window — e.g. insurer description \"Myuhc\" vs rule label \"Medical Insurance\".

Usage:
  python manage.py merge_plaid_duplicate_txns --account-name Savor --dry-run
  python manage.py merge_plaid_duplicate_txns --account-id 42 --execute
"""
from __future__ import annotations

from datetime import timedelta

from django.core.management.base import BaseCommand

from accounts.models import Account
from plaid_link.services import MANUAL_MERGE_DATE_WINDOW_DAYS
from timeline.models import RecurringRule, RecurringRuleSkip
from transactions.models import Transaction, Transfer
from transactions.services import eligible_manual_transactions_queryset


def _delete_transaction_cascade(txn: Transaction) -> None:
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


def _delete_rule_shadow_with_counterpart(manual_t: Transaction) -> None:
    """
    Remove duplicate shadow row; for recurring transfer rules also drop the other leg and skip
    the occurrence (same behavior as Plaid sync merge).
    """
    rid = manual_t.rule_id
    occ_date = manual_t.date
    old_amt = manual_t.amount
    old_acc = manual_t.account_id
    if rid and manual_t.source == Transaction.Source.RULE:
        rule = RecurringRule.objects.filter(pk=rid).first()
        if rule and rule.transfer_to_account_id:
            low = occ_date - timedelta(days=MANUAL_MERGE_DATE_WINDOW_DAYS)
            high = occ_date + timedelta(days=MANUAL_MERGE_DATE_WINDOW_DAYS)
            other = (
                Transaction.objects.filter(
                    rule_id=rid,
                    date__gte=low,
                    date__lte=high,
                    amount=-old_amt,
                )
                .exclude(pk=manual_t.pk)
                .exclude(account_id=old_acc)
                .first()
            )
            if other is not None:
                _delete_transaction_cascade(other)
        RecurringRuleSkip.objects.get_or_create(rule_id=rid, date=occ_date)
    _delete_transaction_cascade(manual_t)


def _find_pairs(account: Account) -> list[tuple[Transaction, Transaction]]:
    """Return (plaid_txn, manual_txn) pairs to merge (manual will be deleted)."""
    manuals = list(eligible_manual_transactions_queryset(account).order_by("date", "id"))
    plaid_rows = list(
        Transaction.objects.filter(account=account, source=Transaction.Source.PLAID)
        .exclude(plaid_transaction_id__isnull=True)
        .exclude(plaid_transaction_id="")
        .order_by("date", "id")
    )
    claimed_manual: set[int] = set()
    pairs: list[tuple[Transaction, Transaction]] = []

    for p in plaid_rows:
        best: Transaction | None = None
        best_diff = 9999
        for m in manuals:
            if m.pk in claimed_manual:
                continue
            if m.amount != p.amount:
                continue
            dd = abs((m.date - p.date).days)
            if dd > MANUAL_MERGE_DATE_WINDOW_DAYS:
                continue
            rank = {Transaction.Source.ACTUAL: 0, Transaction.Source.ONE_TIME: 0, Transaction.Source.RULE: 1}.get(
                m.source, 9
            )
            best_rank = (
                {Transaction.Source.ACTUAL: 0, Transaction.Source.ONE_TIME: 0, Transaction.Source.RULE: 1}.get(
                    best.source, 9
                )
                if best
                else 99
            )
            if (
                best is None
                or dd < best_diff
                or (dd == best_diff and rank < best_rank)
                or (dd == best_diff and rank == best_rank and m.pk < best.pk)
            ):
                best = m
                best_diff = dd
        if best is not None:
            pairs.append((p, best))
            claimed_manual.add(best.pk)
    return pairs


def _find_actual_vs_rule_pairs(
    account: Account, claimed_shadow_pks: set[int]
) -> list[tuple[Transaction, Transaction]]:
    """
    Same-account duplicates where the bank/real line is ACTUAL/ONE_TIME (no Plaid id) and the
    shadow is RULE — e.g. imported or hand-entered payee vs recurring rule label.
    Returns (anchor_actual, rule_shadow); anchor row is kept.
    """
    anchors = list(
        Transaction.objects.filter(
            account=account,
            source__in=[Transaction.Source.ACTUAL, Transaction.Source.ONE_TIME],
            rule__isnull=True,
            scenario__isnull=True,
            plaid_transaction_id__isnull=True,
        )
        .filter(transfer_out__isnull=True, transfer_in__isnull=True)
        .order_by("date", "id")
    )
    rule_shadows = list(
        Transaction.objects.filter(
            account=account,
            source=Transaction.Source.RULE,
            plaid_transaction_id__isnull=True,
            scenario__isnull=True,
        )
        .filter(transfer_out__isnull=True, transfer_in__isnull=True)
        .order_by("date", "id")
    )
    pairs: list[tuple[Transaction, Transaction]] = []
    for a in anchors:
        best_r: Transaction | None = None
        best_dd = 9999
        for r in rule_shadows:
            if r.pk in claimed_shadow_pks:
                continue
            if r.amount != a.amount:
                continue
            dd = abs((r.date - a.date).days)
            if dd > MANUAL_MERGE_DATE_WINDOW_DAYS:
                continue
            if best_r is None or dd < best_dd or (dd == best_dd and r.pk < best_r.pk):
                best_r = r
                best_dd = dd
        if best_r is not None:
            pairs.append((a, best_r))
            claimed_shadow_pks.add(best_r.pk)
    return pairs


class Command(BaseCommand):
    help = "Merge duplicate rule shadows vs Plaid or plain actual rows on one account (keeps real row)."

    def add_arguments(self, parser):
        parser.add_argument("--account-name", type=str, default=None, help="Case-insensitive substring match on account name")
        parser.add_argument("--account-id", type=int, default=None, help="Exact account primary key")
        parser.add_argument("--household-id", type=int, default=None, help="Optional filter when matching by name")
        parser.add_argument("--dry-run", action="store_true", help="List pairs only (default if --execute not set)")
        parser.add_argument("--execute", action="store_true", help="Apply merges (delete manual duplicates)")

    def handle(self, *args, **options):
        acc = self._resolve_account(options)
        pairs_plaid = _find_pairs(acc)
        claimed_shadow = {m.pk for _, m in pairs_plaid}
        pairs_actual = _find_actual_vs_rule_pairs(acc, claimed_shadow)

        if not pairs_plaid and not pairs_actual:
            self.stdout.write(self.style.WARNING(f"No duplicate pairs found on account {acc.id} ({acc.name})."))
            return

        self.stdout.write(f"Account {acc.id} — {acc.name} (household {acc.household_id})")
        self.stdout.write(f"Same amount, within ±{MANUAL_MERGE_DATE_WINDOW_DAYS} days:\n")

        for plaid_t, manual_t in pairs_plaid:
            self.stdout.write(
                f"  [Plaid] keep id={plaid_t.id} date={plaid_t.date} payee={plaid_t.payee!r} | "
                f"remove id={manual_t.id} date={manual_t.date} payee={manual_t.payee!r}"
            )
        for actual_t, rule_t in pairs_actual:
            self.stdout.write(
                f"  [Actual] keep id={actual_t.id} date={actual_t.date} payee={actual_t.payee!r} | "
                f"remove rule id={rule_t.id} date={rule_t.date} payee={rule_t.payee!r}"
            )

        if options["execute"]:
            n = 0
            for plaid_t, manual_t in pairs_plaid:
                if manual_t.category_id and plaid_t.category_id is None:
                    plaid_t.category_id = manual_t.category_id
                if manual_t.tags and (not plaid_t.tags or plaid_t.tags == []):
                    plaid_t.tags = list(manual_t.tags) if isinstance(manual_t.tags, list) else manual_t.tags
                if (manual_t.memo or "").strip() and not (plaid_t.memo or "").strip():
                    plaid_t.memo = manual_t.memo
                plaid_t.save()
                _delete_rule_shadow_with_counterpart(manual_t)
                n += 1
            for actual_t, rule_t in pairs_actual:
                if rule_t.category_id and actual_t.category_id is None:
                    actual_t.category_id = rule_t.category_id
                if rule_t.tags and (not actual_t.tags or actual_t.tags == []):
                    actual_t.tags = list(rule_t.tags) if isinstance(rule_t.tags, list) else rule_t.tags
                if (rule_t.memo or "").strip() and not (actual_t.memo or "").strip():
                    actual_t.memo = rule_t.memo
                actual_t.save()
                _delete_rule_shadow_with_counterpart(rule_t)
                n += 1
            self.stdout.write(self.style.SUCCESS(f"Removed {n} duplicate shadow row(s); kept bank/real rows."))
        else:
            self.stdout.write(self.style.NOTICE("Dry-run only. Re-run with --execute to apply."))

    def _resolve_account(self, options) -> Account:
        aid = options.get("account_id")
        if aid:
            return Account.objects.select_related("household").get(pk=aid)
        name = (options.get("account_name") or "").strip()
        if not name:
            raise SystemExit("Provide --account-id or --account-name.")
        qs = Account.objects.filter(name__icontains=name).select_related("household")
        hid = options.get("household_id")
        if hid:
            qs = qs.filter(household_id=hid)
        accounts = list(qs)
        if len(accounts) == 0:
            raise SystemExit(f"No account matching name {name!r}.")
        if len(accounts) > 1:
            rows = "\n".join(f"  id={a.id} name={a.name!r} household={a.household_id}" for a in accounts[:20])
            raise SystemExit(f"Multiple accounts match {name!r}. Use --account-id or --household-id.\n{rows}")
        return accounts[0]
