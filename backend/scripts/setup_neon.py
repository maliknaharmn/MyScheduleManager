"""Provision dedicated least-privilege roles and apply Alembic to a pulled Neon database.

Input must be a gitignored Neon env file. Outputs only runtime-role credentials to a
new/private file; the owner URL stays in the input and migration subprocess environment.
Existing roles/passwords and non-MySchedule databases are never overwritten.
"""

import argparse
import asyncio
import os
import secrets
import subprocess
import sys
from pathlib import Path

from dotenv import dotenv_values
from sqlalchemy import text
from sqlalchemy.engine import make_url

from myschedule.models import Base
from myschedule.postgres import postgres_engine

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
ROLES = {
    "DATABASE_URL": "myschedule_app",
    "AUTH_DATABASE_URL": "myschedule_auth",
    "WORKER_DATABASE_URL": "myschedule_worker",
}


def quote_identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def write_private(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_name(f".{path.name}.{secrets.token_hex(6)}.tmp")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w") as file:
        file.write(content)
        file.flush()
        os.fsync(file.fileno())
    os.replace(temporary, path)


async def provision(source: Path, output: Path) -> str:
    values = await asyncio.to_thread(dotenv_values, source)
    admin = values.get("DATABASE_URL_UNPOOLED")
    pooled = values.get("DATABASE_URL")
    if not admin or not pooled:
        raise ValueError("Both Neon Postgres URLs must be present in the source file")
    direct_url, pooled_url = make_url(admin), make_url(pooled)
    if not (direct_url.host or "").endswith(".neon.tech") or "-pooler." in direct_url.host:
        raise ValueError("The migration source must be a direct Neon endpoint")
    if (pooled_url.host or "").replace("-pooler.", ".") != direct_url.host:
        raise ValueError("Runtime and migration URLs must belong to the same Neon endpoint")
    if pooled_url.database != direct_url.database:
        raise ValueError("Runtime and migration URLs must select the same database")
    engine = postgres_engine(admin, migration=True)
    try:
        async with engine.begin() as connection:
            tables = set(
                (
                    await connection.execute(
                        text(
                            "SELECT schemaname || '.' || tablename FROM pg_tables "
                            "WHERE schemaname IN ('public','app_private') "
                            "AND tablename <> 'alembic_version'"
                        )
                    )
                ).scalars()
            )
            expected = {
                f"{table.schema or 'public'}.{table.name}"
                for table in Base.metadata.tables.values()
            }
            if tables - expected:
                raise ValueError("Unexpected existing tables; use a dedicated app database")
            if tables:
                revision = await connection.scalar(text("SELECT version_num FROM alembic_version"))
                if revision != "0001":
                    raise ValueError("Existing schema needs manual migration review")
            existing = {
                row.rolname: row
                for row in (
                    await connection.execute(
                        text(
                            "SELECT rolname, rolsuper, rolbypassrls, "
                            "rolcreatedb, rolcreaterole, rolinherit FROM pg_roles "
                            "WHERE rolname IN "
                            "('myschedule_app','myschedule_auth','myschedule_worker')"
                        )
                    )
                ).all()
            }
            old = (
                await asyncio.to_thread(dotenv_values, output)
                if await asyncio.to_thread(output.exists)
                else {}
            )
            if set(old) - set(ROLES):
                raise ValueError(
                    "Existing runtime file has other settings; refusing to overwrite it"
                )
            runtime = {}
            for key, role in ROLES.items():
                if role in existing:
                    row = existing[role]
                    if any(
                        (
                            row.rolsuper,
                            row.rolbypassrls,
                            row.rolcreatedb,
                            row.rolcreaterole,
                            row.rolinherit,
                        )
                    ):
                        raise ValueError(
                            "Existing runtime role has unsafe attributes; refusing to change it"
                        )
                    if not old.get(key):
                        raise ValueError(
                            "Existing role credentials are unavailable; refusing password reset"
                        )
                    previous = make_url(old[key])
                    if (previous.host, previous.database, previous.username) != (
                        pooled_url.host,
                        pooled_url.database,
                        role,
                    ):
                        raise ValueError("Existing output belongs to another endpoint or role")
                    runtime[key] = old[key]
                else:
                    password = secrets.token_urlsafe(32)
                    runtime[key] = pooled_url.set(
                        username=role, password=password
                    ).render_as_string(hide_password=False)
            # Persist before CREATE ROLE so interrupted setup never loses a new role's password.
            # Preserve a previously generated password if the database transaction had rolled back.
            for key, role in ROLES.items():
                if role not in existing and old.get(key):
                    previous = make_url(old[key])
                    if (previous.host, previous.database, previous.username) != (
                        pooled_url.host,
                        pooled_url.database,
                        role,
                    ):
                        raise ValueError("Existing output belongs to another endpoint or role")
                    runtime[key] = old[key]
            await asyncio.to_thread(
                write_private,
                output,
                "# Generated runtime roles only. Owner credentials are not stored here.\n"
                + "\n".join(f"{key}={value}" for key, value in runtime.items())
                + "\n",
            )
            for key, role in ROLES.items():
                if role not in existing:
                    password = make_url(runtime[key]).password
                    literal = password.replace("'", "''")
                    await connection.execute(
                        text(
                            f"CREATE ROLE {quote_identifier(role)} LOGIN PASSWORD '{literal}' "
                            "NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS"
                        )
                    )
                member = await connection.scalar(
                    text("SELECT pg_has_role(:role, 'neon_superuser', 'member')"), {"role": role}
                )
                if member:
                    raise ValueError("Runtime roles must not be members of neon_superuser")
            roles = ", ".join(quote_identifier(role) for role in ROLES.values())
            await connection.execute(
                text(
                    f"GRANT CONNECT ON DATABASE {quote_identifier(direct_url.database)} TO {roles}"
                )
            )
        print("PASS: dedicated runtime/auth/worker roles, no superuser/BYPASSRLS/admin membership.")
        print("Runtime credentials saved privately; no owner URL or passwords printed.")
    finally:
        await engine.dispose()
    return admin


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    source, output = args.source.resolve(), args.output.resolve()
    if not output.is_relative_to(ROOT / ".local"):
        raise ValueError("Runtime output must be inside the project's ignored .local directory")
    owner_url = asyncio.run(provision(source, output))
    environment = os.environ.copy()
    environment.update({k: v for k, v in dotenv_values(output).items() if v is not None})
    environment["MIGRATION_DATABASE_URL"] = owner_url
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=BACKEND,
        env=environment,
        capture_output=True,
        text=True,
        timeout=120,
    )
    if result.returncode:
        # Provider errors can contain SQL or connection parameters. Do not echo them.
        raise RuntimeError(
            "Alembic failed; schema transaction rolled back; credential output withheld"
        )
    print("PASS: Alembic upgrade head completed through the direct, TLS-verified owner connection.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(
            f"Neon setup failed ({type(exc).__name__}); no credential values printed.",
            file=sys.stderr,
        )
        raise SystemExit(1) from None
