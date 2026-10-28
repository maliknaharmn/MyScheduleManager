"""The first usable schedule and note slice for the private workspace.

Overview values come from the domain availability engine, never from UI fixtures.
The Calendar reminder lifecycle and advanced resource editing remain separate work.
"""

from collections.abc import Sequence
from dataclasses import asdict
from datetime import UTC, date, datetime, time, timedelta
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, Response
from pydantic import Field, model_validator
from sqlalchemy import delete, func, select

from myschedule.auth import Identity, assert_csrf, current_identity
from myschedule.domain.availability import Occurrence, Source, availability, expand
from myschedule.domain.schedules import (
    DailyPattern,
    DateOnly,
    ScheduleInput,
    StrictModel,
    TimedInterval,
    local_instant,
    validate_timezone,
)
from myschedule.errors import ApiError, envelope
from myschedule.models import (
    CalendarMapping,
    ChecklistItem,
    NoteDependency,
    Profile,
    Schedule,
    ScheduleReminder,
    ScheduleTag,
    Tag,
    TargetNote,
)
from myschedule.schemas import EnvelopeResponse

router = APIRouter(prefix="/api/v1")
Login = Annotated[Identity, Depends(current_identity)]


class TagView(StrictModel):
    id: UUID
    name: str
    system_key: str | None


class ScheduleView(StrictModel):
    id: UUID
    title: str
    category: str
    status: str
    time: dict
    tags: list[TagView]
    reminder_offsets_minutes: list[int]
    version: int
    created_at: datetime
    updated_at: datetime


class ScheduleList(StrictModel):
    items: list[ScheduleView]
    has_more: bool


class ScheduleUpdate(ScheduleInput):
    expected_version: int = Field(gt=0)


class ScheduleDelete(StrictModel):
    expected_version: int = Field(gt=0)


class DayView(StrictModel):
    date: date
    level: Literal["Free", "Light", "Medium", "Busy"]
    known_scheduled_minutes: int
    is_partial: bool
    unknown_duration_count: int
    occurrence_count: int
    important_occurrence_count: int
    has_conflicts: bool
    occurrences: list[dict]


class WeekView(StrictModel):
    week_start: date
    week_end: date
    timezone: str
    days: list[DayView]


class ReminderInput(StrictModel):
    enabled: bool = False
    local_time: time | None = None
    timezone: str | None = None

    @model_validator(mode="after")
    def valid_reminder(self):
        if self.enabled and (self.local_time is None or self.timezone is None):
            raise ValueError("Waktu dan zona pengingat harus diisi jika pengingat aktif")
        if self.timezone:
            validate_timezone(self.timezone)
        return self


class ChecklistInput(StrictModel):
    title: str = Field(min_length=1, max_length=200)


class NoteInput(StrictModel):
    title: str = Field(min_length=1, max_length=200)
    body: str | None = None
    target_start: date
    target_end: date
    is_important: bool = False
    reminder: ReminderInput = Field(default_factory=ReminderInput)
    checklist: list[ChecklistInput] = Field(default_factory=list, max_length=100)
    prerequisite_note_ids: list[UUID] = Field(default_factory=list)

    @model_validator(mode="after")
    def valid_note(self):
        if self.target_end < self.target_start:
            raise ValueError("Tanggal akhir harus sama atau setelah tanggal mulai")
        if self.prerequisite_note_ids:
            raise ValueError("Prasyarat belum tersedia pada form build ini")
        return self


class ChecklistChange(StrictModel):
    expected_version: int = Field(gt=0)
    completed: bool


class NoteVersion(StrictModel):
    expected_version: int = Field(gt=0)


class CompleteNote(NoteVersion):
    allow_incomplete_checklist: bool = False


class ChecklistEdit(ChecklistInput):
    id: UUID | None = None


class NoteUpdate(NoteVersion):
    title: str = Field(min_length=1, max_length=200)
    body: str | None
    target_start: date
    target_end: date
    is_important: bool
    checklist: list[ChecklistEdit] = Field(max_length=100)

    @model_validator(mode="after")
    def valid_update(self):
        if self.target_end < self.target_start:
            raise ValueError("Tanggal akhir harus sama atau setelah tanggal mulai")
        ids = [item.id for item in self.checklist if item.id is not None]
        if len(ids) != len(set(ids)):
            raise ValueError("ID checklist tidak boleh berulang")
        return self


class NoteView(StrictModel):
    id: UUID
    title: str
    body: str | None
    target_start: date
    target_end: date
    is_important: bool
    completed_at: datetime | None
    version: int
    checklist: list[dict]
    completed_items: int
    total_items: int
    reminder_enabled: bool
    reminder_status: Literal["off", "needs_connection"]
    created_at: datetime
    updated_at: datetime


class NoteDetailView(NoteView):
    prerequisite_count: int
    dependent_count: int
    has_calendar_mapping: bool


class NoteList(StrictModel):
    items: list[NoteView]
    has_more: bool


def schedule_time(row: Schedule) -> dict:
    common = {"mode": row.time_mode, "timezone": row.timezone}
    if row.time_mode == "timed_interval":
        return {**common, "starts_at": row.starts_at, "ends_at": row.ends_at}
    if row.time_mode == "daily_pattern":
        return {
            **common,
            "range_start": row.range_start,
            "range_end": row.range_end,
            "weekdays": row.weekdays,
            "start_local_time": row.start_local_time,
            "end_local_time": row.end_local_time,
            "end_day_offset": row.end_day_offset,
        }
    return {
        **common,
        "range_start": row.range_start,
        "range_end": row.range_end,
        "weekdays": row.weekdays,
    }


def domain_time(row: Schedule):
    value = schedule_time(row)
    if row.time_mode == "timed_interval":
        return TimedInterval.model_validate(value)
    if row.time_mode == "daily_pattern":
        return DailyPattern.model_validate(value)
    return DateOnly.model_validate(value)


async def schedule_view(session, row: Schedule) -> dict:
    return (await schedule_views(session, [row]))[0]


async def schedule_views(session, rows: Sequence[Schedule]) -> list[dict]:
    """Load list relationships in two queries, not two queries per agenda."""
    if not rows:
        return []
    ids = [row.id for row in rows]
    user_id = rows[0].user_id
    tags_by_id = {row.id: [] for row in rows}
    offsets_by_id = {row.id: [] for row in rows}
    tags = await session.execute(
        select(ScheduleTag.schedule_id, Tag)
        .join(ScheduleTag, ScheduleTag.tag_id == Tag.id)
        .where(
            ScheduleTag.schedule_id.in_(ids),
            ScheduleTag.user_id == user_id,
            Tag.user_id == user_id,
        )
        .order_by(Tag.name)
    )
    for schedule_id, tag in tags:
        tags_by_id[schedule_id].append(
            {"id": tag.id, "name": tag.name, "system_key": tag.system_key}
        )
    offsets = await session.execute(
        select(ScheduleReminder.schedule_id, ScheduleReminder.offset_minutes)
        .where(ScheduleReminder.schedule_id.in_(ids), ScheduleReminder.user_id == user_id)
        .order_by(ScheduleReminder.offset_minutes.desc())
    )
    for schedule_id, offset in offsets:
        offsets_by_id[schedule_id].append(offset)
    return [schedule_data(row, tags_by_id[row.id], offsets_by_id[row.id]) for row in rows]


def schedule_data(row: Schedule, tags: list[dict], offsets: list[int]) -> dict:
    return {
        "id": row.id,
        "title": row.title,
        "category": row.category,
        "status": row.status,
        "time": schedule_time(row),
        "tags": tags,
        "reminder_offsets_minutes": offsets,
        "version": row.version,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


async def note_view(session, row: TargetNote) -> dict:
    data = (await note_views(session, [row]))[0]
    links = (
        await session.execute(
            select(NoteDependency.note_id, NoteDependency.prerequisite_note_id).where(
                NoteDependency.user_id == row.user_id,
                (NoteDependency.note_id == row.id)
                | (NoteDependency.prerequisite_note_id == row.id),
            )
        )
    ).all()
    mapping = await session.scalar(
        select(CalendarMapping.id)
        .where(CalendarMapping.user_id == row.user_id, CalendarMapping.note_id == row.id)
        .limit(1)
    )
    return {
        **data,
        "prerequisite_count": sum(note_id == row.id for note_id, _ in links),
        "dependent_count": sum(prerequisite_id == row.id for _, prerequisite_id in links),
        "has_calendar_mapping": mapping is not None,
    }


async def note_views(session, rows: Sequence[TargetNote]) -> list[dict]:
    if not rows:
        return []
    checklist_by_id = {row.id: [] for row in rows}
    checklist = (
        await session.scalars(
            select(ChecklistItem)
            .where(
                ChecklistItem.note_id.in_([row.id for row in rows]),
                ChecklistItem.user_id == rows[0].user_id,
            )
            .order_by(ChecklistItem.position, ChecklistItem.id)
        )
    ).all()
    for item in checklist:
        checklist_by_id[item.note_id].append(item)
    return [note_data(row, checklist_by_id[row.id]) for row in rows]


def note_data(row: TargetNote, checklist: Sequence[ChecklistItem]) -> dict:
    return {
        "id": row.id,
        "title": row.title,
        "body": row.body,
        "target_start": row.target_start,
        "target_end": row.target_end,
        "is_important": row.is_important,
        "completed_at": row.completed_at,
        "version": row.version,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
        "checklist": [
            {
                "id": item.id,
                "title": item.title,
                "position": item.position,
                "completed_at": item.completed_at,
            }
            for item in checklist
        ],
        "completed_items": sum(item.completed_at is not None for item in checklist),
        "total_items": len(checklist),
        "reminder_enabled": row.reminder_enabled,
        "reminder_status": (
            "needs_connection" if row.reminder_enabled and not row.completed_at else "off"
        ),
    }


@router.get("/tags", tags=["schedules"], response_model=EnvelopeResponse[list[TagView]])
async def tags(request: Request, identity: Login):
    async with request.app.state.database.session(identity.user_id) as session:
        rows = (await session.scalars(select(Tag).where(Tag.user_id == identity.user_id))).all()
        return envelope(
            request,
            [{"id": row.id, "name": row.name, "system_key": row.system_key} for row in rows],
        )


@router.get("/schedules", tags=["schedules"], response_model=EnvelopeResponse[ScheduleList])
async def list_schedules(request: Request, identity: Login, limit: int = Query(50, ge=1, le=100)):
    async with request.app.state.database.session(identity.user_id) as session:
        rows = (
            await session.scalars(
                select(Schedule)
                .where(Schedule.user_id == identity.user_id, Schedule.deleted_at.is_(None))
                .order_by(Schedule.created_at.desc(), Schedule.id.desc())
                .limit(limit + 1)
            )
        ).all()
        return envelope(
            request,
            {
                "items": await schedule_views(session, rows[:limit]),
                "has_more": len(rows) > limit,
            },
        )


@router.post(
    "/schedules", status_code=201, tags=["schedules"], response_model=EnvelopeResponse[ScheduleView]
)
async def create_schedule(request: Request, identity: Login, body: ScheduleInput):
    assert_csrf(request, identity)
    async with request.app.state.database.session(identity.user_id) as session:
        if body.tag_ids:
            valid_ids = set(
                (
                    await session.scalars(
                        select(Tag.id).where(
                            Tag.user_id == identity.user_id, Tag.id.in_(body.tag_ids)
                        )
                    )
                ).all()
            )
            if valid_ids != set(body.tag_ids):
                raise ApiError(422, "INVALID_TAG", "Pilih tag yang tersedia di akun ini.")
        value = body.time
        row = Schedule(
            user_id=identity.user_id,
            title=body.title,
            category=body.category,
            status=body.status,
            time_mode=value.mode,
            timezone=value.timezone,
            **schedule_time_fields(value),
        )
        session.add(row)
        await session.flush()
        session.add_all(
            ScheduleTag(user_id=identity.user_id, schedule_id=row.id, tag_id=tag_id)
            for tag_id in body.tag_ids
        )
        session.add_all(
            ScheduleReminder(user_id=identity.user_id, schedule_id=row.id, offset_minutes=offset)
            for offset in body.reminder_offsets_minutes
        )
        await session.flush()
        data = await schedule_view(session, row)
    return envelope(request, data)


def schedule_time_fields(value) -> dict:
    return {
        "starts_at": value.starts_at if isinstance(value, TimedInterval) else None,
        "ends_at": value.ends_at if isinstance(value, TimedInterval) else None,
        "range_start": value.range_start if isinstance(value, (DateOnly, DailyPattern)) else None,
        "range_end": value.range_end if isinstance(value, (DateOnly, DailyPattern)) else None,
        "weekdays": value.weekdays if isinstance(value, (DateOnly, DailyPattern)) else None,
        "start_local_time": value.start_local_time if isinstance(value, DailyPattern) else None,
        "end_local_time": value.end_local_time if isinstance(value, DailyPattern) else None,
        "end_day_offset": value.end_day_offset if isinstance(value, DailyPattern) else None,
    }


async def locked_schedule(session, user_id: UUID, schedule_id: UUID, version: int) -> Schedule:
    row = await session.scalar(
        select(Schedule)
        .where(
            Schedule.id == schedule_id,
            Schedule.user_id == user_id,
            Schedule.deleted_at.is_(None),
        )
        .with_for_update()
    )
    if row is None:
        raise ApiError(404, "SCHEDULE_NOT_FOUND", "Agenda tidak ditemukan.")
    if row.version != version:
        raise ApiError(
            409, "VERSION_CONFLICT", "Agenda berubah di perangkat lain. Muat versi terbaru."
        )
    return row


@router.patch(
    "/schedules/{schedule_id}", tags=["schedules"], response_model=EnvelopeResponse[ScheduleView]
)
async def update_schedule(
    request: Request, identity: Login, schedule_id: UUID, body: ScheduleUpdate
):
    assert_csrf(request, identity)
    async with request.app.state.database.session(identity.user_id) as session:
        row = await locked_schedule(session, identity.user_id, schedule_id, body.expected_version)
        if body.tag_ids:
            valid_ids = set(
                (
                    await session.scalars(
                        select(Tag.id).where(
                            Tag.user_id == identity.user_id, Tag.id.in_(body.tag_ids)
                        )
                    )
                ).all()
            )
            if valid_ids != set(body.tag_ids):
                raise ApiError(422, "INVALID_TAG", "Pilih tag yang tersedia di akun ini.")
        row.title, row.category, row.status = body.title, body.category, body.status
        row.time_mode, row.timezone = body.time.mode, body.time.timezone
        for key, value in schedule_time_fields(body.time).items():
            setattr(row, key, value)
        row.version += 1
        # The parent is locked and everything below commits atomically.
        for model in (ScheduleTag, ScheduleReminder):
            await session.execute(
                delete(model).where(model.user_id == identity.user_id, model.schedule_id == row.id)
            )
        session.add_all(
            ScheduleTag(user_id=identity.user_id, schedule_id=row.id, tag_id=tag_id)
            for tag_id in body.tag_ids
        )
        session.add_all(
            ScheduleReminder(user_id=identity.user_id, schedule_id=row.id, offset_minutes=offset)
            for offset in body.reminder_offsets_minutes
        )
        await session.flush()
        # SQL expression onupdate expires updated_at; load it explicitly in async ORM.
        await session.refresh(row)
        data = await schedule_view(session, row)
    return envelope(request, data)


@router.delete("/schedules/{schedule_id}", status_code=204, tags=["schedules"])
async def delete_schedule(
    request: Request, identity: Login, schedule_id: UUID, body: ScheduleDelete
):
    assert_csrf(request, identity)
    async with request.app.state.database.session(identity.user_id) as session:
        row = await locked_schedule(session, identity.user_id, schedule_id, body.expected_version)
        row.deleted_at = datetime.now(UTC)
        row.version += 1
    return Response(status_code=204)


@router.get(
    "/schedules/{schedule_id}", tags=["schedules"], response_model=EnvelopeResponse[ScheduleView]
)
async def get_schedule(request: Request, identity: Login, schedule_id: UUID):
    async with request.app.state.database.session(identity.user_id) as session:
        row = await session.scalar(
            select(Schedule).where(
                Schedule.id == schedule_id,
                Schedule.user_id == identity.user_id,
                Schedule.deleted_at.is_(None),
            )
        )
        if row is None:
            raise ApiError(404, "SCHEDULE_NOT_FOUND", "Agenda tidak ditemukan.")
        return envelope(request, await schedule_view(session, row))


@router.get("/overview/week", tags=["overview"], response_model=EnvelopeResponse[WeekView])
async def week_overview(
    request: Request, identity: Login, week_start: date, weeks: int = Query(1, ge=1, le=5)
):
    if week_start.isoweekday() != 1:
        raise ApiError(422, "INVALID_WEEK", "Pilih tanggal Senin sebagai awal minggu.")
    # One database scan/authentication round trip can warm a 35-day browser window.
    week_end = week_start + timedelta(days=weeks * 7 - 1)
    async with request.app.state.database.session(identity.user_id) as session:
        profile = await session.get(Profile, identity.user_id)
        if profile is None:
            raise ApiError(503, "PROFILE_UNAVAILABLE", "Profil belum tersedia. Login kembali.")
        # Query a narrow window; the one-day lookback retains overnight tails.
        window_a = local_instant(week_start, time.min, profile.timezone)
        window_b = local_instant(week_end + timedelta(days=1), time.min, profile.timezone)
        rows = (
            await session.scalars(
                select(Schedule).where(
                    Schedule.user_id == identity.user_id,
                    Schedule.deleted_at.is_(None),
                    (
                        (Schedule.time_mode == "timed_interval")
                        & (Schedule.starts_at < window_b)
                        & (Schedule.ends_at > window_a)
                    )
                    | (
                        (Schedule.time_mode != "timed_interval")
                        & (Schedule.range_start <= week_end)
                        & (Schedule.range_end >= week_start - timedelta(days=1))
                    ),
                )
            )
        ).all()
        important_ids = set(
            (
                await session.scalars(
                    select(ScheduleTag.schedule_id)
                    .join(Tag, Tag.id == ScheduleTag.tag_id)
                    .where(Tag.user_id == identity.user_id, Tag.system_key == "important")
                )
            ).all()
        )
        sources = [
            Source(str(row.id), domain_time(row), row.id in important_ids, row.status)
            for row in rows
        ]
        capacities = availability(sources, week_start, week_end, profile.timezone)
        by_id = {str(row.id): row for row in rows}
        occurrences = [
            item
            for source in sources
            for item in expand(source, week_start, week_end, profile.timezone)
        ]
        days = []
        for capacity in capacities:
            start = local_instant(capacity.date, time.min, profile.timezone)
            end = local_instant(capacity.date + timedelta(days=1), time.min, profile.timezone)
            relevant: list[Occurrence] = [
                item
                for item in occurrences
                if item.unknown_date == capacity.date
                or (
                    item.starts_at is not None
                    and item.ends_at is not None
                    and item.starts_at < end
                    and item.ends_at > start
                )
            ]
            relevant.sort(key=lambda item: item.starts_at or start)
            viewed = []
            for item in relevant:
                row = by_id[item.source_id]
                viewed.append(
                    {
                        "occurrence_key": item.key,
                        "schedule_id": row.id,
                        "title": row.title,
                        "category": row.category,
                        "status": row.status,
                        "is_important": item.important,
                        "starts_at": item.starts_at,
                        "ends_at": item.ends_at,
                        "unknown_date": item.unknown_date,
                    }
                )
            days.append({**asdict(capacity), "occurrences": viewed})
        return envelope(
            request,
            {
                "week_start": week_start,
                "week_end": week_end,
                "timezone": profile.timezone,
                "days": days,
            },
        )


@router.get("/notes", tags=["notes"], response_model=EnvelopeResponse[NoteList])
async def list_notes(
    request: Request,
    identity: Login,
    completion: Literal["open", "completed", "all"] = "open",
    limit: int = Query(50, ge=1, le=100),
):
    async with request.app.state.database.session(identity.user_id) as session:
        stmt = select(TargetNote).where(
            TargetNote.user_id == identity.user_id, TargetNote.deleted_at.is_(None)
        )
        if completion == "open":
            stmt = stmt.where(TargetNote.completed_at.is_(None))
        elif completion == "completed":
            stmt = stmt.where(TargetNote.completed_at.is_not(None))
        rows = (
            await session.scalars(
                stmt.order_by(
                    TargetNote.is_important.desc(), TargetNote.target_end, TargetNote.id
                ).limit(limit + 1)
            )
        ).all()
        return envelope(
            request,
            {
                "items": await note_views(session, rows[:limit]),
                "has_more": len(rows) > limit,
            },
        )


@router.post(
    "/notes", status_code=201, tags=["notes"], response_model=EnvelopeResponse[NoteDetailView]
)
async def create_note(request: Request, identity: Login, body: NoteInput):
    assert_csrf(request, identity)
    async with request.app.state.database.session(identity.user_id) as session:
        row = TargetNote(
            user_id=identity.user_id,
            title=body.title,
            body=body.body,
            target_start=body.target_start,
            target_end=body.target_end,
            is_important=body.is_important,
            reminder_enabled=body.reminder.enabled,
            reminder_local_time=body.reminder.local_time,
            reminder_timezone=body.reminder.timezone,
        )
        session.add(row)
        await session.flush()
        session.add_all(
            ChecklistItem(
                user_id=identity.user_id, note_id=row.id, title=item.title, position=index
            )
            for index, item in enumerate(body.checklist)
        )
        await session.flush()
        data = await note_view(session, row)
    return envelope(request, data)


@router.get("/notes/{note_id}", tags=["notes"], response_model=EnvelopeResponse[NoteDetailView])
async def get_note(request: Request, identity: Login, note_id: UUID):
    async with request.app.state.database.session(identity.user_id) as session:
        row = await session.scalar(
            select(TargetNote).where(
                TargetNote.id == note_id,
                TargetNote.user_id == identity.user_id,
                TargetNote.deleted_at.is_(None),
            )
        )
        if row is None:
            raise ApiError(404, "NOTE_NOT_FOUND", "Catatan tidak ditemukan.")
        return envelope(request, await note_view(session, row))


async def locked_note(session, user_id: UUID, note_id: UUID, version: int, *, open_only=False):
    row = await session.scalar(
        select(TargetNote)
        .where(
            TargetNote.id == note_id,
            TargetNote.user_id == user_id,
            TargetNote.deleted_at.is_(None),
        )
        .with_for_update()
    )
    if row is None:
        raise ApiError(404, "NOTE_NOT_FOUND", "Catatan tidak ditemukan.")
    if row.version != version:
        raise ApiError(
            409, "VERSION_CONFLICT", "Catatan berubah di perangkat lain. Muat versi terbaru."
        )
    if open_only and row.completed_at is not None:
        raise ApiError(
            409, "NOTE_COMPLETED", "Buka kembali catatan sebelum mengedit atau mengubah checklist."
        )
    return row


async def ensure_note_unmapped(session, row: TargetNote):
    mapping = await session.scalar(
        select(CalendarMapping.id)
        .where(CalendarMapping.user_id == row.user_id, CalendarMapping.note_id == row.id)
        .limit(1)
    )
    if mapping is not None:
        raise ApiError(
            409,
            "REMINDER_NOT_READY",
            "Catatan memiliki pengingat terkelola. "
            "Perubahan ditahan sampai sinkronisasi Calendar tersedia.",
        )


async def ensure_note_unlinked(session, row: TargetNote):
    link = await session.scalar(
        select(NoteDependency.note_id)
        .where(
            NoteDependency.user_id == row.user_id,
            (NoteDependency.note_id == row.id) | (NoteDependency.prerequisite_note_id == row.id),
        )
        .limit(1)
    )
    if link is not None:
        raise ApiError(
            409,
            "NOTE_LINKED",
            "Catatan masih terhubung sebagai prasyarat. "
            "Hubungan perlu ditinjau sebelum tindakan ini tersedia.",
        )


async def saved_note_view(session, row: TargetNote):
    await session.flush()
    # Explicit refresh for async ORM onupdate timestamps, not an implicit lazy read.
    await session.refresh(row)
    return await note_view(session, row)


@router.patch("/notes/{note_id}", tags=["notes"], response_model=EnvelopeResponse[NoteDetailView])
async def edit_note(request: Request, identity: Login, note_id: UUID, body: NoteUpdate):
    assert_csrf(request, identity)
    async with request.app.state.database.session(identity.user_id) as session:
        row = await locked_note(
            session, identity.user_id, note_id, body.expected_version, open_only=True
        )
        await ensure_note_unmapped(session, row)
        existing = (
            await session.scalars(
                select(ChecklistItem).where(
                    ChecklistItem.note_id == row.id, ChecklistItem.user_id == row.user_id
                )
            )
        ).all()
        by_id = {item.id: item for item in existing}
        retained = {item.id for item in body.checklist if item.id is not None}
        if not retained.issubset(by_id):
            raise ApiError(
                422,
                "INVALID_CHECKLIST_ITEM",
                "Pilih checklist milik catatan ini. "
                "Muat versi terbaru bila checklist sudah berubah.",
            )
        row.title, row.body = body.title, body.body
        row.target_start, row.target_end = body.target_start, body.target_end
        row.is_important = body.is_important
        row.version += 1
        for item in existing:
            if item.id not in retained:
                await session.delete(item)
        for position, item in enumerate(body.checklist):
            if item.id is None:
                session.add(
                    ChecklistItem(
                        user_id=row.user_id, note_id=row.id, title=item.title, position=position
                    )
                )
            else:
                # Preserve identity and completed_at when renaming/reordering an existing step.
                by_id[item.id].title, by_id[item.id].position = item.title, position
        data = await saved_note_view(session, row)
    return envelope(request, data)


@router.delete("/notes/{note_id}", status_code=204, tags=["notes"])
async def delete_note(request: Request, identity: Login, note_id: UUID, body: NoteVersion):
    assert_csrf(request, identity)
    async with request.app.state.database.session(identity.user_id) as session:
        row = await locked_note(session, identity.user_id, note_id, body.expected_version)
        await ensure_note_unmapped(session, row)
        await ensure_note_unlinked(session, row)
        row.deleted_at, row.reminder_enabled = datetime.now(UTC), False
        row.version += 1
    return Response(status_code=204)


@router.post(
    "/notes/{note_id}/reopen", tags=["notes"], response_model=EnvelopeResponse[NoteDetailView]
)
async def reopen_note(request: Request, identity: Login, note_id: UUID, body: NoteVersion):
    assert_csrf(request, identity)
    async with request.app.state.database.session(identity.user_id) as session:
        row = await locked_note(session, identity.user_id, note_id, body.expected_version)
        await ensure_note_unmapped(session, row)
        await ensure_note_unlinked(session, row)
        if row.completed_at is None:
            raise ApiError(409, "NOTE_NOT_COMPLETED", "Catatan ini sudah berstatus belum selesai.")
        row.completed_at = None
        row.version += 1
        data = await saved_note_view(session, row)
    return envelope(request, data)


@router.patch(
    "/notes/{note_id}/checklist-items/{item_id}",
    tags=["notes"],
    response_model=EnvelopeResponse[NoteDetailView],
)
async def update_checklist(
    request: Request, identity: Login, note_id: UUID, item_id: UUID, body: ChecklistChange
):
    assert_csrf(request, identity)
    async with request.app.state.database.session(identity.user_id) as session:
        row = await locked_note(
            session, identity.user_id, note_id, body.expected_version, open_only=True
        )
        item = await session.scalar(
            select(ChecklistItem).where(
                ChecklistItem.id == item_id,
                ChecklistItem.note_id == note_id,
                ChecklistItem.user_id == identity.user_id,
            )
        )
        if item is None:
            raise ApiError(404, "ITEM_NOT_FOUND", "Checklist tidak ditemukan.")
        item.completed_at = datetime.now(UTC) if body.completed else None
        row.version += 1
        data = await saved_note_view(session, row)
    return envelope(request, data)


@router.post(
    "/notes/{note_id}/complete", tags=["notes"], response_model=EnvelopeResponse[NoteDetailView]
)
async def complete_note(request: Request, identity: Login, note_id: UUID, body: CompleteNote):
    assert_csrf(request, identity)
    async with request.app.state.database.session(identity.user_id) as session:
        row = await locked_note(
            session, identity.user_id, note_id, body.expected_version, open_only=True
        )
        dependent = await session.scalar(
            select(NoteDependency.note_id)
            .where(
                NoteDependency.user_id == identity.user_id,
                NoteDependency.note_id == note_id,
            )
            .limit(1)
        )
        if dependent is not None:
            raise ApiError(
                409,
                "DEPENDENCY_REVIEW_REQUIRED",
                "Prasyarat catatan perlu ditinjau sebelum selesai.",
            )
        await ensure_note_unmapped(session, row)
        remaining = await session.scalar(
            select(func.count())
            .select_from(ChecklistItem)
            .where(
                ChecklistItem.user_id == row.user_id,
                ChecklistItem.note_id == row.id,
                ChecklistItem.completed_at.is_(None),
            )
        )
        if remaining and not body.allow_incomplete_checklist:
            raise ApiError(
                409,
                "CHECKLIST_INCOMPLETE",
                "Masih ada langkah yang belum dicentang. Konfirmasi sebelum menyelesaikan catatan.",
                {"remaining_items": remaining},
            )
        row.completed_at = datetime.now(UTC)
        row.version += 1
        data = await saved_note_view(session, row)
    return envelope(request, data)
