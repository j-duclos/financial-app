"""Read and preview paths must not mutate stored financial records."""
from datetime import timedelta
from decimal import Decimal

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Account
from categories.models import Category
from timeline.models import RecurringRule
from timeline.services.canonical_timeline_cache import get_or_build_canonical_forecast_timeline
from timeline.services.ledger import build_timeline
from transactions.models import (
    Reconciliation,
    ReconciliationEntry,
    Transaction,
    TransactionMatch,
    Transfer,
    TransferGroup,
)
from transactions.services.posting import create_transfer
from transactions.services.reconciliation import get_setup_data
from transactions.services.transfer_balance_preview import preview_transfer_balances

WRITE_PREFIXES = ("INSERT", "UPDATE", "DELETE")


def _mutating_sql(sql: str) -> bool:
    s = " ".join(sql.strip().split()).upper()
    if s.startswith("SELECT") or s.startswith("SAVEPOINT") or s.startswith("RELEASE"):
        return False
    if s.startswith("ROLLBACK") or s.startswith("COMMIT") or s.startswith("SET "):
        return False
    return s.startswith(WRITE_PREFIXES)


def financial_snapshot(household_id: int) -> dict:
    txns = Transaction.objects.filter(account__household_id=household_id)
    return {
        "txn": list(
            txns.order_by("pk").values(
                "id",
                "date",
                "amount",
                "status",
                "reconciled",
                "reconciliation_id",
                "source",
                "rule_id",
                "payee",
                "account_id",
                "transfer_group_id",
            )
        ),
        "transfer": list(
            Transfer.objects.filter(from_transaction__account__household_id=household_id)
            .order_by("pk")
            .values("id", "from_transaction_id", "to_transaction_id", "amount", "date")
        ),
        "tg": list(
            TransferGroup.objects.filter(household_id=household_id)
            .order_by("pk")
            .values("id", "from_account_id", "to_account_id", "amount", "scheduled_date", "status")
        ),
        "re_entries": list(
            ReconciliationEntry.objects.filter(transaction__account__household_id=household_id)
            .order_by("pk")
            .values("id", "session_id", "transaction_id", "reconciled_balance")
        ),
        "matches": list(
            TransactionMatch.objects.filter(planned_transaction__account__household_id=household_id)
            .order_by("pk")
            .values("id", "planned_transaction_id", "imported_transaction_id", "match_type")
        ),
        "rule_rows": list(
            txns.filter(rule_id__isnull=False).order_by("pk").values("id", "date", "amount", "rule_id")
        ),
        "txn_count": txns.count(),
        "re_count": ReconciliationEntry.objects.filter(
            transaction__account__household_id=household_id
        ).count(),
    }


@pytest.fixture
def auth_client(api_client, user):
    api_client.force_authenticate(user=user)
    return api_client


@pytest.fixture
def ledger_pair(household, user):
    bank = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Operating",
        currency="USD",
        starting_balance=Decimal("2000.00"),
    )
    card = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        name="Card",
        currency="USD",
        starting_balance=Decimal("-400.00"),
    )
    savings = Account.objects.create(
        household=household,
        account_type=Account.AccountType.SAVINGS,
        name="Reserve",
        currency="USD",
        starting_balance=Decimal("800.00"),
    )
    cat = Category.objects.get_or_create(
        household=household,
        name="Credit Card Payment",
        category_type=Category.CategoryType.EXPENSE,
        defaults={"sort_order": 1},
    )[0]
    return {"bank": bank, "card": card, "savings": savings, "cat": cat, "user": user, "household": household}


def _seed_records(ledger_pair):
    bank = ledger_pair["bank"]
    card = ledger_pair["card"]
    savings = ledger_pair["savings"]
    cat = ledger_pair["cat"]
    user = ledger_pair["user"]
    household = ledger_pair["household"]
    today = timezone.localdate()
    future = today + timedelta(days=14)

    first = create_transfer(
        user=user,
        from_account_id=bank.id,
        to_account_id=card.id,
        amount=Decimal("85.00"),
        transfer_date=future,
        payee="Payment A",
        from_category_id=cat.id,
    )
    second = create_transfer(
        user=user,
        from_account_id=bank.id,
        to_account_id=card.id,
        amount=Decimal("85.00"),
        transfer_date=future,
        payee="Payment B",
        from_category_id=cat.id,
    )
    drifted = create_transfer(
        user=user,
        from_account_id=bank.id,
        to_account_id=savings.id,
        amount=Decimal("40.00"),
        transfer_date=today + timedelta(days=3),
        payee="Move",
    )
    Transaction.objects.filter(pk=drifted.to_transaction_id).update(date=today + timedelta(days=5))

    manual_future = Transaction.objects.create(
        account=bank,
        date=today + timedelta(days=21),
        payee="One-off",
        amount=Decimal("-12.50"),
        source=Transaction.Source.ACTUAL,
        status=Transaction.Status.CLEARED,
    )
    rule = RecurringRule.objects.create(
        household=household,
        name="Rent",
        account=bank,
        category=cat,
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("50.00"),
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=min(28, today.day),
        start_date=today - timedelta(days=60),
        active=True,
    )
    rule_row = Transaction.objects.create(
        account=bank,
        date=today + timedelta(days=10),
        payee="Rent",
        amount=Decimal("-50.00"),
        category=cat,
        source=Transaction.Source.RULE,
        rule=rule,
        status=Transaction.Status.PLANNED,
    )
    planned = Transaction.objects.create(
        account=bank,
        date=today - timedelta(days=2),
        payee="Shop",
        amount=Decimal("-19.99"),
        source=Transaction.Source.RULE,
        rule=rule,
        import_match_status=Transaction.ImportMatchStatus.MATCHED,
    )
    imported = Transaction.objects.create(
        account=bank,
        date=today - timedelta(days=1),
        payee="Shop",
        amount=Decimal("-19.99"),
        source=Transaction.Source.PLAID,
        plaid_transaction_id="plaid-shop-1",
        import_match_status=Transaction.ImportMatchStatus.MATCHED,
    )
    TransactionMatch.objects.create(
        planned_transaction=planned,
        imported_transaction=imported,
        match_type=TransactionMatch.MatchType.MANUAL,
        score=100,
        confidence=TransactionMatch.Confidence.MANUAL,
    )
    rec = Reconciliation.objects.create(
        user=user,
        account=bank,
        bank_current_balance=Decimal("2000.00"),
        app_current_balance=Decimal("2000.00"),
        last_reconciled_balance=Decimal("2000.00"),
        final_reconciled_balance=Decimal("2000.00"),
        difference=Decimal("0"),
        period_start_date=today - timedelta(days=40),
        period_end_date=today - timedelta(days=30),
        transaction_count=0,
        status=Reconciliation.Status.COMPLETED,
        is_active=True,
        completed_at=timezone.now(),
    )
    leftover = Transaction.objects.create(
        account=bank,
        date=today - timedelta(days=35),
        payee="Leftover",
        amount=Decimal("-1.00"),
        source=Transaction.Source.ACTUAL,
        reconciled=True,
        reconciliation=rec,
        status=Transaction.Status.RECONCILED,
    )
    ReconciliationEntry.objects.create(session=rec, transaction=leftover, reconciled_balance=Decimal("1999.00"))
    return {
        "first": first,
        "second": second,
        "drifted": drifted,
        "manual_future": manual_future,
        "rule_row": rule_row,
        "planned": planned,
        "imported": imported,
        "leftover": leftover,
        "today": today,
        "future": future,
    }


@pytest.mark.django_db
def test_reconcile_setup_get_does_not_mutate(auth_client, ledger_pair):
    seeded = _seed_records(ledger_pair)
    hid = ledger_pair["household"].id
    before = financial_snapshot(hid)
    r = auth_client.get("/api/reconcile/setup/", {"account_id": ledger_pair["bank"].pk})
    assert r.status_code == 200
    assert financial_snapshot(hid) == before
    seeded["leftover"].refresh_from_db()
    assert seeded["leftover"].reconciled is True


@pytest.mark.django_db
def test_get_setup_data_does_not_unseal_surplus(ledger_pair):
    seeded = _seed_records(ledger_pair)
    hid = ledger_pair["household"].id
    before = financial_snapshot(hid)
    get_setup_data(ledger_pair["bank"])
    assert financial_snapshot(hid) == before
    seeded["leftover"].refresh_from_db()
    assert seeded["leftover"].reconciled is True
    assert ReconciliationEntry.objects.filter(transaction=seeded["leftover"]).exists()


@pytest.mark.django_db
def test_timeline_get_does_not_mutate(auth_client, ledger_pair):
    _seed_records(ledger_pair)
    hid = ledger_pair["household"].id
    today = timezone.localdate()
    before = financial_snapshot(hid)
    r = auth_client.get(
        "/api/timeline/",
        {
            "account_id": ledger_pair["bank"].pk,
            "start": today.isoformat(),
            "end": (today + timedelta(days=90)).isoformat(),
            "exclude_reconciled_past": "true",
        },
    )
    assert r.status_code == 200
    assert financial_snapshot(hid) == before


@pytest.mark.django_db
def test_canonical_forecast_timeline_load_does_not_mutate(ledger_pair, user):
    _seed_records(ledger_pair)
    hid = ledger_pair["household"].id
    before = financial_snapshot(hid)
    get_or_build_canonical_forecast_timeline(
        user,
        today=timezone.localdate(),
        forecast_days=90,
        household_id=hid,
        caller="invariance_test",
    )
    assert financial_snapshot(hid) == before


@pytest.mark.django_db
def test_transfer_and_card_preview_do_not_mutate(auth_client, ledger_pair):
    seeded = _seed_records(ledger_pair)
    hid = ledger_pair["household"].id
    bank = ledger_pair["bank"]
    card = ledger_pair["card"]
    savings = ledger_pair["savings"]
    today = timezone.localdate()
    before = financial_snapshot(hid)
    preview_transfer_balances(
        ledger_pair["user"],
        from_account_id=bank.id,
        to_account_id=savings.id,
        amount=Decimal("10.00"),
        transfer_date=today + timedelta(days=8),
    )
    preview_transfer_balances(
        ledger_pair["user"],
        from_account_id=bank.id,
        to_account_id=card.id,
        amount=Decimal("85.00"),
        transfer_date=seeded["future"],
        exclude_transaction_ids=[
            seeded["first"].from_transaction_id,
            seeded["first"].to_transaction_id,
        ],
    )
    r = auth_client.post(
        "/api/transactions/transfers/preview/",
        {
            "from_account_id": bank.pk,
            "to_account_id": card.pk,
            "amount": "25.00",
            "date": (today + timedelta(days=9)).isoformat(),
        },
        format="json",
    )
    assert r.status_code == 200
    r2 = auth_client.post(
        "/api/transactions/transfers/preview/",
        {
            "from_account_id": bank.pk,
            "to_account_id": card.pk,
            "amount": "25.00",
            "date": (today + timedelta(days=11)).isoformat(),
        },
        format="json",
    )
    assert r2.status_code == 200
    auth_client.post(
        "/api/transactions/transfers/preview/",
        {
            "from_account_id": bank.pk,
            "to_account_id": card.pk,
            "amount": "25.00",
            "date": (today + timedelta(days=11)).isoformat(),
        },
        format="json",
    )
    assert financial_snapshot(hid) == before
    seeded["second"].from_transaction.refresh_from_db()
    seeded["second"].to_transaction.refresh_from_db()
    assert seeded["second"].from_transaction.date == seeded["future"]
    seeded["drifted"].from_transaction.refresh_from_db()
    seeded["drifted"].to_transaction.refresh_from_db()
    assert seeded["drifted"].from_transaction.date != seeded["drifted"].to_transaction.date


@pytest.mark.django_db
def test_open_future_transaction_without_saving_does_not_mutate(auth_client, ledger_pair):
    seeded = _seed_records(ledger_pair)
    hid = ledger_pair["household"].id
    before = financial_snapshot(hid)
    r = auth_client.get(f"/api/transactions/{seeded['manual_future'].pk}/")
    assert r.status_code == 200
    r2 = auth_client.get(f"/api/accounts/{ledger_pair['bank'].pk}/")
    assert r2.status_code == 200
    assert financial_snapshot(hid) == before
    seeded["manual_future"].refresh_from_db()
    assert seeded["manual_future"].amount == Decimal("-12.50")
    seeded["planned"].refresh_from_db()
    seeded["imported"].refresh_from_db()
    assert Transaction.objects.filter(pk=seeded["planned"].pk).exists()
    assert Transaction.objects.filter(pk=seeded["imported"].pk).exists()
    assert Transaction.objects.filter(pk=seeded["rule_row"].pk).exists()


@pytest.mark.django_db
def test_projection_only_build_timeline_issues_no_writes(ledger_pair, user):
    _seed_records(ledger_pair)
    today = timezone.localdate()
    hid = ledger_pair["household"].id
    before = financial_snapshot(hid)
    with CaptureQueriesContext(connection) as ctx:
        rows = build_timeline(
            user,
            today,
            today + timedelta(days=90),
            household_id=hid,
            as_of_date=today,
            projection_only=True,
            caller="invariance_projection_only",
        )
    writes = [q["sql"] for q in ctx.captured_queries if _mutating_sql(q["sql"])]
    assert writes == []
    assert financial_snapshot(hid) == before
    ids = {r.get("transaction_id") for r in rows}
    assert Transaction.objects.filter(payee="One-off").values_list("pk", flat=True).first() in ids
