"""Canonical balance_after: one walk, all consumers agree with Transactions Bal."""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.core.cache import cache

from accounts.models import Account
from accounts.services.available_to_spend import calculate_forecast_summaries_for_accounts
from core.models import Household, HouseholdMembership
from timeline.services.canonical_timeline_cache import get_or_build_canonical_forecast_timeline
from timeline.services.ledger import build_forecast_projection_timeline, forecast_account_balance_metrics
from timeline.services.ledger_section_balances import (
    assign_canonical_ledger_balance_after,
    forecast_balance_metrics_from_transactions_ledger,
    signed_timeline_ledger_amount,
    transactions_ledger_walk_rows,
)
from transactions.models import Transaction
from transactions.services.reconciliation import ledger_today_balance_before_pending

User = get_user_model()

AS_OF = date(2026, 8, 27)
AUG_28 = date(2026, 8, 28)
AUG_30 = date(2026, 8, 30)
SEP_2 = date(2026, 9, 2)
SEP_4 = date(2026, 9, 4)
FORECAST_DAYS = 30
POSTED_BEFORE_PENDING = Decimal("2022.70")
AFTER_PENDING = Decimal("1784.18")
PENDING_TOTAL = Decimal("-238.52")
MINIMUM_BUFFER = Decimal("503.43")

AUG_28_EXPECTED = [
    ("Gen's Rent", Decimal("1500.00"), Decimal("3284.18")),
    ("Rent", Decimal("-3100.00"), Decimal("184.18")),
    ("Lou", Decimal("500.00"), Decimal("684.18")),
    ("Electric bill", Decimal("-405.00"), Decimal("279.18")),
    ("Water Bill", Decimal("-180.00"), Decimal("99.18")),
]


@pytest.fixture
def user(db):
    return User.objects.create_user(username="canonical_bal_user", password="testpass123")


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="Canonical Bal HH")
    HouseholdMembership.objects.create(
        household=h, user=user, role=HouseholdMembership.Role.OWNER
    )
    return h


@pytest.fixture
def main(household):
    """Starting balance = after-pending ($1,784.18) — same as Transactions Current Balance."""
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        name="Main",
        starting_balance=AFTER_PENDING,
        minimum_buffer=MINIMUM_BUFFER,
        currency="USD",
        include_in_forecast=True,
    )


def _planned(account, day, payee, amount):
    return Transaction.objects.create(
        account=account,
        date=day,
        payee=payee,
        amount=amount,
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.ONE_TIME,
    )


def _main_fixture_stack(main):
    for payee, amount, _ in AUG_28_EXPECTED:
        _planned(main, AUG_28, payee, amount)
    _planned(main, AUG_30, "Vivint", Decimal("-63.65"))
    _planned(main, SEP_2, "Exeter", Decimal("-393.79"))
    _planned(main, SEP_2, "Fortiva", Decimal("-42.74"))
    _planned(main, SEP_2, "Move to Venture", Decimal("-66.00"))
    _planned(main, SEP_4, "Hulu", Decimal("-35.00"))
    _planned(main, SEP_4, "Paycheck", Decimal("1835.52"))
    _planned(main, SEP_4, "ATT", Decimal("-200.00"))


def _rows(user, main):
    cache.clear()
    end = AS_OF + timedelta(days=FORECAST_DAYS)
    return build_forecast_projection_timeline(
        user,
        today=AS_OF,
        end_date=end,
        caller="test_canonical_balance",
        account_id=main.pk,
    )


def _balance_by_description(rows, account_id, payee: str) -> Decimal:
    for row in rows:
        if row.get("account_id") != account_id:
            continue
        if (row.get("description") or "") == payee:
            return Decimal(str(row["balance_after"]))
    raise AssertionError(f"No row matching {payee!r}")


@pytest.mark.django_db
def test_no_double_pending_when_anchor_is_after_pending(user, main):
    """Regression: must never apply pending total twice (1784.18 - 238.52)."""
    _main_fixture_stack(main)
    rows = _rows(user, main)
    anchor = ledger_today_balance_before_pending(main, AS_OF)
    assert anchor == AFTER_PENDING
    gen_bal = _balance_by_description(rows, main.id, "Gen's Rent")
    assert gen_bal == AFTER_PENDING + Decimal("1500.00")
    wrongly_double = AFTER_PENDING - PENDING_TOTAL
    assert gen_bal != wrongly_double + Decimal("1500.00")


@pytest.mark.django_db
def test_explicit_posted_anchor_pending_walk_once(user, household):
    """posted-before-pending anchor + pending rows applied exactly once."""
    acct = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        name="Main Pending",
        starting_balance=POSTED_BEFORE_PENDING,
        minimum_buffer=MINIMUM_BUFFER,
        currency="USD",
        include_in_forecast=True,
    )
    _planned(acct, AS_OF, "Pending A", Decimal("-100.00"))
    _planned(acct, date(2026, 8, 20), "Pending B", Decimal("-138.52"))
    _planned(acct, AUG_28, "Gen's Rent", Decimal("1500.00"))
    end = AS_OF + timedelta(days=FORECAST_DAYS)
    rows = build_forecast_projection_timeline(
        user,
        today=AS_OF,
        end_date=end,
        caller="test_pending_once",
        account_id=acct.pk,
    )
    assign_canonical_ledger_balance_after(
        rows,
        today=AS_OF,
        anchors={acct.id: POSTED_BEFORE_PENDING},
        account_ids={acct.id},
        force=True,
    )
    walk = transactions_ledger_walk_rows(rows, account_id=acct.id, today=AS_OF)
    pending_rows = [r for r in walk if str(r.get("date"))[:10] <= AS_OF.isoformat()]
    assert sum(signed_timeline_ledger_amount(r) for r in pending_rows) == PENDING_TOTAL
    assert Decimal(str(pending_rows[-1]["balance_after"])) == AFTER_PENDING
    assert _balance_by_description(rows, acct.id, "Gen's Rent") == AFTER_PENDING + Decimal(
        "1500.00"
    )


@pytest.mark.django_db
def test_aug_28_canonical_row_balances(user, main):
    _main_fixture_stack(main)
    rows = _rows(user, main)
    for payee, _amount, expected_bal in AUG_28_EXPECTED:
        assert _balance_by_description(rows, main.id, payee) == expected_bal


@pytest.mark.django_db
def test_aug_28_not_projected_negative(user, main):
    for payee, amount, _ in AUG_28_EXPECTED:
        _planned(main, AUG_28, payee, amount)
    rows = _rows(user, main)
    metrics = forecast_account_balance_metrics(
        rows,
        account_id=main.id,
        today=AS_OF,
        end_date=AS_OF + timedelta(days=FORECAST_DAYS),
        minimum_buffer=MINIMUM_BUFFER,
    )
    assert metrics["first_negative_date"] is None
    assert metrics["end_of_day"][AUG_28] == Decimal("99.18")
    assert metrics["first_below_buffer_date"] == AUG_28


@pytest.mark.django_db
def test_first_negative_sep_2(user, main):
    _main_fixture_stack(main)
    rows = _rows(user, main)
    metrics = forecast_account_balance_metrics(
        rows,
        account_id=main.id,
        today=AS_OF,
        end_date=AS_OF + timedelta(days=FORECAST_DAYS),
        minimum_buffer=MINIMUM_BUFFER,
    )
    assert metrics["first_negative_date"] == SEP_2
    assert metrics["first_negative_balance"] == Decimal("-358.26")
    assert _balance_by_description(rows, main.id, "Exeter") == Decimal("-358.26")


@pytest.mark.django_db
def test_lowest_balance_exists_on_canonical_row(user, main):
    _main_fixture_stack(main)
    rows = _rows(user, main)
    metrics = forecast_account_balance_metrics(
        rows,
        account_id=main.id,
        today=AS_OF,
        end_date=AS_OF + timedelta(days=FORECAST_DAYS),
        minimum_buffer=MINIMUM_BUFFER,
    )
    lowest = metrics["lowest"]
    walk = transactions_ledger_walk_rows(
        rows, account_id=main.id, today=AS_OF, end_date=AS_OF + timedelta(days=FORECAST_DAYS)
    )
    canonical_values = {Decimal(str(r["balance_after"])) for r in walk if r.get("balance_after")}
    canonical_values.add(metrics["opening_balance"])
    assert lowest in canonical_values


@pytest.mark.django_db
def test_metrics_reducer_matches_canonical_not_chronological(user, main):
    _main_fixture_stack(main)
    rows = _rows(user, main)
    anchor = ledger_today_balance_before_pending(main, AS_OF)
    metrics = forecast_balance_metrics_from_transactions_ledger(
        rows,
        account_id=main.id,
        today=AS_OF,
        end_date=AS_OF + timedelta(days=FORECAST_DAYS),
        minimum_buffer=MINIMUM_BUFFER,
        ledger_anchor=anchor,
    )
    hulu_bal = _balance_by_description(rows, main.id, "Hulu")
    assert metrics["lowest"] != Decimal("-2343.95")
    assert hulu_bal == Decimal("-502.00")


@pytest.mark.django_db
def test_dashboard_forecast_agrees_with_canonical_rows(user, main):
    _main_fixture_stack(main)
    rows = _rows(user, main)
    summaries = calculate_forecast_summaries_for_accounts(
        user, [main], as_of_date=AS_OF, days=FORECAST_DAYS, timeline_rows=rows
    )
    forecast = summaries[main.id]
    assert forecast["first_negative_date"] == SEP_2.isoformat()
    assert Decimal(forecast["first_negative_balance"]) == Decimal("-358.26")
    assert Decimal(forecast["lowest_projected_balance"]) == Decimal("-502.00")
    assert forecast["lowest_projected_balance_date"] == SEP_4.isoformat()


@pytest.mark.django_db
def test_canonical_cache_hit_shares_balance_after(user, main):
    _main_fixture_stack(main)
    cache.clear()
    rows1, hit1 = get_or_build_canonical_forecast_timeline(
        user, today=AS_OF, forecast_days=FORECAST_DAYS, caller="test_cache_a"
    )
    rows2, hit2 = get_or_build_canonical_forecast_timeline(
        user, today=AS_OF, forecast_days=FORECAST_DAYS, caller="test_cache_b"
    )
    assert hit1 is False
    assert hit2 is True
    main_rows = [r for r in rows1 if r.get("account_id") == main.id]
    cached_rows = [r for r in rows2 if r.get("account_id") == main.id]
    for a, b in zip(
        sorted(main_rows, key=lambda r: (str(r.get("date")), r.get("transaction_id") or 0)),
        sorted(cached_rows, key=lambda r: (str(r.get("date")), r.get("transaction_id") or 0)),
    ):
        assert a.get("balance_after") == b.get("balance_after")


SHADOW_AMOUNT = Decimal("-503.43")
POSTED_ANCHOR = Decimal("2360.64")
GENS_RENT_AMOUNT = Decimal("1500.00")
GENS_RENT_BAL = POSTED_ANCHOR + GENS_RENT_AMOUNT


@pytest.mark.django_db
def test_shadow_rule_row_excluded_from_canonical_walk(user, household):
    """
    Regression: shadow rule sibling must not affect canonical balance_after or Transactions visibility.

    posted anchor = 2360.64, shadow = -503.43 (hidden), Gen's Rent = +1500 → 3860.64
    """
    from timeline.services.ledger import (
        annotate_financially_active_rows,
        is_shadowed_by_matched_rule_sibling,
        row_participates_in_ledger_walk,
    )

    acct_id = 9001
    rule_id = 42
    shadow_day = date(2026, 8, 27)
    matched_day = date(2026, 8, 30)
    gens_day = date(2026, 8, 28)
    as_of = gens_day

    rows = [
        {
            "date": matched_day,
            "description": "Shadowed bill",
            "account_id": acct_id,
            "amount": SHADOW_AMOUNT,
            "type": "OUTFLOW",
            "status": "PLANNED",
            "source": "rule",
            "rule_id": rule_id,
            "transaction_id": 101,
            "import_match_status": "matched",
            "txn_source": "rule",
        },
        {
            "date": shadow_day,
            "description": "Shadowed bill",
            "account_id": acct_id,
            "amount": SHADOW_AMOUNT,
            "type": "OUTFLOW",
            "status": "PLANNED",
            "source": "rule",
            "rule_id": rule_id,
            "transaction_id": 102,
            "import_match_status": None,
            "txn_source": "rule",
        },
        {
            "date": gens_day,
            "description": "Gen's Rent",
            "account_id": acct_id,
            "amount": GENS_RENT_AMOUNT,
            "type": "INFLOW",
            "status": "PLANNED",
            "source": "one_time",
            "rule_id": None,
            "transaction_id": 103,
            "txn_source": "one_time",
        },
    ]
    annotate_financially_active_rows(rows)
    shadow_row = rows[1]
    assert shadow_row["financially_active"] is False
    assert is_shadowed_by_matched_rule_sibling(shadow_row, rows)
    assert not row_participates_in_ledger_walk(shadow_row, rows)

    assign_canonical_ledger_balance_after(
        rows,
        today=as_of,
        anchors={acct_id: POSTED_ANCHOR},
        account_ids={acct_id},
        force=True,
    )
    walk = transactions_ledger_walk_rows(rows, account_id=acct_id, today=as_of)
    assert all(
        not (
            r.get("rule_id") == rule_id and str(r.get("date"))[:10] == shadow_day.isoformat()
        )
        for r in walk
    )
    gen_bal = _balance_by_description(rows, acct_id, "Gen's Rent")
    assert gen_bal == GENS_RENT_BAL
    assert gen_bal != POSTED_ANCHOR + SHADOW_AMOUNT + GENS_RENT_AMOUNT


@pytest.mark.django_db
def test_shadow_rule_materialized_occurrence_excluded_from_canonical_walk(user, household):
    """Integration: DB shadow sibling + explicit rule row still yields Gen's Rent at anchor + 1500."""
    from timeline.models import RecurringRule
    from transactions.services import manual_match_transactions

    acct = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        name="Main Shadow DB",
        starting_balance=POSTED_ANCHOR,
        minimum_buffer=MINIMUM_BUFFER,
        currency="USD",
        include_in_forecast=True,
    )
    rule = RecurringRule.objects.create(
        household=household,
        account=acct,
        name="Shadowed bill",
        direction=RecurringRule.Direction.EXPENSE,
        amount=abs(SHADOW_AMOUNT),
        frequency=RecurringRule.Frequency.WEEKLY,
        start_date=date(2026, 8, 1),
        active=True,
    )
    matched_day = date(2026, 8, 30)
    shadow_day = date(2026, 8, 27)
    gens_day = date(2026, 8, 28)
    as_of = gens_day

    early = Transaction.objects.create(
        account=acct,
        date=matched_day,
        payee=rule.name,
        amount=SHADOW_AMOUNT,
        source=Transaction.Source.RULE,
        status=Transaction.Status.PLANNED,
        rule=rule,
    )
    imported = Transaction.objects.create(
        account=acct,
        date=matched_day,
        payee="BANK SHADOW BILL",
        amount=SHADOW_AMOUNT,
        source=Transaction.Source.PLAID,
        plaid_transaction_id="plaid-shadow-503-db",
        import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
    )
    manual_match_transactions(planned_id=early.pk, imported_id=imported.pk, user=user)
    Transaction.objects.create(
        account=acct,
        date=shadow_day,
        payee=rule.name,
        amount=SHADOW_AMOUNT,
        source=Transaction.Source.RULE,
        status=Transaction.Status.PLANNED,
        rule=rule,
    )
    _planned(acct, gens_day, "Gen's Rent", GENS_RENT_AMOUNT)

    end = as_of + timedelta(days=FORECAST_DAYS)
    rows = build_forecast_projection_timeline(
        user,
        today=as_of,
        end_date=end,
        caller="test_shadow_db",
        account_id=acct.pk,
    )
    anchor = ledger_today_balance_before_pending(acct, as_of)
    assert anchor == POSTED_ANCHOR
    gen_bal = _balance_by_description(rows, acct.id, "Gen's Rent")
    assert gen_bal == GENS_RENT_BAL


@pytest.mark.django_db
def test_financial_visibility_invariant(user, household):
    """Every balance-walk row is financially active; inactive rows carry financially_active=False."""
    from timeline.services.ledger import row_participates_in_ledger_walk

    acct = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        name="Invariant",
        starting_balance=POSTED_ANCHOR,
        currency="USD",
        include_in_forecast=True,
    )
    _planned(acct, AUG_28, "Gen's Rent", GENS_RENT_AMOUNT)
    end = AS_OF + timedelta(days=FORECAST_DAYS)
    rows = build_forecast_projection_timeline(
        user,
        today=AS_OF,
        end_date=end,
        caller="test_invariant",
        account_id=acct.pk,
    )
    walk = transactions_ledger_walk_rows(rows, account_id=acct.id, today=AS_OF)
    acct_rows = [r for r in rows if r.get("account_id") == acct.id]
    for row in walk:
        assert row.get("financially_active") is not False
        assert row_participates_in_ledger_walk(row, acct_rows)
        assert row.get("balance_after") is not None
    for row in acct_rows:
        if row.get("financially_active") is False:
            assert row.get("transaction_id") not in {r.get("transaction_id") for r in walk}
