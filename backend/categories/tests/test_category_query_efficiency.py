"""Query-count regression for GET /api/categories/."""
from __future__ import annotations

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from rest_framework.test import APIClient

from categories.models import Category

WRITE_SQL = ("INSERT", "UPDATE", "DELETE")


def _sql_verb(sql: str) -> str:
    return sql.strip().split(None, 1)[0].upper() if sql.strip() else ""


def _profile(client: APIClient, params: dict | None = None) -> dict:
    url = reverse("category-list")
    query = {"page_size": 500, **(params or {})}
    connection.queries_log.clear()
    with CaptureQueriesContext(connection) as ctx:
        res = client.get(url, query)
    assert res.status_code == 200, res.content[:500]
    writes = [q for q in ctx.captured_queries if _sql_verb(q["sql"]) in WRITE_SQL]
    return {
        "queries": len(ctx.captured_queries),
        "writes": len(writes),
        "count": res.json().get("count"),
        "sql": [q["sql"][:200] for q in ctx.captured_queries],
    }


@pytest.mark.django_db
def test_category_list_query_count_does_not_scale(authenticated_client, household):
    url_params = {"household": household.id, "include_archived": "true"}
    baseline = _profile(authenticated_client, url_params)
    have = Category.objects.filter(household=household).count()
    for i in range(have, have + 80):
        Category.objects.create(
            household=household,
            name=f"Custom {i:03d}",
            category_type="EXPENSE",
            is_system=False,
            sort_order=1000 + i,
        )
    many = _profile(authenticated_client, url_params)
    print(
        f"\nCATEGORY LIST queries baseline={baseline['queries']} "
        f"count={baseline['count']} many={many['queries']} count={many['count']} "
        f"writes={many['writes']}"
    )
    for i, sql in enumerate(many["sql"]):
        print(f"  Q{i}: {sql}")
    assert baseline["writes"] == 0
    assert many["writes"] == 0
    assert many["queries"] <= baseline["queries"] + 1
    assert many["count"] >= baseline["count"] + 80


@pytest.mark.django_db
def test_category_list_get_is_read_only(authenticated_client, household):
    stats = _profile(
        authenticated_client,
        {"household": household.id, "include_archived": "true", "category_type": "EXPENSE"},
    )
    assert stats["writes"] == 0
    assert stats["count"] >= 1
