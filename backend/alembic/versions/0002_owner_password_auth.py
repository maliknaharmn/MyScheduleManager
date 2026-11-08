"""Add owner-bound password credentials, single-use links and persistent throttles.

Revision ID: 0002
Revises: 0001

Additive only: do not change users, Google identities, account data or sessions.
Deploy a backend accepting both revisions with password auth disabled BEFORE upgrade.
"""

import sqlalchemy as sa

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "password_credentials",
        sa.Column("user_id", sa.UUID(), sa.ForeignKey("public.users.id"), primary_key=True),
        sa.Column("username", sa.Text(), nullable=False),
        sa.Column("email", sa.Text(), nullable=False),
        sa.Column("password_hash", sa.Text()),
        sa.Column("email_verified_at", sa.DateTime(timezone=True)),
        sa.Column("password_changed_at", sa.DateTime(timezone=True)),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("username"),
        sa.UniqueConstraint("email"),
        sa.CheckConstraint(
            "username = lower(username) AND username ~ '^[a-z0-9_.]{3,30}$'", name="username_format"
        ),
        sa.CheckConstraint("email = lower(email) AND email = btrim(email)", name="email_format"),
        sa.CheckConstraint(
            "(password_hash IS NULL AND email_verified_at IS NULL AND password_changed_at IS NULL) OR "
            "(password_hash IS NOT NULL AND email_verified_at IS NOT NULL AND password_changed_at IS NOT NULL)",
            name="credential_state",
        ),
        schema="app_private",
    )
    op.create_table(
        "password_links",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("user_id", sa.UUID(), sa.ForeignKey("public.users.id"), nullable=False),
        sa.Column("purpose", sa.Text(), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint("purpose IN ('invitation','reset')", name="purpose_values"),
        sa.CheckConstraint("expires_at > created_at", name="valid_lifetime"),
        schema="app_private",
    )
    op.create_index(
        "ix_password_links_user_purpose",
        "password_links",
        ["user_id", "purpose"],
        schema="app_private",
    )
    op.create_table(
        "password_rate_limits",
        sa.Column("bucket_hash", sa.String(64), primary_key=True),
        sa.Column("user_id", sa.UUID(), sa.ForeignKey("public.users.id"), nullable=False),
        sa.Column("window_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("attempts", sa.BigInteger(), nullable=False),
        sa.CheckConstraint("attempts > 0", name="positive_attempts"),
        schema="app_private",
    )
    op.create_index(
        "ix_password_rate_limits_window",
        "password_rate_limits",
        ["window_start"],
        schema="app_private",
    )
    for table in ("password_credentials", "password_links", "password_rate_limits"):
        qualified = f"app_private.{table}"
        op.execute(f"REVOKE ALL ON {qualified} FROM PUBLIC, myschedule_app, myschedule_worker")
        op.execute(f"ALTER TABLE {qualified} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {qualified} FORCE ROW LEVEL SECURITY")
        op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {qualified} TO myschedule_auth")
        op.execute(
            f"CREATE POLICY auth_access ON {qualified} TO myschedule_auth USING (true) WITH CHECK (true)"
        )


def downgrade() -> None:
    # Operational rollback uses the compatible backend with native auth disabled;
    # do not downgrade a live credential store just to roll back application code.
    op.drop_table("password_rate_limits", schema="app_private")
    op.drop_table("password_links", schema="app_private")
    op.drop_table("password_credentials", schema="app_private")
