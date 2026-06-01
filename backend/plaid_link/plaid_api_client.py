"""Configured Plaid API client."""
import os

from plaid.api import plaid_api
from plaid.api_client import ApiClient
from plaid.configuration import Configuration

# Order matters: first matching non-empty wins (lets you store sandbox + prod secrets at once).
_SECRET_KEYS_BY_ENV: dict[str, tuple[str, ...]] = {
    "sandbox": ("PLAID_SANDBOX_SECRET", "PLAID_SECRET"),
    "development": ("PLAID_DEVELOPMENT_SECRET", "PLAID_SECRET"),
    "production": ("PLAID_PRODUCTION_SECRET", "PLAID_SECRET"),
}


def _clean_cred(raw: str | None) -> str:
    """Strip whitespace, BOM, and surrounding quotes from .env values."""
    s = (raw or "").strip().strip("\ufeff")
    if len(s) >= 2 and s[0] == s[-1] and s[0] in "\"'":
        s = s[1:-1].strip()
    return s


def plaid_api_env() -> str:
    """Normalized PLAID_ENV (sandbox | development | production)."""
    return os.environ.get("PLAID_ENV", "sandbox").lower().strip()


def secret_for_plaid_env(env: str) -> str:
    """Resolve secret for API host: env-specific key first, then PLAID_SECRET."""
    env = env.lower().strip()
    chain = _SECRET_KEYS_BY_ENV.get(env, ("PLAID_SECRET",))
    for key in chain:
        s = _clean_cred(os.environ.get(key))
        if s:
            return s
    return ""


def plaid_hosts():
    return {
        "sandbox": "https://sandbox.plaid.com",
        "development": "https://development.plaid.com",
        "production": "https://production.plaid.com",
    }


def get_plaid_client() -> plaid_api.PlaidApi:
    """
    Uses PLAID_ENV to pick the API host. The secret must belong to that environment
    (see PLAID_SANDBOX_SECRET / PLAID_SECRET / PLAID_PRODUCTION_SECRET resolution in secret_for_plaid_env).
    """
    env = plaid_api_env()
    host = plaid_hosts().get(env, plaid_hosts()["sandbox"])
    client_id = _clean_cred(os.environ.get("PLAID_CLIENT_ID"))
    secret = secret_for_plaid_env(env)
    if not client_id or not secret:
        raise RuntimeError(
            "Plaid credentials incomplete: set PLAID_CLIENT_ID and a secret for this "
            "environment (e.g. PLAID_SECRET or PLAID_SANDBOX_SECRET when PLAID_ENV=sandbox)."
        )
    configuration = Configuration(host=host, api_key={"clientId": client_id, "secret": secret})
    return plaid_api.PlaidApi(ApiClient(configuration))


def plaid_configured() -> bool:
    env = plaid_api_env()
    return bool(_clean_cred(os.environ.get("PLAID_CLIENT_ID")) and secret_for_plaid_env(env))


def resolved_secret_env_var_name() -> str | None:
    """Name of the first env var in the chain that supplied the secret (for diagnostics only)."""
    env = plaid_api_env()
    chain = _SECRET_KEYS_BY_ENV.get(env, ("PLAID_SECRET",))
    for key in chain:
        if _clean_cred(os.environ.get(key)):
            return key
    return None


def plaid_env_configured_explicitly() -> bool:
    """True when PLAID_ENV was set in the environment (not only the app default)."""
    return bool(os.environ.get("PLAID_ENV", "").strip())


def plaid_config_location_hint() -> str:
    """Where operators should set credentials (local .env vs Render env)."""
    if os.environ.get("RENDER", "").lower() in ("true", "1", "yes"):
        return "this server's environment (Render Dashboard → Environment)"
    return "backend/.env"


def plaid_unconfigured_detail() -> str:
    """
    Human-readable message when Plaid API keys are missing.

    Clarifies that a missing PLAID_ENV defaults to sandbox in code — that is not the user's
    Plaid account type (free trial / production keys are separate).
    """
    where = plaid_config_location_hint()
    env = plaid_api_env()
    parts = [
        f"Plaid API keys are not set on this server. Add PLAID_CLIENT_ID and a secret for "
        f"PLAID_ENV={env!r} in {where}, then redeploy or restart the backend.",
    ]
    if not plaid_env_configured_explicitly():
        parts.append(
            " PLAID_ENV is unset here, so the app defaults to 'sandbox' — that does not mean "
            "your Plaid account is sandbox. For real banks (Chase, etc.) set PLAID_ENV=production "
            "and PLAID_PRODUCTION_SECRET from Plaid Team → Keys (Production row). "
            "Plaid Development / free-trial keys use PLAID_ENV=development and PLAID_DEVELOPMENT_SECRET."
        )
    parts.append(
        " Existing bank logins in the database still need matching live API credentials to sync."
    )
    return "".join(parts)


def plaid_credential_diagnostics() -> dict[str, str | int | None]:
    """Non-sensitive facts about how credentials were resolved (for INVALID_API_KEYS debugging)."""
    env = plaid_api_env()
    cid = _clean_cred(os.environ.get("PLAID_CLIENT_ID"))
    sec = secret_for_plaid_env(env)
    return {
        "plaid_env": env,
        "api_host": plaid_hosts().get(env, plaid_hosts()["sandbox"]),
        "client_id_length": len(cid),
        "secret_length": len(sec),
        "secret_loaded_from_env_var": resolved_secret_env_var_name(),
    }
