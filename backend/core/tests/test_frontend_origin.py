from django.test import override_settings

from core.frontend_origin import get_frontend_origin, sanitize_frontend_origin


def test_sanitize_allows_localhost_outside_production():
    assert sanitize_frontend_origin("http://localhost:5173", production=False) == "http://localhost:5173"
    assert sanitize_frontend_origin("http://localhost:5173", production=True) == ""
    assert sanitize_frontend_origin("http://127.0.0.1:5173", production=True) == ""


def test_sanitize_requires_https_in_production():
    assert sanitize_frontend_origin("https://flowsight360.com", production=True) == "https://flowsight360.com"
    assert sanitize_frontend_origin("http://flowsight360.com", production=True) == ""
    assert sanitize_frontend_origin("", production=True) == ""


@override_settings(DEBUG=False, FRONTEND_ORIGIN="https://flowsight360.com")
def test_explicit_https_origin_is_used(monkeypatch):
    monkeypatch.delenv("RENDER", raising=False)
    assert get_frontend_origin() == "https://flowsight360.com"


@override_settings(DEBUG=False, FRONTEND_ORIGIN="http://localhost:5173")
def test_render_rejects_localhost_origin(monkeypatch):
    monkeypatch.setenv("RENDER", "true")
    monkeypatch.delenv("RENDER_EXTERNAL_URL", raising=False)
    assert get_frontend_origin() == ""


@override_settings(DEBUG=False, FRONTEND_ORIGIN="")
def test_render_missing_origin_is_empty(monkeypatch):
    monkeypatch.setenv("RENDER", "true")
    monkeypatch.delenv("RENDER_EXTERNAL_URL", raising=False)
    assert get_frontend_origin() == ""


@override_settings(DEBUG=True, FRONTEND_ORIGIN="")
def test_debug_defaults_to_local_vite(monkeypatch):
    monkeypatch.delenv("RENDER", raising=False)
    monkeypatch.delenv("RENDER_EXTERNAL_URL", raising=False)
    assert get_frontend_origin() == "http://localhost:5173"
