"""Exempt /api/ from CSRF so JWT-authenticated API requests (GET, POST, PUT, PATCH, DELETE) work from the frontend."""
from django.middleware.csrf import CsrfViewMiddleware


class DisableCSRFForAPIMiddleware(CsrfViewMiddleware):
    """Skip CSRF for /api/ so JWT auth works (no cookie/session)."""

    def process_view(self, request, callback, callback_args, callback_kwargs):
        if request.path.startswith("/api/"):
            return None  # Skip CSRF check
        return super().process_view(request, callback, callback_args, callback_kwargs)
