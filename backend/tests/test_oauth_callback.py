from datetime import UTC, datetime
from unittest.mock import AsyncMock
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

import httpx
import pytest
from pydantic import SecretStr
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import create_async_engine

from myschedule.auth import SESSION_COOKIE, GoogleIdentity
from myschedule.main import create_app
from myschedule.models import Base, User

pytestmark = pytest.mark.database


@pytest.fixture(params=["visitor@example.invalid", "staff@organization.example"])
async def new_google_identity(request, db_settings):
    identity = GoogleIdentity(f"public-signup-{uuid4()}", request.param, "Public signup test")
    yield identity
    engine = create_async_engine(db_settings.migration_database_url.get_secret_value())
    try:
        async with engine.begin() as connection:
            user_id = await connection.scalar(
                select(User.id).where(User.google_subject == identity.subject)
            )
            if user_id is not None:
                for table in reversed(Base.metadata.sorted_tables):
                    if "user_id" in table.c:
                        await connection.execute(delete(table).where(table.c.user_id == user_id))
                await connection.execute(delete(User).where(User.id == user_id))
    finally:
        await engine.dispose()


async def test_public_first_sign_in_bootstraps_private_account(
    new_google_identity, account, db_settings, monkeypatch
):
    # A stale deployment allowlist must not restrict signup OR later session lookups.
    monkeypatch.setenv("ALLOWED_GOOGLE_EMAILS", '["former-owner@example.invalid"]')
    settings = db_settings.model_copy(
        update={
            "google_client_id": "test-client",
            "google_client_secret": SecretStr("test-only-secret"),
        }
    )
    app = create_app(settings)
    app.state.google.exchange = AsyncMock(return_value=new_google_identity)
    transport = httpx.ASGITransport(app=app)
    try:
        async with (
            httpx.AsyncClient(transport=transport, base_url=settings.app_origin) as client,
            httpx.AsyncClient(transport=transport, base_url=settings.app_origin) as other,
        ):
            status = (await client.get("/api/v1/status")).json()["data"]
            assert status["google_login_configured"] is True
            assert (await client.get("/api/v1/notes")).status_code == 401
            async with app.state.database.session(auth=True) as session:
                existing_user = await session.scalar(
                    select(User.id).where(User.google_subject == new_google_identity.subject)
                )
                assert existing_user is None
            start = await client.get("/api/v1/auth/google/start")
            assert start.status_code == 303
            state = parse_qs(urlsplit(start.headers["location"]).query)["state"][0]
            callback = await client.get(
                "/api/v1/auth/google/callback", params={"state": state, "code": "test-code"}
            )
            assert callback.status_code == 303
            me = await client.get("/api/v1/me")
            assert me.status_code == 200
            data = me.json()["data"]
            assert data["user"]["email"] == new_google_identity.email
            assert data["user"]["id"] != str(account.user_id)
            assert data["profile"]["version"] == 1
            tags = (await client.get("/api/v1/tags")).json()["data"]
            assert {tag["system_key"] for tag in tags} == {"important", "plan", "target"}
            headers = {"Origin": settings.app_origin, "X-CSRF-Token": data["csrf_token"]}
            note_body = {
                "title": "Private public-signup note",
                "target_start": "2026-11-17",
                "target_end": "2026-11-17",
            }
            assert (await client.post("/api/v1/notes", json=note_body)).status_code == 403
            note = await client.post("/api/v1/notes", json=note_body, headers=headers)
            assert note.status_code == 201, note.text
            note_id = note.json()["data"]["id"]
            agenda = await client.post(
                "/api/v1/schedules",
                headers=headers,
                json={
                    "title": "Private public-signup agenda",
                    "category": "Other",
                    "status": "Confirmed",
                    "time": {
                        "mode": "date_only",
                        "timezone": "Asia/Jakarta",
                        "range_start": "2026-11-17",
                        "range_end": "2026-11-17",
                    },
                },
            )
            assert agenda.status_code == 201, agenda.text
            agenda_id = agenda.json()["data"]["id"]
            other.cookies.set(SESSION_COOKIE, account.token)
            assert (await other.get(f"/api/v1/notes/{note_id}")).status_code == 404
            assert (await other.get(f"/api/v1/schedules/{agenda_id}")).status_code == 404
            assert (await other.get("/api/v1/notes")).json()["data"]["items"] == []
            assert (await other.get("/api/v1/schedules")).json()["data"]["items"] == []
            assert (await client.get(f"/api/v1/notes/{note_id}")).status_code == 200
            assert (await client.get(f"/api/v1/schedules/{agenda_id}")).status_code == 200
    finally:
        await app.state.database.close()


async def test_public_login_still_rejects_disabled_accounts_and_existing_sessions(
    account, db_settings
):
    settings = db_settings.model_copy(
        update={
            "google_client_id": "test-client",
            "google_client_secret": SecretStr("test-only-secret"),
        }
    )
    engine = create_async_engine(db_settings.migration_database_url.get_secret_value())
    try:
        async with engine.begin() as connection:
            await connection.execute(
                update(User).where(User.id == account.user_id).values(disabled_at=datetime.now(UTC))
            )
    finally:
        await engine.dispose()
    app = create_app(settings)
    async with account.database.session(auth=True) as session:
        user = await session.get(User, account.user_id)
        identity = GoogleIdentity(user.google_subject, user.email, user.display_name)
    app.state.google.exchange = AsyncMock(return_value=identity)
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url=settings.app_origin
        ) as client:
            client.cookies.set(SESSION_COOKIE, account.token)
            assert (await client.get("/api/v1/me")).status_code == 401
            start = await client.get("/api/v1/auth/google/start")
            state = parse_qs(urlsplit(start.headers["location"]).query)["state"][0]
            result = await client.get(
                "/api/v1/auth/google/callback", params={"state": state, "code": "test-code"}
            )
            assert result.status_code == 403
            assert result.json()["error"]["code"] == "ACCOUNT_NOT_ALLOWED"
            assert (await client.get("/api/v1/me")).status_code == 401
    finally:
        await app.state.database.close()


async def test_callback_binds_state_sets_opaque_cookie_rotates_and_prevents_replay(
    account, db_settings
):
    settings = db_settings.model_copy(
        update={
            "google_client_id": "test-client",
            "google_client_secret": SecretStr("test-only-secret"),
        }
    )
    app = create_app(settings)
    async with account.database.session(auth=True) as session:
        user = await session.scalar(select(User).where(User.id == account.user_id))
        identity = GoogleIdentity(user.google_subject, user.email, user.display_name)
    # Test-only provider mock. No runtime dev-login/bypass endpoint exists.
    app.state.google.exchange = AsyncMock(return_value=identity)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url=settings.app_origin,
        follow_redirects=False,
    ) as client:
        client.cookies.set(SESSION_COOKIE, account.token)
        start = await client.get("/api/v1/auth/google/start?return_to=/settings")
        assert start.status_code == 303
        state = parse_qs(urlsplit(start.headers["location"]).query)["state"][0]
        response = await client.get(
            "/api/v1/auth/google/callback", params={"state": state, "code": "test-code"}
        )
        assert response.status_code == 303
        assert response.headers["location"] == f"{settings.app_origin}/settings"
        cookies = response.headers.get_list("set-cookie")
        assert any(SESSION_COOKIE in c and "HttpOnly" in c and "SameSite=lax" in c for c in cookies)
        # Cookies intentionally contain only our opaque session, never an ID/access/refresh token.
        assert "test-code" not in " ".join(cookies)
        assert (await client.get("/api/v1/me")).status_code == 200
        replay = await client.get(
            "/api/v1/auth/google/callback", params={"state": state, "code": "test-code"}
        )
        assert replay.status_code == 400
    # The old cookie was rotated/revoked, not reused as a new login session.
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url=settings.app_origin,
    ) as old_client:
        old_client.cookies.set(SESSION_COOKIE, account.token)
        assert (await old_client.get("/api/v1/me")).status_code == 401
    await app.state.database.close()


async def test_cancelled_google_consent_does_not_create_a_session(db_settings):
    settings = db_settings.model_copy(
        update={
            "google_client_id": "test-client",
            "google_client_secret": SecretStr("test-only-secret"),
        }
    )
    app = create_app(settings)
    app.state.google.exchange = AsyncMock()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url=settings.app_origin,
    ) as client:
        start = await client.get("/api/v1/auth/google/start")
        state = parse_qs(urlsplit(start.headers["location"]).query)["state"][0]
        result = await client.get(
            "/api/v1/auth/google/callback", params={"state": state, "error": "access_denied"}
        )
        assert result.status_code == 303
        assert "google_cancelled" in result.headers["location"]
        app.state.google.exchange.assert_not_called()
        assert (await client.get("/api/v1/me")).status_code == 401
    await app.state.database.close()
