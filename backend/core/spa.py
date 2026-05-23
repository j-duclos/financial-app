"""Serve the Vite/React production build from Django (same origin as /api/)."""

import mimetypes
from pathlib import Path

from django.conf import settings
from django.http import FileResponse, Http404, HttpResponse, HttpResponseNotAllowed


def _safe_path(root: Path, rel: str) -> Path | None:
    if not rel or rel.endswith("/"):
        return None
    candidate = (root / rel).resolve()
    root_resolved = root.resolve()
    try:
        candidate.relative_to(root_resolved)
    except ValueError:
        return None
    if candidate.is_file():
        return candidate
    return None


def serve_frontend(request):
    if request.method not in ("GET", "HEAD"):
        return HttpResponseNotAllowed(["GET", "HEAD"])

    root: Path = settings.FRONTEND_DIST
    index = root / "index.html"
    if not index.is_file():
        return HttpResponse(
            "React app not built. Run npm run build -w @budget-app/web and copy dist to backend/frontend_dist.",
            status=503,
            content_type="text/plain",
        )

    rel = request.path.lstrip("/")
    asset = _safe_path(root, rel) if rel else None
    if asset:
        content_type, _ = mimetypes.guess_type(str(asset))
        return FileResponse(asset.open("rb"), content_type=content_type or "application/octet-stream")

    return FileResponse(index.open("rb"), content_type="text/html")
