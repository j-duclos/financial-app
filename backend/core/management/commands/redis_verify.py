"""
Verify Redis cache connectivity and timeline cache settings.

  cd budget-app/backend && python manage.py redis_verify

With Docker Redis: docker compose up -d redis
Local .env: REDIS_URL=redis://localhost:6379/0
Render: set REDIS_URL to the Key Value internal URL on the web service.
"""

from django.core.management.base import BaseCommand

from common.services.redis_config import redis_diagnostics, verify_redis_cache


class Command(BaseCommand):
    help = "Print Redis cache diagnostics and test read/write via Django cache."

    def handle(self, *args, **options):
        d = redis_diagnostics()
        self.stdout.write(f"redis_configured: {d['redis_configured']}")
        self.stdout.write(f"redis_host: {d['redis_host'] or '(not set)'}")
        self.stdout.write(f"cache_backend: {d['cache_backend']}")
        self.stdout.write(f"timeline_cache_enabled: {d['timeline_cache_enabled']}")
        self.stdout.write(f"timeline_cache_seconds: {d['timeline_cache_seconds']}")

        if not d["redis_configured"]:
            self.stdout.write(
                self.style.WARNING(
                    "Timeline and dashboard caches use in-process LocMem only — "
                    "repeat page loads stay slow. Set REDIS_URL and restart the backend."
                )
            )
            return

        self.stdout.write("Testing cache read/write …")
        ok, message = verify_redis_cache()
        if ok:
            self.stdout.write(self.style.SUCCESS(message))
        else:
            self.stdout.write(self.style.ERROR(message))
