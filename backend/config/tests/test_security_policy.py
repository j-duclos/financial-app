from config.security_policy import (
    merge_allowed_hosts,
    merge_production_web_origins,
    production_https_settings,
)


def test_production_https_settings_enable_hsts_without_preload():
    settings = production_https_settings(debug=False, ssl_redirect=True)
    assert settings["SECURE_SSL_REDIRECT"] is True
    assert settings["SECURE_PROXY_SSL_HEADER"] == ("HTTP_X_FORWARDED_PROTO", "https")
    assert settings["SESSION_COOKIE_SECURE"] is True
    assert settings["CSRF_COOKIE_SECURE"] is True
    assert settings["SECURE_HSTS_SECONDS"] == 31536000
    assert settings["SECURE_HSTS_INCLUDE_SUBDOMAINS"] is False
    assert settings["SECURE_HSTS_PRELOAD"] is False
    assert settings["X_FRAME_OPTIONS"] == "DENY"
    assert settings["SECURE_CONTENT_TYPE_NOSNIFF"] is True
    assert settings["SECURE_REFERRER_POLICY"] == "same-origin"


def test_debug_does_not_force_https_settings():
    assert production_https_settings(debug=True) == {}


def test_allowed_hosts_include_flowsight_only_outside_debug():
    hosts = merge_allowed_hosts(["localhost"], debug=True, on_render=False)
    assert "flowsight.com" not in hosts
    assert ".onrender.com" not in hosts
    prod = merge_allowed_hosts(["api.example.com"], debug=False, on_render=True)
    assert "flowsight.com" in prod
    assert "www.flowsight.com" in prod
    assert ".onrender.com" in prod


def test_cors_merges_flowsight_origins_in_production():
    dev = merge_production_web_origins(["http://localhost:5173"], debug=True)
    assert dev == ["http://localhost:5173"]
    prod = merge_production_web_origins(["https://app.onrender.com"], debug=False)
    assert "https://flowsight.com" in prod
    assert "https://www.flowsight.com" in prod
    assert "*" not in prod
