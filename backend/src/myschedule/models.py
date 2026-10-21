"""Persistence models; API responses must use separate public schemas."""

from datetime import date, datetime, time
from uuid import UUID, uuid4

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    LargeBinary,
    MetaData,
    SmallInteger,
    String,
    Text,
    Time,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    metadata = MetaData(
        naming_convention={
            "ix": "ix_%(table_name)s_%(column_0_name)s",
            "uq": "uq_%(table_name)s_%(column_0_N_name)s",
            "ck": "ck_%(table_name)s_%(constraint_name)s",
            "fk": "fk_%(table_name)s_%(column_0_N_name)s_%(referred_table_name)s",
            "pk": "pk_%(table_name)s",
        }
    )


class Timestamps:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class User(Timestamps, Base):
    __tablename__ = "users"
    __table_args__ = (UniqueConstraint("google_issuer", "google_subject"),)

    id: Mapped[UUID] = mapped_column(PGUUID, primary_key=True, default=uuid4)
    google_issuer: Mapped[str] = mapped_column(Text)
    google_subject: Mapped[str] = mapped_column(Text)
    email: Mapped[str] = mapped_column(Text)
    display_name: Mapped[str | None] = mapped_column(Text)
    disabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Profile(Timestamps, Base):
    __tablename__ = "profiles"
    __table_args__ = (CheckConstraint("version > 0", name="positive_version"),)

    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"), primary_key=True)
    timezone: Mapped[str] = mapped_column(Text, server_default="Asia/Jakarta")
    daily_reminder_time: Mapped[time] = mapped_column(Time, server_default="08:00")
    version: Mapped[int] = mapped_column(BigInteger, server_default="1")


class AppSession(Base):
    __tablename__ = "sessions"
    __table_args__ = (
        CheckConstraint("expires_at > created_at", name="valid_lifetime"),
        Index("ix_sessions_expires_at", "expires_at"),
        Index("ix_sessions_user_id", "user_id"),
    )

    id: Mapped[UUID] = mapped_column(PGUUID, primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class Schedule(Timestamps, Base):
    __tablename__ = "schedules"
    __table_args__ = (
        UniqueConstraint("user_id", "id"),
        CheckConstraint("length(btrim(title)) BETWEEN 1 AND 200", name="title_length"),
        CheckConstraint(
            "category IN ('Work','Academic','Business','Organization','Personal','Social','Other')",
            name="category_values",
        ),
        CheckConstraint("status IN ('Confirmed','Tentative')", name="status_values"),
        CheckConstraint("version > 0", name="positive_version"),
        CheckConstraint(
            "(time_mode = 'timed_interval' AND starts_at IS NOT NULL AND ends_at IS NOT NULL "
            "AND ends_at > starts_at AND range_start IS NULL AND range_end IS NULL "
            "AND weekdays IS NULL AND start_local_time IS NULL AND end_local_time IS NULL "
            "AND end_day_offset IS NULL) OR "
            "(time_mode = 'daily_pattern' AND starts_at IS NULL AND ends_at IS NULL "
            "AND range_start IS NOT NULL AND range_end IS NOT NULL AND range_end >= range_start "
            "AND weekdays IS NOT NULL AND cardinality(weekdays) > 0 "
            "AND start_local_time IS NOT NULL AND end_local_time IS NOT NULL "
            "AND end_day_offset IS NOT NULL AND end_day_offset IN (0,1) "
            "AND (end_day_offset = 1 OR end_local_time > start_local_time)) OR "
            "(time_mode IN ('date_only','all_day') AND starts_at IS NULL AND ends_at IS NULL "
            "AND range_start IS NOT NULL AND range_end IS NOT NULL AND range_end >= range_start "
            "AND start_local_time IS NULL AND end_local_time IS NULL AND end_day_offset IS NULL)",
            name="time_mode_fields",
        ),
        CheckConstraint(
            "weekdays IS NULL OR (cardinality(weekdays) BETWEEN 1 AND 7 "
            "AND weekdays <@ ARRAY[1,2,3,4,5,6,7]::smallint[] "
            "AND array_position(weekdays, NULL) IS NULL "
            "AND app_private.unique_weekdays(weekdays))",
            name="valid_weekdays",
        ),
        Index("ix_schedules_user_range", "user_id", "range_start", "range_end"),
        Index("ix_schedules_user_start", "user_id", "starts_at"),
        Index("ix_schedules_user_end", "user_id", "ends_at"),
    )

    id: Mapped[UUID] = mapped_column(PGUUID, primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    title: Mapped[str] = mapped_column(Text)
    category: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text)
    time_mode: Mapped[str] = mapped_column(Text)
    timezone: Mapped[str] = mapped_column(Text)
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    range_start: Mapped[date | None] = mapped_column(Date)
    range_end: Mapped[date | None] = mapped_column(Date)
    weekdays: Mapped[list[int] | None] = mapped_column(ARRAY(SmallInteger))
    start_local_time: Mapped[time | None] = mapped_column(Time)
    end_local_time: Mapped[time | None] = mapped_column(Time)
    end_day_offset: Mapped[int | None] = mapped_column(SmallInteger)
    version: Mapped[int] = mapped_column(BigInteger, server_default="1")
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Tag(Timestamps, Base):
    __tablename__ = "tags"
    __table_args__ = (
        UniqueConstraint("user_id", "id"),
        UniqueConstraint("user_id", "normalized_name"),
        UniqueConstraint("user_id", "system_key"),
        CheckConstraint("length(btrim(name)) BETWEEN 1 AND 200", name="name_length"),
        CheckConstraint("system_key IN ('important','plan','target')", name="system_key_values"),
    )

    id: Mapped[UUID] = mapped_column(PGUUID, primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    name: Mapped[str] = mapped_column(Text)
    normalized_name: Mapped[str] = mapped_column(Text)
    system_key: Mapped[str | None] = mapped_column(Text)


class ScheduleTag(Base):
    __tablename__ = "schedule_tags"
    __table_args__ = (
        ForeignKeyConstraint(["user_id", "schedule_id"], ["schedules.user_id", "schedules.id"]),
        ForeignKeyConstraint(["user_id", "tag_id"], ["tags.user_id", "tags.id"]),
        Index("ix_schedule_tags_reverse", "user_id", "tag_id", "schedule_id"),
    )

    user_id: Mapped[UUID] = mapped_column(PGUUID, primary_key=True)
    schedule_id: Mapped[UUID] = mapped_column(PGUUID, primary_key=True)
    tag_id: Mapped[UUID] = mapped_column(PGUUID, primary_key=True)


class ScheduleReminder(Base):
    __tablename__ = "schedule_reminders"
    __table_args__ = (
        ForeignKeyConstraint(["user_id", "schedule_id"], ["schedules.user_id", "schedules.id"]),
        UniqueConstraint("user_id", "schedule_id", "offset_minutes"),
        CheckConstraint("offset_minutes >= 0", name="positive_offset"),
    )

    id: Mapped[UUID] = mapped_column(PGUUID, primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(PGUUID)
    schedule_id: Mapped[UUID] = mapped_column(PGUUID)
    offset_minutes: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class TargetNote(Timestamps, Base):
    __tablename__ = "target_notes"
    __table_args__ = (
        UniqueConstraint("user_id", "id"),
        CheckConstraint("length(btrim(title)) BETWEEN 1 AND 200", name="title_length"),
        CheckConstraint("target_end >= target_start", name="target_range"),
        CheckConstraint("version > 0", name="positive_version"),
        CheckConstraint(
            "NOT reminder_enabled OR (reminder_local_time IS NOT NULL "
            "AND reminder_timezone IS NOT NULL)",
            name="reminder_fields",
        ),
        Index("ix_target_notes_user_due", "user_id", "completed_at", "target_end"),
    )

    id: Mapped[UUID] = mapped_column(PGUUID, primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    title: Mapped[str] = mapped_column(Text)
    body: Mapped[str | None] = mapped_column(Text)
    target_start: Mapped[date] = mapped_column(Date)
    target_end: Mapped[date] = mapped_column(Date)
    is_important: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reminder_enabled: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    reminder_local_time: Mapped[time | None] = mapped_column(Time)
    reminder_timezone: Mapped[str | None] = mapped_column(Text)
    version: Mapped[int] = mapped_column(BigInteger, server_default="1")
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ChecklistItem(Timestamps, Base):
    __tablename__ = "checklist_items"
    __table_args__ = (
        ForeignKeyConstraint(["user_id", "note_id"], ["target_notes.user_id", "target_notes.id"]),
        CheckConstraint("length(btrim(title)) BETWEEN 1 AND 200", name="title_length"),
        CheckConstraint("position >= 0", name="positive_position"),
        Index("ix_checklist_items_order", "user_id", "note_id", "position", "id"),
    )

    id: Mapped[UUID] = mapped_column(PGUUID, primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(PGUUID)
    note_id: Mapped[UUID] = mapped_column(PGUUID)
    title: Mapped[str] = mapped_column(Text)
    position: Mapped[int] = mapped_column(Integer)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class NoteDependency(Base):
    __tablename__ = "note_dependencies"
    __table_args__ = (
        ForeignKeyConstraint(["user_id", "note_id"], ["target_notes.user_id", "target_notes.id"]),
        ForeignKeyConstraint(
            ["user_id", "prerequisite_note_id"], ["target_notes.user_id", "target_notes.id"]
        ),
        CheckConstraint("note_id <> prerequisite_note_id", name="not_self"),
        Index("ix_note_dependencies_reverse", "user_id", "prerequisite_note_id"),
    )

    user_id: Mapped[UUID] = mapped_column(PGUUID, primary_key=True)
    note_id: Mapped[UUID] = mapped_column(PGUUID, primary_key=True)
    prerequisite_note_id: Mapped[UUID] = mapped_column(PGUUID, primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class CalendarConnection(Base):
    __tablename__ = "calendar_connections"
    __table_args__ = (
        UniqueConstraint("user_id", "id"),
        CheckConstraint(
            "connection_status IN "
            "('pending','connected','reconnect_required','disconnecting','disconnected')",
            name="status_values",
        ),
    )

    id: Mapped[UUID] = mapped_column(PGUUID, primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"), unique=True)
    google_issuer: Mapped[str] = mapped_column(Text)
    google_subject: Mapped[str] = mapped_column(Text)
    google_calendar_id: Mapped[str | None] = mapped_column(Text)
    granted_scopes: Mapped[list[str]] = mapped_column(ARRAY(Text), server_default=text("'{}'"))
    connection_status: Mapped[str] = mapped_column(Text, server_default="pending")
    reminders_paused: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    last_error_code: Mapped[str | None] = mapped_column(Text)
    connected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class CalendarCredential(Base):
    __tablename__ = "calendar_credentials"
    __table_args__ = (
        ForeignKeyConstraint(
            ["user_id", "connection_id"],
            ["calendar_connections.user_id", "calendar_connections.id"],
        ),
        {"schema": "app_private"},
    )

    connection_id: Mapped[UUID] = mapped_column(PGUUID, primary_key=True)
    user_id: Mapped[UUID] = mapped_column(PGUUID)
    refresh_token_ciphertext: Mapped[bytes] = mapped_column(LargeBinary)
    encryption_key_version: Mapped[int] = mapped_column(Integer)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class CalendarMapping(Timestamps, Base):
    __tablename__ = "calendar_mappings"
    __table_args__ = (
        UniqueConstraint("user_id", "id"),
        UniqueConstraint("user_id", "note_id"),
        UniqueConstraint("google_calendar_id", "google_event_id"),
        ForeignKeyConstraint(["user_id", "note_id"], ["target_notes.user_id", "target_notes.id"]),
        ForeignKeyConstraint(
            ["user_id", "connection_id"],
            ["calendar_connections.user_id", "calendar_connections.id"],
        ),
        CheckConstraint("event_generation > 0 AND desired_version > 0", name="positive_versions"),
        CheckConstraint("desired_state IN ('active','stopped')", name="desired_values"),
        CheckConstraint("applied_state IN ('active','stopped','unknown')", name="applied_values"),
        CheckConstraint(
            "(applied_version IS NULL AND applied_state IS NULL) OR "
            "(applied_version IS NOT NULL AND applied_state IS NOT NULL "
            "AND applied_version >= 0 AND applied_version <= desired_version)",
            name="valid_applied_version",
        ),
    )

    id: Mapped[UUID] = mapped_column(PGUUID, primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(PGUUID)
    note_id: Mapped[UUID] = mapped_column(PGUUID)
    connection_id: Mapped[UUID] = mapped_column(PGUUID)
    google_calendar_id: Mapped[str | None] = mapped_column(Text)
    google_event_id: Mapped[str | None] = mapped_column(Text)
    event_generation: Mapped[int] = mapped_column(Integer, server_default="1")
    desired_state: Mapped[str] = mapped_column(Text)
    desired_version: Mapped[int] = mapped_column(BigInteger, server_default="1")
    applied_state: Mapped[str | None] = mapped_column(Text)
    applied_version: Mapped[int | None] = mapped_column(BigInteger)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error_code: Mapped[str | None] = mapped_column(Text)


class CalendarOutbox(Base):
    __tablename__ = "calendar_outbox"
    __table_args__ = (
        ForeignKeyConstraint(
            ["user_id", "mapping_id"], ["calendar_mappings.user_id", "calendar_mappings.id"]
        ),
        UniqueConstraint("mapping_id", "desired_version"),
        CheckConstraint("desired_version > 0 AND attempt_count >= 0", name="positive_versions"),
        CheckConstraint(
            "status IN ('pending','processing','succeeded','failed','superseded')",
            name="status_values",
        ),
        CheckConstraint("(lease_until IS NULL) = (lease_token IS NULL)", name="lease_fields"),
        Index("ix_calendar_outbox_runnable", "status", "next_attempt_at"),
    )

    id: Mapped[UUID] = mapped_column(PGUUID, primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(PGUUID)
    mapping_id: Mapped[UUID] = mapped_column(PGUUID)
    desired_version: Mapped[int] = mapped_column(BigInteger)
    status: Mapped[str] = mapped_column(Text, server_default="pending")
    attempt_count: Mapped[int] = mapped_column(Integer, server_default="0")
    next_attempt_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    lease_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    lease_token: Mapped[UUID | None] = mapped_column(PGUUID)
    last_error_code: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
