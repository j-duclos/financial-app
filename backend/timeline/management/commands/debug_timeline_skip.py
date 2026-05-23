"""
Debug why scheduled transfer (e.g. credit card) payments still appear when the
destination is paid off.

Run from backend directory:
  python manage.py debug_timeline_skip
  python manage.py debug_timeline_skip --account_id=3
  python manage.py debug_timeline_skip --account_id=3 --rule_id=1

--account_id: Simulate "viewing this account only" (like the Transactions page).
  Omit to simulate "all accounts".
--rule_id: Only show this rule. Omit to show all transfer rules.

WHAT THIS COMMAND SHOWS:
- Which accounts are "in view" (account_ids).
- For each transfer rule and each upcoming occurrence date:
  - The balance we compute for the destination account (before that date).
  - Where that balance came from (rows vs DB, payee-matched payments).
  - Whether we SKIP (balance >= 0) or ADD the payment.
- Actual transactions in view (so you can see if the $2 payment is there).
"""
from datetime import date, timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db.models import Q

from accounts.models import Account
from core.utils import get_households_for_user
from timeline.models import RecurringRule, Scenario
from timeline.services.ledger import (
    _balance_at_date_from_rows,
    _balance_at_end_of_date,
    _sum_payments_to_card_from_other_accounts,
    apply_scenario_overrides,
    generate_rule_occurrences,
)
from transactions.models import Transaction


class Command(BaseCommand):
    help = "Debug timeline skip logic: why scheduled payments appear or disappear."

    def add_arguments(self, parser):
        parser.add_argument("--account_id", type=int, default=None, help="Simulate viewing only this account (e.g. Chase or TJ Max).")
        parser.add_argument("--rule_id", type=int, default=None, help="Only debug this rule.")
        parser.add_argument("--user_id", type=int, default=None, help="User (default: first user).")

    def handle(self, *args, **options):
        from django.contrib.auth import get_user_model
        User = get_user_model()
        user_id = options.get("user_id")
        if user_id:
            user = User.objects.filter(pk=user_id).first()
        else:
            user = User.objects.first()
        if not user:
            self.stderr.write(self.style.ERROR("No user found."))
            return

        account_id = options.get("account_id")
        rule_id = options.get("rule_id")
        today = date.today()
        start_date = today
        end_date = today + timedelta(days=90)

        households = get_households_for_user(user)
        if not households.exists():
            self.stderr.write(self.style.ERROR("User has no households."))
            return
        households = households[:1]

        accounts = Account.objects.filter(household__in=households, is_active=True)
        if account_id is not None:
            accounts = accounts.filter(pk=account_id)
        account_ids = list(accounts.values_list("pk", flat=True))
        if not account_ids:
            self.stderr.write(self.style.ERROR("No accounts in view."))
            return

        accs = {a.id: a for a in Account.objects.filter(pk__in=account_ids)}
        opening = {}
        for aid in account_ids:
            acc = accs.get(aid)
            sb = Decimal(str(acc.starting_balance)) if acc and acc.starting_balance is not None else Decimal("0")
            if acc and str(getattr(acc, "account_type", "") or "").upper() == "CREDIT" and sb > 0:
                sb = -sb
            opening[aid] = sb

        actual = list(
            Transaction.objects.filter(
                account_id__in=account_ids,
                date__lte=end_date,
            ).select_related("account", "category").order_by("date", "id")
        )
        rows = []
        for t in actual:
            rows.append({
                "date": t.date,
                "description": t.payee,
                "account_id": t.account_id,
                "account_name": t.account.name,
                "amount": t.amount,
                "source": "actual",
                "rule_id": t.rule_id,
            })

        self.stdout.write("")
        self.stdout.write(self.style.HTTP_INFO("=== WHAT WE ARE SIMULATING ==="))
        self.stdout.write(f"User: {user} (id={user.pk})")
        self.stdout.write(f"View: account_id filter = {account_id}  =>  account_ids = {account_ids}")
        names = [accs.get(aid).name if accs.get(aid) else f"id={aid}" for aid in account_ids]
        self.stdout.write(f"Account names in view: {names}")
        self.stdout.write(f"Date range: {start_date} to {end_date} (today = {today})")
        self.stdout.write("")

        self.stdout.write(self.style.HTTP_INFO("=== ACTUAL TRANSACTIONS IN VIEW ==="))
        if not actual:
            self.stdout.write("(none)")
        else:
            for t in actual:
                self.stdout.write(f"  {t.date}  account={t.account_id} ({t.account.name})  payee={t.payee!r}  amount={t.amount}")
        self.stdout.write("")

        rules_qs = RecurringRule.objects.filter(
            household__in=households,
            active=True,
        ).filter(
            Q(account_id__in=account_ids) | Q(transfer_to_account_id__in=account_ids)
        ).select_related("account", "category", "transfer_to_account")
        if rule_id is not None:
            rules_qs = rules_qs.filter(pk=rule_id)
        rules_qs = list(rules_qs)
        self.stdout.write(f"Rules in scope (account or transfer_to in view): {len(rules_qs)}")
        for r in rules_qs:
            to_id = getattr(r, "transfer_to_account_id", None)
            to_name = r.transfer_to_account.name if getattr(r, "transfer_to_account", None) else ""
            cat = getattr(r, "category", None)
            cat_n = cat.name if cat else ""
            self.stdout.write(f"  Rule id={r.pk} name={r.name!r} account_id={r.account_id} transfer_to={to_id} ({to_name}) category={cat_n!r} direction={r.direction}")
        transfer_rules = [r for r in rules_qs if r.transfer_to_account_id]
        self.stdout.write(f"Of those, with transfer_to_account_id set: {len(transfer_rules)}")
        if not transfer_rules:
            self.stdout.write("")
            self.stdout.write(self.style.WARNING(
                "No transfer rules (no rule has 'Transfer to account' set). "
                "Expense rules with category 'Credit Card Payment' are also skipped when we match a CREDIT account by name."
            ))

        for rule in transfer_rules:
            eff = apply_scenario_overrides(rule, None)
            if not eff.get("active", True):
                continue
            eff_start = eff.get("start_date") or rule.start_date
            eff_end = eff.get("end_date")
            occ_dates = generate_rule_occurrences(
                rule, start_date, end_date,
                effective_start=eff_start,
                effective_end=eff_end,
            )
            occ_dates = [d for d in occ_dates if d >= today][:5]

            from_acc_id = eff.get("account_id") or rule.account_id
            to_acc_id = rule.transfer_to_account_id
            to_acc = getattr(rule, "transfer_to_account", None) or Account.objects.filter(pk=to_acc_id).first()
            to_name = to_acc.name if to_acc else ""
            from_acc = Account.objects.filter(pk=from_acc_id).first()
            from_name = from_acc.name if from_acc else ""

            self.stdout.write("")
            self.stdout.write(self.style.HTTP_INFO(f"=== RULE: {rule.name} (id={rule.pk}) ==="))
            self.stdout.write(f"  From: {from_name} (id={from_acc_id})  =>  To: {to_name} (id={to_acc_id})")
            self.stdout.write(f"  Destination (to) in view?  to_acc_id {to_acc_id} in account_ids {account_ids}  =>  {to_acc_id in account_ids}")
            self.stdout.write("")

            for d in occ_dates:
                day_before = d - timedelta(days=1)
                self.stdout.write(f"  --- Occurrence date: {d}  (day_before = {day_before}) ---")
                self.stdout.write("    (Credit card: negative = debt → add payment; zero or positive = paid off → SKIP)")

                if to_acc_id in account_ids:
                    bal_rows = _balance_at_date_from_rows(to_acc_id, day_before, rows, opening)
                    payee_from_rows = Decimal("0")
                    to_name_norm = (to_name or "").strip()
                    for r in rows:
                        if r.get("source") != "actual" or r.get("account_id") not in account_ids:
                            continue
                        rd = r.get("date")
                        if isinstance(rd, str):
                            rd = date.fromisoformat(rd[:10]) if rd else None
                        if rd is None or rd > day_before:
                            continue
                        amt = r.get("amount")
                        try:
                            amt_d = amt if isinstance(amt, Decimal) else Decimal(str(amt))
                        except (TypeError, ValueError):
                            continue
                        if amt_d >= 0:
                            continue
                        payee_desc = (r.get("description") or "").strip()
                        if not payee_desc or not to_name_norm:
                            continue
                        if payee_desc != to_name_norm and not (to_name_norm.startswith(payee_desc) or payee_desc.startswith(to_name_norm)):
                            continue
                        payee_from_rows += abs(amt_d)
                    db_payments = _sum_payments_to_card_from_other_accounts(
                        to_acc_id, to_name or "", day_before, households
                    )
                    total = bal_rows + payee_from_rows + db_payments
                    self.stdout.write(f"    (destination IN view)")
                    self.stdout.write(f"    balance from rows (opening + txns for to_acc through day_before) = {bal_rows}")
                    self.stdout.write(f"    + payee-matched outflows from rows (payee ~ {to_name_norm!r}) = {payee_from_rows}")
                    self.stdout.write(f"    + DB payments to card (payee iexact {to_name!r} from other accounts) = {db_payments}")
                    self.stdout.write(f"    => total balance_before_d = {total}")
                else:
                    bal_db = _balance_at_end_of_date(to_acc_id, day_before)
                    from_rows_card = Decimal("0")
                    for r in rows:
                        rd = r.get("date")
                        if isinstance(rd, str):
                            rd = date.fromisoformat(rd[:10]) if rd else None
                        if rd is not None and r.get("account_id") == to_acc_id and rd <= day_before:
                            amt = r["amount"] if isinstance(r["amount"], Decimal) else Decimal(str(r["amount"]))
                            from_rows_card += amt
                    from_rows_rule = Decimal("0")
                    in_amount = abs(Decimal(str(eff.get("amount") or rule.amount)))
                    for r in rows:
                        rd = r.get("date")
                        if isinstance(rd, str):
                            rd = date.fromisoformat(rd[:10]) if rd else None
                        if (
                            rd is not None
                            and r.get("source") == "rule"
                            and r.get("rule_id") == rule.id
                            and r.get("account_id") == from_acc_id
                            and rd <= day_before
                        ):
                            from_rows_rule += in_amount
                    db_payments = _sum_payments_to_card_from_other_accounts(
                        to_acc_id, to_name or "", day_before, households
                    )
                    total = bal_db + from_rows_card + from_rows_rule + db_payments
                    self.stdout.write(f"    (destination NOT in view)")
                    self.stdout.write(f"    balance from DB (card; negative=debt) = {bal_db}")
                    self.stdout.write(f"    + from rows (to_acc rows through day_before) = {from_rows_card}")
                    self.stdout.write(f"    + from rows (this rule, from_acc, through day_before) = {from_rows_rule}")
                    self.stdout.write(f"    + DB payments to card (payee iexact {to_name!r}) = {db_payments}")
                    self.stdout.write(f"    => total balance_before_d = {total}  (>= 0 = paid off → SKIP)")

                skip = total >= 0
                self.stdout.write(f"    SKIP? (balance_before_d >= 0) => {skip}")
                if skip:
                    self.stdout.write(self.style.SUCCESS(f"    => This occurrence would NOT be added (payment suppressed)."))
                else:
                    self.stdout.write(self.style.WARNING(f"    => This occurrence WOULD be added (payment shown)."))
                self.stdout.write("")

        # Expense rules with Credit Card Payment category (no transfer_to): we infer card from rule name.
        expense_credit = [
            r for r in rules_qs
            if r.direction == "EXPENSE"
            and getattr(r, "category", None)
            and "credit" in (r.category.name or "").lower()
            and not r.transfer_to_account_id
        ]
        if expense_credit:
            self.stdout.write("")
            self.stdout.write(self.style.HTTP_INFO("=== EXPENSE RULES WITH CREDIT CARD CATEGORY (no transfer_to) ==="))
            for rule in expense_credit:
                cat_name = rule.category.name if rule.category else ""
                # Find CREDIT account whose name matches rule name
                rule_name_lower = (rule.name or "").lower()
                card_for_skip = None
                for a in Account.objects.filter(household__in=households, account_type="CREDIT", is_active=True):
                    an = (a.name or "").strip()
                    if not an:
                        continue
                    if an.lower() in rule_name_lower or rule_name_lower in an.lower() or rule_name_lower.startswith(an.lower()) or an.lower().startswith(rule_name_lower[:20]):
                        card_for_skip = a
                        break
                self.stdout.write(f"  Rule id={rule.pk} name={rule.name!r} category={cat_name!r}")
                self.stdout.write(f"    Matched CREDIT account for skip: {card_for_skip.name if card_for_skip else 'NONE'}")
                if not card_for_skip:
                    continue
                eff = apply_scenario_overrides(rule, None)
                eff_start = eff.get("start_date") or rule.start_date
                occ_dates = generate_rule_occurrences(rule, start_date, end_date, effective_start=eff_start, effective_end=eff.get("end_date"))
                occ_dates = [d for d in occ_dates if d >= today][:3]
                for d in occ_dates:
                    day_before = d - timedelta(days=1)
                    to_acc_id = card_for_skip.id
                    to_name = card_for_skip.name
                    if to_acc_id in account_ids:
                        total = _balance_at_date_from_rows(to_acc_id, day_before, rows, opening)
                    else:
                        total = _balance_at_end_of_date(to_acc_id, day_before)
                    to_name_norm = (to_name or "").strip()
                    payee_from_rows = Decimal("0")
                    for r in rows:
                        if r.get("source") != "actual" or r.get("account_id") not in account_ids:
                            continue
                        rd = r.get("date")
                        if isinstance(rd, str):
                            rd = date.fromisoformat(rd[:10]) if rd else None
                        if rd is None or rd > day_before:
                            continue
                        amt = r.get("amount")
                        try:
                            amt_d = amt if isinstance(amt, Decimal) else Decimal(str(amt))
                        except (TypeError, ValueError):
                            continue
                        if amt_d >= 0:
                            continue
                        payee_desc = (r.get("description") or "").strip()
                        if not payee_desc or not to_name_norm:
                            continue
                        if payee_desc != to_name_norm and not (to_name_norm.startswith(payee_desc) or payee_desc.startswith(to_name_norm)):
                            continue
                        payee_from_rows += abs(amt_d)
                    total += payee_from_rows + _sum_payments_to_card_from_other_accounts(to_acc_id, to_name or "", day_before, households)
                    skip = total >= 0
                    self.stdout.write(f"    Date {d}: balance_before_d={total}  =>  SKIP={skip}")

        self.stdout.write(self.style.HTTP_INFO("=== END DEBUG ==="))
