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
        where = "Render Dashboard → Web Service → Environment" if on_render else "backend/.env"
        explicit = bool(os.environ.get("PLAID_TOKEN_FERNET_KEY", "").strip())
        raise PlaidTokenDecryptError(
            "Cannot decrypt this bank login's saved Plaid token. The database copy was encrypted "
            "on your dev machine, not on Render. "
            + (
                "PLAID_TOKEN_FERNET_KEY is set here but does not match the export machine — run "
                "`python manage.py plaid_fernet_key_for_render` on the Mac that created data.json, "
                "or remove and re-link the bank on Render."
                if explicit
                else f"Set PLAID_TOKEN_FERNET_KEY in {where} (local: "
                "`python manage.py plaid_fernet_key_for_render`), save, wait for redeploy, then retry. "
                "Or remove and re-link the bank on Render."
            )
        ) from exc
