"""Regressions for the actual `fastapi run` entrypoint used by FastAPI Cloud."""

import json
import os
import socket
import subprocess
import sys
import time
import tomllib
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen

from packaging.requirements import Requirement

BACKEND = Path(__file__).resolve().parents[1]


def test_fastapi_standard_and_explicit_entrypoint_are_declared():
    config = tomllib.loads((BACKEND / "pyproject.toml").read_text())
    dependencies = [Requirement(value) for value in config["project"]["dependencies"]]
    fastapi = next(value for value in dependencies if value.name == "fastapi")
    assert "standard" in fastapi.extras
    assert config["tool"]["fastapi"]["entrypoint"] == "myschedule.main:app"
    assert (BACKEND / ".python-version").read_text().strip() == "3.13"


def test_fastapi_run_starts_from_project_config_without_database_or_google(tmp_path):
    # Do not import real credentials into the child: startup must be testable without cloud access.
    environment = os.environ.copy()
    environment.update(
        {
            "APP_ENV": "test",
            "APP_ORIGIN": "http://localhost:5173",
            "DATABASE_URL": "",
            "AUTH_DATABASE_URL": "",
            "MIGRATION_DATABASE_URL": "",
            "SESSION_SECRET": "",
            "COOKIE_SECURE": "false",
            "ALLOWED_GOOGLE_EMAILS": "[]",
            "GOOGLE_CLIENT_ID": "",
            "GOOGLE_CLIENT_SECRET": "",
            "GOOGLE_REDIRECT_URI": "http://localhost:5173/api/v1/auth/google/callback",
        }
    )
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    command = [
        sys.executable,
        "-m",
        "fastapi",
        "run",
        "--host",
        "127.0.0.1",
        "--port",
        str(port),
        "--workers",
        "1",
    ]
    log_path = tmp_path / "startup.log"
    with log_path.open("w") as log:
        process = subprocess.Popen(
            command,
            cwd=BACKEND,
            env=environment,
            stdout=log,
            stderr=subprocess.STDOUT,
        )
        try:
            deadline = time.monotonic() + 25
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise AssertionError(f"FastAPI CLI exited: {log_path.read_text()}")
                try:
                    with urlopen(f"http://127.0.0.1:{port}/health/live", timeout=1) as response:
                        assert response.status == 200
                        assert json.load(response)["data"]["status"] == "ok"
                    break
                except (URLError, TimeoutError, ConnectionError):
                    time.sleep(0.1)
            else:
                raise AssertionError(f"FastAPI CLI did not start: {log_path.read_text()}")
        finally:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
