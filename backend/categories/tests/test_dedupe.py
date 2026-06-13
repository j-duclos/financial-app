import pytest

from categories.models import Category
from categories.services.dedupe import (
    _pick_canonical,
    find_duplicate_category_groups,
    merge_duplicate_categories,
)


@pytest.mark.django_db
class TestCategoryDedupe:
    def test_merge_noop_when_no_duplicates(self, household):
        Category.objects.create(
            household=household,
            name="Dedupe Test Category",
            category_type="EXPENSE",
            sort_order=0,
        )
        stats = merge_duplicate_categories(household_id=household.pk)
        assert stats == {"groups": 0, "merged": 0, "rewired": 0}
        assert find_duplicate_category_groups(household_id=household.pk) == []

    def test_pick_canonical_prefers_most_used(self, household):
        older = Category(
            pk=10,
            household=household,
            name="Groceries",
            category_type="EXPENSE",
            is_system=True,
        )
        newer = Category(
            pk=20,
            household=household,
            name="Groceries",
            category_type="EXPENSE",
            is_system=False,
        )
        older._usage_count = 3  # type: ignore[attr-defined]
        newer._usage_count = 0  # type: ignore[attr-defined]
        assert _pick_canonical([older, newer]).pk == 10
