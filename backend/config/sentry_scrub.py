"""Scrub secrets and financial payloads from Sentry events. No Sentry import required."""

from __future__ import annotations

import re
from typing import Any

_SENSITIVE_KEY = re.compile(
    r"^(password|passwd|current_password|new_password|new_password_confirm|secret|secret_key|"
    r"api_key|stripe_secret|plaid_secret|token|uid|authorization|cookie|csrf|access_token|"
    r"refresh|refresh_token|access_token_cipher|cipher|card_number|cvc|cvv|account_number|"
    r"routing_number|ssn|memo|payee|imported_description)$",
    re.I,
)
_SENSITIVE_HEADER = re.compile(r"^(authorization|cookie|set-cookie|x-csrftoken|x-api-key)$", re.I)
_SECRET_IN_TEXT = re.compile(
    r"(access-(?:sandbox|production|development)-[A-Za-z0-9_-]+|"
    r"(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]+|"
    r"whsec_[A-Za-z0-9]+|"
    r"Bearer\s+\S+|"
    r"eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)",
    re.I,
)
_FILTERED = "[Filtered]"


def is_sensitive_key(key: str) -> bool:
    return bool(_SENSITIVE_KEY.fullmatch(str(key)))


def scrub_secret_text(value: str) -> str:
    return _SECRET_IN_TEXT.sub(_FILTERED, value)


def _redact(value: Any) -> Any:
    if value is None:
        return value
    if isinstance(value, list):
        return [_redact(item) for item in value]
    if isinstance(value, dict):
        return {
            key: _FILTERED if is_sensitive_key(str(key)) else _redact(nested)
            for key, nested in value.items()
        }
    if isinstance(value, str):
        return scrub_secret_text(value)
    return value


def _scrub_query(value: Any) -> Any:
    if isinstance(value, str) and re.search(r"(?:^|&)(?:token|uid|code|access|refresh)=", value, re.I):
        return _FILTERED
    return _redact(value)


def scrub_headers(headers: Any) -> Any:
    if not isinstance(headers, dict):
        return headers
    return {
        key: _FILTERED if _SENSITIVE_HEADER.match(str(key)) or is_sensitive_key(str(key)) else value
        for key, value in headers.items()
    }


def scrub_sentry_event(event: dict[str, Any], _hint: Any = None) -> dict[str, Any]:
    request = event.get("request")
    if isinstance(request, dict):
        request = dict(request)
        if "headers" in request:
            request["headers"] = scrub_headers(request["headers"])
        if "cookies" in request:
            request["cookies"] = _FILTERED
        if "data" in request:
            request["data"] = _FILTERED
        if "query_string" in request:
            request["query_string"] = _scrub_query(request["query_string"])
        event["request"] = request
    if isinstance(event.get("extra"), dict):
        event["extra"] = _redact(event["extra"])
    if isinstance(event.get("contexts"), dict):
        event["contexts"] = _redact(event["contexts"])
    if isinstance(event.get("exception"), dict):
        event["exception"] = _redact(event["exception"])
    if isinstance(event.get("breadcrumbs"), dict):
        event["breadcrumbs"] = _redact(event["breadcrumbs"])
    user = event.get("user")
    if isinstance(user, dict):
        event["user"] = {"id": user["id"]} if "id" in user else {}
    return event
