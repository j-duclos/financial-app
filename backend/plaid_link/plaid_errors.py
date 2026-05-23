"""Parse Plaid ApiException bodies for clearer API responses."""
from __future__ import annotations

import json

from plaid import ApiException

from .plaid_api_client import plaid_credential_diagnostics


def format_plaid_api_exception(
    exc: ApiException,
    *,
    plaid_env: str,
    redirect_uri_attempted: str | None = None,
) -> dict:
    """
    Build a JSON-serializable payload for DRF. Includes parsed Plaid body when present.
    """
    raw_body = exc.body
    if isinstance(raw_body, (bytes, bytearray)):
        raw_body = raw_body.decode("utf-8", errors="replace")

    parsed: dict | None = None
    if isinstance(raw_body, str) and raw_body.strip():
        try:
            parsed = json.loads(raw_body)
        except json.JSONDecodeError:
            parsed = None

    code = (parsed or {}).get("error_code") if parsed else None
    msg = (parsed or {}).get("error_message") if parsed else None

    lower_msg = (msg or "").lower()
    if "no valid accounts" in lower_msg or "no accounts were found" in lower_msg:
        detail = (
            "Plaid couldn't sync transactions for this connection right now. "
            "That usually means the bank login needs to be refreshed, or Plaid changed internal account IDs—we retry "
            "with fresh IDs automatically; if this message persists, disconnect this bank and use Link a bank again."
        )
    elif code == "INVALID_FIELD" and "oauth redirect uri" in lower_msg and "dashboard" in lower_msg:
        u = redirect_uri_attempted or ""
        detail = (
            "Plaid rejected redirect_uri: it must exactly match an entry under Allowed redirect URIs. "
            "If you allowlisted a tunnel (…lhr.life) but this browser tab is on localhost, open the app using the "
            "same https://… tunnel URL you added to Plaid (not http://localhost:5173). "
            "Each new tunnel session gets a new hostname — add that new …/plaid/oauth-return row and Save. "
            "Dashboard: https://dashboard.plaid.com/developers/api"
        )
        if u:
            detail += f" — URI sent to Plaid: {u}"
    elif code == "INVALID_FIELD" and "redirect_uri" in lower_msg and "https" in lower_msg:
        detail = (
            f"{msg or 'redirect_uri invalid for this environment'}. "
            "Production and Development require an https:// redirect URI registered in the Dashboard "
            "(http://localhost is only allowed with PLAID_ENV=sandbox). "
            "Use an HTTPS tunnel for local testing or your real app's https URL."
        )
    elif code == "INVALID_API_KEYS":
        diag = plaid_credential_diagnostics()
        src = diag.get("secret_loaded_from_env_var") or "none"
        env_label = str(diag.get("plaid_env") or "sandbox").lower()
        if env_label == "sandbox":
            row_hint = "Use the Sandbox row client_id + Sandbox secret on Team Keys (not Production)."
        elif env_label == "production":
            row_hint = "Use the Production row client_id + Production secret on Team Keys."
        else:
            row_hint = "Use client_id + secret from the matching Development row on Team Keys."
        detail = (
            f"{msg or 'invalid client_id or secret'}. "
            f"Server targets {diag.get('api_host')} (PLAID_ENV={diag.get('plaid_env')!r}); "
            f"secret came from env var {src!r}; "
            f"client_id len={diag.get('client_id_length')}, secret len={diag.get('secret_length')}. "
            f"{row_hint} Restart Django after saving backend/.env. "
            "CLI: python manage.py plaid_verify"
        )
    elif msg:
        detail = msg
    elif isinstance(raw_body, str) and raw_body.strip():
        detail = raw_body
    else:
        detail = str(exc)

    out = {"detail": detail, "plaid_env": plaid_env}
    if parsed is not None:
        out["plaid_error"] = parsed
    if code == "INVALID_API_KEYS":
        out["plaid_diagnostics"] = plaid_credential_diagnostics()
    return out
