"""Regression: /api/db-info/ must not expose database connection details."""
import pytest


@pytest.mark.django_db
def test_public_client_cannot_retrieve_database_info(api_client, settings):
    settings.DEBUG = False
    response = api_client.get("/api/db-info/")
    assert response.status_code == 404
    body = response.content.decode("utf-8", errors="ignore").lower()
    assert "postgres" not in body
    assert '"host"' not in body
    assert '"user"' not in body
    assert "database" not in body or "not found" in body


@pytest.mark.django_db
def test_db_info_is_unavailable_even_in_debug(api_client, settings):
    settings.DEBUG = True
    response = api_client.get("/api/db-info/")
    assert response.status_code == 404
    body = response.content.decode("utf-8", errors="ignore").lower()
    assert '"host"' not in body
    assert '"port"' not in body


@pytest.mark.django_db
def test_authenticated_client_cannot_retrieve_database_info(authenticated_client):
    response = authenticated_client.get("/api/db-info/")
    assert response.status_code == 404
