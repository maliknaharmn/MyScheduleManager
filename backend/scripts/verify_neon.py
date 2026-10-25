"""Verify the actual Neon connections, and optionally HTTP CRUD on an isolated test branch."""

import argparse
import asyncio
import os
import secrets
import socket
import ssl
import subprocess
import sys
import time
from pathlib import Path
from uuid import uuid4

import httpx
from dotenv import dotenv_values
from sqlalchemy import delete, select, text
from sqlalchemy.engine import make_url

from myschedule.auth import SESSION_COOKIE, GoogleIdentity, create_login
from myschedule.config import Settings
from myschedule.database import Database
from myschedule.models import Base, User
from myschedule.postgres import postgres_engine

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"


async def inspect_connections(runtime: dict) -> None:
    for key, expected in (
        ("DATABASE_URL", "myschedule_app"),
        ("AUTH_DATABASE_URL", "myschedule_auth"),
        ("WORKER_DATABASE_URL", "myschedule_worker"),
    ):
        engine = postgres_engine(runtime[key])
        try:
            async with engine.begin() as connection:
                row = (
                    await connection.execute(
                        text(
                            "SELECT current_user AS role, rolsuper, rolbypassrls, "
                            "pg_has_role(current_user, 'neon_superuser', 'member') AS admin_member "
                            "FROM pg_roles WHERE rolname=current_user"
                        )
                    )
                ).one()
                assert row.role == expected and not any(
                    (row.rolsuper, row.rolbypassrls, row.admin_member)
                )
                # pg_stat_ssl on a pooler shows its backend hop, not our TLS connection.
                raw = await connection.get_raw_connection()
                tls = raw.driver_connection._transport.get_extra_info("ssl_object")
                assert tls is not None and tls.context.verify_mode == ssl.CERT_REQUIRED
                assert tls.context.check_hostname
                if key == "DATABASE_URL":
                    assert (
                        await connection.scalar(text("SELECT version_num FROM alembic_version"))
                        == "0001"
                    )
                    assert await connection.scalar(text("SELECT to_regclass('public.schedules')"))
                elif key == "AUTH_DATABASE_URL":
                    await connection.execute(text("SELECT id FROM users LIMIT 0"))
                    await connection.execute(text("SELECT id FROM sessions LIMIT 0"))
                else:
                    await connection.execute(text("SELECT id FROM calendar_outbox LIMIT 0"))
                    await connection.execute(
                        text("SELECT connection_id FROM app_private.calendar_credentials LIMIT 0")
                    )
        finally:
            await engine.dispose()
        print(f"PASS: {expected} connects through pooled Neon with TLS; no admin/BYPASSRLS.")


async def synthetic_account(runtime: dict, subject: str, session_secret: str):
    settings = Settings(
        _env_file=None,
        app_env="test",
        database_url=runtime["DATABASE_URL"],
        auth_database_url=runtime["AUTH_DATABASE_URL"],
        session_secret=session_secret,
        allowed_google_emails=["neon-e2e@example.invalid"],
    )
    database = Database(settings)
    try:
        token = await create_login(
            database,
            settings,
            GoogleIdentity(subject, "neon-e2e@example.invalid", "Neon E2E"),
            None,
        )
        async with database.session(auth=True) as session:
            user_id = await session.scalar(select(User.id).where(User.google_subject == subject))
        async with database.session(uuid4()) as session:
            assert not (
                await session.execute(
                    text("SELECT user_id FROM profiles WHERE user_id=:user_id"),
                    {"user_id": user_id},
                )
            ).all()
        print("PASS: cross-user RLS isolation on the live Neon validation branch.")
        return user_id, token
    finally:
        await database.close()


async def cleanup(source: dict, subject: str):
    engine = postgres_engine(source["DATABASE_URL_UNPOOLED"], migration=True)
    try:
        async with engine.begin() as connection:
            user_id = await connection.scalar(select(User.id).where(User.google_subject == subject))
            if user_id is not None:
                for table in reversed(Base.metadata.sorted_tables):
                    if "user_id" in table.c:
                        await connection.execute(delete(table).where(table.c.user_id == user_id))
                await connection.execute(delete(User).where(User.id == user_id))
        print("PASS: synthetic verification rows cleaned; no production-user seed created.")
    finally:
        await engine.dispose()


def http_crud(runtime: dict, token: str, session_secret: str):
    with socket.socket() as socket_:
        socket_.bind(("127.0.0.1", 0))
        port = socket_.getsockname()[1]
    origin = f"http://127.0.0.1:{port}"
    environment = os.environ.copy()
    environment.update(runtime)
    environment.update(
        {
            "APP_ENV": "test",
            "APP_ORIGIN": origin,
            "SESSION_SECRET": session_secret,
            "ALLOWED_GOOGLE_EMAILS": '["neon-e2e@example.invalid"]',
            "COOKIE_SECURE": "false",
            "GOOGLE_CLIENT_ID": "",
            "GOOGLE_CLIENT_SECRET": "",
        }
    )
    process = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "myschedule.main:app",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
            "--no-access-log",
        ],
        cwd=BACKEND,
        env=environment,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        with httpx.Client(base_url=origin, timeout=30, follow_redirects=False) as client:
            deadline = time.monotonic() + 30
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise RuntimeError("Verification server exited")
                try:
                    if client.get("/health/live").status_code == 200:
                        break
                except httpx.TransportError:
                    time.sleep(0.1)
            else:
                raise RuntimeError("Verification server did not start")
            assert client.get("/health/ready").status_code == 200
            client.cookies.set(SESSION_COOKIE, token)
            me = client.get("/api/v1/me")
            assert me.status_code == 200
            data = me.json()["data"]
            headers = {"Origin": origin, "X-CSRF-Token": data["csrf_token"]}
            body = {"expected_version": data["profile"]["version"], "daily_reminder_time": "09:15"}
            saved = client.patch("/api/v1/me/profile", json=body, headers=headers)
            assert saved.status_code == 200
            assert (
                client.get("/api/v1/me").json()["data"]["profile"]["daily_reminder_time"] == "09:15"
            )
            assert client.patch("/api/v1/me/profile", json=body, headers=headers).status_code == 409
            assert client.post("/api/v1/auth/logout", headers=headers).status_code == 204
            assert client.get("/api/v1/me").status_code == 401
            print(
                "PASS: real HTTP → FastAPI → SQLAlchemy → pooled Neon: readiness 200, "
                "profile read/write/readback, stale-version 409, logout 204, anonymous 401."
            )
    finally:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--source", type=Path)
    parser.add_argument("--write-test", action="store_true")
    args = parser.parse_args()
    runtime = dict(dotenv_values(args.runtime))
    asyncio.run(inspect_connections(runtime))
    if args.write_test:
        if not args.source:
            raise ValueError("A validation-branch source is required for a write test")
        source = dict(dotenv_values(args.source))
        if not (source.get("NEON_BRANCH") or "").startswith("myschedule-migration-check-"):
            raise ValueError("Synthetic write tests are only allowed on a validation branch")
        production = dotenv_values(ROOT / ".env.local")
        if (
            make_url(source["DATABASE_URL_UNPOOLED"]).host
            == make_url(production["DATABASE_URL_UNPOOLED"]).host
        ):
            raise ValueError("Refusing synthetic write test on the production endpoint")
        subject = f"neon-validation-{uuid4()}"
        secret = secrets.token_urlsafe(48)
        try:
            _, token = asyncio.run(synthetic_account(runtime, subject, secret))
            http_crud(runtime, token, secret)
        finally:
            asyncio.run(cleanup(source, subject))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(
            f"Neon verification failed ({type(exc).__name__}); credential output withheld.",
            file=sys.stderr,
        )
        raise SystemExit(1) from None
