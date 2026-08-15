import pytest
from rest_framework import status
from django.urls import reverse

from categories.models import Category
from transactions.models import Transaction
from accounts.models import Account


@pytest.mark.django_db
class TestCategoryViewSet:
    def test_list_by_type(self, authenticated_client, household, user):
        url = reverse("category-list")
        r = authenticated_client.get(url, {"category_type": "EXPENSE"})
        assert r.status_code == 200
        results = r.json()["results"]
        assert all(c["category_type"] == "EXPENSE" for c in results)
        r2 = authenticated_client.get(url, {"category_type": "INCOME"})
        assert r2.status_code == 200
        assert all(c["category_type"] == "INCOME" for c in r2.json()["results"])

    def test_list_excludes_archived_by_default(
        self, authenticated_client, household
    ):
        Category.objects.create(
            household=household,
            name="Active",
            category_type="EXPENSE",
            sort_order=0,
            is_archived=False,
        )
        Category.objects.create(
            household=household,
            name="Archived",
            category_type="EXPENSE",
            sort_order=1,
            is_archived=True,
        )
        url = reverse("category-list")
        r = authenticated_client.get(url)
        assert r.status_code == 200
        names = [c["name"] for c in r.json()["results"]]
        assert "Active" in names
        assert "Archived" not in names

    def test_list_include_archived(self, authenticated_client, household):
        Category.objects.create(
            household=household,
            name="Archived",
            category_type="EXPENSE",
            sort_order=0,
            is_archived=True,
        )
        url = reverse("category-list")
        r = authenticated_client.get(url, {"include_archived": "true"})
        assert r.status_code == 200
        names = [c["name"] for c in r.json()["results"]]
        assert "Archived" in names

    def test_no_duplicate_name_case_insensitive(
        self, authenticated_client, household
    ):
        url = reverse("category-list")
        r = authenticated_client.post(
            url,
            {
                "household": household.id,
                "name": "groceries",
                "category_type": "EXPENSE",
            },
            format="json",
        )
        assert r.status_code == 400
        assert "name" in r.json()

        Category.objects.create(
            household=household, name="Dog Treats", category_type="EXPENSE", sort_order=0
        )
        r2 = authenticated_client.post(
            url,
            {
                "household": household.id,
                "name": "dog treats",
                "category_type": "EXPENSE",
            },
            format="json",
        )
        assert r2.status_code == 400
        assert "name" in r2.json()

    def test_create_without_parent(self, authenticated_client, household):
        url = reverse("category-list")
        r = authenticated_client.post(
            url,
            {
                "household": household.id,
                "name": "Dog Food",
                "category_type": "EXPENSE",
            },
            format="json",
        )
        assert r.status_code == 201, r.content
        assert r.json()["parent"] is None
        assert r.json()["is_system"] is False

    def test_parent_validation_same_household_and_type(
        self, authenticated_client, household
    ):
        parent = Category.objects.create(
            household=household, name="Parent", category_type="EXPENSE", sort_order=0
        )
        url = reverse("category-list")
        r = authenticated_client.post(
            url,
            {
                "household": household.id,
                "name": "Child",
                "category_type": "EXPENSE",
                "parent": parent.id,
            },
            format="json",
        )
        assert r.status_code == 201
        assert r.json()["parent"] == parent.id

    def test_parent_validation_different_type_rejected(
        self, authenticated_client, household
    ):
        parent = Category.objects.create(
            household=household, name="Income Parent", category_type="INCOME", sort_order=0
        )
        url = reverse("category-list")
        r = authenticated_client.post(
            url,
            {
                "household": household.id,
                "name": "Expense Child",
                "category_type": "EXPENSE",
                "parent": parent.id,
            },
            format="json",
        )
        assert r.status_code == 400
        assert "parent" in r.json()

    def test_delete_referenced_archives_instead(
        self, authenticated_client, household, account
    ):
        cat = Category.objects.create(
            household=household, name="Used", category_type="EXPENSE", sort_order=0
        )
        Transaction.objects.create(
            account=account,
            date="2025-01-01",
            payee="Store",
            amount="-50",
            category=cat,
        )
        url = reverse("category-detail", args=[cat.id])
        r = authenticated_client.delete(url)
        assert r.status_code == 204
        cat.refresh_from_db()
        assert cat.is_archived is True

    def test_delete_unreferenced_deletes(
        self, authenticated_client, household
    ):
        cat = Category.objects.create(
            household=household, name="Unused", category_type="EXPENSE", sort_order=0
        )
        url = reverse("category-detail", args=[cat.id])
        r = authenticated_client.delete(url)
        assert r.status_code == 204
        assert not Category.objects.filter(pk=cat.id).exists()

    def test_list_filters_default_vs_custom(self, authenticated_client, household):
        Category.objects.create(
            household=household,
            name="Dog Food",
            category_type="EXPENSE",
            is_system=False,
            sort_order=0,
        )
        url = reverse("category-list")
        custom = authenticated_client.get(
            url, {"category_type": "EXPENSE", "is_system": "false", "page_size": 500}
        )
        assert custom.status_code == 200
        custom_names = [c["name"] for c in custom.json()["results"]]
        assert "Dog Food" in custom_names
        assert all(c["is_system"] is False for c in custom.json()["results"])

        system = authenticated_client.get(
            url, {"category_type": "EXPENSE", "is_system": "true", "page_size": 500}
        )
        assert system.status_code == 200
        system_rows = system.json()["results"]
        assert system_rows
        assert all(c["is_system"] is True for c in system_rows)
        assert "Groceries" in [c["name"] for c in system_rows]
        assert "Dog Food" not in [c["name"] for c in system_rows]

    def test_list_includes_seeded_default_categories(self, authenticated_client, household):
        url = reverse("category-list")
        r = authenticated_client.get(url, {"page_size": 500})
        assert r.status_code == 200
        names = {c["name"] for c in r.json()["results"]}
        assert "Groceries" in names
        assert "Paycheck / Salary" in names
        assert any(c["is_system"] for c in r.json()["results"])

    def test_list_is_household_scoped(self, authenticated_client, household, api_client):
        from django.contrib.auth import get_user_model
        from core.models import Household, HouseholdMembership

        Category.objects.create(
            household=household,
            name="House A Only",
            category_type="EXPENSE",
            is_system=False,
            sort_order=0,
        )
        user_b = get_user_model().objects.create_user(username="cat_user_b", password="testpass123")
        house_b = Household.objects.create(name="House B cats")
        HouseholdMembership.objects.create(
            household=house_b, user=user_b, role=HouseholdMembership.Role.OWNER
        )
        Category.objects.create(
            household=house_b,
            name="House B Only",
            category_type="EXPENSE",
            is_system=False,
            sort_order=0,
        )
        url = reverse("category-list")
        r = authenticated_client.get(url, {"include_archived": "true", "page_size": 500})
        names = {c["name"] for c in r.json()["results"]}
        assert "House A Only" in names
        assert "House B Only" not in names

        api_client.force_authenticate(user=user_b)
        r_b = api_client.get(url, {"include_archived": "true", "page_size": 500})
        names_b = {c["name"] for c in r_b.json()["results"]}
        assert "House B Only" in names_b
        assert "House A Only" not in names_b
