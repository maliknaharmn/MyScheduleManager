from datetime import date, time
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import select, text, update
from sqlalchemy.exc import DBAPIError

from myschedule.auth import SESSION_COOKIE
from myschedule.main import create_app
from myschedule.models import CalendarCredential, Profile, Schedule, Tag, TargetNote

pytestmark = pytest.mark.database


async def test_readiness_checks_auth_not_only_resource_database(db_settings):
    settings = db_settings.model_copy(update={"auth_database_url": db_settings.database_url})
    app = create_app(settings)
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            assert (await client.get("/health/live")).status_code == 200
            assert (await client.get("/health/ready")).status_code == 503
    finally:
        await app.state.database.close()


async def test_migration_and_non_owner_runtime_role(account):
    async with account.database.session(account.user_id) as session:
        role = (
            await session.execute(
                text("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user")
            )
        ).one()
        assert role == (False, False)
        profile = await session.get(Profile, account.user_id)
        assert profile.timezone == "Asia/Jakarta"
        assert profile.version == 1
        tags = (await session.scalars(select(Tag))).all()
        assert {tag.system_key for tag in tags} == {"important", "plan", "target"}


async def test_rls_without_context_and_after_pool_reuse(account):
    for context, expected in [(account.user_id, 1), (None, 0), (uuid4(), 0), (account.user_id, 1)]:
        async with account.database.session(context) as session:
            rows = (await session.scalars(select(Profile))).all()
            assert len(rows) == expected


async def test_owner_cannot_insert_or_reassign_foreign_resource(account):
    stranger = uuid4()
    with pytest.raises(DBAPIError):
        async with account.database.session(account.user_id) as session:
            session.add(
                TargetNote(
                    user_id=stranger,
                    title="Foreign",
                    target_start=date(2026, 11, 1),
                    target_end=date(2026, 11, 1),
                )
            )
    async with account.database.session(account.user_id) as session:
        note = TargetNote(
            user_id=account.user_id,
            title="Own",
            target_start=date(2026, 11, 1),
            target_end=date(2026, 11, 1),
        )
        session.add(note)
        await session.flush()
        note_id = note.id
    with pytest.raises(DBAPIError):
        async with account.database.session(account.user_id) as session:
            await session.execute(
                update(TargetNote).where(TargetNote.id == note_id).values(user_id=stranger)
            )


async def test_runtime_cannot_read_credentials_or_system_sessions(account):
    for statement in (
        select(CalendarCredential),
        text("SELECT * FROM sessions"),
        text("SELECT * FROM users"),
    ):
        with pytest.raises(DBAPIError):
            async with account.database.session(account.user_id) as session:
                await session.execute(statement)


async def test_system_tags_are_immutable_for_runtime(account):
    async with account.database.session(account.user_id) as session:
        tag = await session.scalar(select(Tag).where(Tag.system_key == "important"))
        result = await session.execute(update(Tag).where(Tag.id == tag.id).values(name="Renamed"))
        assert result.rowcount == 0
    with pytest.raises(DBAPIError):
        async with account.database.session(account.user_id) as session:
            session.add(
                Tag(user_id=account.user_id, name="Fake", normalized_name="fake", system_key="plan")
            )


@pytest.mark.parametrize("weekdays", [[1, 1], [8], [None], []])
async def test_database_checks_weekdays_not_only_ui(account, weekdays):
    with pytest.raises(DBAPIError):
        async with account.database.session(account.user_id) as session:
            session.add(
                Schedule(
                    user_id=account.user_id,
                    title="Invalid pattern",
                    category="Other",
                    status="Confirmed",
                    time_mode="daily_pattern",
                    timezone="Asia/Jakarta",
                    range_start=date(2026, 11, 1),
                    range_end=date(2026, 11, 30),
                    weekdays=weekdays,
                    start_local_time=time(8),
                    end_local_time=time(10),
                    end_day_offset=0,
                )
            )


async def test_me_csrf_profile_concurrency_and_logout(account, db_settings):
    app = create_app(db_settings)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url=db_settings.app_origin) as client:
        client.cookies.set(SESSION_COOKIE, account.token)
        me = await client.get("/api/v1/me")
        assert me.status_code == 200
        data = me.json()["data"]
        assert data["user"]["id"] == str(account.user_id)
        assert data["profile"]["version"] == 1
        assert "google_subject" not in me.text and "token_hash" not in me.text
        body = {"expected_version": 1, "daily_reminder_time": "09:00"}
        assert (await client.patch("/api/v1/me/profile", json=body)).status_code == 403
        headers = {"Origin": db_settings.app_origin, "X-CSRF-Token": data["csrf_token"]}
        updated = await client.patch("/api/v1/me/profile", json=body, headers=headers)
        assert updated.status_code == 200
        assert updated.json()["data"]["version"] == 2
        conflict = await client.patch("/api/v1/me/profile", json=body, headers=headers)
        assert conflict.status_code == 409
        assert conflict.json()["error"]["details"]["current_version"] == 2
        assert (await client.post("/api/v1/auth/logout", headers=headers)).status_code == 204
        assert (await client.get("/api/v1/me")).status_code == 401
        client.cookies.set(SESSION_COOKIE, account.token)
        assert (await client.get("/api/v1/me")).status_code == 401
    await app.state.database.close()
