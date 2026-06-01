"""Encrypt Plaid access tokens at rest (Fernet)."""
import base64
import os
from hashlib import sha256

from cryptography.fernet import Fernet, InvalidToken


class PlaidTokenDecryptError(RuntimeError):
    """Saved access_token_cipher cannot be decrypted with this server's keys."""


def _fernet() -> Fernet:
    key = os.environ.get("PLAID_TOKEN_FERNET_KEY")
    if key:
        kb = key.encode() if isinstance(key, str) else key
        return Fernet(kb)
    digest = sha256(os.environ.get("DJANGO_SECRET_KEY", "dev").encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_secret(plain: str) -> str:
    return _fernet().encrypt(plain.encode()).decode()


def decrypt_secret(cipher: str) -> str:
    return _fernet().decrypt(cipher.encode()).decode()


def decrypt_plaid_access_token(cipher: str) -> str:
    """Decrypt a Plaid item access token; raise PlaidTokenDecryptError with guidance on failure."""
    try:
        return decrypt_secret(cipher)
    except InvalidToken as exc:
        on_render = os.environ.get("RENDER", "").lower() in ("true", "1", "yes")
        where = "Render → Environment" if on_render else "backend/.env"
        explicit = bool(os.environ.get("PLAID_TOKEN_FERNET_KEY", "").strip())
        raise PlaidTokenDecryptError(
            "Cannot decrypt this bank login's saved Plaid token. It was encrypted with a different "
            f"PLAID_TOKEN_FERNET_KEY or DJANGO_SECRET_KEY than this server uses now. "
            f"Copy the same PLAID_TOKEN_FERNET_KEY from your local {where} (if you have one), or set "
            "PLAID_TOKEN_FERNET_KEY on this server to a Fernet key derived from the DJANGO_SECRET_KEY "
            "that was active when you exported/imported data, or remove and re-link the bank on this "
            "server so a new token is stored."
            + (
                ""
                if explicit
                else " This server has no PLAID_TOKEN_FERNET_KEY — tokens use a key derived from "
                "DJANGO_SECRET_KEY, which often differs between local and production."
            )
        ) from exc
