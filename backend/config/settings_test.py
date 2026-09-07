"""
Pytest settings.

Local/default: SQLite. DATABASE_URL from backend/.env is cleared so tests never
hit Render Postgres.

CI: set USE_POSTGRES_FOR_TESTS=1 and DATABASE_URL to the GitHub Actions Postgres
service (dummy credentials only).
"""
from __future__ import annotations

import os

os.environ["SENTRY_DSN"] = ""
os.environ.setdefault("DJANGO_SECRET_KEY", "pytest-secret-key")
os.environ.setdefault("DEBUG", "true")
os.environ.setdefault("EMAIL_BACKEND", "django.core.mail.backends.locmem.EmailBackend")

_use_postgres = os.environ.get("USE_POSTGRES_FOR_TESTS") == "1"
if not _use_postgres:
    os.environ["DATABASE_URL"] = ""

from config.settings import *  # noqa: F401,F403

if not _use_postgres:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "test_db.sqlite3",
        }
    }
else:
    DATABASES["default"]["CONN_MAX_AGE"] = 0

# Faster auth in tests.
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.MD5PasswordHasher",
]

CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
    }
}

EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
EMAIL_HOST_PASSWORD = ""
FRONTEND_ORIGIN = "http://localhost:5173"
PROJECTED_FUNDS_PUSH_DRY_RUN = True
