"""No real identities: shared OAuth tests use only the guarded local _test database."""

import asyncio
import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from pydantic import SecretStr
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import create_async_engine

from myschedule.auth import OAUTH_COOKIE, Handshake
from myschedule.database import Database
from myschedule.errors import ApiError
from myschedule.main import create_app
from myschedule.models import OAuthHandshake
from myschedule.oauth_state import PostgresHandshakeBackend

pytestmark = pytest.mark.database


@pytest.fixture
async def shared(db_settings):
    settings = db_settings.model_copy(update={"oauth_state_storage": "postgres"})
    databases = [Database(settings), Database(settings)]
    stores = [PostgresHandshakeBackend(database, settings) for database in databases]
    owned = set()

    async def create(index=0, path="/settings"):
        item = await stores[index].create(path)
        owned.add(hashlib.sha256(item.state.encode()).hexdigest())
        return item

    yield settings, databases, stores, create, owned
    try:
        async with databases[0].session(auth=True) as session:
            await session.execute(
                delete(OAuthHandshake).where(OAuthHandshake.state_hash.in_(owned))
            )
    finally:
        for database in databases:
            await database.close()


async def test_shared_state_survives_instance_change_and_is_encrypted_bound_single_use(shared):
    _, databases, stores, create, _ = shared
    item = await create(path="/agenda?week=2026-11-16")
    async with databases[0].session(auth=True) as session:
        row = await session.get(OAuthHandshake, hashlib.sha256(item.state.encode()).hexdigest())
        assert row.state_hash != item.state and row.binding_hash != item.binding
        assert row.binding_hash == hashlib.sha256(item.binding.encode()).hexdigest()
        for private in (item.state, item.binding, item.nonce, item.verifier, item.return_to):
            assert private not in row.encrypted_payload
    with pytest.raises(ApiError, match="OAUTH_STATE_INVALID"):
        await stores[1].consume(item.state, secrets.token_urlsafe(32))
    consumed = await stores[1].consume(item.state, item.binding)
    assert consumed == item
    with pytest.raises(ApiError, match="OAUTH_STATE_INVALID"):
        await stores[0].consume(item.state, item.binding)


async def test_two_instances_cannot_consume_the_same_oauth_state(shared):
    _, _, stores, create, _ = shared
    item = await create()
    results = await asyncio.gather(
        *(store.consume(item.state, item.binding) for store in stores), return_exceptions=True
    )
    assert sum(isinstance(result, Handshake) for result in results) == 1
    errors = [result for result in results if isinstance(result, ApiError)]
    assert len(errors) == 1 and errors[0].code == "OAUTH_STATE_INVALID"


async def test_expired_or_corrupt_oauth_state_remains_consumed_on_error(shared):
    settings, databases, stores, create, _ = shared
    owner = create_async_engine(settings.migration_database_url.get_secret_value())
    try:
        for corrupt in (False, True):
            item = await create()
            key = hashlib.sha256(item.state.encode()).hexdigest()
            values = (
                {"encrypted_payload": "not-a-valid-encrypted-payload"}
                if corrupt
                else {
                    "created_at": datetime.now(UTC) - timedelta(minutes=11),
                    "expires_at": datetime.now(UTC) - timedelta(minutes=1),
                }
            )
            async with owner.begin() as connection:
                await connection.execute(
                    update(OAuthHandshake).where(OAuthHandshake.state_hash == key).values(**values)
                )
            with pytest.raises(ApiError) as error:
                await stores[1].consume(item.state, item.binding)
            assert error.value.code == ("OAUTH_STATE_INVALID" if corrupt else "OAUTH_STATE_EXPIRED")
            async with databases[0].session(auth=True) as session:
                assert await session.get(OAuthHandshake, key) is None
            with pytest.raises(ApiError, match="OAUTH_STATE_INVALID"):
                await stores[0].consume(item.state, item.binding)
    finally:
        await owner.dispose()


async def test_shared_capacity_is_atomic_across_instances(shared):
    settings, databases, _, _, owned = shared
    async with databases[0].session(auth=True) as session:
        existing = await session.scalar(select(func.count()).select_from(OAuthHandshake))
    stores = [
        PostgresHandshakeBackend(database, settings, capacity=existing + 1)
        for database in databases
    ]
    results = await asyncio.gather(*(store.create("/") for store in stores), return_exceptions=True)
    accepted = [result for result in results if isinstance(result, Handshake)]
    for item in accepted:
        owned.add(hashlib.sha256(item.state.encode()).hexdigest())
    assert len(accepted) == 1
    errors = [result for result in results if isinstance(result, ApiError)]
    assert len(errors) == 1 and errors[0].status_code == 429 and errors[0].code == "LOGIN_BUSY"


async def test_application_role_cannot_read_oauth_state_or_update_it_as_auth(shared):
    _, databases, _, create, _ = shared
    item = await create()
    with pytest.raises(DBAPIError):
        async with databases[0].session() as session:
            await session.execute(select(OAuthHandshake))
    with pytest.raises(DBAPIError):
        async with databases[0].session(auth=True) as session:
            await session.execute(
                update(OAuthHandshake)
                .where(OAuthHandshake.state_hash == hashlib.sha256(item.state.encode()).hexdigest())
                .values(encrypted_payload="must-not-update")
            )


async def test_new_instance_handles_bound_google_cancellation_without_creating_session(shared):
    settings, databases, _, _, owned = shared
    settings = settings.model_copy(
        update={"google_client_id": "test-client", "google_client_secret": SecretStr("test-only")}
    )
    apps = [create_app(settings), create_app(settings)]
    try:
        async with (
            httpx.AsyncClient(
                transport=httpx.ASGITransport(app=apps[0]), base_url=settings.app_origin
            ) as first,
            httpx.AsyncClient(
                transport=httpx.ASGITransport(app=apps[1]), base_url=settings.app_origin
            ) as second,
        ):
            start = await first.get("/api/v1/auth/google/start")
            assert start.status_code == 303
            state = parse_qs(urlsplit(start.headers["location"]).query)["state"][0]
            owned.add(hashlib.sha256(state.encode()).hexdigest())
            binding = first.cookies.get(OAUTH_COOKIE)
            second.cookies.set(OAUTH_COOKIE, binding)
            cancelled = await second.get(
                "/api/v1/auth/google/callback", params={"state": state, "error": "access_denied"}
            )
            assert cancelled.status_code == 303
            assert (
                cancelled.headers["location"]
                == f"{settings.app_origin}/login?error=google_cancelled"
            )
            assert "myschedule_session=" not in cancelled.headers.get("set-cookie", "")
            assert (await second.get("/api/v1/me")).status_code == 401
            replay = await first.get(
                "/api/v1/auth/google/callback", params={"state": state, "error": "access_denied"}
            )
            assert replay.status_code == 400
            assert (await first.get("/api/v1/status")).json()["data"][
                "auth_handshake_storage"
            ] == "postgres"
            assert await databases[0].ready()
    finally:
        for app in apps:
            await app.state.database.close()
