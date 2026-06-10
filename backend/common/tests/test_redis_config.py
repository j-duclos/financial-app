from common.services.redis_config import redis_configured, redis_host_label, resolve_redis_url


def test_resolve_redis_url_from_env(monkeypatch):
    monkeypatch.delenv("REDIS_URL", raising=False)
    monkeypatch.delenv("REDISCLOUD_URL", raising=False)
    assert resolve_redis_url() == ""

    monkeypatch.setenv("REDIS_URL", "redis://localhost:6379/0")
    assert resolve_redis_url() == "redis://localhost:6379/0"

    monkeypatch.setenv("REDISCLOUD_URL", "redis://fallback:6379/1")
    assert resolve_redis_url() == "redis://localhost:6379/0"


def test_redis_host_label_hides_credentials(monkeypatch):
    monkeypatch.setenv("REDIS_URL", "redis://:secret@red-abc123:6379")
    assert redis_host_label() == "red-abc123:6379"
    assert redis_configured() is True
