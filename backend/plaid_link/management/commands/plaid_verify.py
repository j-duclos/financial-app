"""
Verify Plaid credentials: prints lengths and env-var source only (no secrets),
then calls /link/token/create. Run from backend/ with Django loaded.

  cd budget-app/backend && python manage.py plaid_verify
"""

from django.core.management.base import BaseCommand
from plaid import ApiException

from plaid_link.plaid_api_client import plaid_configured, plaid_credential_diagnostics
from plaid_link.services import create_link_token


class Command(BaseCommand):
    help = "Print Plaid credential diagnostics (lengths only) and test link/token/create."

    def handle(self, *args, **options):
        d = plaid_credential_diagnostics()
        self.stdout.write(f"Resolved PLAID_ENV: {d.get('plaid_env')!r}")
        self.stdout.write(f"API host: {d.get('api_host')}")
        self.stdout.write(f"PLAID_CLIENT_ID length: {d.get('client_id_length')}  (typical ~24)")
        self.stdout.write(f"Secret loaded from: {d.get('secret_loaded_from_env_var') or '(missing)'}")
        self.stdout.write(f"Secret length: {d.get('secret_length')}  (if 0, no secret matched current PLAID_ENV)")

        if not plaid_configured():
            self.stdout.write(self.style.ERROR("Not configured: need PLAID_CLIENT_ID and a secret for this environment."))
            return

        self.stdout.write("Calling Plaid link/token/create …")
        try:
            token = create_link_token(client_user_id="manage.py-plaid_verify")
            self.stdout.write(self.style.SUCCESS(f"OK — credentials accepted. link_token length={len(token)}."))
        except ApiException as e:
            raw = e.body
            if isinstance(raw, bytes):
                raw = raw.decode("utf-8", errors="replace")
            self.stdout.write(self.style.ERROR(f"Plaid API error: {raw}"))
        except RuntimeError as e:
            self.stdout.write(self.style.ERROR(str(e)))
