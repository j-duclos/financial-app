"""Encrypt Plaid access tokens at rest (Fernet)."""
import base64
import os
from hashlib import sha256

from cryptography.fernet import Fernet


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
