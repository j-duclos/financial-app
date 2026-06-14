"""
Pytest settings — always use local SQLite, never remote Postgres from .env.

Without this, DATABASE_URL in backend/.env points pytest at Render Postgres,
which causes hangs (locked test_budgeter_* DB) or flaky setup failures.
"""
from __future__ import annotations

import os

# Clear before importing config.settings (which loads backend/.env via dotenv).
os.environ["DATABASE_URL"] = ""
os.environ.setdefault("DJANGO_SECRET_KEY", "pytest-secret-key")
os.environ.setdefault("DEBUG", "true")

from config.settings import *  # noqa: F401,F403

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / "test_db.sqlite3",
    }
}

# Faster auth in tests.
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.MD5PasswordHasher",
]

CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
    }
}
