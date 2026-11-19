"""Full-stack Vercel routing, native runtime and secret-boundary regressions."""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest
from packaging.requirements import Requirement
from packaging.utils import canonicalize_name
from pydantic import ValidationError
from sqlalchemy import text

from myschedule.config import Settings
from myschedule.database import Database
from myschedule.main import create_app
from myschedule.oauth_state import PostgresHandshakeBackend

ROOT = Path(__file__).resolve().parents[2]


def test_vercel_hosts_both_apps_without_proxying_to_previous_hosts():
    config = json.loads((ROOT / "vercel.json").read_text())
    assert config["regions"] == ["sin1"]
    assert config["git"]["deploymentEnabled"] is False
    assert set(config["services"]) == {"backend", "frontend"}
    backend, frontend = config["services"]["backend"], config["services"]["frontend"]
    assert backend["root"] == "backend" and backend["framework"] == "fastapi"
    assert backend["runtime"] == "python" and backend["entrypoint"] == "app:app"
    function = backend["functions"]["app.py"]
    assert function["maxDuration"] <= 60 and function["regions"] == ["sin1"]
    assert frontend["root"] == "frontend" and frontend["framework"] == "vite"
    assert frontend["installCommand"] == "npm ci"
    assert frontend["buildCommand"] == "npm run build" and frontend["outputDirectory"] == "dist"
    package = json.loads((ROOT / "frontend/package.json").read_text())
    lock = json.loads((ROOT / "frontend/package-lock.json").read_text())
    assert package["engines"]["node"] == lock["packages"][""]["engines"]["node"] == "24.x"
    assert frontend["routes"] == [{"handle": "filesystem"}, {"src": "/.*", "dest": "/index.html"}]
    assert config["rewrites"] == [
        {"source": "/api/:path*", "destination": {"service": "backend"}},
        {"source": "/health/:path*", "destination": {"service": "backend"}},
        {"source": "/:path*", "destination": {"service": "frontend"}},
    ]
    assert not any(key in config for key in ("crons", "daemons", "builds", "env", "build"))
    # API authentication/errors must never acquire a platform-level public cache.
    assert all(
        header["key"].lower() != "cache-control" or rule["source"] == "/assets/:path*"
        for rule in config["headers"]
        for header in rule["headers"]
    )


def test_vercel_upload_excludes_private_files_containers_and_local_preview():
    ignore = (ROOT / ".vercelignore").read_text().splitlines()
    assert "**" in ignore and "!frontend/**" in ignore and "!backend/**" in ignore
    # Vercel's recursive walker tests bare directory names before descending.
    assert "!frontend" in ignore and "!backend" in ignore
    for pattern in (
        "**/.env",
        "**/.env.*",
        "**/.local/**",
        "**/.venv/**",
        "**/node_modules/**",
        "**/*.pem",
        "**/*.key",
        "backend/Dockerfile",
        "backend/tests/**",
        "backend/alembic/**",
        "backend/src/myschedule/local_preview.py",
    ):
        assert pattern in ignore
    assert ".vercel/" in (ROOT / ".gitignore").read_text().splitlines()


def test_vercel_requirements_reuse_runtime_versions_without_test_packages():
    lines = (ROOT / "backend/requirements.txt").read_text().splitlines()
    runtime = {line.strip() for line in lines if line and not line.startswith(("#", " "))}
    locked = {
        canonicalize_name(requirement.name): str(requirement.specifier)
        for line in (ROOT / "backend/requirements-dev.lock").read_text().splitlines()
        if line and not line.startswith(("#", " "))
        for requirement in [Requirement(line)]
    }
    # pip-compile strips extras, not versions; their transitive dependencies remain pinned.
    assert runtime
    assert all(
        str(requirement.specifier) == locked[canonicalize_name(requirement.name)]
        for line in runtime
        for requirement in [Requirement(line)]
    )
    assert any(line.startswith("argon2-cffi==") for line in runtime)
    assert any(line.startswith("asyncpg==") for line in runtime)
    assert not any(line.startswith(("pytest", "ruff==", "pip-tools==")) for line in runtime)


def test_shared_oauth_configuration_requires_a_strong_secret_and_auth_role():
    for kwargs in (
        {},
        {"auth_database_url": "postgresql://auth@localhost/unit_test", "session_secret": "short"},
        {"session_secret": "test-only-secret-" * 4},
    ):
        with pytest.raises(ValidationError, match="Shared OAuth state"):
            Settings(_env_file=None, oauth_state_storage="postgres", **kwargs)


def test_vercel_entrypoint_refuses_memory_state_even_if_accidentally_misconfigured():
    environment = os.environ.copy()
    environment.update(
        {
            "APP_ENV": "test",
            "VERCEL": "1",
            "OAUTH_STATE_STORAGE": "memory",
            "PASSWORD_AUTH_ENABLED": "false",
            "SMTP_PROBE_ON_STARTUP": "false",
            "DATABASE_URL": "",
            "AUTH_DATABASE_URL": "",
            "SESSION_SECRET": "",
            "GOOGLE_CLIENT_ID": "",
            "GOOGLE_CLIENT_SECRET": "",
        }
    )
    result = subprocess.run(
        [sys.executable, "-c", "import app"],
        cwd=ROOT / "backend",
        env=environment,
        capture_output=True,
        text=True,
        timeout=20,
    )
    assert result.returncode != 0
    assert "Vercel requires shared PostgreSQL OAuth state" in result.stderr


@pytest.mark.database
async def test_shared_oauth_readiness_requires_0003_and_forced_rls(db_settings):
    settings = db_settings.model_copy(update={"oauth_state_storage": "postgres"})
    app = create_app(settings)
    database = app.state.database
    assert isinstance(app.state.handshakes, PostgresHandshakeBackend)
    try:
        assert await database.ready()
        async with database.session(auth=True) as session:
            assert await session.scalar(
                text(
                    "SELECT relrowsecurity AND relforcerowsecurity FROM pg_class "
                    "WHERE oid='app_private.oauth_handshakes'::regclass"
                )
            )
        # A state backend never gets the migration-owner credentials.
        assert database.settings.auth_database_url == db_settings.auth_database_url
    finally:
        await database.close()


def test_default_single_worker_source_configuration_is_still_compatible():
    database = Database(Settings(_env_file=None))
    assert database.settings.oauth_state_storage == "memory"
