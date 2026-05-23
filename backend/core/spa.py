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
        hint = (
            "React app not built. On Render: set NODE_VERSION=20 in Environment, "
            "ensure Build Command is 'chmod +x build.sh && ./build.sh', then redeploy. "
            "Locally: npm run build:deploy -w @budget-app/web && cp -r apps/web/dist/* backend/frontend_dist/"
        )
        return HttpResponse(hint, status=503, content_type="text/plain")

    rel = request.path.lstrip("/")
    asset = _safe_path(root, rel) if rel else None
    if asset:
        content_type, _ = mimetypes.guess_type(str(asset))
        return FileResponse(asset.open("rb"), content_type=content_type or "application/octet-stream")

    return FileResponse(index.open("rb"), content_type="text/html")
