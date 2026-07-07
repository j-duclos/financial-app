"""Atomic transaction posting, transfer creation, and manual-clear helpers."""
from __future__ import annotations

from collections.abc import Iterable
from datetime import date, timedelta
from decimal import Decimal

from django.db import transaction


def _coerce_transaction_date(value) -> date:
    """API payloads send ISO date strings; matching logic needs ``date`` objects."""
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        return date.fromisoformat(value[:10])
    raise ValueError("date must be YYYY-MM-DD")
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
    date = _coerce_transaction_date(date)
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
    from .matching import try_match_pending_imports_to_manual

    try_match_pending_imports_to_manual(txn)
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
    from transactions.services.matching import rematch_pending_transfer_imports_for_group

    rematch_pending_transfer_imports_for_group(tg)
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


def get_transfer_group_sibling(txn: Transaction) -> Transaction | None:
    """Other transaction row sharing ``txn.transfer_group_id``, if any."""
    if not txn.transfer_group_id:
        return None
    return (
        Transaction.objects.filter(transfer_group_id=txn.transfer_group_id)
        .exclude(pk=txn.pk)
        .select_related("account")
        .first()
    )


def _txn_has_transfer_bridge(txn: Transaction) -> bool:
    try:
        txn.transfer_out
        return True
    except Transfer.DoesNotExist:
        pass
    try:
        txn.transfer_in
        return True
    except Transfer.DoesNotExist:
        return False


def _create_missing_transfer_leg_for_group(
    *,
    tg: TransferGroup,
    existing: Transaction,
    missing_account_id: int,
    signed_amount: Decimal,
) -> Transaction:
    """Create the missing leg for a one-sided ``TransferGroup``."""
    pay_dt = existing.date or tg.scheduled_date
    today = timezone.localdate()
    txn_status = Transaction.Status.PLANNED if pay_dt > today else Transaction.Status.CLEARED
    payee_text = (existing.payee or "").strip() or f"Payment — {tg.to_account.name}"
    to_acct = tg.to_account
    in_type = (
        Transaction.TransactionType.CREDIT_CARD_PAYMENT
        if to_acct.is_credit_card() and signed_amount > 0
        else Transaction.TransactionType.TRANSFER
    )
    out_type = Transaction.TransactionType.TRANSFER
    txn_type = in_type if signed_amount > 0 else out_type
    category_id = existing.category_id if signed_amount < 0 else None
    if signed_amount > 0 and existing.category_id:
        category_id = existing.category_id
    return Transaction.objects.create(
        account_id=missing_account_id,
        date=pay_dt,
        payee=payee_text[:255],
        memo=(existing.memo or "")[:2000],
        amount=signed_amount,
        category_id=category_id,
        cleared=False,
        tags=list(existing.tags) if isinstance(existing.tags, list) else [],
        status=txn_status,
        planned_date=pay_dt,
        transfer_group=tg,
        source=existing.source,
        rule_id=existing.rule_id,
        transaction_type=txn_type,
    )


def _find_existing_from_account_payment(
    *,
    tg: TransferGroup,
    in_leg: Transaction,
    pay_dt: date,
    amount: Decimal,
    exclude_pks: set[int] | None = None,
    synthetic_min_pk: int | None = None,
) -> Transaction | None:
    """
    Locate a real bank outflow that already paid this card inflow so we do not insert a duplicate leg.
    """
    exclude = set(exclude_pks or set())
    if synthetic_min_pk is not None:
        # Exclude other synthetic transfer legs, not real bank posts that happen to have high pks.
        exclude.update(
            Transaction.objects.filter(
                pk__gte=synthetic_min_pk,
                transfer_group_id__isnull=False,
                plaid_transaction_id__isnull=True,
            ).values_list("pk", flat=True)
        )
    from_id = tg.from_account_id
    out_amt = -abs(amount)
    exact = (
        Transaction.objects.filter(
            account_id=from_id,
            date=pay_dt,
            amount=out_amt,
        )
        .exclude(pk__in=exclude)
        .exclude(transfer_group_id=tg.pk)
        .order_by("id")
        .first()
    )
    if exact is not None:
        return exact
    tol = Decimal("1.00")
    window_start = pay_dt - timedelta(days=5)
    window_end = pay_dt + timedelta(days=5)
    candidates = (
        Transaction.objects.filter(
            account_id=from_id,
            date__gte=window_start,
            date__lte=window_end,
            amount__lt=0,
        )
        .exclude(pk__in=exclude)
        .exclude(transfer_group_id=tg.pk)
        .order_by("date", "id")
    )
    card_name = (getattr(tg.to_account, "name", None) or "").lower()
    for cand in candidates:
        if abs(abs(cand.amount) - abs(out_amt)) > tol:
            continue
        payee = (cand.payee or "").upper()
        if any(
            token in payee
            for token in (
                "CAPITAL ONE",
                "SYNCHRONY",
                "AMAZON",
                "ONLINE PMT",
                "ONLINE PYMT",
                "SYF PAYMNT",
                "TRANSFER TO SAV",
                "TRANSFER FROM CHK",
            )
        ):
            return cand
        if card_name and card_name[:8] in payee.lower():
            return cand
    return None


def _wire_transfer_legs(
    *,
    out_leg: Transaction,
    in_leg: Transaction,
    tg: TransferGroup,
    amount: Decimal,
    pay_dt: date,
) -> None:
    if not out_leg.transfer_group_id:
        out_leg.transfer_group = tg
        out_leg.save(update_fields=["transfer_group_id", "updated_at"])
    if not in_leg.transfer_group_id:
        in_leg.transfer_group = tg
        in_leg.save(update_fields=["transfer_group_id", "updated_at"])
    if not Transfer.objects.filter(from_transaction=out_leg, to_transaction=in_leg).exists():
        Transfer.objects.create(
            from_transaction=out_leg,
            to_transaction=in_leg,
            amount=abs(amount),
            date=pay_dt,
            memo=(out_leg.memo or "")[:2000],
        )


def repair_duplicate_transfer_out_legs(
    *,
    account_ids: Iterable[int] | None = None,
    synthetic_min_pk: int = 6510,
) -> dict[str, int]:
    """Rewire transfer groups onto real bank outflows; drop duplicate synthetic out-legs."""
    return rollback_bogus_repair_transfer_legs(
        synthetic_min_pk=synthetic_min_pk,
        account_ids=account_ids,
    )


def rollback_bogus_repair_transfer_legs(
    *,
    synthetic_min_pk: int = 6510,
    account_ids: Iterable[int] | None = None,
) -> dict[str, int]:
    """
    Remove synthetic outflow legs created by a bad orphan repair when a real bank payment already exists.

    Rewires ``Transfer`` to the existing row; drops synthetic rows that duplicate Plaid/historical posts.
    """
    today = timezone.localdate()
    ids = list(account_ids) if account_ids else []
    synth_qs = Transaction.objects.filter(
        pk__gte=synthetic_min_pk,
        amount__lt=0,
        source=Transaction.Source.ACTUAL,
        transfer_group_id__isnull=False,
        plaid_transaction_id__isnull=True,
    ).select_related("account", "transfer_group", "transfer_group__to_account")
    if ids:
        synth_qs = synth_qs.filter(account_id__in=ids)
    removed = 0
    rewired = 0
    kept = 0
    for fake in synth_qs.iterator(chunk_size=200):
        tg = fake.transfer_group
        if tg is None:
            continue
        in_leg = (
            Transaction.objects.filter(transfer_group_id=tg.pk, amount__gt=0)
            .exclude(pk=fake.pk)
            .first()
        )
        pay_dt = fake.date or tg.scheduled_date
        real = _find_existing_from_account_payment(
            tg=tg,
            in_leg=in_leg or fake,
            pay_dt=pay_dt,
            amount=abs(fake.amount),
            exclude_pks={fake.pk},
            synthetic_min_pk=synthetic_min_pk,
        )
        if real is None and pay_dt > today:
            kept += 1
            continue
        with transaction.atomic():
            try:
                tr = fake.transfer_out
            except Transfer.DoesNotExist:
                tr = None
            if real is not None:
                if in_leg is not None:
                    try:
                        real.transfer_out
                        has_out = True
                    except Transfer.DoesNotExist:
                        has_out = False
                    if not has_out:
                        if tr is not None:
                            tr.from_transaction = real
                            tr.save(update_fields=["from_transaction_id"])
                        else:
                            _wire_transfer_legs(
                                out_leg=real,
                                in_leg=in_leg,
                                tg=tg,
                                amount=abs(fake.amount),
                                pay_dt=real.date,
                            )
                        if not real.transfer_group_id:
                            real.transfer_group_id = tg.pk
                            real.save(update_fields=["transfer_group_id", "updated_at"])
                if tr is not None and tr.from_transaction_id == fake.pk:
                    tr.delete()
                fake.delete()
                rewired += 1
                continue
            if pay_dt > today or fake.status == Transaction.Status.PLANNED:
                kept += 1
                continue
            if tr is not None:
                tr.delete()
            fake.delete()
            if in_leg is not None:
                Transaction.objects.filter(pk=in_leg.pk).update(transfer_group_id=None)
            removed += 1
    return {"rewired": rewired, "removed": removed, "kept": kept}


def repair_orphan_transfer_group_legs(
    account_ids: Iterable[int] | None = None,
) -> int:
    """
    Backfill missing legs and ``Transfer`` rows for broken transfer groups.

    A group with exactly one transaction (common after the paying-account leg was deleted without
    a ``Transfer`` bridge) leaves card-side payments with no outflow on checking.
    """
    ids = list(account_ids) if account_ids else []
    tg_qs = TransferGroup.objects.select_related("from_account", "to_account")
    if ids:
        tg_qs = tg_qs.filter(Q(from_account_id__in=ids) | Q(to_account_id__in=ids))
    repaired = 0
    today = timezone.localdate()
    for tg in tg_qs.iterator(chunk_size=200):
        legs = list(
            Transaction.objects.filter(transfer_group_id=tg.pk).select_related("account")
        )
        if not legs:
            tg.delete()
            continue
        if len(legs) >= 2:
            out_leg = next(
                (t for t in legs if t.account_id == tg.from_account_id and t.amount is not None and t.amount < 0),
                None,
            )
            in_leg = next(
                (t for t in legs if t.account_id == tg.to_account_id and t.amount is not None and t.amount > 0),
                None,
            )
            if out_leg and in_leg and not _txn_has_transfer_bridge(out_leg):
                with transaction.atomic():
                    Transfer.objects.create(
                        from_transaction=out_leg,
                        to_transaction=in_leg,
                        amount=abs(in_leg.amount),
                        date=out_leg.date or tg.scheduled_date,
                        memo=(out_leg.memo or "")[:2000],
                    )
                repaired += 1
            continue
        sole = legs[0]
        if _txn_has_transfer_bridge(sole):
            continue
        amount = tg.amount
        pay_dt = sole.date or tg.scheduled_date
        with transaction.atomic():
            if sole.account_id == tg.to_account_id and sole.amount is not None and sole.amount > 0:
                in_leg = sole
                existing_out = _find_existing_from_account_payment(
                    tg=tg,
                    in_leg=in_leg,
                    pay_dt=pay_dt,
                    amount=amount,
                )
                if existing_out is not None:
                    _wire_transfer_legs(
                        out_leg=existing_out,
                        in_leg=in_leg,
                        tg=tg,
                        amount=amount,
                        pay_dt=existing_out.date,
                    )
                    if pay_dt > today:
                        tg.status = TransferGroup.Status.PLANNED
                    else:
                        tg.status = TransferGroup.Status.CLEARED
                    tg.save(update_fields=["status", "updated_at"])
                    repaired += 1
                    continue
                if pay_dt <= today and sole.source == Transaction.Source.ACTUAL:
                    continue
                if in_leg.rule_id is not None and RecurringRuleSkip.objects.filter(
                    rule_id=in_leg.rule_id,
                    date=pay_dt,
                ).exists():
                    in_leg.delete()
                    tg.delete()
                    continue
                out_leg = _create_missing_transfer_leg_for_group(
                    tg=tg,
                    existing=sole,
                    missing_account_id=tg.from_account_id,
                    signed_amount=-amount,
                )
            elif sole.account_id == tg.from_account_id and sole.amount is not None and sole.amount < 0:
                out_leg = sole
                existing_in = (
                    Transaction.objects.filter(
                        account_id=tg.to_account_id,
                        date=pay_dt,
                        amount=amount,
                    )
                    .exclude(pk=sole.pk)
                    .exclude(transfer_group_id=tg.pk)
                    .first()
                )
                if existing_in is not None:
                    _wire_transfer_legs(
                        out_leg=out_leg,
                        in_leg=existing_in,
                        tg=tg,
                        amount=amount,
                        pay_dt=pay_dt,
                    )
                    if pay_dt > today:
                        tg.status = TransferGroup.Status.PLANNED
                    else:
                        tg.status = TransferGroup.Status.CLEARED
                    tg.save(update_fields=["status", "updated_at"])
                    repaired += 1
                    continue
                in_leg = _create_missing_transfer_leg_for_group(
                    tg=tg,
                    existing=sole,
                    missing_account_id=tg.to_account_id,
                    signed_amount=amount,
                )
            else:
                continue
            Transfer.objects.create(
                from_transaction=out_leg,
                to_transaction=in_leg,
                amount=amount,
                date=pay_dt,
                memo=(out_leg.memo or "")[:2000],
            )
            if pay_dt > today:
                tg.status = TransferGroup.Status.PLANNED
            else:
                tg.status = TransferGroup.Status.CLEARED
            tg.save(update_fields=["status", "updated_at"])
        repaired += 1
    return repaired


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
    from .immutability import reject_if_reconciled

    reject_if_reconciled(txn, action="deleted")
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
        # Rule-based and transfer_group pairs may have no Transfer row.
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
        if counterpart is None and txn.transfer_group_id:
            counterpart = get_transfer_group_sibling(txn)
        if counterpart is not None:
            if getattr(counterpart.account, "preserve_partner_transfer_legs", False):
                tg_ids = {tid for tid in (txn.transfer_group_id, counterpart.transfer_group_id) if tid}
                txn.delete()
                Transaction.objects.filter(pk=counterpart.pk).update(transfer_group_id=None)
                if deleted is not None:
                    deleted.add(txn.pk)
                for gid in tg_ids:
                    TransferGroup.objects.filter(pk=gid).annotate(c=Count("transactions")).filter(c=0).delete()
                return removed_here + 1
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
    from .reconciliation import reset_reconciliation_history_for_account

    tg_ids = set(
        Transaction.objects.filter(account=account, transfer_group_id__isnull=False).values_list(
            "transfer_group_id", flat=True
        )
    )
    with transaction.atomic():
        reconcile_reset = reset_reconciliation_history_for_account(
            account, reason="clear_all_transactions"
        )
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
        "reconciliation_sessions_deactivated": reconcile_reset["sessions_deactivated"],
        "transactions_unreconciled_count": reconcile_reset["transactions_unreconciled_count"],
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
