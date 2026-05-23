"""Atomic transaction posting, transfer creation, and manual-clear helpers."""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone

from core.models import HouseholdMembership
from timeline.models import RecurringRule, RecurringRuleSkip, StatementTransaction

from ..models import Account, Transaction, TransactionMatch, Transfer, TransferGroup
from ..rule_transfer_pairs import find_rule_transfer_counterpart_txn

_RULE_TRANSFER_SHADOW_DATE_WINDOW_DAYS = 4


def _user_can_access_household(user, household):
    return HouseholdMembership.objects.filter(household=household, user=user).exists()


def post_transaction(
    user,
    account_id,
    date,
    payee,
    amount,
    category_id=None,
    memo="",
    cleared=False,
    tags=None,
):
    """
    Create a single transaction. amount is signed (positive=inflow, negative=outflow).
    Raises ValueError if account not found or user not in household.
    """
    try:
        account = Account.objects.select_related("household").get(pk=account_id)
    except Account.DoesNotExist:
        raise ValueError("Account not found")
    if not _user_can_access_household(user, account.household):
        raise ValueError("Not allowed to post to this account")
    amount = Decimal(str(amount))
    if amount == 0:
        raise ValueError("Amount cannot be zero")
    tags = tags or []
    with transaction.atomic():
        txn_type = Transaction.TransactionType.OTHER
        if account.is_credit_card():
            if amount < 0:
                txn_type = Transaction.TransactionType.CREDIT_CARD_PURCHASE
            elif amount > 0:
                txn_type = Transaction.TransactionType.CREDIT_CARD_PAYMENT
        txn = Transaction.objects.create(
            account=account,
            date=date,
            payee=payee,
            memo=memo,
            amount=amount,
            category_id=category_id or None,
            cleared=cleared,
            tags=tags,
            transaction_type=txn_type,
        )
    return txn


def create_transfer(
    user,
    from_account_id,
    to_account_id,
    amount,
    transfer_date,
    memo="",
    from_category_id=None,
    payee=None,
    relationship_id=None,
):
    """
    Create a transfer: two linked transactions (negative from from_account, positive to to_account).
    Creates a TransferGroup for Plaid matching and forecast semantics.
    """
    amount = Decimal(str(amount))
    if amount <= 0:
        raise ValueError("Transfer amount must be positive")
    try:
        from_account = Account.objects.select_related("household").get(pk=from_account_id)
        to_account = Account.objects.select_related("household").get(pk=to_account_id)
    except Account.DoesNotExist:
        raise ValueError("Account not found")
    if from_account_id == to_account_id:
        raise ValueError("From and to account must be different")
    if from_account.household_id != to_account.household_id:
        raise ValueError("Both accounts must belong to the same household")
    if not _user_can_access_household(user, from_account.household):
        raise ValueError("Not allowed to create transfer for these accounts")
    payee_text = (payee if payee is not None else "").strip() or "Transfer"
    if isinstance(transfer_date, str):
        sched = date.fromisoformat(transfer_date[:10])
    else:
        sched = transfer_date
    today = timezone.localdate()
    txn_status = Transaction.Status.PLANNED if sched > today else Transaction.Status.CLEARED
    tg_status = TransferGroup.Status.PLANNED if sched > today else TransferGroup.Status.CLEARED
    uid = getattr(user, "pk", None)
    with transaction.atomic():
        tg = TransferGroup.objects.create(
            household_id=from_account.household_id,
            from_account=from_account,
            to_account=to_account,
            amount=amount,
            scheduled_date=sched,
            status=tg_status,
            relationship_id=relationship_id,
            created_by_id=uid if uid else None,
        )
        out_txn = Transaction.objects.create(
            account=from_account,
            date=sched,
            payee=payee_text,
            memo=memo,
            amount=-amount,
            category_id=from_category_id or None,
            cleared=False,
            tags=[],
            status=txn_status,
            planned_date=sched,
            transfer_group=tg,
            transaction_type=Transaction.TransactionType.TRANSFER,
        )
        in_type = (
            Transaction.TransactionType.CREDIT_CARD_PAYMENT
            if to_account.is_credit_card()
            else Transaction.TransactionType.TRANSFER
        )
        in_txn = Transaction.objects.create(
            account=to_account,
            date=sched,
            payee=payee_text,
            memo=memo,
            amount=amount,
            category_id=from_category_id or None,
            cleared=False,
            tags=[],
            status=txn_status,
            planned_date=sched,
            transfer_group=tg,
            transaction_type=in_type,
        )
        xfer = Transfer.objects.create(
            from_transaction=out_txn,
            to_transaction=in_txn,
            amount=amount,
            date=sched,
            memo=memo,
        )
    return xfer


def attach_out_leg_for_existing_card_inflow(
    *,
    from_account_id: int,
    in_leg: Transaction,
    out_date: date,
    memo: str = "",
    payee: str | None = None,
) -> Transaction | None:
    """
    When only the credit-card inflow leg exists (e.g. partner leg was cleared but this row was
    preserved), create the missing checking out-leg, ``TransferGroup``, and ``Transfer`` so Plaid
    can match the bank outflow to the same transfer.
    """
    if in_leg.amount is None or in_leg.amount <= 0:
        return None
    try:
        from_account = Account.objects.select_related("household").get(pk=from_account_id)
    except Account.DoesNotExist:
        return None
    to_account = in_leg.account
    if from_account.household_id != to_account.household_id:
        return None
    if to_account.account_type != Account.AccountType.CREDIT:
        return None
    if in_leg.transfer_group_id is not None:
        return None
    if in_leg.scenario_id is not None:
        return None
    try:
        _ = in_leg.transfer_in
        return None
    except Transfer.DoesNotExist:
        pass
    try:
        _ = in_leg.transfer_out
        return None
    except Transfer.DoesNotExist:
        pass
    if TransactionMatch.objects.filter(planned_transaction_id=in_leg.pk).exists():
        return None

    amount = in_leg.amount
    today = timezone.localdate()
    txn_status = Transaction.Status.PLANNED if out_date > today else Transaction.Status.CLEARED
    tg_status = TransferGroup.Status.PLANNED if out_date > today else TransferGroup.Status.CLEARED
    payee_text = (payee if payee is not None else "").strip() or f"Payment — {to_account.name}"
    with transaction.atomic():
        tg = TransferGroup.objects.create(
            household_id=from_account.household_id,
            from_account=from_account,
            to_account=to_account,
            amount=amount,
            scheduled_date=out_date,
            status=tg_status,
            created_by_id=None,
        )
        out_txn = Transaction.objects.create(
            account=from_account,
            date=out_date,
            payee=payee_text[:255],
            memo=(memo or in_leg.memo or "")[:2000],
            amount=-amount,
            category_id=None,
            cleared=False,
            tags=list(in_leg.tags) if isinstance(in_leg.tags, list) else [],
            status=txn_status,
            planned_date=out_date,
            transfer_group=tg,
            source=Transaction.Source.ACTUAL,
        )
        in_leg.transfer_group = tg
        in_leg.save(update_fields=["transfer_group", "updated_at"])
        Transfer.objects.create(
            from_transaction=out_txn,
            to_transaction=in_leg,
            amount=amount,
            date=out_date,
            memo=(memo or "")[:2000],
        )
    return out_txn


def prepare_outflow_txn_for_card_payment_link(out_txn: Transaction) -> None:
    """
    Remove state that makes ``link_in_leg_from_existing_out_leg`` bail out when the user fixes a
    mis-signed row (e.g. was modeled as inflow / receiving) and saves as a payer outflow + card:

    - If this transaction is the *destination* of a ``Transfer`` (``transfer_in``), drop that
      bridge so the row can become the source leg of a new payment link.
    - If ``transfer_group_id`` is set but no ``Transfer`` row references this transaction, clear the
      FK so linking can attach a fresh ``TransferGroup`` (orphans block linking in
      ``link_in_leg_from_existing_out_leg``).
    """
    pk = out_txn.pk
    with transaction.atomic():
        try:
            tr = Transfer.objects.select_related("from_transaction", "to_transaction").get(
                to_transaction_id=pk
            )
        except Transfer.DoesNotExist:
            tr = None
        if tr is not None:
            from_pk = tr.from_transaction_id
            to_pk = tr.to_transaction_id
            tr.delete()
            Transaction.objects.filter(pk__in=[from_pk, to_pk]).update(transfer_group_id=None)

        out_txn.refresh_from_db()
        has_bridge = Transfer.objects.filter(
            Q(from_transaction_id=pk) | Q(to_transaction_id=pk)
        ).exists()
        if not has_bridge and out_txn.transfer_group_id is not None:
            Transaction.objects.filter(pk=pk).update(transfer_group_id=None)


def link_in_leg_from_existing_out_leg(
    *,
    out_txn: Transaction,
    to_account: Account,
    payee: str | None = None,
) -> Transaction | None:
    """
    Create the credit-side inflow and wire ``Transfer`` + ``TransferGroup`` when the user marks an
    existing checking outflow (often Plaid) as a payment to ``to_account``.

    If the outflow is from a recurring rule and the card account already has the materialized inflow
    row (same ``rule_id`` and ``date``), that row is updated and linked instead of inserting a second
    leg (avoids duplicates when editing payment amount from Chase).

    Returns the card-side transaction (new or reused), or ``None`` if the row cannot be linked.
    """
    if out_txn.amount is None or out_txn.amount >= 0:
        return None
    if out_txn.account_id == to_account.id:
        return None
    if out_txn.account.household_id != to_account.household_id:
        return None
    if out_txn.transfer_group_id is not None:
        return None
    try:
        out_txn.transfer_out
        return None
    except Transfer.DoesNotExist:
        pass
    try:
        out_txn.transfer_in
        return None
    except Transfer.DoesNotExist:
        pass

    amount = -out_txn.amount
    today = timezone.localdate()
    pay_dt = out_txn.date
    txn_status = Transaction.Status.PLANNED if pay_dt > today else Transaction.Status.CLEARED
    tg_status = TransferGroup.Status.PLANNED if pay_dt > today else TransferGroup.Status.CLEARED
    payee_text = (payee if payee is not None else "").strip() or out_txn.payee or "Transfer"
    memo = (out_txn.memo or "")[:2000]

    # Recurring rule materializations already have a +amount row on the card (same rule_id/date).
    # Wire that row instead of INSERTing a second leg when the user PATCHes payment-to from Chase.
    reuse_in: Transaction | None = None
    if out_txn.rule_id:
        for cand in Transaction.objects.filter(
            account=to_account,
            rule_id=out_txn.rule_id,
            date=pay_dt,
        ).exclude(pk=out_txn.pk):
            try:
                cand.transfer_in
            except Transfer.DoesNotExist:
                reuse_in = cand
                break

    with transaction.atomic():
        tg = TransferGroup.objects.create(
            household_id=out_txn.account.household_id,
            from_account_id=out_txn.account_id,
            to_account=to_account,
            amount=amount,
            scheduled_date=pay_dt,
            status=tg_status,
            created_by_id=None,
        )
        out_txn.transfer_group = tg
        out_txn.save(update_fields=["transfer_group", "updated_at"])

        if reuse_in is not None:
            Transaction.objects.filter(pk=reuse_in.pk).update(
                amount=amount,
                payee=payee_text[:255],
                memo=memo,
                category_id=out_txn.category_id,
                cleared=out_txn.cleared,
                tags=list(out_txn.tags) if isinstance(out_txn.tags, list) else [],
                status=txn_status,
                planned_date=pay_dt,
                transfer_group_id=tg.pk,
            )
            in_txn = Transaction.objects.get(pk=reuse_in.pk)
            Transfer.objects.create(
                from_transaction=out_txn,
                to_transaction=in_txn,
                amount=amount,
                date=pay_dt,
                memo=memo,
            )
            return in_txn

        in_txn = Transaction.objects.create(
            account=to_account,
            date=pay_dt,
            payee=payee_text[:255],
            memo=memo,
            amount=amount,
            category_id=out_txn.category_id,
            cleared=out_txn.cleared,
            tags=list(out_txn.tags) if isinstance(out_txn.tags, list) else [],
            status=txn_status,
            planned_date=pay_dt,
            transfer_group=tg,
            source=Transaction.Source.ACTUAL,
        )
        Transfer.objects.create(
            from_transaction=out_txn,
            to_transaction=in_txn,
            amount=amount,
            date=pay_dt,
            memo=memo,
        )
    return in_txn


def eligible_manual_transactions_queryset(account: Account):
    return (
        Transaction.objects.filter(
            account=account,
            source__in=[
                Transaction.Source.ACTUAL,
                Transaction.Source.ONE_TIME,
                Transaction.Source.RULE,
            ],
            scenario__isnull=True,
        )
        .filter(Q(plaid_transaction_id__isnull=True) | Q(plaid_transaction_id=""))
        .filter(
            Q(source=Transaction.Source.RULE)
            | (
                Q(source__in=[Transaction.Source.ACTUAL, Transaction.Source.ONE_TIME])
                & Q(rule__isnull=True)
            )
        )
        .filter(transfer_out__isnull=True, transfer_in__isnull=True)
    )


def delete_transaction_respecting_partner_ledger(
    txn: Transaction,
    deleted: set[int] | None = None,
) -> int:
    """
    Delete ``txn``. If it is one leg of a ``Transfer``, normally delete the bridge and both legs.

    If the *counterparty* account has ``preserve_partner_transfer_legs`` (manual / non-Plaid ledger),
    delete only ``txn``: remove the ``Transfer``, clear ``transfer_group`` on the other leg, and
    leave that row in place so a partner clear (e.g. Chase + Plaid) does not wipe the card ledger.
    """
    if deleted is not None and txn.pk in deleted:
        return 0
    try:
        tr = txn.transfer_out
    except Transfer.DoesNotExist:
        tr = None
    if tr is None:
        try:
            tr = txn.transfer_in
        except Transfer.DoesNotExist:
            tr = None

    if not tr:
        # Rule-based transfers are two Transaction rows with the same rule_id but no Transfer row.
        today = timezone.localdate()
        removed_here = 0
        counterpart = None
        if txn.rule_id is not None:
            counterpart = find_rule_transfer_counterpart_txn(
                rule_id=txn.rule_id,
                exclude_txn_pk=txn.pk,
                old_date=txn.date,
                old_amount=txn.amount,
                old_account_id=txn.account_id,
            )
        if counterpart is not None:
            if counterpart.rule_id is not None and counterpart.date >= today:
                RecurringRuleSkip.objects.get_or_create(rule_id=counterpart.rule_id, date=counterpart.date)
            _delete_transaction_cascade(counterpart)
            if deleted is not None:
                deleted.add(counterpart.pk)
            removed_here += 1
        txn.delete()
        if deleted is not None:
            deleted.add(txn.pk)
        removed_here += 1
        return removed_here

    other = tr.to_transaction if tr.from_transaction_id == txn.pk else tr.from_transaction
    today = timezone.localdate()

    if getattr(other.account, "preserve_partner_transfer_legs", False):
        if other.rule_id is not None and other.date >= today:
            RecurringRuleSkip.objects.get_or_create(rule_id=other.rule_id, date=other.date)
        tg_ids = {tid for tid in (txn.transfer_group_id, other.transfer_group_id) if tid}
        tr.delete()
        Transaction.objects.filter(pk=other.pk).update(transfer_group_id=None)
        txn.delete()
        if deleted is not None:
            deleted.add(txn.pk)
        for gid in tg_ids:
            TransferGroup.objects.filter(pk=gid).annotate(c=Count("transactions")).filter(c=0).delete()
        return 1

    if other.rule_id is not None and other.date >= today:
        RecurringRuleSkip.objects.get_or_create(rule_id=other.rule_id, date=other.date)

    removed_here = 0
    tr.delete()
    for leg in (txn, other):
        if deleted is not None and leg.pk in deleted:
            continue
        leg.delete()
        if deleted is not None:
            deleted.add(leg.pk)
        removed_here += 1
    return removed_here


def _delete_transaction_cascade(txn: Transaction) -> None:
    try:
        transfer_out = txn.transfer_out
    except Transfer.DoesNotExist:
        transfer_out = None
    try:
        transfer_in = txn.transfer_in
    except Transfer.DoesNotExist:
        transfer_in = None
    xfer = transfer_out or transfer_in
    if xfer:
        other = (
            xfer.to_transaction
            if xfer.from_transaction_id == txn.pk
            else xfer.from_transaction
        )
        xfer.delete()
        other.delete()
    txn.delete()


def _delete_rule_shadow_with_counterpart(manual_t: Transaction) -> int:
    rid = manual_t.rule_id
    occ_date = manual_t.date
    old_amt = manual_t.amount
    old_acc = manual_t.account_id
    deleted = 0
    if rid and manual_t.source == Transaction.Source.RULE:
        rule = RecurringRule.objects.filter(pk=rid).first()
        if rule and rule.transfer_to_account_id:
            low = occ_date - timedelta(days=_RULE_TRANSFER_SHADOW_DATE_WINDOW_DAYS)
            high = occ_date + timedelta(days=_RULE_TRANSFER_SHADOW_DATE_WINDOW_DAYS)
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
                deleted += 1
        RecurringRuleSkip.objects.get_or_create(rule_id=rid, date=occ_date)
    _delete_transaction_cascade(manual_t)
    deleted += 1
    return deleted


def clear_all_transactions_for_account(account: Account) -> dict[str, int]:
    """
    Remove every transaction on this account (Plaid, manual, transfers, rule rows).

    Transfer pairs: by default both legs are removed so balances stay consistent. If the
    *counterparty* account has ``preserve_partner_transfer_legs`` (manual-only / non-Plaid bank),
    that account's leg is kept and only the link is removed when this account's leg is deleted.

    Deletes reconcile ``StatementTransaction`` rows for this account.
    Removes orphan ``TransferGroup`` rows that no longer have any linked transactions.

    Resets Plaid ``transactions_cursor`` on any linked Item so the next ``/transactions/sync`` can
    replay historical ``added`` rows (Plaid only sends deltas after a non-empty cursor).
    """
    from django.utils import timezone as dj_tz

    from plaid_link.models import PlaidItem

    tg_ids = set(
        Transaction.objects.filter(account=account, transfer_group_id__isnull=False).values_list(
            "transfer_group_id", flat=True
        )
    )
    with transaction.atomic():
        stmt_deleted, _ = StatementTransaction.objects.filter(account=account).delete()
        removed = delete_transactions_with_transfer_pairs_for_queryset(
            Transaction.objects.filter(account=account)
        )
        if tg_ids:
            TransferGroup.objects.filter(pk__in=tg_ids).annotate(c=Count("transactions")).filter(c=0).delete()
    plaid_items_reset = PlaidItem.objects.filter(linked_accounts__account_id=account.pk).update(
        transactions_cursor="",
        updated_at=dj_tz.now(),
    )
    return {
        "transactions_deleted": removed,
        "statement_lines_deleted": stmt_deleted,
        "plaid_items_cursor_reset": plaid_items_reset,
    }


def delete_manual_transactions_for_plaid_reset(
    account: Account,
    *,
    before: date | None = None,
    after: date | None = None,
) -> int:
    qs = eligible_manual_transactions_queryset(account).order_by("pk")
    if before is not None:
        qs = qs.filter(date__lte=before)
    if after is not None:
        qs = qs.filter(date__gte=after)
    if before is not None and after is not None and after > before:
        return 0

    pks = list(qs.values_list("pk", flat=True))
    removed = 0
    with transaction.atomic():
        for pk in pks:
            txn = Transaction.objects.filter(pk=pk).first()
            if txn is None:
                continue
            if txn.account_id != account.pk:
                continue
            if txn.plaid_transaction_id and str(txn.plaid_transaction_id).strip():
                continue

            if txn.source == Transaction.Source.RULE and txn.rule_id:
                removed += _delete_rule_shadow_with_counterpart(txn)
                continue

            removed += delete_transactions_with_transfer_pairs_for_queryset(
                Transaction.objects.filter(pk=txn.pk)
            )
    return removed


def delete_transactions_with_transfer_pairs_for_queryset(base_qs) -> int:
    pks = list(base_qs.values_list("pk", flat=True))
    deleted: set[int] = set()
    removed = 0
    for pk in pks:
        if pk in deleted:
            continue
        txn = Transaction.objects.filter(pk=pk).first()
        if txn is None:
            continue
        removed += delete_transaction_respecting_partner_ledger(txn, deleted)
    return removed


def cleanup_orphaned_rule_materializations_for_user(user, *, cutoff=None):
    from django.utils import timezone as dj_tz

    from core.utils import get_households_for_user

    if cutoff is None:
        cutoff = dj_tz.localdate()
    households = get_households_for_user(user)
    qs = Transaction.objects.filter(
        account__household__in=households,
        source=Transaction.Source.RULE,
        rule_id__isnull=True,
        date__gte=cutoff,
    )
    return delete_transactions_with_transfer_pairs_for_queryset(qs)
