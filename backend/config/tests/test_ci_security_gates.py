from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
CI = (ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")


def test_npm_production_audit_is_fail_closed():
    assert "node scripts/audit-web-production.mjs" in CI
    assert "--omit=dev" in Path(ROOT / "scripts" / "audit-web-production.mjs").read_text(
        encoding="utf-8"
    )
    npm_job = CI.split("npm-audit:")[1].split("mobile-tests:")[0]
    assert "continue-on-error" not in npm_job


def test_gitleaks_scans_history_redacts_and_fails_closed():
    secrets = CI.split("secrets-scan:")[1].split("python-audit:")[0]
    assert "fetch-depth: 0" in secrets
    assert "gitleaks detect --source . --verbose --redact --exit-code 1" in secrets
    assert "continue-on-error" not in secrets
