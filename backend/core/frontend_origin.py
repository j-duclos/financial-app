"""Public frontend origin for auth email links (not Stripe-specific)."""
from __future__ import annotations

import logging
import os
from urllib.parse import urlparse

from django.conf import settings

logger = logging.getLogger(__name__)

_DEV_FRONTEND_ORIGIN = "http://localhost:5173"
_LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}


def is_production_frontend_runtime(*, debug: bool) -> bool:
    """True when localhost / non-HTTPS origins must be rejected.

    Render is always production. Pytest-django forces DEBUG=False, so tests
    are not treated as production unless RENDER=true.
    """
    if os.environ.get("RENDER", "").lower() in ("true", "1", "yes"):
        return True
    if os.environ.get("PYTEST_CURRENT_TEST"):
        return False
    return not debug


def sanitize_frontend_origin(origin: str, *, production: bool) -> str:
    """Return a production-safe origin, or empty when the value must not be used."""
    cleaned = (origin or "").strip().rstrip("/")
    if not cleaned:
        return ""
    if not production:
        return cleaned
    host = ""
    try:
        host = (urlparse(cleaned).hostname or "").lower()
    except ValueError:
        host = ""
    if host in _LOCAL_HOSTS:
        logger.warning("Ignoring localhost FRONTEND_ORIGIN in production.")
        return ""
    if not cleaned.lower().startswith("https://"):
        logger.warning("Ignoring non-HTTPS FRONTEND_ORIGIN in production.")
        return ""
    return cleaned


def get_frontend_origin() -> str:
    debug = bool(getattr(settings, "DEBUG", False))
    production = is_production_frontend_runtime(debug=debug)
    origin = sanitize_frontend_origin(
        getattr(settings, "FRONTEND_ORIGIN", "") or "",
        production=production,
    )
    if origin:
        return origin
    render_url = sanitize_frontend_origin(
        os.environ.get("RENDER_EXTERNAL_URL", ""),
        production=production,
    )
    if render_url:
        return render_url
    if not production:
        return _DEV_FRONTEND_ORIGIN
    return ""
