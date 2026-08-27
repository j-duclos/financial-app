"""Exempt /api/ from CSRF so JWT-authenticated API requests (GET, POST, PUT, PATCH, DELETE) work from the frontend."""
from __future__ import annotations

import time

from django.conf import settings
from django.db import connection
from django.middleware.csrf import CsrfViewMiddleware

from common.services.profiler import get_build_timeline_count, perf_enabled, perf_print, reset_build_timeline_count


class DisableCSRFForAPIMiddleware(CsrfViewMiddleware):
    """Skip CSRF for /api/ so JWT auth works (no cookie/session)."""

    def process_view(self, request, callback, callback_args, callback_kwargs):
        if request.path.startswith("/api/"):
            return None  # Skip CSRF check
        return super().process_view(request, callback, callback_args, callback_kwargs)


class PerfRequestMiddleware:
    """Development/test request timing — no production noise unless ENABLE_PERF_LOGS."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if not perf_enabled() or not request.path.startswith("/api/"):
            return self.get_response(request)

        reset_build_timeline_count()
        start = time.perf_counter()
        query_before = len(connection.queries) if settings.DEBUG else 0

        response = self.get_response(request)

        elapsed_ms = (time.perf_counter() - start) * 1000
        sql_delta = len(connection.queries) - query_before if settings.DEBUG else None
        timeline_builds = get_build_timeline_count()
        path = request.path
        parts = [
            f"[PERF] request {request.method} {path}",
            f"status={response.status_code}",
            f"elapsed_ms={elapsed_ms:.0f}",
            f"timeline_builds={timeline_builds}",
        ]
        if sql_delta is not None:
            parts.append(f"sql={sql_delta}")
        content_length = response.get("Content-Length")
        if content_length:
            parts.append(f"bytes={content_length}")
        for header in ("X-Timeline-Cache", "X-Dashboard-Cache", "X-Cache"):
            val = response.get(header)
            if val:
                parts.append(f"{header.lower()}={val}")
        perf_print(" ".join(parts))
        return response
