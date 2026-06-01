"""Print PLAID_TOKEN_FERNET_KEY to copy onto Render after a data.json import from local."""
import base64
import os
from hashlib import sha256

from django.conf import settings
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = (
        "Print the Fernet key Render needs to decrypt Plaid tokens imported from this machine's database."
    )

    def handle(self, *args, **options):
        explicit = os.environ.get("PLAID_TOKEN_FERNET_KEY", "").strip()
        if explicit:
            key = explicit
            source = "PLAID_TOKEN_FERNET_KEY from environment"
        else:
            digest = sha256(settings.SECRET_KEY.encode()).digest()
            key = base64.urlsafe_b64encode(digest).decode()
            source = "derived from DJANGO_SECRET_KEY (no PLAID_TOKEN_FERNET_KEY set locally)"

        self.stdout.write(f"Source: {source}")
        self.stdout.write("")
        self.stdout.write("Add this to Render → Web Service → Environment, then Save (service restarts):")
        self.stdout.write("")
        self.stdout.write(f"PLAID_TOKEN_FERNET_KEY={key}")
        self.stdout.write("")
        self.stdout.write(
            "Verify: GET /api/plaid/meta/ should show plaid_token_fernet_key_set: true"
        )
