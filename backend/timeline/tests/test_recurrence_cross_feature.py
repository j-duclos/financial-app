"""
Cross-feature recurrence consistency: Recurring list next_occurrence_date must match
the first future occurrence used by timeline/calendar/bills for the same rule.
"""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Account
from bills.recurring_payment_status import get_next_rule_run_date, next_occurrence_absence_reason
from categories.models import Category
from core.models import Household, HouseholdMembership
from timeline.models import RecurringRule
from timeline.services.ledger import build_timeline, generate_rule_occurrences
from timeline.services.rule_schedule import generate_rule_occurrence_dates

User = get_user_model()


@pytest.fixture
def hh(db, user):
    h = Household.objects.create(name="Consistency HH")
    HouseholdMembership.objects.create(household=h, user=user, role=HouseholdMembership.Role.OWNER)
    return h


@pytest.fixture
def checking(db, hh):
    return Account.objects.create(
        household=hh,
        account_type=Account.AccountType.CHECKING,
        name="Main",
        currency="USD",
    )


@pytest.fixture
def savings(db, hh):
    return Account.objects.create(
        household=hh,
        account_type=Account.AccountType.SAVINGS,
        name="Savings",
        currency="USD",
    )


@pytest.fixture
def rent_cat(db, hh):
    cat, _ = Category.objects.get_or_create(
        household=hh,
        name="Rent / Mortgage",
        category_type=Category.CategoryType.EXPENSE,
        defaults={"sort_order": 1},
    )
    return cat


@pytest.fixture
def bank_transfer_cat(db, hh):
    cat, _ = Category.objects.get_or_create(
        household=hh,
        name="Bank Transfer",
        category_type=Category.CategoryType.EXPENSE,
        defaults={"sort_order": 99},
    )
    return cat


def _make_monthly_rent(hh, checking, rent_cat, *, day=1):
    today = timezone.localdate()
    return RecurringRule.objects.create(
        household=hh,
        name="Rent",
        account=checking,
        category=rent_cat,
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("3100.00"),
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=day,
        start_date=today.replace(day=1) - timedelta(days=60),
        active=True,
    )


@pytest.mark.django_db
def test_next_occurrence_matches_across_features(user, hh, checking, rent_cat):
    rule = _make_monthly_rent(hh, checking, rent_cat, day=1)
    today = timezone.localdate()
    next_date = get_next_rule_run_date(rule, today)
    assert next_date is not None

    # Canonical expansion
    occ = generate_rule_occurrence_dates(rule, today, today + timedelta(days=400))
    assert occ[0] == next_date

    # Timeline / calendar path
    end = today + timedelta(days=45)
    timeline = build_timeline(user, today, end, account_id=checking.id)
    rent_rows = [
        r
        for r in timeline
        if r.get("rule_id") == rule.id or (r.get("description") or "").startswith("Rent")
    ]
    assert rent_rows, "timeline should include the rent occurrence"
    assert date.fromisoformat(str(rent_rows[0]["date"])[:10]) == next_date

    # Rules API serialization
    client = APIClient()
    client.force_authenticate(user=user)
    res = client.get(f"/api/rules/{rule.id}/")
    assert res.status_code == 200
    assert res.data["next_occurrence_date"] == next_date.isoformat()


@pytest.mark.django_db
def test_next_occurrence_null_reasons(user, hh, checking, rent_cat):
    today = timezone.localdate()
    rule = _make_monthly_rent(hh, checking, rent_cat)

    rule.active = False
    rule.paused_at = today
    rule.save(update_fields=["active", "paused_at"])
    assert get_next_rule_run_date(rule, today) is None
    assert next_occurrence_absence_reason(rule, today) == "paused"

    rule.paused_at = None
    rule.end_date = today - timedelta(days=1)
    rule.active = True
    rule.save(update_fields=["paused_at", "end_date", "active"])
    assert get_next_rule_run_date(rule, today) is None
    assert next_occurrence_absence_reason(rule, today) == "ended"

    rule.end_date = None
    rule.active = False
    rule.save(update_fields=["end_date", "active"])
    assert next_occurrence_absence_reason(rule, today) == "inactive"


@pytest.mark.django_db
def test_month_end_clamp_and_leap_year(hh, checking, rent_cat):
    rule = RecurringRule.objects.create(
        household=hh,
        name="Month-end bill",
        account=checking,
        category=rent_cat,
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("50"),
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=31,
        start_date=date(2024, 1, 1),
        active=True,
    )
    occ = generate_rule_occurrences(rule, date(2024, 1, 1), date(2024, 4, 30))
    assert occ == [
        date(2024, 1, 31),
        date(2024, 2, 29),  # leap year
        date(2024, 3, 31),
        date(2024, 4, 30),
    ]
    occ_non_leap = generate_rule_occurrences(rule, date(2025, 1, 1), date(2025, 3, 31))
    assert occ_non_leap == [date(2025, 1, 31), date(2025, 2, 28), date(2025, 3, 31)]


@pytest.mark.django_db
def test_biweekly_and_weekly_and_nth_and_yearly(hh, checking, rent_cat):
    start = date(2026, 1, 1)  # Thursday
    weekly = RecurringRule.objects.create(
        household=hh,
        name="Weekly",
        account=checking,
        category=rent_cat,
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("10"),
        currency="USD",
        frequency=RecurringRule.Frequency.WEEKLY,
        interval=1,
        day_of_week=3,  # Thursday
        start_date=start,
        active=True,
    )
    biweekly = RecurringRule.objects.create(
        household=hh,
        name="Biweekly",
        account=checking,
        category=rent_cat,
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("20"),
        currency="USD",
        frequency=RecurringRule.Frequency.BIWEEKLY,
        interval=1,
        day_of_week=3,
        start_date=start,
        active=True,
    )
    nth = RecurringRule.objects.create(
        household=hh,
        name="2nd Friday",
        account=checking,
        category=rent_cat,
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("30"),
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_NTH_WEEKDAY,
        interval=1,
        day_of_week=4,
        nth_week=2,
        start_date=start,
        active=True,
    )
    yearly = RecurringRule.objects.create(
        household=hh,
        name="Annual",
        account=checking,
        category=rent_cat,
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("40"),
        currency="USD",
        frequency=RecurringRule.Frequency.YEARLY,
        interval=1,
        start_date=date(2026, 6, 15),
        active=True,
    )

    w = generate_rule_occurrences(weekly, date(2026, 1, 1), date(2026, 1, 31))
    assert w[0] == date(2026, 1, 1)
    assert all(d.weekday() == 3 for d in w)

    b = generate_rule_occurrences(biweekly, date(2026, 1, 1), date(2026, 2, 28))
    assert b[0] == date(2026, 1, 1)
    assert b[1] == date(2026, 1, 15)

    n = generate_rule_occurrences(nth, date(2026, 1, 1), date(2026, 3, 31))
    assert date(2026, 1, 9) in n  # 2nd Friday Jan 2026
    assert date(2026, 2, 13) in n

    y = generate_rule_occurrences(yearly, date(2026, 1, 1), date(2027, 12, 31))
    assert y == [date(2026, 6, 15), date(2027, 6, 15)]


@pytest.mark.django_db
def test_weekly_interval_phases_from_rule_start_not_window(hh, checking, rent_cat):
    """Regression: every-3-weeks must not emit mid-cycle ghosts when the window starts mid-series.

    Chewy-style bug: window starting Aug 29 previously emitted Sep 4 (first Friday in window)
    instead of staying on the Aug 7 + 3-week phase (Aug 28, Sep 18, …).
    """
    rule = RecurringRule.objects.create(
        household=hh,
        name="Chewy",
        account=checking,
        category=rent_cat,
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("119.14"),
        currency="USD",
        frequency=RecurringRule.Frequency.WEEKLY,
        interval=3,
        day_of_week=4,  # Friday
        start_date=date(2026, 8, 7),  # Friday
        active=True,
    )
    occ = generate_rule_occurrences(rule, date(2026, 8, 29), date(2026, 9, 28))
    assert date(2026, 9, 4) not in occ
    assert date(2026, 9, 25) not in occ
    assert date(2026, 9, 18) in occ
    assert occ == [date(2026, 9, 18)]


@pytest.mark.django_db
def test_transfer_rule_next_and_two_sided_timeline(user, hh, checking, savings, bank_transfer_cat):
    today = timezone.localdate()
    # Anchor to a known weekday
    start = today - timedelta(days=((today.weekday() - 5) % 7))
    rule = RecurringRule.objects.create(
        household=hh,
        name="Save for Rent",
        account=checking,
        transfer_to_account=savings,
        category=bank_transfer_cat,
        direction=RecurringRule.Direction.TRANSFER,
        amount=Decimal("680.00"),
        currency="USD",
        frequency=RecurringRule.Frequency.WEEKLY,
        interval=1,
        day_of_week=5,  # Saturday
        start_date=start,
        active=True,
    )
    next_date = get_next_rule_run_date(rule, today)
    assert next_date is not None
    assert next_date.weekday() == 5

    end = today + timedelta(days=14)
    src_tl = build_timeline(user, today, end, account_id=checking.id)
    dst_tl = build_timeline(user, today, end, account_id=savings.id)
    src_hits = [r for r in src_tl if r.get("rule_id") == rule.id]
    dst_hits = [r for r in dst_tl if r.get("rule_id") == rule.id]
    assert src_hits and dst_hits
    assert Decimal(str(src_hits[0]["amount"])) < 0
    assert Decimal(str(dst_hits[0]["amount"])) > 0
    assert date.fromisoformat(str(src_hits[0]["date"])[:10]) == next_date


@pytest.mark.django_db
def test_rules_list_includes_next_occurrence(user, hh, checking, rent_cat):
    _make_monthly_rent(hh, checking, rent_cat)
    client = APIClient()
    client.force_authenticate(user=user)
    res = client.get("/api/rules/?page_size=200")
    assert res.status_code == 200
    row = res.data["results"][0]
    assert "next_occurrence_date" in row
    assert row["next_occurrence_date"] is not None
