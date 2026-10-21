from unittest.mock import AsyncMock
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from pydantic import SecretStr
from sqlalchemy import select

from myschedule.auth import SESSION_COOKIE, GoogleIdentity
from myschedule.main import create_app
from myschedule.models import User

pytestmark = pytest.mark.database


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
