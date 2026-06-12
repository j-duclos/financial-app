"""
Django settings for budget-app backend.
12-factor: SECRET_KEY, DEBUG, ALLOWED_HOSTS, DATABASE_URL, CORS_ALLOWED_ORIGINS from env.
"""
import os
import sys
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent
_ON_RENDER = os.environ.get("RENDER", "").lower() in ("true", "1", "yes")

# Load .env from backend/ when python-dotenv is installed (pip install python-dotenv).
if not _ON_RENDER:
    try:
        from dotenv import load_dotenv
        load_dotenv(BASE_DIR / ".env")
    except ImportError:
        pass

_INSECURE_DEV_SECRET = "dev-secret-key-change-in-production"


def _env_bool(name: str, *, default: bool) -> bool:
    if name not in os.environ:
        return default
    return os.environ[name].lower() in ("true", "1", "yes")


SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", _INSECURE_DEV_SECRET)
# Local dev: DEBUG True by default. Render sets RENDER=true → DEBUG False unless DEBUG= is explicit.
DEBUG = _env_bool("DEBUG", default=not _ON_RENDER)

# Performance instrumentation ([PERF] logs) — enable on Render without DEBUG=True.
ENABLE_PERF_LOGS = os.getenv("ENABLE_PERF_LOGS", "false").lower() == "true"

if not DEBUG and SECRET_KEY == _INSECURE_DEV_SECRET:
    raise ImproperlyConfigured(
        "Set DJANGO_SECRET_KEY to a unique secret when DEBUG is False (required on Render)."
    )

def _csv_env(name: str, default: str) -> list[str]:
    raw = os.environ.get(name, default)
    return [part.strip() for part in raw.split(",") if part.strip()]


_allowed_hosts = _csv_env("ALLOWED_HOSTS", "localhost,127.0.0.1")
if ".onrender.com" not in _allowed_hosts:
    _allowed_hosts.append(".onrender.com")
ALLOWED_HOSTS = _allowed_hosts


def _build_csrf_trusted_origins() -> list[str]:
    """Trusted origins for CSRF (React dev server + Render)."""
    origins = _csv_env("CSRF_TRUSTED_ORIGINS", "")
    seen = set(origins)

    def add(origin: str) -> None:
        o = origin.rstrip("/")
        if o and o not in seen:
            seen.add(o)
            origins.append(o)

    # Render sets this automatically on Web Services.
    add(os.environ.get("RENDER_EXTERNAL_URL", ""))

    for host in _allowed_hosts:
        if host.startswith("."):
            continue
        if host in ("localhost", "127.0.0.1"):
            add(f"http://{host}:8000")
            add(f"http://{host}:5173")
        else:
            add(f"https://{host}")

    return origins


CSRF_TRUSTED_ORIGINS = _build_csrf_trusted_origins()

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "rest_framework_simplejwt",
    "corsheaders",
    "drf_spectacular",
    "django_filters",
    "core",
    "accounts",
    "transactions",
    "budgets",
    "categories",
    "insights",
    "goals",
    "timeline",
    "plaid_link",
    "bills",
    "credit_cards",
    "recommendations",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    *(
        ["whitenoise.middleware.WhiteNoiseMiddleware"]
        if not DEBUG
        else []
    ),
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "core.middleware.DisableCSRFForAPIMiddleware",  # CSRF only for non-API; /api/ uses JWT
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]
WSGI_APPLICATION = "config.wsgi.application"

# Database: PostgreSQL when DATABASE_URL set, else SQLite
_DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
if _DATABASE_URL:
    if _ON_RENDER and ("localhost" in _DATABASE_URL or "127.0.0.1" in _DATABASE_URL):
        raise ImproperlyConfigured(
            "DATABASE_URL points to localhost, which does not exist on Render. "
            "In the Render Dashboard: create a Postgres database, link it to this Web Service "
            "(Environment → Link Database), or paste Render's Internal Database URL — "
            "do not copy the localhost placeholder from .env.example."
        )
    import dj_database_url

    DATABASES = {"default": dj_database_url.config(conn_max_age=600, default=_DATABASE_URL)}
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.sqlite3",
        }
    }

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True
STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

# Vite build output (build.sh copies apps/web/dist → frontend_dist on deploy).
def _resolve_frontend_dist() -> Path:
    for candidate in (
        BASE_DIR / "frontend_dist",
        BASE_DIR.parent / "apps" / "web" / "dist",
    ):
        if (candidate / "index.html").is_file():
            return candidate
    return BASE_DIR / "frontend_dist"


FRONTEND_DIST = _resolve_frontend_dist()


def _serve_react_app() -> bool:
    explicit = os.environ.get("SERVE_REACT_APP", "").strip().lower()
    if explicit in ("true", "1", "yes"):
        return True
    if explicit in ("false", "0", "no"):
        return False
    if _ON_RENDER:
        return True
    # Local/Docker: serve committed or built React on :8000 when frontend_dist exists.
    return (FRONTEND_DIST / "index.html").is_file()


SERVE_REACT_APP = _serve_react_app()
if not DEBUG:
    STORAGES = {
        "staticfiles": {
            "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
        },
    }
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Optional Redis cache (Render Key Value / Redis) — speeds timeline for all users in production.
from common.services.redis_config import resolve_redis_url

_REDIS_URL = resolve_redis_url()
_REDIS_BACKEND_AVAILABLE = False
if _REDIS_URL:
    try:
        import django_redis  # noqa: F401

        _REDIS_BACKEND_AVAILABLE = True
    except ImportError:
        import logging

        logging.getLogger(__name__).warning(
            "REDIS_URL is set but django-redis is not installed; using in-memory cache."
        )

if _REDIS_URL and _REDIS_BACKEND_AVAILABLE:
    CACHES = {
        "default": {
            "BACKEND": "django_redis.cache.RedisCache",
            "LOCATION": _REDIS_URL,
            "OPTIONS": {"CLIENT_CLASS": "django_redis.client.DefaultClient"},
            "KEY_PREFIX": "budget",
        }
    }
    TIMELINE_CACHE_ENABLED = True
    TIMELINE_CACHE_SECONDS = int(os.environ.get("TIMELINE_CACHE_SECONDS", "120"))
else:
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
            "LOCATION": "budget-local",
        }
    }
    TIMELINE_CACHE_ENABLED = False

LOGIN_URL = "/login/"
LOGIN_REDIRECT_URL = "/"
LOGOUT_REDIRECT_URL = "/login/"

# Render / reverse-proxy HTTPS
if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SECURE_SSL_REDIRECT = os.environ.get("SECURE_SSL_REDIRECT", "True").lower() in ("true", "1", "yes")
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True

# DRF
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": int(os.environ.get("PAGE_SIZE", "20")),
    "DEFAULT_FILTER_BACKENDS": ["django_filters.rest_framework.DjangoFilterBackend"],
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
}

# Simple JWT
from datetime import timedelta
SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=60),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
}

# CORS (DELETE must be allowed for transaction delete; django-cors-headers includes it by default, but set explicitly for clarity)
_CORS_DEV_DEFAULT = "http://localhost:5173,http://127.0.0.1:5173"


def _is_management_command() -> bool:
    argv0 = os.path.basename(sys.argv[0]) if sys.argv else ""
    return argv0 in ("manage.py", "django-admin")

# Enforce at gunicorn runtime only — not during build.sh (migrate/collectstatic also set RENDER=true).
_render_origin = os.environ.get("RENDER_EXTERNAL_URL", "").rstrip("/")
_cors_on_render_default = _render_origin if (_ON_RENDER and SERVE_REACT_APP and _render_origin) else ""

if (
    _ON_RENDER
    and "CORS_ALLOWED_ORIGINS" not in os.environ
    and not _is_management_command()
    and not _cors_on_render_default
):
    raise ImproperlyConfigured(
        "Set CORS_ALLOWED_ORIGINS to your app origin (e.g. https://your-app.onrender.com), "
        "or deploy with SERVE_REACT_APP on the same host so RENDER_EXTERNAL_URL applies."
    )
CORS_ALLOWED_ORIGINS = _csv_env(
    "CORS_ALLOWED_ORIGINS",
    _cors_on_render_default if _cors_on_render_default else _CORS_DEV_DEFAULT,
)
CORS_ALLOW_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
CORS_ALLOW_HEADERS = ["content-type", "authorization", "accept"]

# drf-spectacular
SPECTACULAR_SETTINGS = {
    "TITLE": "Budget App API",
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
}

# Console logging for Render (captures stdout/stderr from gunicorn workers).
_PERF_LOG_LEVEL = "INFO" if (DEBUG or ENABLE_PERF_LOGS) else "WARNING"
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "simple": {
            "format": "%(asctime)s %(levelname)s %(name)s %(message)s",
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "simple",
        },
    },
    "root": {
        "handlers": ["console"],
        "level": "INFO",
    },
    "loggers": {
        "common.services.profiler": {
            "handlers": ["console"],
            "level": _PERF_LOG_LEVEL,
            "propagate": False,
        },
        "timeline": {
            "handlers": ["console"],
            "level": _PERF_LOG_LEVEL,
            "propagate": False,
        },
        "timeline.services": {
            "handlers": ["console"],
            "level": _PERF_LOG_LEVEL,
            "propagate": False,
        },
        "timeline.services.ledger": {
            "handlers": ["console"],
            "level": _PERF_LOG_LEVEL,
            "propagate": False,
        },
        "accounts": {
            "handlers": ["console"],
            "level": _PERF_LOG_LEVEL,
            "propagate": False,
        },
        "accounts.services": {
            "handlers": ["console"],
            "level": _PERF_LOG_LEVEL,
            "propagate": False,
        },
        "accounts.services.available_to_spend": {
            "handlers": ["console"],
            "level": _PERF_LOG_LEVEL,
            "propagate": False,
        },
        "insights": {
            "handlers": ["console"],
            "level": _PERF_LOG_LEVEL,
            "propagate": False,
        },
        "insights.services": {
            "handlers": ["console"],
            "level": _PERF_LOG_LEVEL,
            "propagate": False,
        },
        "insights.services.dashboard_summary": {
            "handlers": ["console"],
            "level": _PERF_LOG_LEVEL,
            "propagate": False,
        },
    },
}
