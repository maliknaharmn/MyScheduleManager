"""The first workspace slice uses real owner-scoped Postgres rows."""

import asyncio
from datetime import UTC, date, datetime
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import event, select

from myschedule.auth import SESSION_COOKIE, Identity, current_identity, token_hash
from myschedule.main import create_app
from myschedule.models import (
    ChecklistItem,
    Schedule,
    ScheduleReminder,
    ScheduleTag,
    Tag,
    TargetNote,
)

pytestmark = pytest.mark.database


async def owner_client(account, db_settings):
    app = create_app(db_settings)
    client = httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url=db_settings.app_origin
    )
    client.cookies.set(SESSION_COOKIE, account.token)
    me = (await client.get("/api/v1/me")).json()["data"]
    headers = {"Origin": db_settings.app_origin, "X-CSRF-Token": me["csrf_token"]}
    return app, client, headers


@pytest.mark.parametrize("relationships", [False, True])
async def test_schedule_save_does_not_reread_just_written_relationships(
    account, db_settings, relationships
):
    app, client, headers = await owner_client(account, db_settings)
    statements = []

    def record(connection, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    try:
        tags = (await client.get("/api/v1/tags")).json()["data"]
        body = agenda_body()
        body["tag_ids"] = [row["id"] for row in tags] if relationships else []
        body["reminder_offsets_minutes"] = [60, 1440] if relationships else []
        engines = [
            app.state.database.engine.sync_engine,
            app.state.database.auth_engine.sync_engine,
        ]
        for engine in engines:
            event.listen(engine, "before_cursor_execute", record)
        try:
            response = await client.post("/api/v1/schedules", json=body, headers=headers)
        finally:
            for engine in engines:
                event.remove(engine, "before_cursor_execute", record)
        assert response.status_code == 201, response.text
        # Auth SELECT + RLS set_config + INSERT; relationships add only validation and writes.
        assert len(statements) == (6 if relationships else 3)
        assert not any(
            statement.lstrip().upper().startswith("SELECT")
            and ("schedule_tags" in statement or "schedule_reminders" in statement)
            for statement in statements
        )
        saved = response.json()["data"]
        expected_tags = sorted(tags, key=lambda row: row["name"]) if relationships else []
        assert saved["tags"] == expected_tags
        assert saved["reminder_offsets_minutes"] == ([1440, 60] if relationships else [])
        # The success response is sent only after the transaction has committed.
        assert (await client.get(f"/api/v1/schedules/{saved['id']}")).json()["data"] == saved
    finally:
        await client.aclose()
        await app.state.database.close()


async def test_week_capacity_uses_union_unknown_and_important(account, db_settings):
    app, client, headers = await owner_client(account, db_settings)
    try:
        tag_rows = (await client.get("/api/v1/tags")).json()["data"]
        important = next(row["id"] for row in tag_rows if row["system_key"] == "important")
        for title, start, end, tags in (
            ("Agenda A", "09:00", "12:00", [important]),
            ("Agenda B", "10:00", "14:00", []),
        ):
            response = await client.post(
                "/api/v1/schedules",
                headers=headers,
                json={
                    "title": title,
                    "category": "Work",
                    "status": "Confirmed",
                    "time": {
                        "mode": "daily_pattern",
                        "timezone": "Asia/Jakarta",
                        "range_start": "2026-11-16",
                        "range_end": "2026-11-16",
                        "weekdays": [1],
                        "start_local_time": start,
                        "end_local_time": end,
                        "end_day_offset": 0,
                    },
                    "tag_ids": tags,
                    "reminder_offsets_minutes": [],
                },
            )
            assert response.status_code == 201, response.text
        response = await client.post(
            "/api/v1/schedules",
            headers=headers,
            json={
                "title": "Jam belum pasti",
                "category": "Other",
                "status": "Tentative",
                "time": {
                    "mode": "date_only",
                    "timezone": "Asia/Jakarta",
                    "range_start": "2026-11-16",
                    "range_end": "2026-11-16",
                },
                "tag_ids": [],
                "reminder_offsets_minutes": [],
            },
        )
        assert response.status_code == 201, response.text
        week = await client.get("/api/v1/overview/week?week_start=2026-11-16")
        assert week.status_code == 200, week.text
        monday = week.json()["data"]["days"][0]
        assert monday["level"] == "Light"
        assert monday["known_scheduled_minutes"] == 300
        assert monday["is_partial"] is True
        assert monday["unknown_duration_count"] == 1
        assert monday["has_conflicts"] is True
        assert monday["important_occurrence_count"] == 1
        assert len(monday["occurrences"]) == 3
        assert (await client.get("/api/v1/overview/week?week_start=2026-11-17")).status_code == 422
    finally:
        await client.aclose()
        await app.state.database.close()


async def test_note_progress_and_completion_are_explicit(account, db_settings):
    app, client, headers = await owner_client(account, db_settings)
    try:
        created = await client.post(
            "/api/v1/notes",
            headers=headers,
            json={
                "title": "Siapkan berkas",
                "target_start": "2026-11-17",
                "target_end": "2026-11-20",
                "is_important": True,
                "reminder": {"enabled": False},
                "checklist": [{"title": "Periksa formulir"}, {"title": "Cetak dokumen"}],
                "prerequisite_note_ids": [],
            },
        )
        assert created.status_code == 201, created.text
        note = created.json()["data"]
        assert note["completed_items"] == 0
        assert note["total_items"] == 2
        assert note["completed_at"] is None
        assert (await client.get("/api/v1/notes")).json()["data"]["items"][0]["id"] == note["id"]
        toggled = await client.patch(
            f"/api/v1/notes/{note['id']}/checklist-items/{note['checklist'][0]['id']}",
            headers=headers,
            json={"expected_version": note["version"], "completed": True},
        )
        assert toggled.status_code == 200, toggled.text
        progress = toggled.json()["data"]
        assert progress["completed_items"] == 1
        assert progress["completed_at"] is None
        stale = await client.post(
            f"/api/v1/notes/{note['id']}/complete",
            headers=headers,
            json={"expected_version": note["version"]},
        )
        assert stale.status_code == 409
        incomplete = await client.post(
            f"/api/v1/notes/{note['id']}/complete",
            headers=headers,
            json={"expected_version": progress["version"]},
        )
        assert incomplete.status_code == 409
        assert incomplete.json()["error"]["code"] == "CHECKLIST_INCOMPLETE"
        complete = await client.post(
            f"/api/v1/notes/{note['id']}/complete",
            headers=headers,
            json={"expected_version": progress["version"], "allow_incomplete_checklist": True},
        )
        assert complete.status_code == 200, complete.text
        assert complete.json()["data"]["completed_at"] is not None
        assert (await client.get("/api/v1/notes")).json()["data"]["items"] == []
    finally:
        await client.aclose()
        await app.state.database.close()


async def test_new_private_endpoints_reject_unauthenticated_access():
    app = create_app()
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            for path in (
                "/api/v1/schedules",
                "/api/v1/notes",
                "/api/v1/overview/week?week_start=2026-11-16",
                "/api/v1/overview/month?month_start=2026-11-01",
            ):
                assert (await client.get(path)).status_code == 401
    finally:
        await app.state.database.close()


async def test_list_queries_stay_constant_and_keep_relationships_scoped(account, db_settings):
    app, client, _ = await owner_client(account, db_settings)
    day = date(2026, 11, 16)
    try:
        async with account.database.session(account.user_id) as session:
            important = await session.scalar(
                select(Tag).where(Tag.user_id == account.user_id, Tag.system_key == "important")
            )
            schedules = [
                Schedule(
                    user_id=account.user_id,
                    title=f"Agenda {index}",
                    category="Work",
                    status="Confirmed",
                    time_mode="date_only",
                    timezone="Asia/Jakarta",
                    range_start=day,
                    range_end=day,
                )
                for index in range(100)
            ]
            notes = [
                TargetNote(
                    user_id=account.user_id,
                    title=f"Catatan {index}",
                    target_start=day,
                    target_end=day,
                )
                for index in range(100)
            ]
            session.add_all([*schedules, *notes])
            await session.flush()
            session.add_all(
                [
                    ScheduleTag(
                        user_id=account.user_id, schedule_id=schedules[0].id, tag_id=important.id
                    ),
                    ScheduleReminder(
                        user_id=account.user_id, schedule_id=schedules[0].id, offset_minutes=60
                    ),
                    ScheduleReminder(
                        user_id=account.user_id, schedule_id=schedules[0].id, offset_minutes=1440
                    ),
                    ChecklistItem(
                        user_id=account.user_id, note_id=notes[0].id, title="Kedua", position=1
                    ),
                    ChecklistItem(
                        user_id=account.user_id, note_id=notes[0].id, title="Pertama", position=0
                    ),
                ]
            )

        statements = []

        def count_selects(connection, cursor, statement, parameters, context, executemany):
            if statement.lstrip().upper().startswith("SELECT"):
                statements.append(statement)

        engine = app.state.database.engine.sync_engine
        event.listen(engine, "before_cursor_execute", count_selects)
        try:
            # Includes one transaction-scoped RLS set_config SELECT, excludes auth engine.
            response = await client.get("/api/v1/schedules?limit=100")
            assert response.status_code == 200, response.text
            assert len(statements) == 4
            data = response.json()["data"]
            assert len(data["items"]) == 100
            assert data["has_more"] is False
            by_id = {row["id"]: row for row in data["items"]}
            tagged = by_id[str(schedules[0].id)]
            assert [tag["id"] for tag in tagged["tags"]] == [str(important.id)]
            assert tagged["reminder_offsets_minutes"] == [1440, 60]
            assert all(
                row["tags"] == [] and row["reminder_offsets_minutes"] == []
                for row in data["items"]
                if row["id"] != str(schedules[0].id)
            )
            statements.clear()
            response = await client.get("/api/v1/notes?limit=100")
            assert response.status_code == 200, response.text
            assert len(statements) == 3
            data = response.json()["data"]
            assert len(data["items"]) == 100
            by_id = {row["id"]: row for row in data["items"]}
            assert [item["title"] for item in by_id[str(notes[0].id)]["checklist"]] == [
                "Pertama",
                "Kedua",
            ]
            assert by_id[str(notes[0].id)]["total_items"] == 2
            assert all(
                row["total_items"] == 0 for row in data["items"] if row["id"] != str(notes[0].id)
            )
            # Limits and has_more must still work with batched relationship loading.
            assert (await client.get("/api/v1/schedules?limit=1")).json()["data"]["has_more"]
            assert (await client.get("/api/v1/notes?limit=1")).json()["data"]["has_more"]
        finally:
            event.remove(engine, "before_cursor_execute", count_selects)
    finally:
        await client.aclose()
        await app.state.database.close()


def agenda_body():
    return {
        "title": "Rapat awal",
        "category": "Work",
        "status": "Confirmed",
        "time": {
            "mode": "daily_pattern",
            "timezone": "Asia/Jakarta",
            "range_start": "2026-11-16",
            "range_end": "2026-12-20",
            "weekdays": [1],
            "start_local_time": "09:00",
            "end_local_time": "10:00",
            "end_day_offset": 0,
        },
        "tag_ids": [],
        "reminder_offsets_minutes": [60],
    }


async def test_edit_delete_are_versioned_atomic_and_update_capacity(account, db_settings):
    app, client, headers = await owner_client(account, db_settings)
    try:
        original = agenda_body()
        created = await client.post("/api/v1/schedules", json=original, headers=headers)
        assert created.status_code == 201, created.text
        row = created.json()["data"]
        path = f"/api/v1/schedules/{row['id']}"
        changed = {**original, "title": "Rapat diperbarui", "expected_version": 1}
        changed["time"] = {**original["time"], "end_local_time": "11:00"}
        assert (await client.patch(path, json=changed)).status_code == 403
        response = await client.patch(path, json=changed, headers=headers)
        assert response.status_code == 200, response.text
        assert response.json()["data"]["version"] == 2
        assert response.json()["data"]["title"] == "Rapat diperbarui"
        assert response.json()["data"]["reminder_offsets_minutes"] == [60]
        assert (await client.patch(path, json=changed, headers=headers)).status_code == 409
        invalid = {**changed, "expected_version": 2, "tag_ids": [str(uuid4())]}
        assert (await client.patch(path, json=invalid, headers=headers)).status_code == 422
        assert (await client.get(path)).json()["data"]["version"] == 2
        week = (await client.get("/api/v1/overview/week?week_start=2026-11-16")).json()["data"]
        assert week["days"][0]["known_scheduled_minutes"] == 120
        assert week["days"][0]["occurrences"][0]["title"] == "Rapat diperbarui"
        assert (
            await client.request("DELETE", path, json={"expected_version": 2})
        ).status_code == 403
        stale = await client.request("DELETE", path, json={"expected_version": 1}, headers=headers)
        assert stale.status_code == 409
        removed = await client.request(
            "DELETE", path, json={"expected_version": 2}, headers=headers
        )
        assert removed.status_code == 204
        assert removed.content == b""
        assert (await client.get(path)).status_code == 404
        assert (await client.get("/api/v1/schedules")).json()["data"]["items"] == []
        window = (await client.get("/api/v1/overview/week?week_start=2026-11-16&weeks=5")).json()[
            "data"
        ]
        assert len(window["days"]) == 35
        assert all(day["occurrence_count"] == 0 for day in window["days"])
        async with account.database.session(account.user_id) as session:
            deleted = await session.get(Schedule, row["id"])
            assert deleted.deleted_at is not None
            assert deleted.version == 3
    finally:
        await client.aclose()
        await app.state.database.close()


async def test_edit_can_switch_time_modes_without_leaking_old_fields(account, db_settings):
    app, client, headers = await owner_client(account, db_settings)
    try:
        body = agenda_body()
        row = (await client.post("/api/v1/schedules", json=body, headers=headers)).json()["data"]
        body.update(
            expected_version=1,
            time={
                "mode": "all_day",
                "timezone": "Asia/Jakarta",
                "range_start": "2026-11-18",
                "range_end": "2026-11-18",
            },
            reminder_offsets_minutes=[],
        )
        response = await client.patch(f"/api/v1/schedules/{row['id']}", json=body, headers=headers)
        assert response.status_code == 200, response.text
        updated = response.json()["data"]
        assert updated["time"]["mode"] == "all_day"
        assert "start_local_time" not in updated["time"]
        assert updated["reminder_offsets_minutes"] == []
    finally:
        await client.aclose()
        await app.state.database.close()


async def test_agenda_mutations_cannot_access_another_owner(account, db_settings):
    app, client, headers = await owner_client(account, db_settings)
    try:
        body = agenda_body()
        row = (await client.post("/api/v1/schedules", json=body, headers=headers)).json()["data"]
        # Auth dependency is isolated here to test the resource/RLS boundary independently.
        app.dependency_overrides[current_identity] = lambda: Identity(
            uuid4(), uuid4(), "test@example.invalid", "Another account", token_hash(account.token)
        )
        path = f"/api/v1/schedules/{row['id']}"
        assert (
            await client.patch(path, json={**body, "expected_version": 1}, headers=headers)
        ).status_code == 404
        assert (
            await client.request("DELETE", path, json={"expected_version": 1}, headers=headers)
        ).status_code == 404
        app.dependency_overrides.clear()
        assert (await client.get(path)).json()["data"]["version"] == 1
        client.cookies.clear()
        assert (
            await client.patch(path, json={**body, "expected_version": 1}, headers=headers)
        ).status_code == 401
        assert (
            await client.request("DELETE", path, json={"expected_version": 1}, headers=headers)
        ).status_code == 401
    finally:
        await client.aclose()
        await app.state.database.close()


async def test_five_week_window_matches_individual_weeks(account, db_settings, monkeypatch):
    app, client, headers = await owner_client(account, db_settings)
    try:
        await client.post("/api/v1/schedules", json=agenda_body(), headers=headers)
        from myschedule import resources

        original_expand = resources.expand
        expanded = []

        def record_expand(*args):
            expanded.append(args[0].id)
            return original_expand(*args)

        monkeypatch.setattr(resources, "expand", record_expand)
        response = await client.get("/api/v1/overview/week?week_start=2026-11-16&weeks=5")
        assert response.status_code == 200, response.text
        assert len(expanded) == 1
        window = response.json()["data"]
        assert window["week_end"] == "2026-12-20"
        assert len(window["days"]) == 35
        assert sum(day["occurrence_count"] for day in window["days"]) == 5
        for index in range(0, 35, 7):
            start = window["days"][index]["date"]
            single = (await client.get(f"/api/v1/overview/week?week_start={start}")).json()["data"]
            assert single["days"] == window["days"][index : index + 7]
        assert (
            await client.get("/api/v1/overview/week?week_start=2026-11-16&weeks=6")
        ).status_code == 422
    finally:
        await client.aclose()
        await app.state.database.close()


async def test_concurrent_agenda_edits_only_accept_one_expected_version(account, db_settings):
    app, client, headers = await owner_client(account, db_settings)
    try:
        body = agenda_body()
        row = (await client.post("/api/v1/schedules", json=body, headers=headers)).json()["data"]
        path = f"/api/v1/schedules/{row['id']}"
        results = await asyncio.gather(
            client.patch(
                path, json={**body, "title": "Perubahan A", "expected_version": 1}, headers=headers
            ),
            client.patch(
                path, json={**body, "title": "Perubahan B", "expected_version": 1}, headers=headers
            ),
        )
        assert sorted(response.status_code for response in results) == [200, 409]
        assert (await client.get(path)).json()["data"]["version"] == 2
    finally:
        await client.aclose()
        await app.state.database.close()


def freeze_agenda_clock(monkeypatch, value="2026-11-16T03:00:00+00:00"):
    from myschedule import resources

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime.fromisoformat(value).astimezone(tz or UTC)

    monkeypatch.setattr(resources, "datetime", Clock)


async def test_upcoming_filter_keeps_ongoing_and_future_without_deleting_history(
    account, db_settings, monkeypatch
):
    freeze_agenda_clock(monkeypatch)
    app, client, headers = await owner_client(account, db_settings)
    pattern = {**agenda_body()["time"], "range_end": "2026-11-16"}
    cases = [
        ("Selesai tepat sekarang", pattern, False),
        ("Masih berlangsung", {**pattern, "end_local_time": "11:00"}, True),
        (
            "Nanti hari ini",
            {**pattern, "start_local_time": "11:00", "end_local_time": "12:00"},
            True,
        ),
        ("Berulang pekan depan", {**pattern, "range_end": "2026-11-23"}, True),
        (
            "Hari berulang terakhir sudah lewat",
            {**pattern, "range_start": "2026-11-14", "range_end": "2026-11-17", "weekdays": [6]},
            False,
        ),
        (
            "Ekor lintas tengah malam",
            {
                **pattern,
                "range_start": "2026-11-15",
                "range_end": "2026-11-15",
                "weekdays": [7],
                "start_local_time": "23:00",
                "end_local_time": "11:00",
                "end_day_offset": 1,
            },
            True,
        ),
        (
            "Interval selesai",
            {
                "mode": "timed_interval",
                "timezone": "Asia/Jakarta",
                "starts_at": "2026-11-15T23:00:00+07:00",
                "ends_at": "2026-11-16T10:00:00+07:00",
            },
            False,
        ),
        (
            "Interval berlangsung",
            {
                "mode": "timed_interval",
                "timezone": "Asia/Jakarta",
                "starts_at": "2026-11-15T23:00:00+07:00",
                "ends_at": "2026-11-16T11:00:00+07:00",
            },
            True,
        ),
    ]
    for mode in ("date_only", "all_day"):
        for day, zone, active in (
            ("2026-11-16", "Asia/Jakarta", True),
            ("2026-11-15", "Asia/Jakarta", False),
            ("2026-11-15", "America/Los_Angeles", True),
            ("2026-11-15", "Pacific/Kiritimati", False),
        ):
            cases.append(
                (
                    f"{mode} {day} {zone}",
                    {"mode": mode, "timezone": zone, "range_start": day, "range_end": day},
                    active,
                )
            )
        cases.append(
            (
                f"{mode} hari berulang terakhir sudah lewat",
                {
                    "mode": mode,
                    "timezone": "Asia/Jakarta",
                    "range_start": "2026-11-14",
                    "range_end": "2026-11-17",
                    "weekdays": [6],
                },
                False,
            )
        )
    try:
        saved = {}
        for title, time_value, _ in cases:
            response = await client.post(
                "/api/v1/schedules",
                json={**agenda_body(), "title": title, "time": time_value},
                headers=headers,
            )
            assert response.status_code == 201, response.text
            saved[title] = response.json()["data"]
        response = await client.get("/api/v1/schedules?upcoming=true&limit=100")
        assert response.status_code == 200, response.text
        assert response.headers["cache-control"] == "no-store"
        upcoming = response.json()["data"]
        assert {row["title"] for row in upcoming["items"]} == {
            title for title, _, active in cases if active
        }
        assert upcoming["has_more"] is False
        history = (await client.get("/api/v1/schedules?limit=100")).json()["data"]["items"]
        assert len(history) == len(cases)
        # History is unchanged, still addressable, and still contributes to its old date.
        ended = saved["Selesai tepat sekarang"]
        assert (await client.get(f"/api/v1/schedules/{ended['id']}")).json()["data"] == ended
        week = (await client.get("/api/v1/overview/week?week_start=2026-11-16")).json()["data"]
        assert ended["id"] in {item["schedule_id"] for item in week["days"][0]["occurrences"]}
        app.dependency_overrides[current_identity] = lambda: Identity(
            uuid4(), uuid4(), "other@example.invalid", "Another account", token_hash(account.token)
        )
        isolated = (await client.get("/api/v1/schedules?upcoming=true")).json()["data"]
        assert isolated == {"items": [], "has_more": False}
    finally:
        await client.aclose()
        await app.state.database.close()


async def test_upcoming_filters_before_limit_and_keeps_relationship_queries_bounded(
    account, db_settings, monkeypatch
):
    freeze_agenda_clock(monkeypatch)
    app, client, headers = await owner_client(account, db_settings)
    try:
        future = (
            await client.post("/api/v1/schedules", json=agenda_body(), headers=headers)
        ).json()["data"]
        async with account.database.session(account.user_id) as session:
            session.add_all(
                Schedule(
                    user_id=account.user_id,
                    title=f"Riwayat {index}",
                    category="Work",
                    status="Confirmed",
                    time_mode="date_only",
                    timezone="Asia/Jakarta",
                    range_start=date(2020, 1, 1),
                    range_end=date(2020, 1, 1),
                )
                for index in range(105)
            )
        statements = []

        def record(connection, cursor, statement, parameters, context, executemany):
            statements.append(statement)

        engine = app.state.database.engine.sync_engine
        event.listen(engine, "before_cursor_execute", record)
        try:
            response = await client.get("/api/v1/schedules?upcoming=true&limit=1")
        finally:
            event.remove(engine, "before_cursor_execute", record)
        assert response.status_code == 200, response.text
        assert len(statements) == 4  # RLS + list + batched tags/reminders; no per-agenda queries.
        assert response.json()["data"] == {"items": [future], "has_more": False}
        await client.post("/api/v1/schedules", json=agenda_body(), headers=headers)
        assert (await client.get("/api/v1/schedules?upcoming=true&limit=1")).json()["data"][
            "has_more"
        ]
        assert (await client.get("/api/v1/schedules?upcoming=invalid")).status_code == 422
    finally:
        await client.aclose()
        await app.state.database.close()


@pytest.mark.parametrize(
    ("month", "first", "last"),
    [
        ("2026-11-01", "2026-10-26", "2026-12-06"),
        ("2028-02-01", "2028-01-31", "2028-03-12"),
        ("2026-12-01", "2026-11-30", "2027-01-10"),
    ],
)
async def test_calendar_month_is_six_monday_first_weeks(account, db_settings, month, first, last):
    app, client, _ = await owner_client(account, db_settings)
    try:
        response = await client.get(f"/api/v1/overview/month?month_start={month}")
        assert response.status_code == 200, response.text
        assert response.headers["cache-control"] == "no-store"
        data = response.json()["data"]
        assert data["month_start"] == month
        assert data["week_start"] == first
        assert data["week_end"] == last
        assert data["timezone"] == "Asia/Jakarta"
        assert len(data["days"]) == 42
        assert all(day["occurrence_count"] == 0 for day in data["days"])
        for invalid in ("2026-11-05", "bad-date", "9999-12-01"):
            assert (
                await client.get(f"/api/v1/overview/month?month_start={invalid}")
            ).status_code == 422
    finally:
        await client.aclose()
        await app.state.database.close()


async def test_calendar_month_retains_history_matches_capacity_and_is_owner_scoped(
    account, db_settings, monkeypatch
):
    freeze_agenda_clock(monkeypatch)
    app, client, headers = await owner_client(account, db_settings)
    try:
        body = agenda_body()
        body["time"] = {
            **body["time"],
            "range_start": "2026-11-01",
            "range_end": "2026-11-01",
            "weekdays": [7],
            "start_local_time": "23:00",
            "end_local_time": "02:00",
            "end_day_offset": 1,
        }
        saved = (await client.post("/api/v1/schedules", json=body, headers=headers)).json()["data"]
        assert (await client.get("/api/v1/schedules?upcoming=true")).json()["data"]["items"] == []
        statements = []

        def record(connection, cursor, statement, parameters, context, executemany):
            statements.append(statement)

        engine = app.state.database.engine.sync_engine
        event.listen(engine, "before_cursor_execute", record)
        try:
            response = await client.get("/api/v1/overview/month?month_start=2026-11-01")
        finally:
            event.remove(engine, "before_cursor_execute", record)
        assert response.status_code == 200, response.text
        assert len(statements) == 4  # RLS + profile + bounded scan + batched Important IDs.
        data = response.json()["data"]
        by_date = {day["date"]: day for day in data["days"]}
        assert by_date["2026-11-01"]["known_scheduled_minutes"] == 60
        assert by_date["2026-11-02"]["known_scheduled_minutes"] == 120
        for day in ("2026-11-01", "2026-11-02"):
            assert by_date[day]["occurrences"][0]["schedule_id"] == saved["id"]
        for index in range(0, 42, 7):
            start = data["days"][index]["date"]
            week = (await client.get(f"/api/v1/overview/week?week_start={start}")).json()["data"]
            assert week["days"] == data["days"][index : index + 7]
        app.dependency_overrides[current_identity] = lambda: Identity(
            uuid4(), uuid4(), "other@example.invalid", "Another account", token_hash(account.token)
        )
        # A different account without a profile fails closed; it never sees this history.
        assert (
            await client.get("/api/v1/overview/month?month_start=2026-11-01")
        ).status_code == 503
        app.dependency_overrides.clear()
        assert (await client.get(f"/api/v1/schedules/{saved['id']}")).json()["data"] == saved
        await client.request(
            "DELETE",
            f"/api/v1/schedules/{saved['id']}",
            json={"expected_version": 1},
            headers=headers,
        )
        cleared = (await client.get("/api/v1/overview/month?month_start=2026-11-01")).json()["data"]
        assert all(day["occurrence_count"] == 0 for day in cleared["days"])
    finally:
        await client.aclose()
        await app.state.database.close()
