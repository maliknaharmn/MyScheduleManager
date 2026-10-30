"""Create NEW, isolated local development databases/roles without changing existing resources.

Run from backend/: python3.13 scripts/provision_local.py
Requires the local OS user to have PostgreSQL CREATEDB/CREATEROLE (normally local dev owner).
No cluster/service is started or modified. Refuses all pre-existing project roles/databases/.env.
"""

import os
import secrets
import subprocess
from pathlib import Path
from urllib.parse import quote

ROLES = ("myschedule_app", "myschedule_auth", "myschedule_worker")
DATABASES = ("myschedule_dev", "myschedule_test")


def sql(statement: str) -> str:
    result = subprocess.run(
        ["psql", "-X", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tA"],
        input=statement,
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode:
        raise SystemExit(
            "PostgreSQL provisioning failed. No credentials are printed; inspect locally."
        )
    return result.stdout.strip()


def main():
    root = Path(__file__).resolve().parents[1]
    env = root / ".env"
    if env.exists():
        raise SystemExit(".env already exists; refusing to overwrite local configuration.")
    names = ",".join(f"'{value}'" for value in (*ROLES, *DATABASES))
    existing = sql(
        f"SELECT rolname FROM pg_roles WHERE rolname IN ({names}) UNION "
        f"SELECT datname FROM pg_database WHERE datname IN ({names});"
    )
    if existing:
        raise SystemExit("Project resources already exist; refusing to overwrite or change them.")
    owner = sql("SELECT current_user;")
    host = os.environ.get("PGHOST", "")
    port = int(os.environ.get("PGPORT", "5432"))
    if host not in {"", "localhost", "127.0.0.1", "/tmp", "/var/run/postgresql"}:
        raise SystemExit("Provisioning is local-only; refusing a non-local PostgreSQL host.")
    runtime_host = host if host and not host.startswith("/") else "127.0.0.1"
    passwords = {role: secrets.token_urlsafe(32) for role in ROLES}
    for role, password in passwords.items():
        sql(
            f"CREATE ROLE \"{role}\" LOGIN PASSWORD '{password}' "
            "NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;"
        )
    for name in DATABASES:
        sql(f'CREATE DATABASE "{name}";')
    # The migration owner remains the local OS role; API connections use limited roles over TCP.
    lines = ["APP_ENV=development", "APP_ORIGIN=http://localhost:5173"]
    for db, prefix in ((DATABASES[0], ""), (DATABASES[1], "TEST_")):
        for role, key in (
            (ROLES[0], "DATABASE_URL"),
            (ROLES[1], "AUTH_DATABASE_URL"),
            (ROLES[2], "WORKER_DATABASE_URL"),
        ):
            lines.append(
                f"{prefix}{key}=postgresql+asyncpg://{role}:{passwords[role]}@{runtime_host}:{port}/{db}"
            )
        if host and not host.startswith("/"):
            password = quote(os.environ.get("PGPASSWORD", ""), safe="")
            migration_url = f"postgresql+asyncpg://{quote(owner)}:{password}@{host}:{port}/{db}"
        else:
            socket = quote(host or "/tmp", safe="")
            migration_url = f"postgresql+asyncpg://{quote(owner)}@/{db}?host={socket}&port={port}"
        lines.append(f"{prefix}MIGRATION_DATABASE_URL={migration_url}")
    lines += [
        f"SESSION_SECRET={secrets.token_urlsafe(48)}",
        "COOKIE_SECURE=false",
        "GOOGLE_CLIENT_ID=",
        "GOOGLE_CLIENT_SECRET=",
        "GOOGLE_REDIRECT_URI=http://localhost:5173/api/v1/auth/google/callback",
    ]
    fd = os.open(env, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as file:
        file.write("\n".join(lines) + "\n")
    print(
        "Created isolated myschedule_dev/test and limited roles. "
        "Saved .env (0600), no secrets printed."
    )
    print("Next: .venv/bin/alembic upgrade head; run tests using the dedicated test database.")


if __name__ == "__main__":
    main()
