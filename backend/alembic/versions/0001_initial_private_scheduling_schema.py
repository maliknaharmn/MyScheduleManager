"""initial private scheduling schema

Revision ID: 0001
Revises:
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0001"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA app_private")
    op.execute("REVOKE ALL ON SCHEMA app_private FROM PUBLIC")
    op.execute("""
        CREATE FUNCTION app_private.unique_weekdays(values_ smallint[])
        RETURNS boolean LANGUAGE sql IMMUTABLE STRICT SET search_path = '' AS $$
            SELECT cardinality(values_) = (SELECT count(DISTINCT d) FROM unnest(values_) AS d)
        $$
    """)
    op.execute("REVOKE ALL ON FUNCTION app_private.unique_weekdays(smallint[]) FROM PUBLIC")
    op.create_table(
        "users",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("google_issuer", sa.Text(), nullable=False),
        sa.Column("google_subject", sa.Text(), nullable=False),
        sa.Column("email", sa.Text(), nullable=False),
        sa.Column("display_name", sa.Text(), nullable=True),
        sa.Column("disabled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_users")),
        sa.UniqueConstraint(
            "google_issuer", "google_subject", name=op.f("uq_users_google_issuer_google_subject")
        ),
    )
    op.create_table(
        "calendar_connections",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("google_issuer", sa.Text(), nullable=False),
        sa.Column("google_subject", sa.Text(), nullable=False),
        sa.Column("google_calendar_id", sa.Text(), nullable=True),
        sa.Column(
            "granted_scopes",
            postgresql.ARRAY(sa.Text()),
            server_default=sa.text("'{}'"),
            nullable=False,
        ),
        sa.Column("connection_status", sa.Text(), server_default="pending", nullable=False),
        sa.Column(
            "reminders_paused", sa.Boolean(), server_default=sa.text("false"), nullable=False
        ),
        sa.Column("last_error_code", sa.Text(), nullable=True),
        sa.Column("connected_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "connection_status IN ('pending','connected','reconnect_required','disconnecting','disconnected')",
            name=op.f("ck_calendar_connections_status_values"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_calendar_connections_user_id_users")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_calendar_connections")),
        sa.UniqueConstraint("user_id", "id", name=op.f("uq_calendar_connections_user_id_id")),
        sa.UniqueConstraint("user_id", name=op.f("uq_calendar_connections_user_id")),
    )
    op.create_table(
        "profiles",
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("timezone", sa.Text(), server_default="Asia/Jakarta", nullable=False),
        sa.Column("daily_reminder_time", sa.Time(), server_default="08:00", nullable=False),
        sa.Column("version", sa.BigInteger(), server_default="1", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("version > 0", name=op.f("ck_profiles_positive_version")),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name=op.f("fk_profiles_user_id_users")),
        sa.PrimaryKeyConstraint("user_id", name=op.f("pk_profiles")),
    )
    op.create_table(
        "schedules",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("category", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("time_mode", sa.Text(), nullable=False),
        sa.Column("timezone", sa.Text(), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("range_start", sa.Date(), nullable=True),
        sa.Column("range_end", sa.Date(), nullable=True),
        sa.Column("weekdays", postgresql.ARRAY(sa.SmallInteger()), nullable=True),
        sa.Column("start_local_time", sa.Time(), nullable=True),
        sa.Column("end_local_time", sa.Time(), nullable=True),
        sa.Column("end_day_offset", sa.SmallInteger(), nullable=True),
        sa.Column("version", sa.BigInteger(), server_default="1", nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "(time_mode = 'timed_interval' AND starts_at IS NOT NULL AND ends_at IS NOT NULL AND ends_at > starts_at AND range_start IS NULL AND range_end IS NULL AND weekdays IS NULL AND start_local_time IS NULL AND end_local_time IS NULL AND end_day_offset IS NULL) OR (time_mode = 'daily_pattern' AND starts_at IS NULL AND ends_at IS NULL AND range_start IS NOT NULL AND range_end IS NOT NULL AND range_end >= range_start AND weekdays IS NOT NULL AND cardinality(weekdays) > 0 AND start_local_time IS NOT NULL AND end_local_time IS NOT NULL AND end_day_offset IS NOT NULL AND end_day_offset IN (0,1) AND (end_day_offset = 1 OR end_local_time > start_local_time)) OR (time_mode IN ('date_only','all_day') AND starts_at IS NULL AND ends_at IS NULL AND range_start IS NOT NULL AND range_end IS NOT NULL AND range_end >= range_start AND start_local_time IS NULL AND end_local_time IS NULL AND end_day_offset IS NULL)",
            name=op.f("ck_schedules_time_mode_fields"),
        ),
        sa.CheckConstraint(
            "category IN ('Work','Academic','Business','Organization','Personal','Social','Other')",
            name=op.f("ck_schedules_category_values"),
        ),
        sa.CheckConstraint(
            "status IN ('Confirmed','Tentative')", name=op.f("ck_schedules_status_values")
        ),
        sa.CheckConstraint(
            "length(btrim(title)) BETWEEN 1 AND 200", name=op.f("ck_schedules_title_length")
        ),
        sa.CheckConstraint("version > 0", name=op.f("ck_schedules_positive_version")),
        sa.CheckConstraint(
            "weekdays IS NULL OR (cardinality(weekdays) BETWEEN 1 AND 7 AND weekdays <@ ARRAY[1,2,3,4,5,6,7]::smallint[] AND array_position(weekdays, NULL) IS NULL AND app_private.unique_weekdays(weekdays))",
            name=op.f("ck_schedules_valid_weekdays"),
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name=op.f("fk_schedules_user_id_users")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_schedules")),
        sa.UniqueConstraint("user_id", "id", name=op.f("uq_schedules_user_id_id")),
    )
    op.create_index("ix_schedules_user_end", "schedules", ["user_id", "ends_at"], unique=False)
    op.create_index(
        "ix_schedules_user_range",
        "schedules",
        ["user_id", "range_start", "range_end"],
        unique=False,
    )
    op.create_index("ix_schedules_user_start", "schedules", ["user_id", "starts_at"], unique=False)
    op.create_table(
        "sessions",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "last_seen_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("expires_at > created_at", name=op.f("ck_sessions_valid_lifetime")),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name=op.f("fk_sessions_user_id_users")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_sessions")),
        sa.UniqueConstraint("token_hash", name=op.f("uq_sessions_token_hash")),
    )
    op.create_index("ix_sessions_expires_at", "sessions", ["expires_at"], unique=False)
    op.create_index("ix_sessions_user_id", "sessions", ["user_id"], unique=False)
    op.create_table(
        "tags",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("normalized_name", sa.Text(), nullable=False),
        sa.Column("system_key", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "system_key IN ('important','plan','target')", name=op.f("ck_tags_system_key_values")
        ),
        sa.CheckConstraint(
            "length(btrim(name)) BETWEEN 1 AND 200", name=op.f("ck_tags_name_length")
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name=op.f("fk_tags_user_id_users")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_tags")),
        sa.UniqueConstraint("user_id", "id", name=op.f("uq_tags_user_id_id")),
        sa.UniqueConstraint(
            "user_id", "normalized_name", name=op.f("uq_tags_user_id_normalized_name")
        ),
        sa.UniqueConstraint("user_id", "system_key", name=op.f("uq_tags_user_id_system_key")),
    )
    op.create_table(
        "target_notes",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("target_start", sa.Date(), nullable=False),
        sa.Column("target_end", sa.Date(), nullable=False),
        sa.Column("is_important", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "reminder_enabled", sa.Boolean(), server_default=sa.text("false"), nullable=False
        ),
        sa.Column("reminder_local_time", sa.Time(), nullable=True),
        sa.Column("reminder_timezone", sa.Text(), nullable=True),
        sa.Column("version", sa.BigInteger(), server_default="1", nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "NOT reminder_enabled OR (reminder_local_time IS NOT NULL AND reminder_timezone IS NOT NULL)",
            name=op.f("ck_target_notes_reminder_fields"),
        ),
        sa.CheckConstraint(
            "length(btrim(title)) BETWEEN 1 AND 200", name=op.f("ck_target_notes_title_length")
        ),
        sa.CheckConstraint("target_end >= target_start", name=op.f("ck_target_notes_target_range")),
        sa.CheckConstraint("version > 0", name=op.f("ck_target_notes_positive_version")),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_target_notes_user_id_users")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_target_notes")),
        sa.UniqueConstraint("user_id", "id", name=op.f("uq_target_notes_user_id_id")),
    )
    op.create_index(
        "ix_target_notes_user_due",
        "target_notes",
        ["user_id", "completed_at", "target_end"],
        unique=False,
    )
    op.create_table(
        "calendar_credentials",
        sa.Column("connection_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("refresh_token_ciphertext", sa.LargeBinary(), nullable=False),
        sa.Column("encryption_key_version", sa.Integer(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["user_id", "connection_id"],
            ["calendar_connections.user_id", "calendar_connections.id"],
            name=op.f("fk_calendar_credentials_user_id_connection_id_calendar_connections"),
        ),
        sa.PrimaryKeyConstraint("connection_id", name=op.f("pk_calendar_credentials")),
        schema="app_private",
    )
    op.create_table(
        "calendar_mappings",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("note_id", sa.UUID(), nullable=False),
        sa.Column("connection_id", sa.UUID(), nullable=False),
        sa.Column("google_calendar_id", sa.Text(), nullable=True),
        sa.Column("google_event_id", sa.Text(), nullable=True),
        sa.Column("event_generation", sa.Integer(), server_default="1", nullable=False),
        sa.Column("desired_state", sa.Text(), nullable=False),
        sa.Column("desired_version", sa.BigInteger(), server_default="1", nullable=False),
        sa.Column("applied_state", sa.Text(), nullable=True),
        sa.Column("applied_version", sa.BigInteger(), nullable=True),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error_code", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "applied_state IN ('active','stopped','unknown')",
            name=op.f("ck_calendar_mappings_applied_values"),
        ),
        sa.CheckConstraint(
            "desired_state IN ('active','stopped')",
            name=op.f("ck_calendar_mappings_desired_values"),
        ),
        sa.CheckConstraint(
            "(applied_version IS NULL AND applied_state IS NULL) OR (applied_version IS NOT NULL AND applied_state IS NOT NULL AND applied_version >= 0 AND applied_version <= desired_version)",
            name=op.f("ck_calendar_mappings_valid_applied_version"),
        ),
        sa.CheckConstraint(
            "event_generation > 0 AND desired_version > 0",
            name=op.f("ck_calendar_mappings_positive_versions"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id", "connection_id"],
            ["calendar_connections.user_id", "calendar_connections.id"],
            name=op.f("fk_calendar_mappings_user_id_connection_id_calendar_connections"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id", "note_id"],
            ["target_notes.user_id", "target_notes.id"],
            name=op.f("fk_calendar_mappings_user_id_note_id_target_notes"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_calendar_mappings")),
        sa.UniqueConstraint(
            "google_calendar_id",
            "google_event_id",
            name=op.f("uq_calendar_mappings_google_calendar_id_google_event_id"),
        ),
        sa.UniqueConstraint("user_id", "id", name=op.f("uq_calendar_mappings_user_id_id")),
        sa.UniqueConstraint(
            "user_id", "note_id", name=op.f("uq_calendar_mappings_user_id_note_id")
        ),
    )
    op.create_table(
        "checklist_items",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("note_id", sa.UUID(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "length(btrim(title)) BETWEEN 1 AND 200", name=op.f("ck_checklist_items_title_length")
        ),
        sa.CheckConstraint("position >= 0", name=op.f("ck_checklist_items_positive_position")),
        sa.ForeignKeyConstraint(
            ["user_id", "note_id"],
            ["target_notes.user_id", "target_notes.id"],
            name=op.f("fk_checklist_items_user_id_note_id_target_notes"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_checklist_items")),
    )
    op.create_index(
        "ix_checklist_items_order",
        "checklist_items",
        ["user_id", "note_id", "position", "id"],
        unique=False,
    )
    op.create_table(
        "note_dependencies",
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("note_id", sa.UUID(), nullable=False),
        sa.Column("prerequisite_note_id", sa.UUID(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "note_id <> prerequisite_note_id", name=op.f("ck_note_dependencies_not_self")
        ),
        sa.ForeignKeyConstraint(
            ["user_id", "note_id"],
            ["target_notes.user_id", "target_notes.id"],
            name=op.f("fk_note_dependencies_user_id_note_id_target_notes"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id", "prerequisite_note_id"],
            ["target_notes.user_id", "target_notes.id"],
            name=op.f("fk_note_dependencies_user_id_prerequisite_note_id_target_notes"),
        ),
        sa.PrimaryKeyConstraint(
            "user_id", "note_id", "prerequisite_note_id", name=op.f("pk_note_dependencies")
        ),
    )
    op.create_index(
        "ix_note_dependencies_reverse",
        "note_dependencies",
        ["user_id", "prerequisite_note_id"],
        unique=False,
    )
    op.create_table(
        "schedule_reminders",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("schedule_id", sa.UUID(), nullable=False),
        sa.Column("offset_minutes", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "offset_minutes >= 0", name=op.f("ck_schedule_reminders_positive_offset")
        ),
        sa.ForeignKeyConstraint(
            ["user_id", "schedule_id"],
            ["schedules.user_id", "schedules.id"],
            name=op.f("fk_schedule_reminders_user_id_schedule_id_schedules"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_schedule_reminders")),
        sa.UniqueConstraint(
            "user_id",
            "schedule_id",
            "offset_minutes",
            name=op.f("uq_schedule_reminders_user_id_schedule_id_offset_minutes"),
        ),
    )
    op.create_table(
        "schedule_tags",
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("schedule_id", sa.UUID(), nullable=False),
        sa.Column("tag_id", sa.UUID(), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id", "schedule_id"],
            ["schedules.user_id", "schedules.id"],
            name=op.f("fk_schedule_tags_user_id_schedule_id_schedules"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id", "tag_id"],
            ["tags.user_id", "tags.id"],
            name=op.f("fk_schedule_tags_user_id_tag_id_tags"),
        ),
        sa.PrimaryKeyConstraint("user_id", "schedule_id", "tag_id", name=op.f("pk_schedule_tags")),
    )
    op.create_index(
        "ix_schedule_tags_reverse",
        "schedule_tags",
        ["user_id", "tag_id", "schedule_id"],
        unique=False,
    )
    op.create_table(
        "calendar_outbox",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("mapping_id", sa.UUID(), nullable=False),
        sa.Column("desired_version", sa.BigInteger(), nullable=False),
        sa.Column("status", sa.Text(), server_default="pending", nullable=False),
        sa.Column("attempt_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column(
            "next_attempt_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("lease_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("lease_token", sa.UUID(), nullable=True),
        sa.Column("last_error_code", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('pending','processing','succeeded','failed','superseded')",
            name=op.f("ck_calendar_outbox_status_values"),
        ),
        sa.CheckConstraint(
            "(lease_until IS NULL) = (lease_token IS NULL)",
            name=op.f("ck_calendar_outbox_lease_fields"),
        ),
        sa.CheckConstraint(
            "desired_version > 0 AND attempt_count >= 0",
            name=op.f("ck_calendar_outbox_positive_versions"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id", "mapping_id"],
            ["calendar_mappings.user_id", "calendar_mappings.id"],
            name=op.f("fk_calendar_outbox_user_id_mapping_id_calendar_mappings"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_calendar_outbox")),
        sa.UniqueConstraint(
            "mapping_id",
            "desired_version",
            name=op.f("uq_calendar_outbox_mapping_id_desired_version"),
        ),
    )
    op.create_index(
        "ix_calendar_outbox_runnable",
        "calendar_outbox",
        ["status", "next_attempt_at"],
        unique=False,
    )
    install_security()


def install_security() -> None:
    # Roles are provisioned explicitly, never created as superusers by an app migration.
    app = "myschedule_app"
    auth = "myschedule_auth"
    worker = "myschedule_worker"
    roles = (app, auth, worker)
    owned_tables = (
        "profiles",
        "schedules",
        "tags",
        "schedule_tags",
        "schedule_reminders",
        "target_notes",
        "checklist_items",
        "note_dependencies",
        "calendar_connections",
        "calendar_mappings",
        "calendar_outbox",
    )
    for role in roles:
        op.execute(f"GRANT USAGE ON SCHEMA public, app_private TO {role}")
        op.execute(f"GRANT EXECUTE ON FUNCTION app_private.unique_weekdays(smallint[]) TO {role}")
    # Schema access does not imply table access. There are no PUBLIC data grants.
    op.execute("REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC")
    op.execute("REVOKE ALL ON ALL TABLES IN SCHEMA app_private FROM PUBLIC")
    op.execute(f"GRANT SELECT ON public.alembic_version TO {app}")
    owner_condition = "user_id = nullif(current_setting('app.user_id', true), '')::uuid"
    for table in owned_tables:
        op.execute(f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE public.{table} FORCE ROW LEVEL SECURITY")
        # App reads status, but only worker can write mapping/outbox or external credentials.
        app_operations = (
            ("SELECT",)
            if table in {"calendar_connections", "calendar_mappings", "calendar_outbox"}
            else ("SELECT", "INSERT", "UPDATE", "DELETE")
        )
        for operation in app_operations:
            op.execute(f"GRANT {operation} ON public.{table} TO {app}")
            clauses = ""
            if operation in {"SELECT", "UPDATE", "DELETE"}:
                clauses += f" USING ({owner_condition})"
            if operation in {"INSERT", "UPDATE"}:
                clauses += f" WITH CHECK ({owner_condition})"
            op.execute(
                f"CREATE POLICY app_{operation.lower()} ON public.{table} FOR {operation} TO {app}{clauses}"
            )
    # Narrow auth-only path for session lookup before a verified user context exists.
    for table in ("users", "sessions"):
        op.execute(f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE public.{table} FORCE ROW LEVEL SECURITY")
        op.execute(f"GRANT SELECT, INSERT, UPDATE ON public.{table} TO {auth}")
        for operation in ("SELECT", "INSERT", "UPDATE"):
            clauses = " USING (true)" if operation in {"SELECT", "UPDATE"} else ""
            clauses += " WITH CHECK (true)" if operation in {"INSERT", "UPDATE"} else ""
            op.execute(
                f"CREATE POLICY auth_{operation.lower()} ON public.{table} FOR {operation} TO {auth}{clauses}"
            )
    # First-login bootstrap still needs verified user context for profile and system-tag inserts.
    for table in ("profiles", "tags"):
        op.execute(f"GRANT SELECT, INSERT ON public.{table} TO {auth}")
        op.execute(
            f"CREATE POLICY auth_select ON public.{table} FOR SELECT TO {auth} USING ({owner_condition})"
        )
        op.execute(
            f"CREATE POLICY auth_insert ON public.{table} FOR INSERT TO {auth} WITH CHECK ({owner_condition})"
        )
    for table in ("calendar_connections", "calendar_mappings", "calendar_outbox"):
        op.execute(f"GRANT SELECT, INSERT, UPDATE ON public.{table} TO {worker}")
        op.execute(
            f"CREATE POLICY worker_access ON public.{table} FOR ALL TO {worker} USING (true) WITH CHECK (true)"
        )
    op.execute(f"GRANT SELECT ON public.target_notes TO {worker}")
    op.execute(
        f"CREATE POLICY worker_read ON public.target_notes FOR SELECT TO {worker} USING (true)"
    )
    op.execute("ALTER TABLE app_private.calendar_credentials ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE app_private.calendar_credentials FORCE ROW LEVEL SECURITY")
    op.execute(
        f"GRANT SELECT, INSERT, UPDATE, DELETE ON app_private.calendar_credentials TO {worker}"
    )
    op.execute(
        f"CREATE POLICY worker_credentials ON app_private.calendar_credentials TO {worker} USING (true) WITH CHECK (true)"
    )

    # Tags have special system identities. Runtime clients may only create/change custom tags.
    op.execute("DROP POLICY app_insert ON public.tags")
    op.execute("DROP POLICY app_update ON public.tags")
    op.execute("DROP POLICY app_delete ON public.tags")
    op.execute(
        f"CREATE POLICY app_insert ON public.tags FOR INSERT TO {app} WITH CHECK ({owner_condition} AND system_key IS NULL)"
    )
    op.execute(
        f"CREATE POLICY app_update ON public.tags FOR UPDATE TO {app} USING ({owner_condition} AND system_key IS NULL) WITH CHECK ({owner_condition} AND system_key IS NULL)"
    )
    op.execute(
        f"CREATE POLICY app_delete ON public.tags FOR DELETE TO {app} USING ({owner_condition} AND system_key IS NULL)"
    )


def downgrade() -> None:
    # ### commands auto generated by Alembic - please adjust! ###
    op.drop_index("ix_calendar_outbox_runnable", table_name="calendar_outbox")
    op.drop_table("calendar_outbox")
    op.drop_index("ix_schedule_tags_reverse", table_name="schedule_tags")
    op.drop_table("schedule_tags")
    op.drop_table("schedule_reminders")
    op.drop_index("ix_note_dependencies_reverse", table_name="note_dependencies")
    op.drop_table("note_dependencies")
    op.drop_index("ix_checklist_items_order", table_name="checklist_items")
    op.drop_table("checklist_items")
    op.drop_table("calendar_mappings")
    op.drop_table("calendar_credentials", schema="app_private")
    op.drop_index("ix_target_notes_user_due", table_name="target_notes")
    op.drop_table("target_notes")
    op.drop_table("tags")
    op.drop_index("ix_sessions_user_id", table_name="sessions")
    op.drop_index("ix_sessions_expires_at", table_name="sessions")
    op.drop_table("sessions")
    op.drop_index("ix_schedules_user_start", table_name="schedules")
    op.drop_index("ix_schedules_user_range", table_name="schedules")
    op.drop_index("ix_schedules_user_end", table_name="schedules")
    op.drop_table("schedules")
    op.drop_table("profiles")
    op.drop_table("calendar_connections")
    op.drop_table("users")
    op.execute("DROP FUNCTION app_private.unique_weekdays(smallint[])")
    op.execute("DROP SCHEMA app_private")
    # ### end Alembic commands ###
