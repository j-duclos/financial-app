"""
Profile dashboard summary-fast cold/warm cache and details shared-context reuse.

  cd backend && ENABLE_PERF_LOGS=true python manage.py profile_dashboard_summary_fast

Optional:
  --username capone
  --days 30
  --skip-warm   (cold cache only)
"""
from __future__ import annotations

import time

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.management.base import BaseCommand, CommandError

from common.services.profiler import get_build_timeline_count, perf_enabled, reset_build_timeline_count
from insights.services.dashboard_summary import (
    build_dashboard_summary_details,
    build_dashboard_summary_fast,
)

User = get_user_model()


class Command(BaseCommand):
    help = "Profile summary-fast and details with [PERF] phase/SQL logs."

    def add_arguments(self, parser):
        parser.add_argument("--username", default=None, help="User to profile (default: first superuser)")
        parser.add_argument("--days", type=int, default=30)
        parser.add_argument("--skip-warm", action="store_true")

    def handle(self, *args, **options):
        if not perf_enabled():
            raise CommandError("Set ENABLE_PERF_LOGS=true or DEBUG=true for profiling output.")

        username = options["username"]
        if username:
            try:
                user = User.objects.get(username=username)
            except User.DoesNotExist as exc:
                raise CommandError(f"User not found: {username}") from exc
        else:
            user = User.objects.filter(is_superuser=True).order_by("pk").first()
            if user is None:
                user = User.objects.order_by("pk").first()
            if user is None:
                raise CommandError("No users in database.")

        days = options["days"]
        self.stdout.write(
            self.style.NOTICE(
                f"Profiling dashboard for user={user.username!r} days={days} "
                f"(topology: this Django process → configured DATABASE)"
            )
        )

        cache.clear()
        reset_build_timeline_count()
        cold_start = time.perf_counter()
        build_dashboard_summary_fast(user, days=days)
        cold_ms = (time.perf_counter() - cold_start) * 1000
        cold_timeline = get_build_timeline_count()
        self.stdout.write(self.style.SUCCESS(f"COLD summary-fast wall={cold_ms:.0f}ms timeline_builds={cold_timeline}"))

        if not options["skip_warm"]:
            reset_build_timeline_count()
            warm_start = time.perf_counter()
            build_dashboard_summary_fast(user, days=days)
            warm_ms = (time.perf_counter() - warm_start) * 1000
            warm_timeline = get_build_timeline_count()
            self.stdout.write(
                self.style.SUCCESS(f"WARM summary-fast wall={warm_ms:.0f}ms timeline_builds={warm_timeline}")
            )

        reset_build_timeline_count()
        details_start = time.perf_counter()
        build_dashboard_summary_details(user, days=days)
        details_ms = (time.perf_counter() - details_start) * 1000
        details_timeline = get_build_timeline_count()
        self.stdout.write(
            self.style.SUCCESS(
                f"DETAILS after fast (shared ctx expected) wall={details_ms:.0f}ms "
                f"timeline_builds={details_timeline}"
            )
        )
