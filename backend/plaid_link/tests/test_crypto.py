import os
from unittest.mock import patch

import pytest
from cryptography.fernet import Fernet
from django.core.exceptions import ImproperlyConfigured

from plaid_link.crypto import decrypt_secret, encrypt_secret
from plaid_link.models import PlaidItem
from core.models import Household


pytestmark = pytest.mark.django_db


def test_round_trip_with_explicit_fernet_key(monkeypatch):
    key = Fernet.generate_key().decode()
    monkeypatch.setenv("PLAID_TOKEN_FERNET_KEY", key)
    plain = "access-sandbox-roundtrip-token"
    cipher = encrypt_secret(plain)
    assert cipher != plain
    assert "access-sandbox" not in cipher
    assert decrypt_secret(cipher) == plain


def test_production_requires_explicit_plaid_fernet_key(monkeypatch):
    monkeypatch.delenv("PLAID_TOKEN_FERNET_KEY", raising=False)
    monkeypatch.setenv("DEBUG", "false")
    monkeypatch.setenv("RENDER", "true")
    with pytest.raises(ImproperlyConfigured, match="PLAID_TOKEN_FERNET_KEY"):
        encrypt_secret("access-sandbox-x")


def test_invalid_fernet_key_fails_safely(monkeypatch):
    monkeypatch.setenv("PLAID_TOKEN_FERNET_KEY", "not-a-valid-fernet-key")
    with pytest.raises(ImproperlyConfigured, match="invalid"):
        encrypt_secret("access-sandbox-x")


def test_plaintext_access_token_is_never_stored(monkeypatch, household: Household):
    key = Fernet.generate_key().decode()
    monkeypatch.setenv("PLAID_TOKEN_FERNET_KEY", key)
    plain = "access-production-should-not-be-stored"
    item = PlaidItem.objects.create(
        household=household,
        item_id="item-crypto-1",
        access_token_cipher=encrypt_secret(plain),
        institution_name="Test Bank",
    )
    item.refresh_from_db()
    assert item.access_token_cipher != plain
    assert plain not in item.access_token_cipher
    assert decrypt_secret(item.access_token_cipher) == plain


def test_local_debug_may_derive_from_secret_key(monkeypatch):
    monkeypatch.delenv("PLAID_TOKEN_FERNET_KEY", raising=False)
    monkeypatch.setenv("DEBUG", "true")
    monkeypatch.delenv("RENDER", raising=False)
    monkeypatch.setenv("DJANGO_SECRET_KEY", "local-dev-secret-for-fernet-fallback")
    with patch.dict(os.environ, {"DEBUG": "true"}, clear=False):
        cipher = encrypt_secret("access-sandbox-local")
    assert decrypt_secret(cipher) == "access-sandbox-local"
