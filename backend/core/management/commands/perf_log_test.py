"""
Emit a test [PERF] log line to verify console logging on Render.

  cd budget-app/backend && python manage.py perf_log_test

Requires ENABLE_PERF_LOGS=true or DEBUG=True for perf instrumentation to be active.
The command always writes one INFO line so you can confirm the logging pipeline.
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
        self.stdout.write(self.style.SUCCESS("Emitted: [PERF] Render performance log test"))
