"""Public frontend origin for auth email links (not Stripe-specific)."""
from __future__ import annotations

import os

from django.conf import settings

_DEV_FRONTEND_ORIGIN = "http://localhost:5173"


def get_frontend_origin() -> str:
    origin = (getattr(settings, "FRONTEND_ORIGIN", "") or "").strip().rstrip("/")
    if origin:
        return origin
    render_url = os.environ.get("RENDER_EXTERNAL_URL", "").strip().rstrip("/")
    if render_url:
        return render_url
    if getattr(settings, "DEBUG", False):
        return _DEV_FRONTEND_ORIGIN
    return ""
