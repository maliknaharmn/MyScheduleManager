"""Note edits and lifecycle use real, isolated owner-scoped Postgres transactions."""

import asyncio
from datetime import UTC, date, datetime
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from test_resources import owner_client

from myschedule.auth import Identity, current_identity, token_hash
from myschedule.models import CalendarConnection, CalendarMapping, NoteDependency, TargetNote

pytestmark = pytest.mark.database


async def create_note(client, headers, **overrides):
    response = await client.post(
        "/api/v1/notes",
        headers=headers,
        json={
            "title": "Siapkan berkas",
            "body": "Paragraf satu.\n\nParagraf dua.",
            "target_start": "2026-11-17",
            "target_end": "2026-11-20",
            "checklist": [{"title": "Periksa"}, {"title": "Kirim"}],
            **overrides,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["data"]


def edit_body(note, **overrides):
    return {
        "expected_version": note["version"],
        **{
            key: note[key]
            for key in ("title", "body", "target_start", "target_end", "is_important")
        },
        "checklist": [{"id": item["id"], "title": item["title"]} for item in note["checklist"]],
        **overrides,
    }


async def test_edit_preserves_checklist_identity_and_completion(account, db_settings):
    app, client, headers = await owner_client(account, db_settings)
    try:
        note = await create_note(client, headers)
        path = f"/api/v1/notes/{note['id']}"
        checked = (
            await client.patch(
                f"{path}/checklist-items/{note['checklist'][0]['id']}",
                headers=headers,
                json={"expected_version": 1, "completed": True},
            )
        ).json()["data"]
        saved = await client.patch(
            path,
            headers=headers,
            json=edit_body(
                checked,
                title="Berkas final",
                body="Baru.\n\nTetap terpisah.",
                is_important=True,
                target_start="2026-11-18",
                target_end="2026-11-21",
                checklist=[
                    {"title": "Langkah baru"},
                    {
                        "id": checked["checklist"][0]["id"],
                        "title": "Sudah diperiksa",
                    },
                ],
            ),
        )
        assert saved.status_code == 200, saved.text
        row = saved.json()["data"]
        assert row["title"] == "Berkas final"
        assert row["body"] == "Baru.\n\nTetap terpisah."
        assert row["target_end"] == "2026-11-21"
        assert row["is_important"] is True
        assert row["version"] == 3
        assert row["created_at"] == note["created_at"]
        assert row["updated_at"] >= checked["updated_at"]
        assert row["completed_items"] == 1 and row["total_items"] == 2
        assert row["checklist"][0]["completed_at"] is None
        assert row["checklist"][1] == {
            **checked["checklist"][0],
            "title": "Sudah diperiksa",
            "position": 1,
        }
        removed_id = note["checklist"][1]["id"]
        assert (
            await client.patch(
                f"{path}/checklist-items/{removed_id}",
                headers=headers,
                json={"expected_version": 3, "completed": True},
            )
        ).status_code == 404
        assert (await client.get(path)).json()["data"] == row
    finally:
        await client.aclose()
        await app.state.database.close()


@pytest.mark.parametrize("invalid", ["foreign", "unknown", "duplicate", "empty", "range"])
async def test_invalid_edits_are_atomic(account, db_settings, invalid):
    app, client, headers = await owner_client(account, db_settings)
    try:
        note = await create_note(client, headers)
        body = edit_body(note, title="Must not persist")
        if invalid == "foreign":
            other = await create_note(client, headers)
            body["checklist"][0]["id"] = other["checklist"][0]["id"]
        elif invalid == "unknown":
            body["checklist"][0]["id"] = str(uuid4())
        elif invalid == "duplicate":
            body["checklist"] *= 2
        elif invalid == "empty":
            body["checklist"][0]["title"] = "   "
        else:
            body["target_end"] = "2026-11-01"
        path = f"/api/v1/notes/{note['id']}"
        result = await client.patch(path, headers=headers, json=body)
        assert result.status_code == 422, result.text
        assert (await client.get(path)).json()["data"] == note
    finally:
        await client.aclose()
        await app.state.database.close()


async def test_complete_reopen_and_soft_delete_preserve_progress(account, db_settings):
    app, client, headers = await owner_client(account, db_settings)
    try:
        note = await create_note(client, headers)
        path = f"/api/v1/notes/{note['id']}"
        assert (
            await client.post(
                f"{path}/reopen",
                headers=headers,
                json={"expected_version": 1},
            )
        ).json()["error"]["code"] == "NOTE_NOT_COMPLETED"
        complete = (
            await client.post(
                f"{path}/complete",
                headers=headers,
                json={
                    "expected_version": 1,
                    "allow_incomplete_checklist": True,
                },
            )
        ).json()["data"]
        assert complete["completed_at"] is not None
        assert complete["completed_items"] == 0
        assert (
            await client.patch(
                path,
                headers=headers,
                json=edit_body(complete),
            )
        ).json()["error"]["code"] == "NOTE_COMPLETED"
        assert (
            await client.patch(
                f"{path}/checklist-items/{note['checklist'][0]['id']}",
                headers=headers,
                json={"expected_version": 2, "completed": True},
            )
        ).json()["error"]["code"] == "NOTE_COMPLETED"
        assert (
            await client.post(
                f"{path}/reopen",
                headers=headers,
                json={"expected_version": 1},
            )
        ).json()["error"]["code"] == "VERSION_CONFLICT"
        reopened = (
            await client.post(
                f"{path}/reopen",
                headers=headers,
                json={"expected_version": 2},
            )
        ).json()["data"]
        assert reopened["completed_at"] is None and reopened["version"] == 3
        assert reopened["checklist"] == note["checklist"]
        assert (
            await client.request(
                "DELETE",
                path,
                headers=headers,
                json={
                    "expected_version": 2,
                },
            )
        ).json()["error"]["code"] == "VERSION_CONFLICT"
        deleted = await client.request(
            "DELETE",
            path,
            headers=headers,
            json={
                "expected_version": 3,
            },
        )
        assert deleted.status_code == 204
        assert (await client.get(path)).status_code == 404
        assert (await client.get("/api/v1/notes?completion=all")).json()["data"]["items"] == []
        assert (
            await client.patch(path, headers=headers, json=edit_body(reopened))
        ).status_code == 404
        async with account.database.session(account.user_id) as session:
            row = await session.get(TargetNote, UUID(note["id"]))
            assert row.deleted_at is not None and row.version == 4
    finally:
        await client.aclose()
        await app.state.database.close()


async def test_concurrent_note_writes_only_one_version_wins(account, db_settings):
    app, client, headers = await owner_client(account, db_settings)
    try:
        note = await create_note(client, headers)
        path = f"/api/v1/notes/{note['id']}"
        results = await asyncio.gather(
            client.patch(path, headers=headers, json=edit_body(note, title="First")),
            client.patch(
                f"{path}/checklist-items/{note['checklist'][0]['id']}",
                headers=headers,
                json={"expected_version": 1, "completed": True},
            ),
        )
        assert sorted(result.status_code for result in results) == [200, 409]
        assert (await client.get(path)).json()["data"]["version"] == 2
    finally:
        await client.aclose()
        await app.state.database.close()


@pytest.mark.parametrize("with_checklist", [False, True])
async def test_checklist_never_implicitly_completes_note(account, db_settings, with_checklist):
    app, client, headers = await owner_client(account, db_settings)
    try:
        note = await create_note(
            client, headers, checklist=[{"title": "Done"}] if with_checklist else []
        )
        path = f"/api/v1/notes/{note['id']}"
        if with_checklist:
            note = (
                await client.patch(
                    f"{path}/checklist-items/{note['checklist'][0]['id']}",
                    headers=headers,
                    json={"expected_version": 1, "completed": True},
                )
            ).json()["data"]
        assert note["completed_at"] is None
        complete = await client.post(
            f"{path}/complete",
            headers=headers,
            json={
                "expected_version": note["version"],
            },
        )
        assert complete.status_code == 200, complete.text
        completed = complete.json()["data"]
        reopened = (
            await client.post(
                f"{path}/reopen",
                headers=headers,
                json={
                    "expected_version": completed["version"],
                },
            )
        ).json()["data"]
        assert reopened["checklist"] == note["checklist"]
        assert reopened["completed_at"] is None
    finally:
        await client.aclose()
        await app.state.database.close()


@pytest.mark.parametrize("action", ["edit", "delete", "complete", "reopen", "toggle"])
async def test_note_mutations_require_csrf_and_owner(account, db_settings, action):
    app, client, headers = await owner_client(account, db_settings)
    try:
        note = await create_note(client, headers)
        path = f"/api/v1/notes/{note['id']}"
        method, body = "POST", {"expected_version": 1}
        if action == "edit":
            method, body = "PATCH", edit_body(note)
        elif action == "delete":
            method = "DELETE"
        elif action == "toggle":
            method, path = "PATCH", f"{path}/checklist-items/{note['checklist'][0]['id']}"
            body["completed"] = True
        else:
            path += f"/{action}"
        denied = await client.request(method, path, json=body)
        assert denied.status_code == 403
        app.dependency_overrides[current_identity] = lambda: Identity(
            uuid4(), uuid4(), "other@example.invalid", "Other", token_hash(account.token)
        )
        foreign = await client.request(method, path, headers=headers, json=body)
        assert foreign.status_code == 404, foreign.text
        app.dependency_overrides.clear()
        assert (await client.get(f"/api/v1/notes/{note['id']}")).json()["data"] == note
        client.cookies.clear()
        assert (await client.request(method, path, headers=headers, json=body)).status_code == 401
    finally:
        await client.aclose()
        await app.state.database.close()


@pytest.mark.parametrize("guard", ["mapping", "dependency"])
async def test_legacy_relationships_guard_unsafe_lifecycle_changes(account, db_settings, guard):
    app, client, headers = await owner_client(account, db_settings)
    try:
        note = await create_note(client, headers, checklist=[])
        path = f"/api/v1/notes/{note['id']}"
        # Calendar rows are worker-owned; seed legacy fixtures with the isolated test owner.
        engine = create_async_engine(db_settings.migration_database_url.get_secret_value())
        try:
            async with async_sessionmaker(engine).begin() as session:
                await seed_legacy_relationship(session, account.user_id, note, guard)
        finally:
            await engine.dispose()
        detail = (await client.get(path)).json()["data"]
        assert detail["has_calendar_mapping"] == (guard == "mapping")
        assert detail["prerequisite_count"] == (1 if guard == "dependency" else 0)
        expected = "REMINDER_NOT_READY" if guard == "mapping" else "NOTE_LINKED"
        result = await client.request("DELETE", path, headers=headers, json={"expected_version": 1})
        assert result.json()["error"]["code"] == expected
        complete = await client.post(
            f"{path}/complete", headers=headers, json={"expected_version": 1}
        )
        assert complete.status_code == 409
        if guard == "mapping":
            assert (
                await client.patch(path, headers=headers, json=edit_body(note))
            ).status_code == 409
        async with account.database.session(account.user_id) as session:
            row = await session.scalar(select(TargetNote).where(TargetNote.id == UUID(note["id"])))
            row.completed_at = datetime.now(UTC)
        reopen = await client.post(f"{path}/reopen", headers=headers, json={"expected_version": 1})
        assert reopen.json()["error"]["code"] == expected
    finally:
        await client.aclose()
        await app.state.database.close()


async def seed_legacy_relationship(session, user_id, note, guard):
    if guard == "mapping":
        connection = CalendarConnection(
            user_id=user_id,
            google_issuer="https://accounts.google.com",
            google_subject=f"test-{uuid4()}",
        )
        session.add(connection)
        await session.flush()
        session.add(
            CalendarMapping(
                user_id=user_id,
                note_id=UUID(note["id"]),
                connection_id=connection.id,
                event_generation=1,
                desired_version=1,
                desired_state="active",
            )
        )
    else:
        prerequisite = TargetNote(
            user_id=user_id,
            title="Prasyarat",
            target_start=date(2026, 11, 17),
            target_end=date(2026, 11, 20),
        )
        session.add(prerequisite)
        await session.flush()
        session.add(
            NoteDependency(
                user_id=user_id,
                note_id=UUID(note["id"]),
                prerequisite_note_id=prerequisite.id,
            )
        )
