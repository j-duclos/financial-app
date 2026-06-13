"""Merge duplicate categories that share household, name, type, and parent."""
from __future__ import annotations

from collections import defaultdict
from typing import Iterable, Optional

from django.apps import apps
from django.db import transaction as db_transaction
from django.db.models import Count, Q

from categories.models import Category

# (app_label, model_name, field_name)
_CATEGORY_FK_REFS: tuple[tuple[str, str, str], ...] = (
    ("transactions", "Transaction", "category"),
    ("timeline", "RecurringRule", "category"),
    ("timeline", "RecurringRuleSchedule", "category"),
    ("timeline", "ScenarioRuleOverride", "override_category"),
    ("timeline", "ScenarioOneTimeEvent", "category"),
    ("timeline", "ScenarioAddedRecurring", "category"),
    ("timeline", "ScenarioCategoryShock", "category"),
    ("budgets", "Budget", "category"),
    ("budgets", "SpendingTarget", "category"),
    ("bills", "BillOccurrence", "category"),
)


def _dedupe_key(category: Category) -> tuple[int, str, str, Optional[int]]:
    return (
        category.household_id,
        category.name.strip().casefold(),
        category.category_type,
        category.parent_id,
    )


def _pick_canonical(categories: list[Category]) -> Category:
    def score(c: Category) -> tuple[int, int, int]:
        usage = getattr(c, "_usage_count", 0)
        return (usage, int(c.is_system), -c.pk)

    return max(categories, key=score)


def find_duplicate_category_groups(
    *,
    household_id: Optional[int] = None,
    include_archived: bool = False,
) -> list[list[Category]]:
    qs = Category.objects.all()
    if household_id is not None:
        qs = qs.filter(household_id=household_id)
    if not include_archived:
        qs = qs.filter(is_archived=False)

    grouped: dict[tuple[int, str, str, Optional[int]], list[Category]] = defaultdict(list)
    for cat in qs.order_by("id"):
        grouped[_dedupe_key(cat)].append(cat)

    return [cats for cats in grouped.values() if len(cats) > 1]


def _usage_counts(category_ids: Iterable[int]) -> dict[int, int]:
    counts: dict[int, int] = dict.fromkeys(category_ids, 0)
    txn_model = apps.get_model("transactions", "Transaction")
    txn_counts = (
        txn_model.objects.filter(category_id__in=category_ids)
        .values("category_id")
        .annotate(n=Count("id"))
    )
    for row in txn_counts:
        counts[row["category_id"]] = counts.get(row["category_id"], 0) + row["n"]
    return counts


def merge_duplicate_categories(
    *,
    household_id: Optional[int] = None,
    dry_run: bool = False,
) -> dict[str, int]:
    """
    Rewire FKs to the canonical row (most-used, else system, else oldest id) and archive dupes.
    """
    groups = find_duplicate_category_groups(household_id=household_id)
    if not groups:
        return {"groups": 0, "merged": 0, "rewired": 0}

    all_ids = [c.pk for group in groups for c in group]
    usage = _usage_counts(all_ids)

    merged = 0
    rewired = 0

    with db_transaction.atomic():
        for group in groups:
            for cat in group:
                cat._usage_count = usage.get(cat.pk, 0)  # type: ignore[attr-defined]
            canonical = _pick_canonical(group)
            dupes = [c for c in group if c.pk != canonical.pk]

            for dupe in dupes:
                merged += 1
                for app_label, model_name, field_name in _CATEGORY_FK_REFS:
                    model = apps.get_model(app_label, model_name)
                    filter_kwargs = {f"{field_name}_id": dupe.pk}
                    update_kwargs = {f"{field_name}_id": canonical.pk}
                    if dry_run:
                        rewired += model.objects.filter(**filter_kwargs).count()
                    else:
                        rewired += model.objects.filter(**filter_kwargs).update(**update_kwargs)

                child_filter = Q(parent_id=dupe.pk)
                if dry_run:
                    rewired += Category.objects.filter(child_filter).count()
                else:
                    rewired += Category.objects.filter(child_filter).update(parent_id=canonical.pk)

                if dry_run:
                    continue
                dupe.is_archived = True
                dupe.save(update_fields=["is_archived", "updated_at"])

    return {"groups": len(groups), "merged": merged, "rewired": rewired}
