"""Safe production configuration diagnostics. Never include secret values."""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

from django.conf import settings
from django.db import connection

from billing.stripe_config import (
    stripe_premium_price_id,
    stripe_secret_key,
    stripe_webhook_secret,
)
from common.services.redis_config import redis_configured, verify_redis_cache
from plaid_link.plaid_api_client import (
    plaid_api_env,
    plaid_configured,
    plaid_env_configured_explicitly,
    secret_for_plaid_env,
    _clean_cred,
)

PASSWORD_RESET_REQUEST_PATH = "/api/auth/forgot-password/"
PASSWORD_RESET_COMPLETE_PATH = "/api/auth/reset-password/"
PASSWORD_RESET_WEB_PATH = "/reset-password"
BILLING_CHECKOUT_PATH = "/api/billing/create-checkout-session/"
BILLING_WEBHOOK_PATH = "/api/billing/webhook/"


def _configured(value: str | None) -> str:
    return "configured" if (value or "").strip() else "missing"


def _yes_no(value: Any) -> str:
    return "yes" if value else "no"


def stripe_secret_mode(secret_key: str | None = None) -> str:
    """Detect test/live from the key prefix only. Never return the key."""
    key = (secret_key if secret_key is not None else stripe_secret_key()) or ""
    if key.startswith("sk_live_"):
        return "live"
    if key.startswith("sk_test_"):
        return "test"
    if key.strip():
        return "unknown"
    return "missing"


def _tls_ssl_mode() -> str:
    use_ssl = bool(getattr(settings, "EMAIL_USE_SSL", False))
    use_tls = bool(getattr(settings, "EMAIL_USE_TLS", False))
    if use_ssl and use_tls:
        return "TLS+SSL (invalid: pick one)"
    if use_ssl:
        return "SSL"
    if use_tls:
        return "TLS"
    return "none"


def _frontend_origin_configured() -> bool:
    explicit = (getattr(settings, "FRONTEND_ORIGIN", "") or "").strip()
    render_url = os.environ.get("RENDER_EXTERNAL_URL", "").strip()
    return bool(explicit or render_url)


def build_billing_report(*, probe_stripe: bool = False) -> list[tuple[str, str]]:
    secret = stripe_secret_key()
    price_id = stripe_premium_price_id()
    webhook = stripe_webhook_secret()
    success_custom = bool((getattr(settings, "BILLING_SUCCESS_URL", "") or "").strip())
    cancel_custom = bool((getattr(settings, "BILLING_CANCEL_URL", "") or "").strip())
    rows: list[tuple[str, str]] = [
        ("STRIPE_SECRET_KEY", _configured(secret)),
        ("STRIPE_SECRET_MODE", stripe_secret_mode(secret)),
        ("STRIPE_PREMIUM_PRICE_ID", _configured(price_id)),
        ("STRIPE_WEBHOOK_SECRET", _configured(webhook)),
        ("FRONTEND_ORIGIN", "configured" if _frontend_origin_configured() else "missing"),
        ("BILLING_SUCCESS_URL", "custom" if success_custom else "default"),
        ("BILLING_CANCEL_URL", "custom" if cancel_custom else "default"),
        ("STRIPE_CHECKOUT_PATH", BILLING_CHECKOUT_PATH),
        ("STRIPE_WEBHOOK_PATH", BILLING_WEBHOOK_PATH),
    ]
    if not probe_stripe:
        rows.append(("STRIPE_API_REACHABLE", "skipped"))
        rows.append(("STRIPE_KEY_PRICE_COMPATIBLE", "skipped"))
        return rows

    if not secret:
        rows.append(("STRIPE_API_REACHABLE", "skipped"))
        rows.append(("STRIPE_KEY_PRICE_COMPATIBLE", "skipped"))
        return rows

    reachable = "no"
    compatible = "skipped"
    try:
        from billing.stripe_api import retrieve_account, retrieve_price

        retrieve_account()
        reachable = "yes"
        if price_id:
            price = retrieve_price(price_id)
            livemode = bool(getattr(price, "livemode", False))
            mode = stripe_secret_mode(secret)
            if mode == "live":
                compatible = "yes" if livemode else "no"
            elif mode == "test":
                compatible = "yes" if not livemode else "no"
            else:
                compatible = "unknown"
    except Exception as exc:
        reachable = "no"
        rows.append(("STRIPE_API_ERROR_TYPE", type(exc).__name__))
    rows.append(("STRIPE_API_REACHABLE", reachable))
    rows.append(("STRIPE_KEY_PRICE_COMPATIBLE", compatible))
    return rows


def build_email_report() -> list[tuple[str, str]]:
    backend = (getattr(settings, "EMAIL_BACKEND", "") or "").strip() or "missing"
    host = (getattr(settings, "EMAIL_HOST", "") or "").strip()
    port = getattr(settings, "EMAIL_PORT", "")
    from_email = (getattr(settings, "DEFAULT_FROM_EMAIL", "") or "").strip() or "missing"
    timeout = int(getattr(settings, "PASSWORD_RESET_TIMEOUT", 60 * 60 * 24 * 3) or 0)
    smtp_ready = backend.endswith("smtp.EmailBackend") and bool(host)
    remaining: list[str] = []
    if not _frontend_origin_configured():
        remaining.append("FRONTEND_ORIGIN")
    if not smtp_ready and "console" in backend:
        remaining.append("production SMTP (EMAIL_BACKEND/EMAIL_HOST)")
    if not (getattr(settings, "EMAIL_HOST_PASSWORD", "") or "").strip() and smtp_ready:
        remaining.append("EMAIL_HOST_PASSWORD")
    return [
        ("EMAIL_BACKEND", backend),
        ("SMTP_HOST", f"configured {_yes_no(host)}"),
        ("SMTP_PORT", str(port)),
        ("TLS/SSL", _tls_ssl_mode()),
        ("DEFAULT_FROM_EMAIL", from_email),
        ("FRONTEND_ORIGIN", f"configured {_yes_no(_frontend_origin_configured())}"),
        ("PASSWORD_RESET_REQUEST_ENDPOINT", PASSWORD_RESET_REQUEST_PATH),
        ("PASSWORD_RESET_COMPLETE_ENDPOINT", PASSWORD_RESET_COMPLETE_PATH),
        ("PASSWORD_RESET_WEB_PATH", PASSWORD_RESET_WEB_PATH),
        ("PASSWORD_RESET_TIMEOUT_SECONDS", str(timeout)),
        (
            "PASSWORD_RESET_REMAINING",
            ", ".join(remaining) if remaining else "none (web reset ready; mobile UI is Phase B)",
        ),
    ]


def build_plaid_report() -> list[tuple[str, str]]:
    explicit = plaid_env_configured_explicitly()
    try:
        env = plaid_api_env()
        env_error = ""
    except RuntimeError as exc:
        env = "unset"
        env_error = str(exc)
    client_id = _clean_cred(os.environ.get("PLAID_CLIENT_ID"))
    secret_present = bool(secret_for_plaid_env(env) if env != "unset" else "")
    webhook = (getattr(settings, "PLAID_WEBHOOK_URL", "") or os.environ.get("PLAID_WEBHOOK_URL", "")).strip()
    rows = [
        (
            "PLAID_ENV",
            env
            if explicit
            else ("missing" if env == "unset" else f"{env} (implicit development default)"),
        ),
        ("PLAID_ENV_EXPLICIT", _yes_no(explicit)),
        ("PLAID_CLIENT_ID", _configured(client_id)),
        ("PLAID_SECRET", "configured" if secret_present else "missing"),
        ("PLAID_WEBHOOK_URL", "configured" if webhook else "not configured"),
        ("PLAID_CONFIGURED", _yes_no(env != "unset" and plaid_configured())),
    ]
    if env_error:
        rows.append(("PLAID_ENV_ERROR", "missing in production (sandbox fallback refused)"))
    return rows


def _database_connected() -> bool:
    try:
        connection.ensure_connection()
        connection.cursor().execute("SELECT 1")
        return True
    except Exception:
        return False


def build_production_health_report(*, probe_stripe: bool = False) -> list[tuple[str, str]]:
    db_ok = _database_connected()
    redis_ok = False
    redis_state = "not configured"
    if redis_configured():
        redis_ok, _message = verify_redis_cache()
        redis_state = "connected" if redis_ok else "error"
    email_rows = dict(build_email_report())
    billing_rows = dict(build_billing_report(probe_stripe=probe_stripe))
    plaid_rows = dict(build_plaid_report())
    smtp_host = (getattr(settings, "EMAIL_HOST", "") or "").strip()
    email_ok = "smtp.EmailBackend" in email_rows["EMAIL_BACKEND"] and bool(smtp_host)
    stripe_ok = billing_rows["STRIPE_SECRET_KEY"] == "configured"
    plaid_ok = plaid_rows.get("PLAID_CONFIGURED") == "yes"
    return [
        ("database", "connected" if db_ok else "error"),
        ("redis", redis_state),
        ("email_configured", _yes_no(email_ok)),
        ("stripe_configured", _yes_no(stripe_ok)),
        ("plaid_configured", _yes_no(plaid_ok)),
        ("frontend_origin_configured", _yes_no(_frontend_origin_configured())),
        *[(f"billing.{k}", v) for k, v in billing_rows.items()],
        *[(f"email.{k}", v) for k, v in email_rows.items()],
        *[(f"plaid.{k}", v) for k, v in plaid_rows.items()],
    ]


def format_report(rows: list[tuple[str, str]]) -> str:
    return "\n".join(f"{key}: {value}" for key, value in rows)


def report_contains_secrets(text: str, injected: list[str]) -> list[str]:
    """Return any injected secret strings that leaked into diagnostic text."""
    return [secret for secret in injected if secret and secret in text]


@dataclass(frozen=True)
class ProductionReadiness:
    ok: bool
    missing: list[str]


def production_readiness(*, probe_stripe: bool = False) -> ProductionReadiness:
    """High-level required production items (presence only)."""
    missing: list[str] = []
    billing = dict(build_billing_report(probe_stripe=probe_stripe))
    email = dict(build_email_report())
    plaid = dict(build_plaid_report())
    if billing["STRIPE_SECRET_KEY"] != "configured":
        missing.append("STRIPE_SECRET_KEY")
    if billing["STRIPE_PREMIUM_PRICE_ID"] != "configured":
        missing.append("STRIPE_PREMIUM_PRICE_ID")
    if billing["STRIPE_WEBHOOK_SECRET"] != "configured":
        missing.append("STRIPE_WEBHOOK_SECRET")
    if billing["FRONTEND_ORIGIN"] != "configured":
        missing.append("FRONTEND_ORIGIN")
    if email["SMTP_HOST"] != "configured yes":
        missing.append("EMAIL_HOST")
    if plaid.get("PLAID_ENV_EXPLICIT") != "yes":
        missing.append("PLAID_ENV")
    if plaid.get("PLAID_CLIENT_ID") != "configured":
        missing.append("PLAID_CLIENT_ID")
    if plaid.get("PLAID_SECRET") != "configured":
        missing.append("PLAID_SECRET")
    return ProductionReadiness(ok=not missing, missing=missing)
