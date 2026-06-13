"""
Emit a test [PERF] log line to verify console logging on Render.

  cd budget-app/backend && python manage.py perf_log_test

Requires DEBUG=True locally, or ENABLE_PERF_LOGS (defaults true on Render).
"""

from django.conf import settings
from django.core.management.base import BaseCommand

from common.services.profiler import perf_print


class Command(BaseCommand):
    help = "Emit a test [PERF] log line to verify Render/console logging."

    def handle(self, *args, **options):
        perf_on = bool(getattr(settings, "DEBUG", False)) or bool(
            getattr(settings, "ENABLE_PERF_LOGS", False)
        )
        if not perf_on:
            self.stdout.write(
                self.style.WARNING(
                    "ENABLE_PERF_LOGS and DEBUG are both false — "
                    "set ENABLE_PERF_LOGS=true to enable [PERF] instrumentation."
                )
            )
        perf_print("[PERF] Render performance log test")
        if perf_on:
            self.stdout.write(self.style.SUCCESS("OK: [PERF] line written to stdout (check Render Logs)"))
        else:
            self.stdout.write(
                self.style.ERROR(
                    "No [PERF] line written — set ENABLE_PERF_LOGS=true or DEBUG=true"
                )
            )
