"""Optional Sentry error monitoring. No-op when SENTRY_DSN is unset."""

from __future__ import annotations

import logging
import os

from config.sentry_scrub import scrub_sentry_event

logger = logging.getLogger(__name__)

_enabled = False


def monitoring_enabled() -> bool:
    return _enabled


def bind_sentry_user(user) -> None:
    if not _enabled:
        return
    import sentry_sdk

    if user is not None and getattr(user, "is_authenticated", False):
        sentry_sdk.set_user({"id": str(user.pk)})
    else:
        sentry_sdk.set_user(None)


def _on_request_exception(sender, request, **kwargs):  # noqa: ARG001
    bind_sentry_user(getattr(request, "user", None))


def init_sentry() -> bool:
    """Initialize Sentry when DSN is present. Never required for local startup."""
    global _enabled
    dsn = (os.environ.get("SENTRY_DSN") or "").strip()
    if not dsn:
        _enabled = False
        return False
    try:
        import sentry_sdk
        from sentry_sdk.integrations.django import DjangoIntegration
    except ImportError:
        logger.warning("SENTRY_DSN is set but sentry-sdk is not installed; monitoring disabled")
        _enabled = False
        return False

    environment = (os.environ.get("SENTRY_ENVIRONMENT") or "").strip()
    if not environment:
        if os.environ.get("RENDER", "").lower() in ("true", "1", "yes"):
            environment = "production"
        else:
            environment = "development"
    release = (os.environ.get("SENTRY_RELEASE") or "").strip() or None

    kwargs = {
        "dsn": dsn,
        "environment": environment,
        "release": release,
        "send_default_pii": False,
        "traces_sample_rate": 0,
        "integrations": [DjangoIntegration()],
        "before_send": scrub_sentry_event,
    }
    optional = {
        "profiles_sample_rate": 0,
        "include_local_variables": False,
        "max_request_body_size": "never",
    }
    try:
        sentry_sdk.init(**kwargs, **optional)
    except TypeError:
        sentry_sdk.init(**kwargs)
    from django.core.signals import got_request_exception

    got_request_exception.connect(_on_request_exception, weak=False)
    _enabled = True
    logger.info("Sentry error monitoring enabled environment=%s", environment)
    return True
