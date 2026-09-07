"""Production HTTPS, host, and CORS policy helpers.

HSTS preload is intentionally off until flowsight.com and every required
subdomain are confirmed HTTPS-only.
"""

PRODUCTION_WEB_HOSTS = ("flowsight.com", "www.flowsight.com")
PRODUCTION_WEB_ORIGINS = ("https://flowsight.com", "https://www.flowsight.com")


def production_https_settings(*, debug: bool, ssl_redirect: bool = True) -> dict:
    """Return Django security settings for non-DEBUG (Render / production) runtimes."""
    if debug:
        return {}
    return {
        "SECURE_PROXY_SSL_HEADER": ("HTTP_X_FORWARDED_PROTO", "https"),
        "SECURE_SSL_REDIRECT": ssl_redirect,
        "SESSION_COOKIE_SECURE": True,
        "CSRF_COOKIE_SECURE": True,
        "SECURE_HSTS_SECONDS": 31536000,
        "SECURE_HSTS_INCLUDE_SUBDOMAINS": False,
        "SECURE_HSTS_PRELOAD": False,
        "X_FRAME_OPTIONS": "DENY",
        "SECURE_CONTENT_TYPE_NOSNIFF": True,
        "SECURE_REFERRER_POLICY": "same-origin",
    }


def merge_allowed_hosts(hosts: list[str], *, debug: bool, on_render: bool) -> list[str]:
    out = list(hosts)
    if on_render and ".onrender.com" not in out:
        out.append(".onrender.com")
    if not debug:
        for host in PRODUCTION_WEB_HOSTS:
            if host not in out:
                out.append(host)
    return out


def merge_production_web_origins(origins: list[str], *, debug: bool) -> list[str]:
    if debug:
        return origins
    out = list(origins)
    for origin in PRODUCTION_WEB_ORIGINS:
        if origin not in out:
            out.append(origin)
    return out
