"""The budget-first Render plan must not provision paid or replacement data services."""

from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]


def blueprint():
    return yaml.safe_load((ROOT / "render.yaml").read_text())


def test_render_blueprint_is_one_free_singapore_api_without_paid_addons():
    config = blueprint()
    # Quote "off" in YAML so both YAML 1.1 and 1.2 readers treat it as a string.
    assert config["previews"]["generation"] == "off"
    assert set(config) == {"previews", "services"}
    assert len(config["services"]) == 1
    service = config["services"][0]
    assert service["type"] == "web" and service["runtime"] == "docker"
    assert service["region"] == "singapore" and service["plan"] == "free"
    assert service["numInstances"] == 1
    assert service["autoDeployTrigger"] == "off"
    assert not any(key in service for key in ("disk", "scaling", "previews", "maintenanceMode"))
    assert not any(key in service for key in ("preDeployCommand", "initialDeployHook"))


def test_render_build_targets_only_the_backend_and_explicit_release_branch():
    service = blueprint()["services"][0]
    assert service["branch"] == "infra/render-free-singapore"
    assert service["repo"] == "https://github.com/maliknaharmn/MyScheduleManager"
    root = ROOT / service["rootDir"]
    assert root == ROOT / "backend"
    assert (root / service["dockerfilePath"]).resolve() == root / "Dockerfile"
    assert (root / service["dockerContext"]).resolve() == root
    assert service["healthCheckPath"] == "/health/ready"


def test_render_preserves_native_auth_and_public_callback_but_starts_gated():
    entries = blueprint()["services"][0]["envVars"]
    env = {entry["key"]: entry["value"] for entry in entries if "value" in entry}
    assert env == {
        "APP_ENV": "production",
        "APP_ORIGIN": "https://myschedule.gwe.web.id",
        "GOOGLE_REDIRECT_URI": "https://myschedule.gwe.web.id/api/v1/auth/google/callback",
        "COOKIE_SECURE": "true",
        "MAINTENANCE_MODE": "true",
        "PASSWORD_AUTH_ENABLED": "true",
        "MAIL_TRANSPORT": "brevo_api",
        "SMTP_PROBE_ON_STARTUP": "false",
        "DATABASE_POOL_SIZE": "2",
        "DATABASE_POOL_MAX_OVERFLOW": "1",
    }


def test_render_identity_and_connections_are_private_existing_secret_inputs_only():
    entries = blueprint()["services"][0]["envVars"]
    assert len({entry["key"] for entry in entries}) == len(entries)
    private = {entry["key"]: entry for entry in entries if "value" not in entry}
    expected = {
        "DATABASE_URL",
        "AUTH_DATABASE_URL",
        "SESSION_SECRET",
        "GOOGLE_CLIENT_ID",
        "GOOGLE_CLIENT_SECRET",
        "PASSWORD_OWNER_USER_ID",
        "PASSWORD_OWNER_EMAIL",
        "SMTP_FROM_EMAIL",
        "SMTP_FROM_NAME",
        "BREVO_API_KEY",
    }
    assert set(private) == expected
    assert all(entry == {"key": key, "sync": False} for key, entry in private.items())
    assert not any("generateValue" in entry or "fromDatabase" in entry for entry in entries)
    assert not any(
        entry["key"].startswith(("TEST_", "MIGRATION_", "WORKER_"))
        or entry["key"] in {"DATABASE_SSL_CA_PEM", "SMTP_PASSWORD", "SMTP_USERNAME"}
        for entry in entries
    )
