"""Redis cache configuration helpers (Render Key Value / local Docker)."""
from __future__ import annotations

import os
from urllib.parse import urlparse


def resolve_redis_url() -> str:
    """REDIS_URL or REDISCLOUD_URL from the environment."""
    for key in ("REDIS_URL", "REDISCLOUD_URL"):
        raw = (os.environ.get(key) or "").strip()
        if raw:
            return raw
    return ""


def redis_configured() -> bool:
    return bool(resolve_redis_url())


def redis_host_label() -> str | None:
    """Non-secret host:port for diagnostics (no password)."""
    url = resolve_redis_url()
    if not url:
        return None
    parsed = urlparse(url)
    if parsed.hostname:
        port = parsed.port or 6379
        return f"{parsed.hostname}:{port}"
    return "(configured)"


def redis_diagnostics() -> dict[str, str | int | bool | None]:
    from django.conf import settings

    url = resolve_redis_url()
    return {
        "redis_configured": bool(url),
        "redis_host": redis_host_label(),
        "timeline_cache_enabled": bool(getattr(settings, "TIMELINE_CACHE_ENABLED", False)),
        "timeline_cache_seconds": int(getattr(settings, "TIMELINE_CACHE_SECONDS", 0) or 0),
        "cache_backend": settings.CACHES["default"]["BACKEND"].rsplit(".", 1)[-1],
    }


def verify_redis_cache() -> tuple[bool, str]:
    """
    Ping Redis via Django cache backend.
    Returns (ok, message).
    """
    if not redis_configured():
        return False, "REDIS_URL is not set — timeline cache is disabled (LocMem only)."

    from django.core.cache import cache

    probe_key = "budget:redis_verify"
    probe_val = "ok"
    try:
        cache.set(probe_key, probe_val, timeout=30)
        if cache.get(probe_key) != probe_val:
            return False, "Redis write succeeded but read-back failed."
        cache.delete(probe_key)
        return True, "Redis read/write OK."
    except Exception as exc:
        return False, f"Redis error: {type(exc).__name__}: {exc}"
