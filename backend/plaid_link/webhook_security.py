"""Verify Plaid webhook JWT (Plaid-Verification) before mutating state."""
from __future__ import annotations

import hashlib
import json
import logging

logger = logging.getLogger(__name__)


def verify_plaid_webhook_request(request) -> bool:
    """Return True only when the Plaid-Verification JWT matches the request body."""
    token = (
        request.headers.get("Plaid-Verification")
        or request.META.get("HTTP_PLAID_VERIFICATION")
        or ""
    ).strip()
    if not token:
        return False
    body = getattr(request, "body", b"") or b""
    try:
        return _verify_plaid_webhook_jwt(token, body)
    except Exception:
        logger.warning("Plaid webhook JWT verification failed")
        return False


def _verify_plaid_webhook_jwt(token: str, body: bytes) -> bool:
    import jwt
    from jwt.algorithms import ECAlgorithm
    from plaid.model.webhook_verification_key_get_request import WebhookVerificationKeyGetRequest

    from plaid_link.plaid_api_client import get_plaid_client, plaid_configured

    if not plaid_configured():
        return False
    header = jwt.get_unverified_header(token)
    kid = header.get("kid")
    if not kid:
        return False
    client = get_plaid_client()
    key_resp = client.webhook_verification_key_get(WebhookVerificationKeyGetRequest(key_id=kid))
    jwk = key_resp["key"] if isinstance(key_resp, dict) else key_resp.key
    if hasattr(jwk, "to_dict"):
        jwk = jwk.to_dict()
    public_key = ECAlgorithm.from_jwk(json.dumps(jwk))
    decoded = jwt.decode(
        token,
        key=public_key,
        algorithms=["ES256"],
        options={"verify_aud": False, "verify_iat": False},
    )
    expected = hashlib.sha256(body).hexdigest()
    return str(decoded.get("request_body_sha256") or "") == expected
