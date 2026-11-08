import asyncio
import secrets
from datetime import timedelta

import httpx
import pytest
from pydantic import SecretStr
from sqlalchemy import select, update
from sqlalchemy.exc import DBAPIError

from myschedule.auth import SESSION_COOKIE, GoogleIdentity, create_login, token_hash
from myschedule.main import create_app
from myschedule.models import PasswordCredential, PasswordLink, PasswordRateLimit, User
from myschedule.password_auth import utcnow
from myschedule.password_mail import PasswordMailUnavailable

pytestmark = pytest.mark.database
BASE = "/api/v1/auth/password"
FIRST = "Orbit482!"
SECOND = "River793!"


class Mailer:
    def __init__(self):
        self.messages = []
        self.fail = False

    def send(self, email, purpose, token):
        if self.fail:
            raise PasswordMailUnavailable()
        self.messages.append((email, purpose, token))


@pytest.fixture
async def native(account, db_settings):
    settings = db_settings.model_copy(
        update={
            "password_auth_enabled": True,
            "password_owner_user_id": account.user_id,
            "password_owner_email": "test@example.invalid",
            "session_secret": SecretStr(secrets.token_urlsafe(48)),
        }
    )
    app = create_app(settings)
    app.state.password_auth.mailer = Mailer()
    yield app, settings, account
    await app.state.database.close()


def client_for(app, settings):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=settings.app_origin)


async def csrf(client, settings):
    response = await client.get(BASE + "/context")
    assert response.status_code == 200
    assert response.json()["data"]["enabled"]
    return {"Origin": settings.app_origin, "X-CSRF-Token": response.json()["data"]["csrf_token"]}


async def issue(app, settings, purpose="invitation"):
    assert await app.state.password_auth.issue_email(
        settings.password_owner_email, purpose, "test-peer"
    )
    return app.state.password_auth.mailer.messages[-1][2]


async def enroll(app, settings, client):
    token = await issue(app, settings)
    headers = await csrf(client, settings)
    response = await client.post(
        BASE + "/activate",
        headers=headers,
        json={"token": token, "password": FIRST, "confirmation": FIRST},
    )
    assert response.status_code == 204, response.text
    return headers


async def clear_cooldown(app):
    native = app.state.password_auth
    async with app.state.database.session(auth=True) as session:
        await session.execute(
            update(PasswordRateLimit)
            .where(
                PasswordRateLimit.bucket_hash
                == native.bucket_hash("email-cooldown", native.settings.password_owner_email),
            )
            .values(window_start=utcnow() - timedelta(seconds=61))
        )


async def test_invitation_is_bound_to_existing_id_and_smtp_failure_keeps_pending_state(
    native,
):
    app, settings, account = native
    mailer = app.state.password_auth.mailer
    mailer.fail = True
    assert not await app.state.password_auth.issue_email(
        settings.password_owner_email, "invitation", "test-peer"
    )
    async with app.state.database.session(auth=True) as session:
        assert await session.get(PasswordCredential, account.user_id) is None
    await clear_cooldown(app)
    mailer.fail = False
    token = await issue(app, settings)
    async with app.state.database.session(auth=True) as session:
        row = await session.get(PasswordCredential, account.user_id)
        link = await session.scalar(
            select(PasswordLink).where(PasswordLink.user_id == account.user_id)
        )
        assert (
            row.user_id == account.user_id
            and row.password_hash is None
            and row.email_verified_at is None
        )
        assert link.token_hash == token_hash(token) and link.token_hash != token
        assert link.expires_at - link.created_at == timedelta(hours=24)


async def test_activation_get_csrf_wrong_purpose_confirmation_policy_and_replay_fail_closed(native):
    app, settings, account = native
    token = await issue(app, settings)
    async with client_for(app, settings) as client:
        headers = await csrf(client, settings)
        payload = {"token": token, "password": FIRST, "confirmation": FIRST}
        assert (await client.get(BASE + "/activate", params={"token": token})).status_code == 405
        assert (await client.post(BASE + "/activate", json=payload)).status_code == 403
        assert (
            await client.post(
                BASE + "/activate",
                headers={**headers, "Origin": "https://attacker.invalid"},
                json=payload,
            )
        ).status_code == 403
        assert (
            await client.post(BASE + "/reset", headers=headers, json=payload)
        ).status_code == 400
        mismatch = await client.post(
            BASE + "/activate", headers=headers, json={**payload, "confirmation": SECOND}
        )
        assert (
            mismatch.status_code == 422
            and FIRST not in mismatch.text
            and SECOND not in mismatch.text
            and token not in mismatch.text
        )
        assert (
            await client.post(
                BASE + "/activate",
                headers=headers,
                json={**payload, "password": "Password1", "confirmation": "Password1"},
            )
        ).status_code == 422
        assert (
            await client.post(BASE + "/activate", headers=headers, json=payload)
        ).status_code == 204
        assert (
            await client.post(BASE + "/activate", headers=headers, json=payload)
        ).status_code == 400
        assert (await client.get("/api/v1/me")).status_code == 401
        client.cookies.set(SESSION_COOKIE, account.token)
        assert (await client.get("/api/v1/me")).status_code == 401
    async with app.state.database.session(auth=True) as session:
        row = await session.get(PasswordCredential, account.user_id)
        assert row.email_verified_at and row.password_hash.startswith("$argon2id$")


async def test_username_email_login_preserves_google_identity_data_and_session_cookie(native):
    app, settings, account = native
    async with client_for(app, settings) as client:
        client.cookies.set(SESSION_COOKIE, account.token)
        old = (await client.get("/api/v1/me")).json()["data"]
        note = await client.post(
            "/api/v1/notes",
            headers={"Origin": settings.app_origin, "X-CSRF-Token": old["csrf_token"]},
            json={
                "title": "Existing private history",
                "target_start": "2026-11-08",
                "target_end": "2026-11-08",
            },
        )
        assert note.status_code == 201
        note_id = note.json()["data"]["id"]
        headers = await enroll(app, settings, client)
        for identifier in ["MALIK", "TEST@EXAMPLE.INVALID"]:
            response = await client.post(
                BASE + "/login", headers=headers, json={"identifier": identifier, "password": FIRST}
            )
            assert response.status_code == 204
            assert (
                "HttpOnly" in response.headers["set-cookie"]
                and "SameSite=lax" in response.headers["set-cookie"]
            )
            me = (await client.get("/api/v1/me")).json()["data"]
            assert me["user"]["id"] == str(account.user_id)
            assert me["profile"] == old["profile"]
            assert "password_hash" not in str(me)
            assert (await client.get("/api/v1/notes/" + note_id)).status_code == 200
    async with app.state.database.session(auth=True) as session:
        user = await session.get(User, account.user_id)
    google_token = await create_login(
        app.state.database,
        settings,
        GoogleIdentity(user.google_subject, user.email, user.display_name),
        None,
    )
    async with client_for(app, settings) as client:
        client.cookies.set(SESSION_COOKIE, google_token)
        assert (await client.get("/api/v1/me")).json()["data"]["user"]["id"] == str(account.user_id)


async def test_login_budget_is_shared_by_aliases_persistent_across_service_restart_and_expires(
    native,
):
    app, settings, account = native
    async with client_for(app, settings) as client:
        headers = await enroll(app, settings, client)
        for identifier in [
            "malik",
            "test@example.invalid",
            "MALIK",
            "malik",
            "test@example.invalid",
        ]:
            assert (
                await client.post(
                    BASE + "/login",
                    headers=headers,
                    json={"identifier": identifier, "password": "Wrong482"},
                )
            ).status_code == 401
        assert (
            await client.post(
                BASE + "/login", headers=headers, json={"identifier": "malik", "password": FIRST}
            )
        ).status_code == 429
    other = create_app(settings)
    try:
        async with client_for(other, settings) as client:
            headers = await csrf(client, settings)
            assert (
                await client.post(
                    BASE + "/login",
                    headers=headers,
                    json={"identifier": "malik", "password": FIRST},
                )
            ).status_code == 429
            async with app.state.database.session(auth=True) as session:
                await session.execute(
                    update(PasswordRateLimit)
                    .where(PasswordRateLimit.user_id == account.user_id)
                    .values(window_start=utcnow() - timedelta(minutes=16))
                )
            assert (
                await client.post(
                    BASE + "/login",
                    headers=headers,
                    json={"identifier": "malik", "password": FIRST},
                )
            ).status_code == 204
    finally:
        await other.state.database.close()


async def test_unknown_identifier_and_disabled_owner_cannot_login_or_trigger_email(native):
    app, settings, account = native
    async with client_for(app, settings) as client:
        headers = await enroll(app, settings, client)
        unknown = await client.post(
            BASE + "/login", headers=headers, json={"identifier": "someone-else", "password": FIRST}
        )
        assert unknown.status_code == 401
        async with app.state.database.session(auth=True) as session:
            await session.execute(
                update(User).where(User.id == account.user_id).values(disabled_at=utcnow())
            )
        disabled = await client.post(
            BASE + "/login", headers=headers, json={"identifier": "malik", "password": FIRST}
        )
        assert disabled.status_code == 401
        assert unknown.json()["error"]["message"] == disabled.json()["error"]["message"]
        await clear_cooldown(app)
        count = len(app.state.password_auth.mailer.messages)
        assert (
            await client.post(
                BASE + "/forgot", headers=headers, json={"email": settings.password_owner_email}
            )
        ).status_code == 202
        assert len(app.state.password_auth.mailer.messages) == count


async def test_reset_is_thirty_minutes_single_use_and_revokes_all_sessions(native):
    app, settings, account = native
    async with client_for(app, settings) as client:
        headers = await enroll(app, settings, client)
        assert (
            await client.post(
                BASE + "/login", headers=headers, json={"identifier": "malik", "password": FIRST}
            )
        ).status_code == 204
        previous = client.cookies.get(SESSION_COOKIE)
        await clear_cooldown(app)
        token = await issue(app, settings, "reset")
        async with app.state.database.session(auth=True) as session:
            link = await session.scalar(
                select(PasswordLink).where(PasswordLink.token_hash == token_hash(token))
            )
            assert link.expires_at - link.created_at == timedelta(minutes=30)
        payload = {"token": token, "password": SECOND, "confirmation": SECOND}
        assert (
            await client.post(BASE + "/reset", headers=headers, json=payload)
        ).status_code == 204
        assert (
            await client.post(BASE + "/reset", headers=headers, json=payload)
        ).status_code == 400
        client.cookies.set(SESSION_COOKIE, previous)
        assert (await client.get("/api/v1/me")).status_code == 401
        assert (
            await client.post(
                BASE + "/login", headers=headers, json={"identifier": "malik", "password": FIRST}
            )
        ).status_code == 401
        assert (
            await client.post(
                BASE + "/login", headers=headers, json={"identifier": "malik", "password": SECOND}
            )
        ).status_code == 204


async def test_change_requires_current_password_session_csrf_and_revokes_google_and_current_browser(
    native,
):
    app, settings, account = native
    async with client_for(app, settings) as client:
        native_headers = await enroll(app, settings, client)
        async with app.state.database.session(auth=True) as session:
            user = await session.get(User, account.user_id)
        google = await create_login(
            app.state.database,
            settings,
            GoogleIdentity(user.google_subject, user.email, user.display_name),
            None,
        )
        assert (
            await client.post(
                BASE + "/login",
                headers=native_headers,
                json={"identifier": "malik", "password": FIRST},
            )
        ).status_code == 204
        previous = client.cookies.get(SESSION_COOKIE)
        me = (await client.get("/api/v1/me")).json()["data"]
        headers = {"Origin": settings.app_origin, "X-CSRF-Token": me["csrf_token"]}
        payload = {"current_password": FIRST, "password": SECOND, "confirmation": SECOND}
        assert (await client.post(BASE + "/change", json=payload)).status_code == 403
        assert (
            await client.post(
                BASE + "/change", headers=headers, json={**payload, "current_password": "Wrong482"}
            )
        ).status_code == 401
        assert (await client.get("/api/v1/me")).status_code == 200
        assert (
            await client.post(BASE + "/change", headers=headers, json=payload)
        ).status_code == 204
        for token in (previous, google, account.token):
            client.cookies.set(SESSION_COOKIE, token)
            assert (await client.get("/api/v1/me")).status_code == 401


async def test_expired_and_concurrently_replayed_invitation_cannot_activate_twice(native):
    app, settings, account = native
    token = await issue(app, settings)
    async with app.state.database.session(auth=True) as session:
        await session.execute(
            update(PasswordLink)
            .where(PasswordLink.user_id == account.user_id)
            .values(
                created_at=utcnow() - timedelta(days=2), expires_at=utcnow() - timedelta(days=1)
            )
        )
    async with client_for(app, settings) as first, client_for(app, settings) as second:
        one, two = await csrf(first, settings), await csrf(second, settings)
        payload = {"token": token, "password": FIRST, "confirmation": FIRST}
        assert (await first.post(BASE + "/activate", headers=one, json=payload)).status_code == 400
        await clear_cooldown(app)
        payload["token"] = await issue(app, settings)
        responses = await asyncio.gather(
            first.post(BASE + "/activate", headers=one, json=payload),
            second.post(BASE + "/activate", headers=two, json=payload),
        )
        assert sorted(response.status_code for response in responses) == [204, 400]


async def test_resend_limits_and_failed_smtp_preserve_the_previous_valid_link(native):
    app, settings, account = native
    first_token = await issue(app, settings)
    with pytest.raises(Exception) as error:
        await issue(app, settings)
    assert error.value.code == "PASSWORD_RATE_LIMIT"
    await clear_cooldown(app)
    app.state.password_auth.mailer.fail = True
    assert not await app.state.password_auth.issue_email(
        settings.password_owner_email, "invitation", "test-peer"
    )
    async with app.state.database.session(auth=True) as session:
        first = await session.scalar(
            select(PasswordLink).where(PasswordLink.token_hash == token_hash(first_token))
        )
        assert first.consumed_at is None
    await clear_cooldown(app)
    app.state.password_auth.mailer.fail = False
    second_token = await issue(app, settings)
    async with app.state.database.session(auth=True) as session:
        first = await session.scalar(
            select(PasswordLink).where(PasswordLink.token_hash == token_hash(first_token))
        )
        assert first.consumed_at is not None
        assert first_token != second_token
    await clear_cooldown(app)
    with pytest.raises(Exception) as error:
        await issue(app, settings)
    assert error.value.code == "PASSWORD_RATE_LIMIT"


async def test_native_secret_tables_are_not_visible_to_the_normal_resource_role(native):
    app, settings, account = native
    await issue(app, settings)
    for model in (PasswordCredential, PasswordLink, PasswordRateLimit):
        with pytest.raises(DBAPIError):
            async with app.state.database.session(account.user_id) as session:
                await session.execute(select(model))
    async with client_for(app, settings) as client:
        headers = await csrf(client, settings)
        response = await client.post(
            BASE + "/signup",
            headers=headers,
            json={"username": "someone", "email": "visitor@example.invalid", "password": FIRST},
        )
        assert response.status_code == 403
        assert "set-cookie" not in response.headers
